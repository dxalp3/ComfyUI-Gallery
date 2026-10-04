import { getComfyApp } from './ComfyAppApi';
export type PrefixLibrary = { version: number; tags: { id: string; name: string; text: string }[]; prefixes: { id: string; name: string; tags: string[] }[] };
async function api() {
    const current = (window as any).comfyAPI?.api?.api || getComfyApp()?.api;
    if (current?.fetchApi) return current;
    try { return (await import(/* @vite-ignore */ `${location.origin}/scripts/api.js`)).api; } catch { return current; }
}
export const PREFIX_MANAGER_EVENT = 'gallery-prefix-manager';
export type PrefixSeed = { name?: string; positive?: string[]; negative?: string[]; hydrus?: string[]; node?: any };
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
export function expandPrefix(library: PrefixLibrary, name: string): string[] {
    const excluded = name.startsWith('-@');
    const clean = name.replace(/^-?@/, '');
    const prefix = library.prefixes.find(item => item.name.toLowerCase() === clean.toLowerCase());
    return prefix ? prefix.tags.flatMap(id => (library.tags.find(tag => tag.id === id)?.text || '').split(/[,\n]+/)).map(value => (excluded ? '-' : '') + value.trim()).filter(value => value && value !== '-') : [name];
}
/** Expand saved compound vocabulary and copied prefix text without splitting literal Hydrus predicates. */
export function expandSearchTerms(library: PrefixLibrary, value: string): string[] {
    const expanded = expandPrefix(library, value);
    if (expanded.length !== 1 || expanded[0] !== value) return expanded;
    const excluded = value.startsWith('-');
    const text = (excluded ? value.slice(1) : value).trim();
    const compound = library.tags.some(tag => tag.text.trim() === text) || library.prefixes.some(prefix =>
        prefix.tags.map(id => library.tags.find(tag => tag.id === id)?.text).filter(Boolean).join(', ') === text);
    return compound ? Array.from(new Set(text.split(/[,\n]+/).map(term => term.trim()).filter(Boolean).map(term => (excluded ? '-' : '') + term))) : [value];
}
export async function savePrefix(name: string, values: string[], revision?: string) {
    const result = await request({ action: 'save', name, terms: values, revision: revision || (await loadPrefixes()).revision });
    localStorage.setItem('comfy.prompt-library.v2', JSON.stringify(result.library));
    changed();
    return 'Saved to shared Prompt Library';
}
export async function deletePrefix(id: string, revision: string) {
    const result = await request({ action: 'delete', id, revision });
    localStorage.setItem('comfy.prompt-library.v2', JSON.stringify(result.library));
    changed();
}
const isPrefixNode = (node: any) => ['TagPrefixPromptLibrary', 'GalleryPromptLibrary'].includes(node?.comfyClass || node?.type || node?.constructor?.comfyClass);
export function applyLibraryPrefix(node: any, library: PrefixLibrary, id: string, text?: string) {
    const widget = node?.widgets?.find((value: any) => value.name === 'prefix');
    const prefix = library.prefixes.find(value => value.id === id);
    if (!widget || !prefix || !node.graph) throw new Error('The Prompt Library node is no longer in the workflow.');
    node.graph.beforeChange?.();
    try {
        node.properties ||= {}; node.properties.prompt_library_selected_prefix = id;
        widget.value = text ?? expandPrefix(library, '@' + prefix.name).join(', ');
        widget.callback?.(widget.value); node.setDirtyCanvas?.(true, true);
    } finally { node.graph.afterChange?.(); }
}
export function installPrefixWidgets(node: any) {
    if (!isPrefixNode(node)) return;
    // Other node packages run their creation hook too. Replace only this known
    // manager button once those hooks have installed it; leave its STRING output intact.
    setTimeout(() => {
        const existing = node.widgets?.find((widget: any) => widget.name === 'Open prompt library');
        const open = () => openPrefixManager({ node });
        if (existing) existing.callback = open;
        else node.addWidget?.('button', 'Open prompt library', null, open, { serialize: false });
    }, 0);
}
