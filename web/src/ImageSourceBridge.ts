import { getComfyApp, STANDALONE } from './ComfyAppApi';
import { emptyImageSourceManifest } from './ImageSourceGeometry';
import type { ImageSourceImage, ImageSourceManifest } from './ImageSourceGeometry';

export const SOURCE_EDITOR_EVENT = 'gallery-source-editor';
export const SOURCE_BROWSE_EVENT = 'gallery-source-browse';
let target: any;
const children = new Set<Window>();
const graphNow = () => getComfyApp()?.canvas?.graph || getComfyApp()?.graph;
const isSource = (node: any) => node?.comfyClass === 'GalleryImageSource' || node?.type === 'GalleryImageSource';
const nodes = () => (graphNow()?._nodes || []).filter(isSource);

export function readSourceManifest(node: any): ImageSourceManifest {
    const raw = node.widgets?.find((widget: any) => widget.name === 'sources')?.value;
    if (!raw) return emptyImageSourceManifest();
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.images)) throw new Error('This node has invalid image source settings.');
    return value;
}

export function saveSourceManifest(node: any, manifest: ImageSourceManifest) {
    const graph = graphNow();
    if (!graph || !nodes().includes(node)) throw new Error('The target node is no longer in the active workflow.');
    const widget = node.widgets?.find((item: any) => item.name === 'sources');
    if (!widget) throw new Error('Restart ComfyUI to register Gallery Image Source.');
    graph.beforeChange?.();
    try { widget.value = JSON.stringify(manifest); widget.callback?.(widget.value); node.setDirtyCanvas?.(true, true); }
    finally { graph.afterChange?.(); }
}

function currentTarget(create = false, forceNew = false): any {
    const available = nodes();
    if (!forceNew && target && available.includes(target)) return target;
    target = undefined;
    const selected = Object.values(getComfyApp()?.canvas?.selected_nodes || {}).filter(isSource);
    if (!forceNew && selected.length === 1) return selected[0];
    if (!forceNew && available.length === 1) return available[0];
    if (!create) return undefined;
    if (!forceNew && available.length) throw new Error('Choose an Image Source target in the gallery toolbar first.');
    const graph = graphNow();
    const liteGraph = (window as any).LiteGraph || (window as any).comfyAPI?.litegraph?.LiteGraph;
    if (!graph || !liteGraph?.createNode) throw new Error('Open Gallery from a ComfyUI workflow to append images.');
    const node = liteGraph.createNode('GalleryImageSource');
    if (!node) throw new Error('Gallery Image Source is unavailable. Restart ComfyUI and refresh the browser.');
    const canvas = getComfyApp()?.canvas;
    const scale = canvas?.ds?.scale || 1, offset = canvas?.ds?.offset || [0, 0];
    node.pos = [(canvas?.canvas?.clientWidth || 800) / (2 * scale) - offset[0], (canvas?.canvas?.clientHeight || 600) / (2 * scale) - offset[1]];
    graph.beforeChange?.();
    try { graph.add(node); installSourceWidgets(node); canvas?.selectNode?.(node); }
    finally { graph.afterChange?.(); }
    target = node;
    return node;
}

export function installSourceWidgets(node: any) {
    if (!isSource(node) || node.__gallerySourceInstalled) return;
    node.__gallerySourceInstalled = true;
    // Keep the STRING widget serialized, but present the visual editor instead.
    const widget = node.widgets?.find((item: any) => item.name === 'sources');
    if (widget) { widget.type = 'hidden'; widget.hidden = true; widget.computeSize = () => [0, -4]; if (widget.inputEl) widget.inputEl.style.display = 'none'; }
    const edit = node.addWidget('button', 'Edit images / crop / stitch', null, () => {
        target = node; window.dispatchEvent(new CustomEvent(SOURCE_EDITOR_EVENT, { detail: node }));
    }, { serialize: false });
    const browse = node.addWidget('button', 'Browse / append from Gallery', null, () => {
        target = node; window.dispatchEvent(new CustomEvent(SOURCE_BROWSE_EVENT));
    }, { serialize: false });
    if (edit) edit.serialize = false;
    if (browse) browse.serialize = false;
    node.setSize?.([320, Math.max(180, node.computeSize?.()[1] || 180)]);
}

type TargetInfo = { options: { value: string; label: string }[]; selected?: string };
function targetInfo(): TargetInfo {
    const chosen = currentTarget();
    return { options: nodes().map((node: any) => ({ value: String(node.id), label: `${node.title || 'Gallery Image Source'} #${node.id} (${readSourceManifest(node).images.length})` })), selected: chosen ? String(chosen.id) : undefined };
}

function localCommand(command: string, payload: any): any {
    if (command === 'targets') return targetInfo();
    if (command === 'target' && payload === 'new') { currentTarget(true, true); return targetInfo(); }
    if (command === 'target') { target = nodes().find((node: any) => String(node.id) === payload); if (!target) throw new Error('That target is no longer available.'); return targetInfo(); }
    if (command === 'edit') { const node = currentTarget(true); window.dispatchEvent(new CustomEvent(SOURCE_EDITOR_EVENT, { detail: node })); window.focus(); return true; }
    if (command !== 'append') throw new Error('Unknown image source action.');
    if (!Array.isArray(payload) || !payload.length || payload.length > 32 || payload.some(image => typeof image?.input_name !== 'string' || !image.input_name || image.input_name.length > 2048)) throw new Error('Append between 1 and 32 input images.');
    const node = currentTarget(true);
    const manifest = readSourceManifest(node);
    if (manifest.images.length + payload.length > 32) throw new Error('This node can contain at most 32 images. Remove sources or choose another node.');
    saveSourceManifest(node, { ...manifest, images: [...manifest.images, ...payload.map(image => ({ input_name: image.input_name, title: String(image.title || image.input_name).slice(0, 512) }))] });
    target = node;
    return `Appended ${payload.length} image(s) to ${node.title || 'Gallery Image Source'} #${node.id}.`;
}

window.addEventListener('message', event => {
    if (STANDALONE || event.origin !== location.origin || !children.has(event.source as Window) || event.data?.kind !== 'gallery-source-request') return;
    const { id, command, payload } = event.data;
    try { (event.source as Window).postMessage({ kind: 'gallery-source-response', id, value: localCommand(command, payload) }, location.origin); }
    catch (error) { (event.source as Window).postMessage({ kind: 'gallery-source-response', id, error: error instanceof Error ? error.message : String(error) }, location.origin); }
});

function command<T>(name: string, payload?: any): Promise<T> {
    if (!STANDALONE) { try { return Promise.resolve(localCommand(name, payload)); } catch (error) { return Promise.reject(error); } }
    if (!window.opener || window.opener.closed) return Promise.reject(new Error('Open this gallery using “Open in new tab” in ComfyUI to connect an Image Source node.'));
    return new Promise((resolve, reject) => {
        const id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const finish = () => { clearTimeout(timer); window.removeEventListener('message', listener); };
        const listener = (event: MessageEvent) => {
            if (event.origin !== location.origin || event.source !== window.opener || event.data?.kind !== 'gallery-source-response' || event.data.id !== id) return;
            finish(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.value);
        };
        const timer = window.setTimeout(() => { finish(); reject(new Error('The opening ComfyUI tab did not respond. Reopen Gallery from that tab.')); }, 5000);
        window.addEventListener('message', listener);
        window.opener.postMessage({ kind: 'gallery-source-request', id, command: name, payload }, location.origin);
    });
}

export const getSourceTargets = () => command<TargetInfo>('targets');
export const setSourceTarget = (id: string) => command<TargetInfo>('target', id);
export const editSourceTarget = () => command<boolean>('edit');
export const appendToImageSource = (images: ImageSourceImage[]) => command<string>('append', images);

export async function appendLocalImages(urls: string[]) {
    if (!urls.length || urls.length > 32) throw new Error('Select between 1 and 32 images per append.');
    const entries: ImageSourceImage[] = [];
    for (const url of urls) {
        const response = await fetch('/Gallery/source/local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not copy the local image.');
        entries.push({ input_name: data.input_name, title: data.title });
    }
    return appendToImageSource(entries);
}

export function openGalleryTab() {
    const child = window.open('/Gallery/app', '_blank');
    if (!child) throw new Error('Allow popups for ComfyUI to open Gallery in a new tab.');
    children.add(child);
    for (const old of children) if (old.closed) children.delete(old);
}
