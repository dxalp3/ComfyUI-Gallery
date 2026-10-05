import { combineEncoderPrompt } from './PromptInsertion';
import { sourcePrompt } from './ImageSourceGeometry';
import { getComfyApp } from './ComfyAppApi';
export type PrefixImage = { name?: string; local_url?: string; root?: string; hash?: string };
export type PrefixLibrary = { version: number; associations?: Record<string, { prefix_id: string; terms: string[]; negative_terms?: string[]; image?: PrefixImage }>; tags: { id: string; name: string; text: string }[]; prefixes: { id: string; name: string; tags: string[]; negative_terms?: string[] }[] };
async function api() {
    const current = (window as any).comfyAPI?.api?.api || getComfyApp()?.api;
    if (current?.fetchApi) return current;
    try { return (await import(/* @vite-ignore */ `${location.origin}/scripts/api.js`)).api; } catch { return current; }
}
export const PREFIX_MANAGER_EVENT = 'gallery-prefix-manager';
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
export async function savePrefix(name: string, values: string[], revision?: string, imageKeys?: string[], negativeTerms?: string[], imageRefs?: Record<string, PrefixImage>) {
    const result = await request({ action: 'save', name, terms: values, image_keys: imageKeys || [], negative_terms: negativeTerms, image_refs: imageRefs || {}, revision: revision || (await loadPrefixes()).revision });
    localStorage.setItem('comfy.prompt-library.v2', JSON.stringify(result.library));
    changed();
    return 'Saved to shared Prompt Library';
}
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
        if (widget.inputEl) widget.inputEl.readOnly = false;
        widget.value = text ?? expandPrefix(library, '@' + prefix.name).join(', ');
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
        installEffectivePrompt(node);
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
    try { widget.value = text; if (widget.inputEl) { widget.inputEl.value = text; widget.inputEl.readOnly = false; } widget.callback?.(text); node.setDirtyCanvas?.(true, true); }
    finally { node.graph.afterChange?.(); }
}

export function imagePrefixRefs(entry: { name?: string; hash?: string; local?: { url: string } }, root: string): Record<string, PrefixImage> {
    return Object.fromEntries(imagePrefixKeys(entry, root).map(key => [key, { name: entry.name || '', ...(entry.hash ? { hash: entry.hash } : {}), ...(entry.local ? { local_url: entry.local.url, root } : {}) }]));
}

export function effectiveSourceText(node: any): string | undefined {
    const input = node.inputs?.find((input: any) => input.name === 'source_text');
    if (input?.link == null) return undefined;
    const graph = node.graph || getComfyApp()?.graph;
    const link = graph?.links?.get?.(input.link) || graph?.links?.[input.link];
    let source = graph?.getNodeById?.(link?.origin_id) || graph?._nodes?.find((value: any) => value.id === link?.origin_id);
    if ((source?.comfyClass || source?.type) === 'GalleryImageSource' && [4, 5].includes(link?.origin_slot)) {
        try { return sourcePrompt(JSON.parse(source.widgets.find((value: any) => value.name === 'sources').value), link.origin_slot === 4 ? 'positive' : 'negative'); } catch { return 'Source settings unavailable'; }
    }
    return node.__galleryRuntimeSource ?? 'Connected prompt will be shown after execution.';
}
function installEffectivePrompt(node: any) {
    if ((node.comfyClass || node.type) !== 'GalleryPromptEncode' || node.__galleryEffectiveInstalled || !node.addDOMWidget) return;
    node.__galleryEffectiveInstalled = true;
    const box = document.createElement('div');
    const label = document.createElement('div'); const text = document.createElement('textarea');
    text.readOnly = true; text.setAttribute('aria-label', 'Effective encoder prompt');
    text.style.cssText = 'width:100%;height:100px;box-sizing:border-box;resize:vertical;background:var(--comfy-input-bg,#222);color:var(--input-text,#ddd)';
    box.append(label, text);
    const refresh = () => { if (!node.inputs?.some((input: any) => input.name === 'source_text')) node.addInput?.('source_text', 'STRING'); if (!node.widgets?.some((widget: any) => widget.name === 'source_mode')) node.addWidget?.('combo', 'source_mode', 'after', () => { node.__galleryRuntimePrompt = undefined; refresh(); }, { values: ['after', 'before', 'replace'] }); const incoming = effectiveSourceText(node); const own = node.widgets?.find((value: any) => value.name === 'text')?.value || ''; const mode = node.widgets?.find((value: any) => value.name === 'source_mode')?.value || 'after'; label.textContent = incoming === undefined ? 'Effective prompt · own text' : 'Effective prompt · source ' + mode; text.value = node.__galleryRuntimePrompt ?? combineEncoderPrompt(own, incoming, mode); };
    const dom = node.addDOMWidget('effective_prompt', 'effective_prompt', box, { serialize: false, getHeight: () => 125 }); if (dom) dom.serialize = false;
    const widget = node.widgets?.find((value: any) => value.name === 'text'); const callback = widget?.callback;
    if (widget) widget.callback = function (...args: any[]) { node.__galleryRuntimePrompt = undefined; const result = callback?.apply(this, args); refresh(); return result; };
    for (const key of ['onConnectionsChange', 'onConfigure']) { const previous = node[key]; node[key] = function (...args: any[]) { node.__galleryRuntimePrompt = undefined; const result = previous?.apply(this, args); setTimeout(refresh, 0); return result; }; }
    const executed = node.onExecuted; node.onExecuted = function (data: any) { const result = executed?.call(this, data); if (Array.isArray(data?.effective_prompt)) node.__galleryRuntimePrompt = data.effective_prompt[0]; refresh(); return result; };
    const changed = () => { node.__galleryRuntimePrompt = undefined; refresh(); };
    const modeWidget = node.widgets?.find((value: any) => value.name === 'source_mode'); const modeCallback = modeWidget?.callback;
    if (modeWidget) modeWidget.callback = function (...args: any[]) { const result = modeCallback?.apply(this, args); changed(); return result; };
    window.addEventListener('gallery-source-changed', changed);
    const removed = node.onRemoved; node.onRemoved = function (...args: any[]) { window.removeEventListener('gallery-source-changed', changed); return removed?.apply(this, args); };
    refresh(); node.setSize?.([Math.max(320, node.size?.[0] || 320), Math.max(node.size?.[1] || 0, node.computeSize?.()[1] || 280)]);
}
