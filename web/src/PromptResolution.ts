/**
 * Which options of {a|b|c} groups an image was actually made with.
 *
 * ComfyUI picks one option of every group when a workflow is queued, so the API prompt stored in the
 * image holds the picked text while the encoder's boxes (saved on the workflow node) still hold all
 * options. Gallery Prompt Encode also records what it encoded in a `gallery_prompts` chunk, which covers
 * groups that arrived through `source_text`. Tags for Hydrus and the local search use only the picks.
 */
import { compileBoxes, composeWithSource, groupingKind, optionTags, parsePrompt, parseState, splitTop, type GroupingKind } from './PromptBoxes';

export type EncoderRecord = { text?: string; resolved?: string; choices?: { options: string[]; chosen: string }[]; source_text?: string };
export type ResolvedChoice = { kind: GroupingKind; options: string[]; chosen?: string };
export type EncoderResolution = { id: string; title: string; template: string; resolved: string; choices: ResolvedChoice[] };

function object(value: unknown): Record<string, any> {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

/** Metadata may come straight from the file or from the Hydrus note (`hydrus.notes[...]`). */
export function metadataSources(metadata: unknown): Record<string, any> {
    const raw = object(metadata);
    const hydrus = object(raw.hydrus || raw);
    const notes = Object.entries(object(hydrus.notes)).filter(([name]) => name.startsWith('ComfyUI Gallery generation metadata')).map(([, value]) => object(value));
    return Object.assign({}, ...notes, raw);
}

/** What each Gallery Prompt Encode node recorded when it ran, keyed by node id. */
export function encoderRecords(metadata: unknown): Record<string, EncoderRecord> {
    return object(metadataSources(metadata).gallery_prompts) as Record<string, EncoderRecord>;
}

/** Remove {…} groups that were never resolved: their pick is unknown, so none of their options may become a tag. */
export function stripUnresolved(text: string): string {
    if (!text.includes('{')) return text;
    let depth = 0, out = '';
    for (const char of text) {
        if (char === '{') { depth++; continue; }
        if (char === '}' && depth > 0) { depth--; continue; }
        if (depth === 0) out += char;
    }
    return out.replace(/\(\s*:\s*[-+]?\d+(?:\.\d+)?\s*\)/g, '').replace(/(?:\s*,\s*){2,}/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '');
}

const norm = (value: string) => value.trim().toLowerCase().replace(/_/g, ' ').replace(/^\((.*):[-+]?\d+(?:\.\d+)?\)$/, '$1').replace(/^[([](.*)[)\]]$/, '$1').replace(/\\([()])/g, '$1').trim();
const tagsOf = (text: string) => splitTop(text, ',').map(norm).filter(Boolean);

/**
 * Line the template's chips up with the resolved tags and report the option each group took.
 * Works on tag boundaries, so a group of several tags ({a, b|}) is matched as a whole.
 */
export function inferChoices(template: string, resolved: string): ResolvedChoice[] | undefined {
    const chips = parsePrompt(template);
    const words = tagsOf(resolved);
    type Step = { chip: number; take: number; option?: number };
    const memo = new Map<string, Step[] | null>();
    const solve = (chip: number, word: number): Step[] | null => {
        if (chip === chips.length) return []; // extra resolved tags (source text, wildcards) are allowed at the end
        const key = chip + ':' + word;
        if (memo.has(key)) return memo.get(key)!;
        memo.set(key, null);
        const current = chips[chip];
        const tries: Step[] = [];
        if (current.kind === 'tag') tries.push({ chip, take: tagsOf(current.text).length });
        else {
            current.options.forEach((option, index) => tries.push({ chip, take: tagsOf(option).length, option: index }));
            if (current.optional) tries.push({ chip, take: 0 });
        }
        let result: Step[] | null = null;
        for (const step of tries) {
            const wanted = current.kind === 'tag' ? tagsOf(current.text) : step.option === undefined ? [] : tagsOf(current.options[step.option]);
            if (wanted.some((tag, offset) => words[word + offset] !== tag)) continue;
            const rest = solve(chip + 1, word + step.take);
            if (rest) { result = [step, ...rest]; break; }
        }
        // Tags the template does not explain (edited text, wildcards) are skipped rather than failing everything.
        if (!result && word < words.length) { const rest = solve(chip, word + 1); if (rest) result = rest; }
        memo.set(key, result);
        return result;
    };
    const steps = solve(0, 0);
    if (!steps) return undefined;
    return steps.filter(step => chips[step.chip].kind === 'or').map(step => {
        const chip = chips[step.chip];
        const options = chip.kind === 'or' ? chip.options : [];
        return { kind: groupingKind(chip), options, chosen: step.option === undefined ? '' : options[step.option] };
    });
}

/** The template an encoder node was built from: its boxes from the saved workflow, with the source text filled in. */
function workflowTemplates(metadata: unknown): Map<string, { title: string; template: string }> {
    const workflow = object(metadataSources(metadata).workflow);
    const found = new Map<string, { title: string; template: string }>();
    for (const node of Array.isArray(workflow.nodes) ? workflow.nodes : []) {
        if (node?.type !== 'GalleryPromptEncode') continue;
        const state = parseState(node.properties?.prompt_boxes);
        if (state) found.set(String(node.id), { title: String(node.title || 'Gallery Prompt Encode'), template: compileBoxes(state) });
    }
    return found;
}

/** Per encoder: the template, what was encoded, and which option every group took (when that can be told). */
export function promptResolutions(metadata: unknown): EncoderResolution[] {
    const sources = metadataSources(metadata);
    const records = encoderRecords(metadata);
    const prompt = object(sources.prompt);
    const templates = workflowTemplates(metadata);
    const ids = new Set([...Object.keys(records), ...templates.keys()]);
    const result: EncoderResolution[] = [];
    for (const id of ids) {
        const record = records[id] || {};
        const api = object(prompt[id]?.inputs);
        const saved = templates.get(id);
        const source = typeof record.source_text === 'string' ? record.source_text : typeof api.source_text === 'string' ? api.source_text : undefined;
        const template = saved ? composeWithSource(saved.template, source) : record.text || '';
        const resolved = record.resolved || (typeof api.text === 'string' ? composeWithSource(api.text, source) : '');
        if (!template || !resolved || !template.includes('{')) continue;
        const choices = inferChoices(template, resolved)
            ?? (record.choices || []).map(choice => ({ kind: (choice.options.some(option => !option) ? choice.options.filter(Boolean).length === 1 ? 'group' : 'optional' : 'alternatives') as GroupingKind, options: choice.options.filter(Boolean), chosen: choice.chosen }));
        result.push({ id, title: saved?.title || String(prompt[id]?._meta?.title || 'Gallery Prompt Encode'), template, resolved, choices });
    }
    return result;
}

/** The tags a picked option contributes ('' when the group was left out). */
export const chosenTags = (choice: ResolvedChoice): string[] => choice.chosen ? optionTags(choice.chosen) : [];
