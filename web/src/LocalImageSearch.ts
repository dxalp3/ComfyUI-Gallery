import type { FileDetails } from './types';

export type LocalSearchField = 'all' | 'name' | 'hydrus' | 'positive' | 'negative';
export interface LocalPrompts { positive: string; negative: string }
type Polarity = keyof LocalPrompts;
type Node = { type: string; title: string; inputs: Record<string, unknown>; widgets?: unknown[] };

function object(value: unknown): Record<string, any> {
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { return {}; }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function text(value: unknown, depth = 0): string {
    if (depth > 8) return '';
    if (typeof value === 'string') return value.trim();
    if (value && typeof value === 'object' && !Array.isArray(value)) return text((value as Record<string, unknown>).content, depth + 1);
    return '';
}

function polarity(name: string): Polarity | undefined {
    const normalized = name.toLowerCase().replace(/[\s-]+/g, '_');
    if (/^(positive|pos)(?:_prompt|_conditioning)?$/.test(normalized)) return 'positive';
    if (/^(negative|neg)(?:_prompt|_conditioning)?$/.test(normalized)) return 'negative';
    return undefined;
}

const encoderTextInputs: Record<string, string[]> = {
    CLIPTextEncodeFlux: ['clip_l', 't5xxl'],
    CLIPTextEncodeSD3: ['clip_l', 'clip_g', 't5xxl'],
};

function isPromptInput(name: string, nodeType: string): boolean {
    return /^(text(?:_\w+)?|prompt(?:_\w+)?|wildcard(?:_text)?|populated_text|value|string|conditioning(?:_\w+)?|conditioning\d*)$/i.test(name)
        || !!encoderTextInputs[nodeType]?.includes(name);
}

function promptGraph(raw: unknown): Map<string, Node> {
    return new Map(Object.entries(object(raw)).filter(([, value]) => value && typeof value === 'object' && value.inputs)
        .map(([id, value]) => [id, { type: String(value.class_type || value.type || ''), title: String(value._meta?.title || value.title || ''), inputs: object(value.inputs) }]));
}

function workflowGraph(raw: unknown): Map<string, Node> {
    const workflow = object(raw);
    if (!Array.isArray(workflow.nodes)) return new Map();
    const links = new Map<string, unknown>();
    for (const link of Array.isArray(workflow.links) ? workflow.links : Object.values(object(workflow.links))) {
        if (Array.isArray(link)) links.set(String(link[0]), [link[1], link[2]]);
        else if (link && typeof link === 'object') links.set(String(link.id), [link.origin_id, link.origin_slot]);
    }
    const nodes = new Map<string, Node>();
    for (const item of workflow.nodes) {
        if (!item || item.id === undefined) continue;
        const inputs: Record<string, unknown> = {};
        for (const input of Array.isArray(item.inputs) ? item.inputs : []) {
            if (typeof input?.name !== 'string') continue;
            if (input.link !== undefined && input.link !== null) inputs[input.name] = links.get(String(input.link));
            else if (input.value !== undefined) inputs[input.name] = input.value;
        }
        nodes.set(String(item.id), { type: String(item.type || ''), title: String(item.title || ''), inputs,
            widgets: Array.isArray(item.widgets_values) ? item.widgets_values : [] });
    }
    return nodes;
}

/** Follow named conditioning/text connections. Node IDs, colours and prompt wording do not determine polarity. */
function collectGraph(graph: Map<string, Node>): LocalPrompts {
    const collected = { positive: new Set<string>(), negative: new Set<string>() };
    const visited = { positive: new Set<string>(), negative: new Set<string>() };
    let steps = 0;
    function collect(value: unknown, side: Polarity, depth = 0) {
        if (++steps > 10000 || depth > 128) return;
        if (Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number')) {
            const id = String(value[0]);
            const node = graph.get(id);
            if (!node || visited[side].has(id)) return;
            visited[side].add(id);
            for (const [name, input] of Object.entries(node.inputs)) {
                const branch = polarity(name);
                if (branch ? branch === side : isPromptInput(name, node.type) || /reroute/i.test(node.type)) collect(input, side, depth + 1);
            }
            // Workflow-only CLIP text encoders store their text in widgets rather than API inputs.
            // Restrict this fallback to known text nodes so model filenames/settings never become prompts.
            const encoderInputs = encoderTextInputs[node.type];
            if (encoderInputs || /^(CLIPTextEncode(?:SDXL(?:Refiner)?)?|PrimitiveNode|String|TextBox|CR Prompt Text)$/i.test(node.type)) {
                // Flux/SD3 put prompt widgets first, before guidance or empty-padding settings.
                const widgets = encoderInputs ? (node.widgets || []).slice(0, encoderInputs.length) : node.widgets || [];
                for (const widget of widgets) {
                    const value = text(widget);
                    if (value) collected[side].add(value);
                }
            }
        } else {
            const valueText = text(value);
            if (valueText) collected[side].add(valueText);
        }
    }
    for (const [id, node] of graph) {
        for (const [name, input] of Object.entries(node.inputs)) {
            const side = polarity(name);
            if (side) collect(input, side);
            else if (name === 'conditioning' && node.type === 'BasicGuider') collect(input, 'positive');
        }
    }
    for (const [id, node] of graph) {
        const labelled = /\bnegative(?:[ _-]prompt)?\b/i.test(node.title) ? 'negative' : /\bpositive(?:[ _-]prompt)?\b/i.test(node.title) ? 'positive' : undefined;
        if (labelled && collected[labelled].size === 0) collect([id, 0], labelled);
    }
    return { positive: [...collected.positive].join('\n'), negative: [...collected.negative].join('\n') };
}

/** API prompts are authoritative; saved-workflow links and explicit fields fill missing sides. */
export function extractLocalPrompts(metadata: unknown): LocalPrompts {
    const source = object(metadata);
    const directPrompt = object(source.prompt);
    const api = collectGraph(promptGraph(source.prompt));
    const workflow = (!api.positive || !api.negative) ? collectGraph(workflowGraph(source.workflow)) : { positive: '', negative: '' };
    const result: LocalPrompts = { positive: '', negative: '' };
    for (const side of ['positive', 'negative'] as const) {
        result[side] = api[side] || text(directPrompt[side]) || text(directPrompt[`${side}_prompt`]) || text(source[side]) || text(source[`${side}_prompt`]) || workflow[side];
    }
    // Common parameters text has explicit sections; do not infer polarity from vocabulary.
    const parameters = typeof source.parameters === 'string' ? source.parameters : '';
    if (parameters) {
        const withoutSettings = parameters.split(/\nSteps:\s*\d/i)[0];
        const parts = withoutSettings.split(/\nNegative prompt:\s*/i);
        if (!result.positive) result.positive = parts[0].trim();
        if (!result.negative && parts.length > 1) result.negative = parts.slice(1).join('\n').trim();
    }
    return result;
}

/** Active cached tags across services, including Hydrus' sibling-resolved display tags. */
export function extractHydrusTags(metadata: unknown): string[] {
    const result = new Set<string>();
    for (const service of Object.values(object(object(metadata).tags))) {
        const entry = object(service);
        for (const tags of [entry.display_tags, entry.storage_tags]) {
            const statuses = object(tags);
            for (const status of ['0', '2']) {
                for (const tag of Array.isArray(statuses[status]) ? statuses[status] : []) {
                    if (typeof tag === 'string' && tag.trim()) result.add(tag);
                }
            }
        }
    }
    return [...result];
}

export function matchesLocalImage(file: Pick<FileDetails, 'name' | 'metadata'>, query: string, field: LocalSearchField,
    hydrusTags: string[] = [], prompts?: LocalPrompts): boolean {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return true;
    const parsed = prompts || (field === 'all' || field === 'positive' || field === 'negative' ? extractLocalPrompts(file.metadata) : { positive: '', negative: '' });
    const contains = (value: string) => value.toLocaleLowerCase().includes(needle);
    return ((field === 'all' || field === 'name') && contains(file.name || '')) ||
        ((field === 'all' || field === 'hydrus') && hydrusTags.some(contains)) ||
        ((field === 'all' || field === 'positive') && contains(parsed.positive)) ||
        ((field === 'all' || field === 'negative') && contains(parsed.negative));
}

export type ImageQualities = { minWidth: number; minHeight: number; format: string };
export function matchesImageQualities(file: FileDetails, quality: ImageQualities): boolean {
    if (!quality.minWidth && !quality.minHeight && !quality.format) return true;
    if (file.type !== 'image') return false;
    const dimensions = String(file.metadata?.fileinfo?.resolution || '').match(/(\d+)\s*[x×]\s*(\d+)/);
    if ((quality.minWidth || quality.minHeight) && !dimensions) return false;
    if (dimensions && (Number(dimensions[1]) < quality.minWidth || Number(dimensions[2]) < quality.minHeight)) return false;
    const extension = file.name.split('.').pop()?.toLowerCase().replace('jpeg', 'jpg');
    return !quality.format || extension === quality.format;
}
