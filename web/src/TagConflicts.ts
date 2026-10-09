/**
 * Experimental: tags that describe the same attribute and normally exclude each other (one hair length,
 * one framing, one character count, ...). With "Exclusive tags" on, choosing one turns the others off.
 *
 * Danbooru's wiki tag groups only list related tags (the hair group mixes colours, lengths and actions), so the
 * sets are a list of their own: data/exclusive-tags.json is built in, and the gallery's editor saves an edited
 * copy per ComfyUI user (gallery-exclusive-tags.json). The list is loaded from the server once and kept here.
 */
export type ExclusiveSet = { name: string; tags: string[] };

/** Tags compare by name: case, spaces vs underscores, brackets and weights do not matter. */
export function tagKey(tag: string): string {
    let text = tag.trim();
    const weighted = /^\(([\s\S]+):-?\d+(?:\.\d+)?\)$/.exec(text);
    if (weighted) text = weighted[1];
    while (/^[([].*[)\]]$/.test(text)) text = text.slice(1, -1).trim();
    return text.toLowerCase().replace(/\\([()])/g, '$1').replace(/\s+/g, '_');
}

let index = new Map<string, Set<string>>();
/** Use these sets from now on (after loading or saving them). */
export function setExclusiveSets(sets: ExclusiveSet[]) {
    const next = new Map<string, Set<string>>();
    for (const set of sets) {
        const keys = [...new Set(set.tags.map(tagKey).filter(Boolean))];
        for (const key of keys) {
            if (!next.has(key)) next.set(key, new Set());
            for (const other of keys) if (other !== key) next.get(key)!.add(other);
        }
    }
    index = next;
}

/** True when two tags describe the same attribute with different values (they share a set). */
export const conflicts = (a: string, b: string): boolean => { const left = tagKey(a), right = tagKey(b); return left !== right && !!index.get(left)?.has(right); };
/** The tags `tag` excludes. */
export const conflictsOf = (tag: string): string[] => [...(index.get(tagKey(tag)) || [])];

type ListResponse = { sets: ExclusiveSet[]; custom: boolean };
async function request(body?: unknown): Promise<ListResponse> {
    const api = (window as any).comfyAPI?.api?.api;
    const options = body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const response = await (api?.fetchApi ? api.fetchApi('/Gallery/exclusive-tags', options) : fetch('/Gallery/exclusive-tags', options));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The exclusive tag list could not be read.');
    setExclusiveSets(data.sets);
    if (typeof window !== 'undefined' && body !== undefined) window.dispatchEvent(new Event(EXCLUSIVE_MODE_EVENT));
    return data;
}
/** The current list (yours, or the built-in one) — also makes it the one in use. */
export const loadExclusiveSets = () => request();
/** Save an edited list for this ComfyUI user; `reset` goes back to the built-in list. */
export const saveExclusiveSets = (sets: ExclusiveSet[]) => request({ sets });
export const resetExclusiveSets = () => request({ reset: true });

let loading: Promise<unknown> | undefined;
const SETTINGS_KEY = 'comfy-ui-gallery-settings';
/**
 * The gallery setting "Exclusive tags", read from storage so the encoder node (outside React) can use it:
 *   off       nothing happens
 *   disable   adding or switching on a tag turns off the tags it excludes
 *   together  conflicting tags can all be added; optional ones compile into one group, so a run never uses two
 * Loads the list on first use. (`exclusiveTags: true` from before means `disable`.)
 */
export type ExclusiveMode = 'off' | 'disable' | 'together';
export function exclusiveMode(): ExclusiveMode {
    let mode: ExclusiveMode = 'off';
    try { const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); mode = ['disable', 'together'].includes(settings?.exclusiveMode) ? settings.exclusiveMode : settings?.exclusiveTags === true && !settings?.exclusiveMode ? 'disable' : 'off'; } catch { /* storage unavailable */ }
    if (mode !== 'off' && !loading) loading = loadExclusiveSets().then(() => window.dispatchEvent(new Event(EXCLUSIVE_MODE_EVENT))).catch(() => { loading = undefined; });
    return mode;
}
export const exclusiveTagsEnabled = () => exclusiveMode() !== 'off';
/** Sent when the mode or the list changes, so open encoder nodes recompile. */
export const EXCLUSIVE_MODE_EVENT = 'gallery-exclusive-mode';

const cleanTags = (tags: unknown[]): string[] => [...new Set(tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean))];

/**
 * Sets from a file someone wrote (by hand or with an LLM). Accepted, in JSON:
 *   [["short hair", "long hair"], ...]                      lists of tags
 *   [{"name": "Hair length", "tags": [...]}, ...]           named sets (also `label`/`title`, `members`)
 *   {"Hair length": [...], "Framing": [...]}                 name → tags
 *   {"sets": ...} or {"groups": ...}                         any of the above inside
 * and in plain text, one set per line (`#` starts a comment): `Hair length: short hair, long hair` or
 * `short hair | long hair`. Sets with fewer than two tags are dropped.
 */
export function parseExclusiveSets(text: string): ExclusiveSet[] {
    const fromJson = (value: unknown, name = ''): ExclusiveSet[] => {
        if (Array.isArray(value)) {
            if (value.every(item => typeof item === 'string')) return [{ name, tags: cleanTags(value) }];
            return value.flatMap((item, at) => fromJson(item, name ? `${name} ${at + 1}` : ''));
        }
        if (value && typeof value === 'object') {
            const record = value as Record<string, unknown>;
            const inner = record.sets ?? record.groups;
            if (inner !== undefined) return fromJson(inner, name);
            const tags = record.tags ?? record.members ?? record.set;
            if (Array.isArray(tags)) return [{ name: String(record.name ?? record.label ?? record.title ?? name), tags: cleanTags(tags) }];
            return Object.entries(record).flatMap(([key, item]) => fromJson(item, key));
        }
        return [];
    };
    let sets: ExclusiveSet[];
    try { sets = fromJson(JSON.parse(text)); }
    catch {
        sets = text.split(/\r?\n/).map(line => line.replace(/#.*$/, '').trim()).filter(Boolean).map(line => {
            const named = /^([^:,|]{1,80}):\s*(.+)$/.exec(line);
            const body = named ? named[2] : line;
            return { name: named ? named[1].trim() : '', tags: cleanTags(body.split(body.includes('|') ? '|' : ',')) };
        });
    }
    return sets.filter(set => set.tags.length >= 2).map(set => ({ name: set.name.slice(0, 80), tags: set.tags }));
}
