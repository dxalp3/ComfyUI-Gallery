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

export type TagChip = { id: string; kind: 'tag'; text: string; enabled: boolean; weight?: number; emphasis?: 'round' | 'square' };
export type OrChip = { id: string; kind: 'or'; options: string[]; optional: boolean; enabled: boolean; weight?: number };
export type Chip = TagChip | OrChip;
export type GroupBox = { id: string; kind: 'group'; name: string; chips: Chip[]; enabled: boolean; collapsed: boolean };
export type SourceBox = { id: string; kind: 'source'; enabled: boolean; collapsed: boolean };
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
export function compileBoxes(state: BoxState): string {
    const parts: string[] = [];
    for (const box of state.boxes) {
        if (!box.enabled) continue;
        if (box.kind === 'source') parts.push(SOURCE_MARKER);
        else for (const chip of box.chips) { const compiled = compileChip(chip); if (compiled) parts.push(compiled); }
    }
    return parts.join(', ');
}

/** Mirrors the backend: put the source text where the marker is and tidy stray commas. */
export function composeWithSource(compiled: string, source?: string): string {
    const clean = (source || '').trim().replace(/^,+|,+$/g, '').trim();
    return compiled.split(SOURCE_MARKER).join(clean).replace(/(?:\s*,\s*){2,}/g, ', ').trim().replace(/^,+|,+$/g, '').trim();
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
    if (text.includes(SOURCE_MARKER)) {
        const [before, ...rest] = text.split(SOURCE_MARKER);
        const after = rest.join(', ');
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
export function reconcileText(state: BoxState, text: string, mode: string, hasSource: boolean): BoxState {
    return compileBoxes(state) === text ? state : stateFromText(text, mode, hasSource);
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
            if (!hasSource) { hasSource = true; boxes.push({ id, kind: 'source', enabled: raw.enabled !== false, collapsed: raw.collapsed === true }); }
        } else if (raw.kind === 'group') {
            boxes.push({ id, kind: 'group', name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '', chips: (Array.isArray(raw.chips) ? raw.chips : []).map(cleanChip).filter((chip): chip is Chip => !!chip), enabled: raw.enabled !== false, collapsed: raw.collapsed === true });
        }
    }
    if (!hasSource) boxes.push(sourceBox());
    return { version: 1, boxes };
}

// --- edits (all pure: they return a new state) ---

export const updateBox = (state: BoxState, id: string, patch: Partial<Omit<GroupBox, 'kind' | 'id'>>): BoxState =>
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
    if (chip.kind === 'tag') return [chip.text];
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

/**
 * What the user is typing right now, for suggestions: the text after the last `,` `|` or `{`.
 * Lets suggestions work inside `{blond hair|bro` as well as after a comma.
 */
export function typingToken(value: string): { token: string; start: number; inGroup: boolean } {
    let start = 0, depth = 0;
    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        if (char === '{') { depth++; start = index + 1; }
        else if (char === '}') { depth = Math.max(0, depth - 1); start = index + 1; }
        else if (char === ',' || char === '|') start = index + 1;
    }
    const raw = value.slice(start);
    return { token: raw.trim(), start: start + (raw.length - raw.trimStart().length), inGroup: depth > 0 };
}

/** Close any brace the user left open (Enter on `{a|b` means `{a|b}`). */
export function closeBraces(value: string): string {
    let depth = 0;
    for (const char of value) { if (char === '{') depth++; else if (char === '}') depth = Math.max(0, depth - 1); }
    return value + '}'.repeat(depth);
}

/** A chip of the given kind made from plain tags: one option per tag, or all tags together for a group. */
export function groupChip(kind: GroupingKind, tags: string[]): Chip | undefined {
    const clean = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
    if (!clean.length) return undefined;
    if (kind === 'tag') return clean.length === 1 ? parsePrompt(clean[0])[0] : undefined;
    return { id: newId(), kind: 'or', options: kind === 'group' ? [clean.join(', ')] : clean, optional: kind !== 'alternatives', enabled: true };
}

export const addChip = (state: BoxState, boxId: string, chip: Chip): BoxState => editChips(state, boxId, chips => [...chips, chip]);

export function addBoxWithChip(state: BoxState, chip: Chip): BoxState {
    const box = emptyGroup(nextName(state), [chip]);
    return { ...state, boxes: [...state.boxes, box] };
}
