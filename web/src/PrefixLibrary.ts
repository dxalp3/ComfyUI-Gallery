import { installPromptBoxes } from './EncoderNode';
import { getComfyApp } from './ComfyAppApi';
import { splitTop } from './PromptBoxes';
// The encoder's source-prompt lookup moved next to the box editor; keep the old import path working.
export { effectiveSourceText } from './EncoderNode';
export type PrefixImage = { name?: string; local_url?: string; root?: string; hash?: string; /** Association keys this image is stored under (filled in when listing). */ keys?: string[] };
export type PrefixLibrary = { version: number; associations?: Record<string, { prefix_id: string; terms: string[]; negative_terms?: string[]; image?: PrefixImage }>; tags: { id: string; name: string; text: string }[]; prefixes: { id: string; name: string; tags: string[]; negative_terms?: string[] }[] };
async function api() {
    const current = (window as any).comfyAPI?.api?.api || getComfyApp()?.api;
    if (current?.fetchApi) return current;
    try { return (await import(/* @vite-ignore */ `${location.origin}/scripts/api.js`)).api; } catch { return current; }
}
export const PREFIX_MANAGER_EVENT = 'gallery-prefix-manager';
/** Opens the prefix editor window as it is (no new seed). */
export const PREFIX_EDITOR_EVENT = 'gallery-prefix-editor';
export type PrefixSeed = { name?: string; positive?: string[]; negative?: string[]; hydrus?: string[]; node?: any; imageKeys?: string[]; imageRefs?: Record<string, PrefixImage>; onSaved?: (terms: string[], prefixId: string, negativeTerms: string[]) => void };
export function openPrefixManager(seed: PrefixSeed = {}) { window.dispatchEvent(new CustomEvent(PREFIX_MANAGER_EVENT, { detail: seed })); }
export type SharedLibrary = PrefixLibrary & { revision?: string };
async function request(body?: unknown): Promise<{ library: PrefixLibrary; revision: string }> {
    const service = await api();
    const options = body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const response = await (service?.fetchApi ? service.fetchApi('/Gallery/prefixes', options) : fetch('/Gallery/prefixes', options));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Shared Prompt Library request failed');
    return result;
}
let channel: BroadcastChannel | undefined;
if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('gallery-prefix-library');
    channel.onmessage = () => window.dispatchEvent(new Event('gallery-prefix-library-changed'));
}
function changed() {
    window.dispatchEvent(new Event('gallery-prefix-library-changed'));
    channel?.postMessage('changed');
}
export async function loadPrefixes(): Promise<SharedLibrary> {
    const result = await request();
    return { ...result.library, revision: result.revision };
}
export async function migrateBrowserPrefixes(revision: string) {
    const raw = localStorage.getItem('comfy.prompt-library.v2') || localStorage.getItem('comfy.tag-prefix-library.v1');
    if (!raw) throw new Error('No legacy browser library found.');
    await request({ action: 'migrate', revision, library: JSON.parse(raw) });
    changed();
}
/** Prefix terms in a text: comma or line separated, but a comma inside a group stays (`{(a, b)|}` is one term). */
const termsOfText = (text: string) => text.split(/\n+/).flatMap(line => splitTop(line, ','));
export function expandPrefix(library: PrefixLibrary, name: string): string[] {
    const excluded = name.startsWith('-@');
    const clean = name.replace(/^-?@/, '');
    const prefix = library.prefixes.find(item => item.name.toLowerCase() === clean.toLowerCase());
    return prefix ? prefix.tags.flatMap(id => termsOfText(library.tags.find(tag => tag.id === id)?.text || '')).map(value => (excluded ? '-' : '') + value.trim()).filter(value => value && value !== '-') : [name];
}
/** Expand saved compound vocabulary and copied prefix text without splitting literal Hydrus predicates. */
export function expandSearchTerms(library: PrefixLibrary, value: string): string[] {
    const expanded = expandPrefix(library, value);
    if (expanded.length !== 1 || expanded[0] !== value) return expanded;
    const excluded = value.startsWith('-');
    const text = (excluded ? value.slice(1) : value).trim();
    const compound = library.tags.some(tag => tag.text.trim() === text) || library.prefixes.some(prefix =>
        prefix.tags.map(id => library.tags.find(tag => tag.id === id)?.text).filter(Boolean).join(', ') === text);
    return compound ? Array.from(new Set(termsOfText(text).map(term => term.trim()).filter(Boolean).map(term => (excluded ? '-' : '') + term))) : [value];
}
export async function savePrefix(name: string, values: string[], revision?: string, imageKeys?: string[], negativeTerms?: string[], imageRefs?: Record<string, PrefixImage>) {
    const result = await request({ action: 'save', name, terms: values, image_keys: imageKeys || [], negative_terms: negativeTerms, image_refs: imageRefs || {}, revision: revision || (await loadPrefixes()).revision });
    localStorage.setItem('comfy.prompt-library.v2', JSON.stringify(result.library));
    changed();
    return 'Saved to shared Prompt Library';
}
/** Pair images with an existing prefix without changing its terms. */
export async function associateImages(prefixId: string, imageKeys: string[], imageRefs: Record<string, PrefixImage> = {}, revision?: string) {
    const result = await request({ action: 'associate', prefix_id: prefixId, image_keys: imageKeys, image_refs: imageRefs, revision: revision || (await loadPrefixes()).revision });
    localStorage.setItem('comfy.prompt-library.v2', JSON.stringify(result.library));
    changed();
}
/** Remove image pairings (the prefix itself is kept). */
export async function dissociateImages(imageKeys: string[], revision?: string) {
    const result = await request({ action: 'dissociate', image_keys: imageKeys, revision: revision || (await loadPrefixes()).revision });
    localStorage.setItem('comfy.prompt-library.v2', JSON.stringify(result.library));
    changed();
}
export type PrefixPolarity = 'all' | 'positive' | 'negative' | 'both';
/** Which sides a prefix has terms on: positive only, negative only, or both. */
export function prefixSides(prefix: { tags: string[]; negative_terms?: string[] }): Exclude<PrefixPolarity, 'all'> | 'empty' {
    const positive = prefix.tags.length > 0, negative = !!prefix.negative_terms?.length;
    return positive && negative ? 'both' : positive ? 'positive' : negative ? 'negative' : 'empty';
}
/** Spelled-out sides of a prefix, for lists ("Pose · positive only"). */
export const sidesLabel = (prefix: { tags: string[]; negative_terms?: string[] }) => ({ positive: 'positive only', negative: 'negative only', both: 'positive + negative', empty: 'empty' } as const)[prefixSides(prefix)];
export const matchesPolarity = (prefix: { tags: string[]; negative_terms?: string[] }, filter: PrefixPolarity) => filter === 'all' || prefixSides(prefix) === filter;
export const POLARITY_OPTIONS: { value: PrefixPolarity; label: string }[] = [{ value: 'all', label: 'All prefixes' }, { value: 'positive', label: 'Positive only' }, { value: 'negative', label: 'Negative only' }, { value: 'both', label: 'Positive and negative' }];
export async function deletePrefix(id: string, revision: string) {
    const result = await request({ action: 'delete', id, revision });
    localStorage.setItem('comfy.prompt-library.v2', JSON.stringify(result.library));
    changed();
}
const isPrefixNode = (node: any) => ['TagPrefixPromptLibrary', 'GalleryPromptLibrary', 'GalleryPromptEncode'].includes(node?.comfyClass || node?.type || node?.constructor?.comfyClass);
export function applyLibraryPrefix(node: any, library: PrefixLibrary, id: string, text?: string) {
    const widget = node?.widgets?.find((value: any) => value.name === 'prefix' || value.name === 'text');
    const prefix = library.prefixes.find(value => value.id === id);
    if (!widget || !prefix || !node.graph) throw new Error('The Prompt Library node is no longer in the workflow.');
    node.graph.beforeChange?.();
    try {
        node.properties ||= {}; node.properties.prompt_library_selected_prefix = id;
        const value = text ?? expandPrefix(library, '@' + prefix.name).join(', ');
        // The encoder shows boxes; setting its text means replacing them with one box named after the prefix.
        if (node.__galleryPromptBoxes) { node.__galleryPromptBoxes.insert(value, 'replace', prefix.name); return; }
        if (widget.inputEl) widget.inputEl.readOnly = false;
        widget.value = value;
        if (widget.inputEl) widget.inputEl.value = widget.value;
        widget.callback?.(widget.value); node.setDirtyCanvas?.(true, true);
    } finally { node.graph.afterChange?.(); }
}
export function installPrefixWidgets(node: any) {
    if (!isPrefixNode(node)) return;
    // Other node packages run their creation hook too. Replace only this known
    // manager button once those hooks have installed it; leave its STRING output intact.
    setTimeout(() => {
        const prompt = node.widgets?.find((widget: any) => ['prefix', 'text'].includes(widget.name));
        if (prompt?.inputEl) { prompt.inputEl.readOnly = false; prompt.inputEl.disabled = false; }
        installPromptBoxes(node, { loadLibrary: loadPrefixes, expandPrefix });
        const existing = node.widgets?.find((widget: any) => widget.name === 'Open prompt library');
        const open = () => openPrefixManager({ node });
        if (existing) existing.callback = open;
        else node.addWidget?.('button', 'Open prompt library', null, open, { serialize: false });
    }, 0);
}

export function imagePrefixKeys(entry: { hash?: string; local?: { url: string } }, root: string): string[] {
    return [...(entry.hash ? ['sha256:' + entry.hash] : []), ...(entry.local ? ['local:' + root + ':' + entry.local.url] : [])];
}

export function writeLibraryNodeText(node: any, text: string) {
    const widget = node?.widgets?.find((value: any) => value.name === 'prefix' || value.name === 'text');
    if (!widget || !node.graph) throw new Error('The prompt node is no longer in the workflow.');
    node.graph.beforeChange?.();
    try {
        if (node.__galleryPromptBoxes) { node.__galleryPromptBoxes.insert(text, 'replace'); return; }
        widget.value = text; if (widget.inputEl) { widget.inputEl.value = text; widget.inputEl.readOnly = false; } widget.callback?.(text); node.setDirtyCanvas?.(true, true);
    }
    finally { node.graph.afterChange?.(); }
}

export function imagePrefixRefs(entry: { name?: string; hash?: string; local?: { url: string } }, root: string): Record<string, PrefixImage> {
    return Object.fromEntries(imagePrefixKeys(entry, root).map(key => [key, { name: entry.name || '', ...(entry.hash ? { hash: entry.hash } : {}), ...(entry.local ? { local_url: entry.local.url, root } : {}) }]));
}
