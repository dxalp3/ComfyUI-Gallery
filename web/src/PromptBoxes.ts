/**
 * The visual model behind the Gallery Prompt Encode node.
 *
 * The node shows boxes of tags instead of a text field. Every edit is compiled into one
 * prompt string (the node's hidden `text` widget); the boxes themselves are stored on the
 * node as a property so they survive saving, loading and copy/paste of the workflow.
 *
 *   tag chip   `blue eyes`, `(blue eyes:1.2)`, `[blue eyes]`
 *   or chip    `{a|b|c}` (one of them) and `{a|b|c|}` (one of them, or nothing)
 *   group box  a named set of chips (a prefix name, or #1, #2, ...) that can be collapsed
 *   source box the connected `source_text`, compiled to SOURCE_MARKER at its position and
 *              substituted by the backend when the workflow runs
 */
export const SOURCE_MARKER = '\u27e6source\u27e7';
/**
 * Tags removed from the source box travel inside the marker, `\u27e6source -["tag a","tag b"]\u27e7`, because the
 * source text itself is often only known when the workflow runs. The backend drops those tags then.
 */
const MARKER = /\u27e6source(?: -(\[[^\u27e7]*\]))?\u27e7/;
// ComfyUI resolves {a|b} and strips /* */ and // comments in the text when it queues, so those characters are
// written as JSON \u escapes and cannot change the list.
const escapeList = (excluded: string[]) => JSON.stringify(excluded).replace(/[{}|/\u27e7]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
export const sourceMarker = (excluded?: string[]) => excluded?.length ? '\u27e6source -' + escapeList(excluded) + '\u27e7' : SOURCE_MARKER;
export const hasSourceMarker = (text: string) => MARKER.test(text);
/** Every source marker (with or without removed tags) replaced by `replace(excluded)`. */
export function replaceSourceMarkers(text: string, replace: (excluded: string[]) => string): string {
    return text.replace(new RegExp(MARKER.source, 'g'), (_, list?: string) => {
        let excluded: string[] = [];
        try { const value = list ? JSON.parse(list) : []; if (Array.isArray(value)) excluded = value.filter((item): item is string => typeof item === 'string'); } catch { /* a damaged list removes nothing */ }
        return replace(excluded);
    });
}
/** How removed source tags are compared: case, underscores and spacing do not matter. */
export const sourceKey = (tag: string) => tag.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
/** The source text without the removed tags (top-level comma parts are compared). */
export function filterSource(source: string, excluded: string[]): string {
    if (!excluded.length) return source;
    const drop = new Set(excluded.map(sourceKey));
    return splitTop(source, ',').filter(part => !drop.has(sourceKey(part))).join(',');
}

export type TagChip = { id: string; kind: 'tag'; text: string; enabled: boolean; weight?: number; emphasis?: 'round' | 'square' };
export type OrChip = { id: string; kind: 'or'; options: string[]; optional: boolean; enabled: boolean; weight?: number };
export type Chip = TagChip | OrChip;
export type GroupBox = { id: string; kind: 'group'; name: string; chips: Chip[]; enabled: boolean; collapsed: boolean };
export type SourceBox = { id: string; kind: 'source'; enabled: boolean; collapsed: boolean; /** Source tags left out of the prompt. */ excluded?: string[] };
export type PromptBox = GroupBox | SourceBox;
export type BoxState = { version: 1; boxes: PromptBox[] };

let counter = 0;
export const newId = () => 'b' + (counter++).toString(36) + Math.random().toString(36).slice(2, 8);

/** True when `text` starts with `open` and that bracket closes exactly at the end. */
function wraps(text: string, open: string, close: string): boolean {
    if (text.length < 2 || text[0] !== open || text[text.length - 1] !== close) return false;
    let depth = 0;
    for (let index = 0; index < text.length; index++) {
        if (text[index] === open) depth++;
        else if (text[index] === close) { depth--; if (depth < 0 || (depth === 0 && index < text.length - 1)) return false; }
    }
    return depth === 0;
}

/** Split on a separator that is not inside (), [], {} or <>. Unbalanced text falls back to a plain split. */
export function splitTop(text: string, separator: ',' | '|'): string[] {
    let depth = 0, balancedText = true;
    const cuts: number[] = [], plain: number[] = [];
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if ('([{<'.includes(char)) depth++;
        else if (')]}>'.includes(char)) { depth--; if (depth < 0) { balancedText = false; depth = 0; } }
        else if (char === separator) { plain.push(index); if (depth === 0) cuts.push(index); }
    }
    if (depth !== 0) balancedText = false;
    const parts: string[] = []; let start = 0;
    for (const index of balancedText ? cuts : plain) { parts.push(text.slice(start, index)); start = index + 1; }
    parts.push(text.slice(start));
    return parts;
}

/** Whether every bracket the user opened has been closed (used to decide if a comma ends a tag). */
export function balanced(text: string): boolean {
    let depth = 0;
    for (const char of text) { if ('([{'.includes(char)) depth++; else if (')]}'.includes(char)) depth = Math.max(0, depth - 1); }
    return depth === 0;
}

function parseChip(raw: string): Chip {
    let text = raw.trim(), weight: number | undefined, emphasis: 'round' | 'square' | undefined;
    const weighted = /^\(([\s\S]+):(-?\d+(?:\.\d+)?)\)$/.exec(text);
    if (weighted && wraps(text, '(', ')')) { text = weighted[1].trim(); weight = Number(weighted[2]); }
    else if (wraps(text, '(', ')')) { text = text.slice(1, -1).trim(); emphasis = 'round'; }
    else if (wraps(text, '[', ']')) { text = text.slice(1, -1).trim(); emphasis = 'square'; }
    if (wraps(text, '{', '}')) {
        const options = splitTop(text.slice(1, -1), '|');
        const clean = options.map(option => option.trim()).filter(Boolean);
        if (options.length > 1 && clean.length) return { id: newId(), kind: 'or', options: clean, optional: clean.length < options.length, enabled: true, weight };
    }
    return { id: newId(), kind: 'tag', text: text || raw.trim(), enabled: true, weight, emphasis };
}

/** Turn prompt text into chips: comma-separated tags become individual chips, {a|b|c} becomes one or-chip. */
export function parsePrompt(text: string): Chip[] {
    return splitTop(text.replace(/\r?\n/g, ' '), ',').map(part => part.trim()).filter(Boolean).map(parseChip);
}

const fmt = (value: number) => String(Math.round(value * 100) / 100);
const withWeight = (inner: string, weight?: number) => weight !== undefined && weight !== 1 ? `(${inner}:${fmt(weight)})` : inner;

export function compileChip(chip: Chip): string {
    if (!chip.enabled) return '';
    if (chip.kind === 'or') {
        if (!chip.options.length) return '';
        // A single, required option is just that text: `{a}` would be noise.
        if (chip.options.length === 1 && !chip.optional) return withWeight(chip.options[0], chip.weight);
        return withWeight('{' + chip.options.join('|') + (chip.optional ? '|' : '') + '}', chip.weight);
    }
    const text = chip.text.trim();
    if (!text) return '';
    if (chip.weight !== undefined && chip.weight !== 1) return `(${text}:${fmt(chip.weight)})`;
    return chip.emphasis === 'round' ? `(${text})` : chip.emphasis === 'square' ? `[${text}]` : text;
}

/** The prompt string stored in the node. The source box becomes SOURCE_MARKER at its position. */
export type Conflicts = (a: string, b: string) => boolean;

/**
 * "Never together" (exclusive tags): single optional tags that exclude each other — `{long hair|}` and
 * `{short hair|}` — are groups of chip ids that compile into one optional-alternatives chip at the first one's
 * place, `{long hair|short hair|}`, so a run uses one of them or neither, never both.
 */
export function neverTogether(state: BoxState, conflicts: Conflicts): string[][] {
    const singles: { id: string; tag: string }[] = [];
    for (const box of state.boxes) if (box.kind === 'group' && box.enabled) for (const chip of box.chips) if (chip.enabled && addModeOf(chip) === 'each') singles.push({ id: chip.id, tag: chipTerms(chip)[0] });
    const group = new Map<string, string>();
    const find = (id: string): string => { const parent = group.get(id) ?? id; return parent === id ? id : find(parent); };
    singles.forEach((a, i) => singles.slice(i + 1).forEach(b => { if (conflicts(a.tag, b.tag)) group.set(find(b.id), find(a.id)); }));
    const sets = new Map<string, string[]>();
    for (const item of singles) { const key = find(item.id); sets.set(key, [...(sets.get(key) || []), item.id]); }
    return [...sets.values()].filter(ids => ids.length > 1);
}

/** Plain (always used) tags that exclude each other: these cannot be resolved, only reported. */
export function alwaysTogether(state: BoxState, conflicts: Conflicts): [string, string][] {
    const tags: string[] = [];
    for (const box of state.boxes) if (box.kind === 'group' && box.enabled) for (const chip of box.chips) if (chip.enabled && chip.kind === 'tag') tags.push(chipTerms(chip)[0] || chip.text);
    return tags.flatMap((a, i) => tags.slice(i + 1).filter(b => conflicts(a, b)).map(b => [a, b] as [string, string]));
}

/** The prompt string stored in the node. The source box becomes SOURCE_MARKER at its position. With `conflicts`, see neverTogether. */
export function compileBoxes(state: BoxState, conflicts?: Conflicts): string {
    const merged = new Map<string, string>(), skipped = new Set<string>();
    if (conflicts) {
        const chips = new Map(state.boxes.flatMap(box => box.kind === 'group' ? box.chips.map(chip => [chip.id, chip] as const) : []));
        for (const ids of neverTogether(state, conflicts)) {
            const options = ids.map(id => { const chip = chips.get(id)!; return withWeight(chipTerms(chip)[0], chip.weight); });
            merged.set(ids[0], '{' + options.join('|') + '|}');
            ids.slice(1).forEach(id => skipped.add(id));
        }
    }
    const parts: string[] = [];
    for (const box of state.boxes) {
        if (!box.enabled) continue;
        if (box.kind === 'source') parts.push(sourceMarker(box.excluded));
        else for (const chip of box.chips) { if (skipped.has(chip.id)) continue; const compiled = merged.get(chip.id) ?? compileChip(chip); if (compiled) parts.push(compiled); }
    }
    return parts.join(', ');
}

/** Mirrors the backend: put the source text where the marker is and tidy stray commas. */
export function composeWithSource(compiled: string, source?: string): string {
    const clean = (source || '').trim().replace(/^,+|,+$/g, '').trim();
    return replaceSourceMarkers(compiled, excluded => filterSource(clean, excluded).trim()).replace(/(?:\s*,\s*){2,}/g, ', ').trim().replace(/^,+|,+$/g, '').trim();
}

export const emptyGroup = (name: string, chips: Chip[] = []): GroupBox => ({ id: newId(), kind: 'group', name, chips, enabled: true, collapsed: false });
export const sourceBox = (): SourceBox => ({ id: newId(), kind: 'source', enabled: true, collapsed: false });

/** #1, #2, ... — the next unused default name. */
export function nextName(state: BoxState): string {
    let highest = 0;
    for (const box of state.boxes) { const match = box.kind === 'group' && /^#(\d+)$/.exec(box.name); if (match) highest = Math.max(highest, Number(match[1])); }
    return '#' + (highest + 1);
}

/**
 * Build boxes from prompt text. Used for workflows made before the box editor existed
 * (the old source order maps to the box order) and when the text changed outside the editor.
 */
export function stateFromText(text: string, mode = 'after', hasSource = true): BoxState {
    const source = sourceBox();
    const marker = MARKER.exec(text);
    if (marker) {
        replaceSourceMarkers(marker[0], excluded => { if (excluded.length) source.excluded = excluded; return ''; });
        const before = text.slice(0, marker.index), after = replaceSourceMarkers(text.slice(marker.index + marker[0].length), () => '');
        const boxes: PromptBox[] = [];
        if (parsePrompt(before).length) boxes.push(emptyGroup('#1', parsePrompt(before)));
        boxes.push(source);
        if (parsePrompt(after).length) boxes.push(emptyGroup(boxes.length > 1 ? '#2' : '#1', parsePrompt(after)));
        return { version: 1, boxes };
    }
    const own = emptyGroup('#1', parsePrompt(text));
    if (mode === 'replace' && hasSource) own.enabled = false;
    if (mode === 'boxes') source.enabled = false;
    return { version: 1, boxes: mode === 'before' ? [source, own] : [own, source] };
}

/** Keep the boxes unless the stored text no longer matches them (changed by an API call or another extension). */
export function reconcileText(state: BoxState, text: string, mode: string, hasSource: boolean, conflicts?: Conflicts): BoxState {
    return compileBoxes(state, conflicts) === text || compileBoxes(state) === text ? state : stateFromText(text, mode, hasSource);
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function cleanChip(value: unknown): Chip | undefined {
    if (!isRecord(value)) return undefined;
    const id = typeof value.id === 'string' && value.id ? value.id : newId();
    const enabled = value.enabled !== false;
    const weight = typeof value.weight === 'number' && Number.isFinite(value.weight) ? value.weight : undefined;
    if (value.kind === 'or') {
        const options = Array.isArray(value.options) ? value.options.filter((option): option is string => typeof option === 'string' && !!option.trim()).map(option => option.trim()) : [];
        return options.length ? { id, kind: 'or', options, optional: value.optional === true, enabled, weight } : undefined;
    }
    if (value.kind === 'tag' && typeof value.text === 'string' && value.text.trim()) return { id, kind: 'tag', text: value.text.trim(), enabled, weight, emphasis: value.emphasis === 'round' || value.emphasis === 'square' ? value.emphasis : undefined };
    return undefined;
}

/** Validate state read back from a saved workflow. There is always exactly one source box. */
export function parseState(value: unknown): BoxState | undefined {
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.boxes)) return undefined;
    const boxes: PromptBox[] = [];
    let hasSource = false;
    for (const raw of value.boxes) {
        if (!isRecord(raw)) continue;
        const id = typeof raw.id === 'string' && raw.id ? raw.id : newId();
        if (raw.kind === 'source') {
            const excluded = Array.isArray(raw.excluded) ? raw.excluded.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
            if (!hasSource) { hasSource = true; boxes.push({ id, kind: 'source', enabled: raw.enabled !== false, collapsed: raw.collapsed === true, ...(excluded.length ? { excluded } : {}) }); }
        } else if (raw.kind === 'group') {
            boxes.push({ id, kind: 'group', name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '', chips: (Array.isArray(raw.chips) ? raw.chips : []).map(cleanChip).filter((chip): chip is Chip => !!chip), enabled: raw.enabled !== false, collapsed: raw.collapsed === true });
        }
    }
    if (!hasSource) boxes.push(sourceBox());
    return { version: 1, boxes };
}

// --- edits (all pure: they return a new state) ---

export const updateBox = (state: BoxState, id: string, patch: Partial<Omit<GroupBox, 'kind' | 'id'>> | Partial<Pick<SourceBox, 'enabled' | 'collapsed' | 'excluded'>>): BoxState =>
    ({ ...state, boxes: state.boxes.map(box => box.id === id ? { ...box, ...patch } as PromptBox : box) });

/** The source box cannot be removed; it can be disabled, collapsed and moved. */
export const removeBox = (state: BoxState, id: string): BoxState => ({ ...state, boxes: state.boxes.filter(box => box.id !== id || box.kind === 'source') });

export function moveItem<T extends { id: string }>(items: T[], id: string, delta: -1 | 1): T[] {
    const from = items.findIndex(item => item.id === id), to = from + delta;
    if (from < 0 || to < 0 || to >= items.length) return items;
    const next = [...items]; [next[from], next[to]] = [next[to], next[from]];
    return next;
}
export const moveBox = (state: BoxState, id: string, delta: -1 | 1): BoxState => { const boxes = moveItem(state.boxes, id, delta); return boxes === state.boxes ? state : { ...state, boxes }; };

export const editChips = (state: BoxState, boxId: string, change: (chips: Chip[]) => Chip[]): BoxState =>
    ({ ...state, boxes: state.boxes.map(box => box.id === boxId && box.kind === 'group' ? { ...box, chips: change(box.chips) } : box) });

export const addChips = (state: BoxState, boxId: string, text: string): BoxState => editChips(state, boxId, chips => [...chips, ...parsePrompt(text)]);

export function addBox(state: BoxState, name: string | undefined, text: string, position: 'start' | 'end' = 'end'): BoxState {
    const box = emptyGroup(name?.trim() || nextName(state), parsePrompt(text));
    return { ...state, boxes: position === 'start' ? [box, ...state.boxes] : [...state.boxes, box] };
}

/**
 * Library appends and image-prompt appends arrive as text. Each one becomes its own box,
 * named after the prefix when one was used, otherwise #1, #2, ...
 */
export function insertText(state: BoxState, text: string, position: 'before' | 'after' | 'replace', name?: string): BoxState {
    if (!parsePrompt(text).length) return state;
    if (position === 'replace') {
        const sources = state.boxes.filter(box => box.kind === 'source');
        const box = emptyGroup(name?.trim() || '#1', parsePrompt(text));
        return { ...state, boxes: [box, ...sources] };
    }
    return addBox(state, name, text, position === 'before' ? 'start' : 'end');
}

/**
 * Drag and drop: move a chip into a box, before or after a target chip (or to the end when there is
 * no target). Chips move freely between boxes; the source box cannot hold chips.
 */
export function moveChipTo(state: BoxState, chipId: string, toBoxId: string, target?: { chipId: string; after: boolean }): BoxState {
    if (!state.boxes.some(box => box.kind === 'group' && box.id === toBoxId)) return state;
    let moving: Chip | undefined;
    for (const box of state.boxes) {
        if (box.kind !== 'group') continue;
        const found = box.chips.find(chip => chip.id === chipId);
        if (found) { moving = found; break; }
    }
    if (!moving || target?.chipId === chipId) return state;
    const chip = moving;
    return { ...state, boxes: state.boxes.map(box => {
        if (box.kind !== 'group') return box;
        const rest = box.chips.filter(item => item.id !== chipId);
        if (box.id !== toBoxId) return rest.length === box.chips.length ? box : { ...box, chips: rest };
        const at = target ? rest.findIndex(item => item.id === target.chipId) : -1;
        rest.splice(at < 0 ? rest.length : at + (target?.after ? 1 : 0), 0, chip);
        return { ...box, chips: rest };
    }) };
}

/** Drag and drop: put a box before or after another box. */
export function moveBoxTo(state: BoxState, boxId: string, target: { boxId: string; after: boolean }): BoxState {
    const moving = state.boxes.find(box => box.id === boxId);
    if (!moving || target.boxId === boxId) return state;
    const rest = state.boxes.filter(box => box.id !== boxId);
    const at = rest.findIndex(box => box.id === target.boxId);
    if (at < 0) return state;
    rest.splice(at + (target.after ? 1 : 0), 0, moving);
    return { ...state, boxes: rest };
}

// --- grouping types ---

/**
 * The four ways tags are grouped (the same names as the palette's insertion formats):
 *   tag           one plain tag                          `a`
 *   alternatives  exactly one of the options             `{a|b|c}`
 *   optional      one of the options, or nothing         `{a|b|c|}`
 *   group         all of the tags together, or nothing   `{a, b, c|}`
 */
export type GroupingKind = 'tag' | 'alternatives' | 'optional' | 'group';
export const GROUPING_LABELS: Record<GroupingKind, { name: string; badge: string; hint: string }> = {
    tag: { name: 'Tag', badge: '', hint: 'One tag' },
    alternatives: { name: 'Alternatives', badge: '1 of', hint: 'Exactly one option is used each run  {a|b|c}' },
    optional: { name: 'Optional alternatives', badge: '1 of / none', hint: 'One option or nothing is used each run  {a|b|c|}' },
    group: { name: 'Optional group', badge: 'all / none', hint: 'All of these tags together, or none of them  {a, b, c|}' },
};

export function groupingKind(chip: Chip): GroupingKind {
    if (chip.kind === 'tag') return 'tag';
    if (!chip.optional) return 'alternatives';
    return chip.options.length === 1 ? 'group' : 'optional';
}

/** The tags inside one option (an option of an optional group can hold several comma-separated tags). */
export const optionTags = (option: string): string[] => splitTop(option, ',').map(part => part.trim()).filter(Boolean);

/** Every plain tag a chip can contribute, used to convert between grouping kinds. */
export function chipTerms(chip: Chip): string[] {
    // A tag chip can hold `a, b` (typed, or converted from a group): those are two tags, not one option.
    if (chip.kind === 'tag') return optionTags(chip.emphasis === 'round' ? `(${chip.text})` : chip.emphasis === 'square' ? `[${chip.text}]` : chip.text);
    return chip.options.flatMap(optionTags);
}

/** Convert a chip to another grouping kind, keeping its tags, weight and on/off state. */
export function setGroupingKind(chip: Chip, kind: GroupingKind): Chip {
    if (groupingKind(chip) === kind) return chip;
    const base = { id: chip.id, enabled: chip.enabled, weight: chip.weight };
    if (kind === 'tag') {
        const terms = chipTerms(chip);
        return { ...base, kind: 'tag', text: terms.join(', ') || (chip.kind === 'tag' ? chip.text : '') };
    }
    // Options stay options when switching between the two alternatives kinds; otherwise each tag becomes an option.
    const options = chip.kind === 'or' && groupingKind(chip) !== 'group' ? chip.options : chipTerms(chip);
    if (kind === 'group') return { ...base, kind: 'or', options: [chipTerms(chip).join(', ')], optional: true };
    return { ...base, kind: 'or', options, optional: kind === 'optional' && options.length > 0 ? true : false };
}

/** The "Add as" mode a chip shows as: a single optional tag (`{a|}`) is `each`, otherwise its grouping kind. */
export const addModeOf = (chip: Chip): AddMode => chip.kind === 'or' && chip.optional && chip.options.length === 1 && optionTags(chip.options[0]).length === 1 ? 'each' : groupingKind(chip);

/**
 * Change what a chip is, in place. Turning several tags into plain tags (or into `each`, every tag optional
 * on its own) splits the chip, because one chip can only stand for one tag or one group.
 */
export function convertChip(state: BoxState, boxId: string, chipId: string, mode: AddMode): BoxState {
    return editChips(state, boxId, chips => chips.flatMap(chip => {
        if (chip.id !== chipId || addModeOf(chip) === mode) return [chip];
        const terms = chipTerms(chip);
        if (mode === 'each') return terms.map((tag, index) => ({ id: index ? newId() : chip.id, kind: 'or' as const, options: [tag], optional: true, enabled: chip.enabled, weight: chip.weight }));
        if (mode === 'tag' && terms.length > 1) return terms.map((tag, index) => ({ ...parseChip(tag), id: index ? newId() : chip.id, enabled: chip.enabled }));
        if (mode === 'tag') return [{ ...parseChip(terms[0] || ''), id: chip.id, enabled: chip.enabled, weight: chip.weight ?? parseChip(terms[0] || '').weight }];
        return [setGroupingKind(chip, mode)];
    }));
}

/** What a grouped chip shows as its parts: its options, or the tags of an optional group. */
export const chipItems = (chip: Chip): string[] => chip.kind === 'tag' ? [] : groupingKind(chip) === 'group' ? optionTags(chip.options[0] || '') : chip.options;
/** The same chip with other parts (undefined when no part is left, so the caller removes it). */
export function withItems(chip: Chip, items: string[]): Chip | undefined {
    const clean = items.map(item => item.trim()).filter(Boolean);
    if (chip.kind !== 'or' || !clean.length) return chip.kind === 'or' ? undefined : chip;
    return groupingKind(chip) === 'group' ? { ...chip, options: [clean.join(', ')] } : { ...chip, options: clean };
}

/** The single tag a chip stands for when it is a plain tag or one optional tag (`{a|}`); otherwise undefined. */
export function singleTag(chip: Chip): string | undefined {
    const terms = chipTerms(chip);
    return terms.length === 1 && (chip.kind === 'tag' || addModeOf(chip) === 'each') ? terms[0] : undefined;
}

/**
 * Exclusive tags: every single-tag chip that became used in `next` (added, switched on or retyped) turns off the
 * other single-tag chips it conflicts with. Returns `next` unchanged when nothing conflicts, and the tags turned off.
 */
export function disableConflicts(previous: BoxState, next: BoxState, conflicts: (a: string, b: string) => boolean): { state: BoxState; disabled: string[] } {
    const before = new Map<string, string | undefined>();
    for (const box of previous.boxes) if (box.kind === 'group' && box.enabled) for (const chip of box.chips) if (chip.enabled) before.set(chip.id, singleTag(chip));
    const fresh: { id: string; tag: string }[] = [];
    for (const box of next.boxes) if (box.kind === 'group' && box.enabled) for (const chip of box.chips) {
        const tag = chip.enabled ? singleTag(chip) : undefined;
        if (tag && before.get(chip.id) !== tag) fresh.push({ id: chip.id, tag });
    }
    if (!fresh.length) return { state: next, disabled: [] };
    const disabled: string[] = [];
    const boxes = next.boxes.map(box => box.kind !== 'group' ? box : { ...box, chips: box.chips.map(chip => {
        const tag = chip.enabled ? singleTag(chip) : undefined;
        if (!tag || fresh.some(item => item.id === chip.id) || !fresh.some(item => conflicts(item.tag, tag))) return chip;
        disabled.push(tag);
        return { ...chip, enabled: false };
    }) });
    return disabled.length ? { state: { ...next, boxes }, disabled } : { state: next, disabled };
}

/** Replace one chip with plain tag chips (one per tag it holds). */
export const splitChip = (state: BoxState, boxId: string, chipId: string): BoxState => editChips(state, boxId, chips => chips.flatMap(chip =>
    chip.id !== chipId ? [chip] : chipTerms(chip).map(text => ({ id: newId(), kind: 'tag' as const, text, enabled: chip.enabled }))));

/** Merge several chips into one grouped chip at the position of the first one. */
export function mergeChips(state: BoxState, boxId: string, chipIds: string[], kind: Exclude<GroupingKind, 'tag'>): BoxState {
    return editChips(state, boxId, chips => {
        const picked = chips.filter(chip => chipIds.includes(chip.id));
        if (picked.length < 2) return chips;
        const options = kind === 'group' ? [picked.flatMap(chipTerms).join(', ')] : picked.map(chip => chipTerms(chip).join(', '));
        const merged: OrChip = { id: newId(), kind: 'or', options, optional: kind !== 'alternatives', enabled: true };
        const first = chips.findIndex(chip => chipIds.includes(chip.id));
        const rest = chips.filter(chip => !chipIds.includes(chip.id));
        rest.splice(Math.min(first, rest.length), 0, merged);
        return rest;
    });
}

/** An optional group holding a single tag (`{a|}`, `{(a, b)|}`) reads as "Optional" rather than "Optional group". */
export const groupingName = (chip: Chip): string =>
    chip.kind === 'or' && groupingKind(chip) === 'group' && optionTags(chip.options[0] || '').length === 1 ? 'Optional' : GROUPING_LABELS[groupingKind(chip)].name;

// --- typing ---

/**
 * Upper-case words that relate the tags around them instead of being tags themselves (upper case only,
 * so a tag such as "salt and pepper hair" is left alone):
 *   a AND b        both                       a, b         (with OPT: all or none  {a, b|})
 *   a OR b         exactly one                {a|b}        (with OPT: one or none  {a|b|})
 *   a OPT          the tag or nothing         {a|}
 * AND binds tighter than OR: `a AND b OR c` is `{a, b|c}`. Keywords inside brackets are left as typed.
 */
export const KEYWORDS = ['AND', 'OR', 'OPT'] as const;

/** Split on a keyword that stands on its own at bracket depth 0. */
function splitKeyword(text: string, word: string): string[] {
    const parts: string[] = []; let depth = 0, start = 0;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if ('([{<'.includes(char)) depth++;
        else if (')]}>'.includes(char)) depth = Math.max(0, depth - 1);
        else if (depth === 0 && text.startsWith(word, index) && (index === 0 || /\s/.test(text[index - 1])) && (index + word.length === text.length || /\s/.test(text[index + word.length]))) {
            parts.push(text.slice(start, index)); start = index + word.length; index += word.length - 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

function expandSegment(segment: string): string {
    let text = segment.trim(), optional = false;
    const tail = splitKeyword(text, 'OPT');
    if (tail.length > 1 && !tail[tail.length - 1].trim()) { optional = true; text = tail.slice(0, -1).join(' ').trim(); }
    const options = splitKeyword(text, 'OR').map(option => splitKeyword(option, 'AND').map(tag => tag.trim()).filter(Boolean).join(', ')).filter(Boolean);
    if (!options.length) return '';
    if (options.length === 1) {
        if (!optional) return options[0];
        // `{a|b} OPT` makes the existing alternatives optional instead of nesting them.
        if (wraps(options[0], '{', '}') && splitTop(options[0].slice(1, -1), '|').length > 1) return options[0].endsWith('|}') ? options[0] : options[0].slice(0, -1) + '|}';
    }
    return '{' + options.join('|') + (optional ? '|' : '') + '}';
}

/** Typed text with its AND / OR / OPT keywords turned into prompt syntax (see KEYWORDS). */
export function expandKeywords(text: string): string {
    return splitTop(text, ',').map(expandSegment).filter(Boolean).join(', ');
}

/** What was typed, as chips: keywords applied, brackets left open closed. */
export const parseTyped = (text: string): Chip[] => parsePrompt(expandKeywords(closeBraces(text)));

/** True when the current comma segment uses a keyword, so a picked suggestion continues it instead of ending it. */
export const pendingKeyword = (text: string): boolean => {
    const segment = splitTop(text, ',').pop() || '';
    return KEYWORDS.some(word => splitKeyword(segment, word).length > 1);
};

/**
 * What the user is typing right now, for suggestions: the text after the last separator — `,` `|`,
 * an opening or closing bracket, or a keyword. Lets suggestions work inside `{blond hair|bro`,
 * `{(red hair, bl` and `red hair AND bl` as well as after a comma.
 */
export function typingToken(value: string): { token: string; start: number; inGroup: boolean } {
    let start = 0, depth = 0;
    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        if ('{(['.includes(char)) { depth++; start = index + 1; }
        else if ('})]'.includes(char)) { depth = Math.max(0, depth - 1); start = index + 1; }
        else if (char === ',' || char === '|') start = index + 1;
    }
    let raw = value.slice(start);
    const keyword = /(?:^|\s)(?:AND|OR|OPT)(?=\s)/g;
    let match: RegExpExecArray | null, cut = 0;
    while ((match = keyword.exec(raw))) cut = match.index + match[0].length;
    start += cut; raw = raw.slice(cut);
    return { token: raw.trim(), start: start + (raw.length - raw.trimStart().length), inGroup: depth > 0 };
}

/** Close any bracket the user left open, innermost first (Enter on `{(a, b` means `{(a, b)}`). */
export function closeBraces(value: string): string {
    const open: string[] = [];
    const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
    for (const char of value) {
        if (pairs[char]) open.push(pairs[char]);
        else if (open[open.length - 1] === char) open.pop();
    }
    return value + open.reverse().join('');
}

/**
 * True when the last keystroke closed a bracketed chip: the text was unbalanced, now it is balanced, ends
 * with a closing bracket, and the current comma segment started with an opening one. `tagname|}` after
 * `{` or `tag2)|}` after `{(tag1, ` therefore become a chip without pressing Enter.
 */
export function closesChip(previous: string, next: string): boolean {
    if (balanced(previous) || !balanced(next) || !/[)\]}]\s*$/.test(next)) return false;
    const segment = (splitTop(next, ',').pop() || '').trim();
    return /^[({[]/.test(segment);
}

/** "Add as": a grouping kind, or `each` — every tag optional on its own. */
export type AddMode = GroupingKind | 'each';
export const ADD_MODES: { value: AddMode; name: string; hint: string }[] = [
    { value: 'tag', name: 'Tags', hint: GROUPING_LABELS.tag.hint },
    { value: 'alternatives', name: GROUPING_LABELS.alternatives.name, hint: GROUPING_LABELS.alternatives.hint },
    { value: 'optional', name: GROUPING_LABELS.optional.name, hint: GROUPING_LABELS.optional.hint },
    { value: 'group', name: GROUPING_LABELS.group.name, hint: GROUPING_LABELS.group.hint },
    { value: 'each', name: 'Optional tags (each)', hint: 'Every tag is used or left out on its own  {a|}, {b|}' },
];

/** A chip of the given kind made from plain tags: one option per tag, or all tags together for a group. */
export function groupChip(kind: GroupingKind, tags: string[]): Chip | undefined {
    const clean = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
    if (!clean.length) return undefined;
    if (kind === 'tag') return clean.length === 1 ? parsePrompt(clean[0])[0] : undefined;
    return { id: newId(), kind: 'or', options: kind === 'group' ? [clean.join(', ')] : clean, optional: kind !== 'alternatives', enabled: true };
}

/** The chips an "Add as" mode makes from tags: one grouped chip, or (each) one optional chip per tag. */
export function groupChips(mode: AddMode, tags: string[]): Chip[] {
    const clean = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
    if (mode === 'each') return clean.map(tag => ({ id: newId(), kind: 'or', options: [tag], optional: true, enabled: true }));
    if (mode === 'tag') return clean.flatMap(tag => parsePrompt(tag));
    const chip = groupChip(mode, clean);
    return chip ? [chip] : [];
}

export const addChip = (state: BoxState, boxId: string, chip: Chip): BoxState => editChips(state, boxId, chips => [...chips, chip]);

export function addBoxWithChip(state: BoxState, chip: Chip | Chip[]): BoxState {
    const box = emptyGroup(nextName(state), Array.isArray(chip) ? chip : [chip]);
    return { ...state, boxes: [...state.boxes, box] };
}
