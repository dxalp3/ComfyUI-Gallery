import { refreshSourcePrefix } from './SourcePrefixes';
import { mergeSourceHistory, type PickerRect } from './SourceHistory';
import { getComfyApp, STANDALONE } from './ComfyAppApi';
import { imageOrigin, ORIGIN_STYLE, stampOrigin, removeSourceImage, sourceImageUrl, emptyImageSourceManifest, mergePrompt } from './ImageSourceGeometry';
import type { ImageSourceImage, ImageSourceManifest, PromptApply } from './ImageSourceGeometry';
import { loadPrefixes, type SharedLibrary } from './PrefixLibrary';
import { hideWidget } from './NodeWidgets';

export const SOURCE_EDITOR_EVENT = 'gallery-source-editor';
export const SOURCE_BROWSE_EVENT = 'gallery-source-browse';
/** Opens the image picker (SourcePicker) for a node. */
export const SOURCE_PICKER_EVENT = 'gallery-source-picker';
export type SourcePickerRequest = { node: any; anchor: () => PickerRect | null; trigger?: HTMLElement; batch?: boolean };
export function openSourcePicker(node: any, anchor?: () => PickerRect | null, trigger?: HTMLElement) {
    window.dispatchEvent(new CustomEvent(SOURCE_PICKER_EVENT, { detail: { node, anchor: anchor || node.__galleryPickerAnchor, trigger } }));
}
export function readSourceHistory(node: any) {
    return mergeSourceHistory(node.properties?.gallery_source_history, readSourceManifest(node).images);
}
let target: any;
let sourceConstructor: any;
export const registerSourceConstructor = (value: any) => { sourceConstructor = value; };
const children = new Set<Window>();
// Read app.graph only once the canvas exists: before that ComfyUI logs "graph accessed before initialization".
const graphNow = () => { const app = getComfyApp(); return app?.canvas?.graph || (app?.canvas ? app.graph : undefined); };
const isSource = (node: any) => [node?.comfyClass, node?.type, node?.constructor?.comfyClass].includes('GalleryImageSource');
const nodes = () => (graphNow()?._nodes || []).filter(isSource);

export function readSourceManifest(node: any): ImageSourceManifest {
    const raw = node.widgets?.find((widget: any) => widget.name === 'sources')?.value;
    if (!raw) return emptyImageSourceManifest();
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.images)) throw new Error('This node has invalid image source settings.');
    return value;
}

export function saveSourceManifest(node: any, manifest: ImageSourceManifest, recordChange = true) {
    const graph = graphNow();
    if (!graph || !nodes().includes(node)) throw new Error('The target node is no longer in the active workflow.');
    const widget = node.widgets?.find((item: any) => item.name === 'sources');
    if (!widget) throw new Error('Restart ComfyUI to register Gallery Image Source.');
    if (recordChange) graph.beforeChange?.();
    try {
        const history = mergeSourceHistory(readSourceHistory(node), manifest.images);
        widget.value = JSON.stringify(manifest); widget.callback?.(widget.value);
        if (readSourceManifest(node).images.length !== manifest.images.length) throw new Error('ComfyUI did not retain the appended sources. Check this node’s sources input.');
        node.properties ||= {}; node.properties.gallery_source_history = history;
        node.__galleryRefreshPreview?.(); window.dispatchEvent(new CustomEvent('gallery-source-changed')); node.setDirtyCanvas?.(true, true);
    }
    finally { if (recordChange) graph.afterChange?.(); }
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
    if (!graph || (!liteGraph?.createNode && !sourceConstructor)) throw new Error('Open Gallery from a ComfyUI workflow to append images.');
    const node = liteGraph?.createNode ? liteGraph.createNode('GalleryImageSource') : new sourceConstructor();
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
    // Preserve the native STRING/DOM widget type and serializer. Changing its
    // type can break frontend extensions that own the widget's backing value.
    hideWidget(widget);
    const edit = node.addWidget('button', 'Edit images / crop / stitch', null, () => {
        target = node; window.dispatchEvent(new CustomEvent(SOURCE_EDITOR_EVENT, { detail: node }));
    }, { serialize: false });
    const browse = node.addWidget('button', 'Browse / append from Gallery', null, () => {
        target = node; window.dispatchEvent(new CustomEvent(SOURCE_BROWSE_EVENT));
    }, { serialize: false });
    // Put the node-local picker immediately above the preview; the gallery browser stays separate.
    const pickButton = node.addWidget('button', 'Pick images ▾', null, (...args: any[]) => {
        target = node;
        const event = args.find(value => value && typeof value.clientX === 'number');
        // Vue's WidgetButton invokes callback() without an event; its native button has focus.
        const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest('button') : null;
        const element = event?.target instanceof HTMLElement && event.target.tagName !== 'CANVAS' ? event.target.closest('button') || event.target
            : focused && /Pick images/.test(focused.getAttribute('aria-label') || focused.textContent || '') ? focused : undefined;
        const anchor = () => {
            if (element?.isConnected) return element.getBoundingClientRect();
            const canvas = getComfyApp()?.canvas;
            const widgetY = pickButton?.y ?? pickButton?.last_y;
            if (canvas?.canvas && Number.isFinite(widgetY)) {
                const bounds = canvas.canvas.getBoundingClientRect(), scale = canvas.ds?.scale || 1, offset = canvas.ds?.offset || [0, 0];
                const sx = bounds.width / (canvas.canvas.clientWidth || bounds.width), sy = bounds.height / (canvas.canvas.clientHeight || bounds.height);
                const left = bounds.left + (node.pos[0] + offset[0] + 10) * scale * sx;
                const top = bounds.top + (node.pos[1] + offset[1] + widgetY) * scale * sy;
                const width = (node.size[0] - 20) * scale * sx, height = (pickButton.height || 20) * scale * sy;
                return { left, top, right: left + width, bottom: top + height, width, height };
            }
            return node.__galleryPickerAnchor?.() || null;
        };
        openSourcePicker(node, anchor, element);
    }, { serialize: false });
    if (pickButton) pickButton.serialize = false;
    if (edit) edit.serialize = false;
    if (browse) browse.serialize = false;
    if (typeof document !== 'undefined' && node.addDOMWidget) {
        // A fixed-size slider (like Load Image's picker): one large image, arrows, and a scrolling strip of
        // thumbnails. However many images are added, the node keeps its size.
        const preview = document.createElement('div');
        preview.className = 'gallery-source-node-preview';
        preview.style.cssText = 'display:flex;flex-direction:column;gap:4px;width:100%;height:230px;overflow:hidden;color:var(--input-text,#ddd);background:var(--comfy-input-bg,#222);padding:4px;box-sizing:border-box;font:11px system-ui';
        let view = 0, note = '', clickTimer = 0, stripScroll = 0;
        const galleryViewer = (index: number) => {
            clearTimeout(clickTimer);
            target = node;
            window.dispatchEvent(new CustomEvent(SOURCE_BROWSE_EVENT));
            window.dispatchEvent(new CustomEvent('gallery-open-viewer', { detail: { sourceImages: readSourceManifest(node).images, sourceIndex: index } }));
        };
        node.__galleryPickerAnchor = () => preview.isConnected ? (preview.querySelector<HTMLElement>('[data-picker-trigger]') || preview).getBoundingClientRect() : null;
        const pickerTrigger = (element: HTMLElement) => {
            element.dataset.pickerTrigger = 'true'; element.tabIndex = 0;
            element.setAttribute('role', 'button'); element.setAttribute('aria-label', 'Pick images from this node');
            element.setAttribute('aria-haspopup', 'dialog'); element.setAttribute('aria-expanded', String(!!node.__galleryPickerOpen));
            element.onclick = event => { event.stopPropagation(); clearTimeout(clickTimer); clickTimer = window.setTimeout(() => openSourcePicker(node, node.__galleryPickerAnchor, element), 280); };
            element.ondblclick = event => { event.preventDefault(); event.stopPropagation(); galleryViewer(view); };
            element.onkeydown = event => { if (event.target === element && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); openSourcePicker(node, node.__galleryPickerAnchor, element); } };
        };
        const thumb = (image: ImageSourceImage) => '/Gallery/source/thumbnail?url=' + encodeURIComponent('/static_gallery/' + image.input_name);
        const button = (text: string, label: string, onClick: () => void, css = '') => { const item = document.createElement('button'); item.type = 'button'; item.textContent = text; item.title = label; item.setAttribute('aria-label', label); item.onclick = event => { event.stopPropagation(); onClick(); }; item.style.cssText = 'border:0;border-radius:4px;background:#000a;color:#fff;cursor:pointer;' + css; return item; };
        let dismissMenu: (() => void) | undefined;
        let dismissViewer: (() => void) | undefined;
        const badge = (element: HTMLElement, image: ImageSourceImage) => {
            const origin = imageOrigin(image), look = ORIGIN_STYLE[origin];
            element.style.position = 'relative';
            element.style.border = (origin === 'external' ? '3px' : '2px') + ' solid ' + look.color;
            element.style.boxSizing = 'border-box';
            const label = document.createElement('span'); label.textContent = look.label;
            label.style.cssText = 'position:absolute;top:0;left:0;padding:1px 3px;font:9px system-ui;color:#111;background:' + look.color;
            element.append(label);
        };
        const openViewer = (image: ImageSourceImage) => {
            dismissViewer?.();
            const dialog = document.createElement('dialog'); dialog.setAttribute('aria-label', 'Image source viewer');
            dialog.style.cssText = 'max-width:95vw;max-height:95vh;padding:12px;background:#202020;color:white;border:1px solid #888;border-radius:8px';
            const img = document.createElement('img'); img.src = sourceImageUrl(image.input_name); img.alt = image.title || image.input_name;
            img.style.cssText = 'display:block;max-width:90vw;max-height:80vh;object-fit:contain';
            const close = () => { dialog.remove(); dismissViewer = undefined; };
            dialog.append(button('Close', 'Close viewer', close), img);
            dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
            dismissViewer = close; document.body.append(dialog); dialog.showModal();
        };
        const menu = (event: MouseEvent, index: number) => {
            event.preventDefault(); event.stopPropagation(); dismissMenu?.();
            const image = readSourceManifest(node).images[index]; if (!image) return;
            const popup = document.createElement('div'); popup.setAttribute('role', 'menu');
            popup.style.cssText = 'position:fixed;z-index:4000;display:flex;flex-direction:column;padding:4px;gap:3px;background:#252525;border:1px solid #888;border-radius:6px;box-shadow:0 4px 20px #0008';
            popup.style.left = Math.max(0, Math.min(event.clientX, innerWidth - 190)) + 'px';
            popup.style.top = Math.max(0, Math.min(event.clientY, innerHeight - 150)) + 'px';
            const close = () => { popup.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); dismissMenu = undefined; };
            const outside = (e: PointerEvent) => { if (!popup.contains(e.target as Node)) close(); };
            const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
            const action = (label: string, run: () => void) => {
                const item = button(label, label, () => { close(); try { run(); } catch (error) { node.__galleryNotify?.(String(error)); } }, 'text-align:left;padding:6px 12px;min-width:180px');
                item.setAttribute('role', 'menuitem'); popup.append(item);
            };
            action('Use as output', () => { const current = readSourceManifest(node); saveSourceManifest(node, { ...current, layout: 'single', active_index: index }); });
            action('Choose batch images…', () => window.dispatchEvent(new CustomEvent(SOURCE_PICKER_EVENT, { detail: { node, anchor: node.__galleryPickerAnchor, batch: true } })));
            action('Open in gallery', () => galleryViewer(index));
            action('Open in viewer', () => openViewer(image));
            action('Remove image', () => { const current = readSourceManifest(node); view = Math.max(0, view - (index <= view ? 1 : 0)); saveSourceManifest(node, removeSourceImage(current, index)); });
            dismissMenu = close; document.body.append(popup); popup.querySelector('button')?.focus();
            document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true);
        };
        const removed = node.onRemoved;
        node.onRemoved = function (...args: any[]) { clearTimeout(clickTimer); dismissMenu?.(); dismissViewer?.(); return removed?.apply(this, args); };
        const refresh = () => {
            dismissMenu?.();
            preview.replaceChildren();
            try {
                const manifest = readSourceManifest(node), images = manifest.images, single = manifest.layout === 'single';
                const active = manifest.active_index || 0;
                if (!images.length) {
                    const empty = document.createElement('div');
                    empty.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;text-align:center;border:1px dashed #8886;border-radius:6px;padding:8px;opacity:.75';
                    empty.textContent = note || 'No images yet. Click to pick images, drop image files here, or drop a Load Image node onto this node.';
                    empty.style.cursor = 'pointer'; pickerTrigger(empty);
                    preview.append(empty); return;
                }
                // In the single layout the slider picks the output image; otherwise it only browses.
                view = single ? active : Math.min(view, images.length - 1);
                node.__galleryViewIndex = view;
                const go = (index: number) => { const next = (index + images.length) % images.length; if (single) saveSourceManifest(node, { ...manifest, active_index: next }); else { view = next; refresh(); } };
                const stage = document.createElement('div');
                stage.style.cssText = 'position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#0006;border-radius:4px;overflow:hidden;cursor:pointer';
                stage.title = 'Click to pick images · Double-click to open in Gallery'; pickerTrigger(stage);
                const img = document.createElement('img');
                img.src = thumb(images[view]); img.alt = images[view].title || images[view].input_name;
                img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain';
                img.onerror = () => { img.replaceWith(Object.assign(document.createElement('span'), { textContent: 'Preview unavailable: ' + (images[view].title || images[view].input_name) })); };
                stage.append(img); badge(stage, images[view]);
                stage.oncontextmenu = event => menu(event, view);
                if (images.length > 1) {
                    stage.append(button('‹', 'Previous image', () => go(view - 1), 'position:absolute;left:3px;top:50%;transform:translateY(-50%);width:22px;height:34px;font-size:18px'));
                    stage.append(button('›', 'Next image', () => go(view + 1), 'position:absolute;right:3px;top:50%;transform:translateY(-50%);width:22px;height:34px;font-size:18px'));
                }
                const caption = document.createElement('div');
                caption.style.cssText = 'position:absolute;left:0;right:0;bottom:0;padding:2px 6px;background:#000a;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
                caption.textContent = `${view + 1} / ${images.length} · ${manifest.layout}${single ? ' · output image' : ''} · ${images[view].title || images[view].input_name}${note ? ' · ' + note : ''}`;
                stage.append(caption);
                const chevron = document.createElement('span'); chevron.textContent = '▾'; chevron.style.cssText = 'position:absolute;right:6px;top:3px;color:white;text-shadow:0 1px 3px #000;font-size:16px'; stage.append(chevron);
                preview.append(stage);
                if (images.length > 1) {
                    const strip = document.createElement('div');
                    strip.setAttribute('aria-label', 'Source images');
                    strip.style.cssText = 'flex:none;display:flex;gap:3px;width:100%;max-width:335px;min-width:0;box-sizing:border-box;overflow-x:scroll;overflow-y:hidden;height:58px;padding-bottom:6px;scrollbar-width:thin;scrollbar-color:var(--border-color,#888) var(--comfy-input-bg,#222)';
                    strip.onscroll = () => { stripScroll = strip.scrollLeft; };
                    for (let index = 0; index < images.length; index++) {
                        const image = images[index];
                        const tile = button('', `${single ? 'Use' : 'Show'} image ${index + 1}: ${image.title || image.input_name}`, () => { clearTimeout(clickTimer); clickTimer = window.setTimeout(() => go(index), 280); }, `flex:0 0 64px;width:64px;min-width:64px;max-width:64px;overflow:hidden;height:42px;padding:0;background:transparent;outline:2px solid ${index === view ? '#1677ff' : 'transparent'};outline-offset:-2px;opacity:${index === view ? 1 : .7}`);
                        tile.setAttribute('aria-pressed', String(index === view));
                        const small = document.createElement('img'); small.src = thumb(image); small.alt = ''; small.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:3px';
                        tile.append(small);
                        tile.ondblclick = event => { event.preventDefault(); event.stopPropagation(); galleryViewer(index); };
                        tile.oncontextmenu = event => menu(event, index); strip.append(tile);
                    }
                    preview.append(strip);
                    strip.title = 'Scroll for more images · Double-click to open in Gallery';
                    strip.scrollLeft = stripScroll;
                    requestAnimationFrame(() => { if (!strip.isConnected) return; const left = view * 67; if (left < strip.scrollLeft) strip.scrollLeft = left; else if (left + 64 > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = left + 64 - strip.clientWidth; });
                }
            } catch (error) { preview.textContent = String(error); }
        };
        node.__galleryRefreshPreview = refresh;
        node.__galleryFocusImage = (index: number) => { view = index; refresh(); };
        node.__galleryFocusPreview = () => preview.querySelector<HTMLElement>('[data-picker-trigger]')?.focus({ preventScroll: true });
        node.__galleryNotify = (text: string) => { note = text; refresh(); window.setTimeout(() => { if (note === text) { note = ''; refresh(); } }, 4000); };
        // Files and gallery images dropped on the preview (or on the node) are added to this node.
        const drop = async (transfer: DataTransfer) => {
            note = 'adding…'; refresh();
            try { const count = await appendDropped(node, transfer); note = count ? `added ${count}` : 'nothing to add'; }
            catch (error) { note = String(error instanceof Error ? error.message : error); }
            refresh(); window.setTimeout(() => { note = ''; refresh(); }, 4000);
        };
        const accepts = (transfer: DataTransfer | null) => !!transfer && [...transfer.types].some(type => type === 'Files' || type === 'custom' || type === 'application/x-gallery-image');
        preview.addEventListener('dragover', event => { if (accepts(event.dataTransfer)) { event.preventDefault(); event.stopPropagation(); preview.style.outline = '2px dashed #1677ff'; } });
        preview.addEventListener('dragleave', () => { preview.style.outline = ''; });
        preview.addEventListener('drop', event => { preview.style.outline = ''; if (!accepts(event.dataTransfer)) return; event.preventDefault(); event.stopPropagation(); void drop(event.dataTransfer!); });
        node.onDragOver = (event: DragEvent) => accepts(event.dataTransfer);
        node.onDragDrop = (event: DragEvent) => { if (!accepts(event.dataTransfer)) return false; void drop(event.dataTransfer!); return true; };
        const dom = node.addDOMWidget('gallery_source_preview', 'gallery_source_preview', preview, { serialize: false, hideOnZoom: false, getHeight: () => 230, getMinHeight: () => 230, getMaxHeight: () => 230 });
        if (dom) { dom.serialize = false; dom.computeSize = () => [320, 230]; }
        const configure = node.onConfigure;
        node.onConfigure = function (...args: any[]) { const result = configure?.apply(this, args); refresh(); void loadPrefixes().catch(() => {}); return result; };
        refresh(); void loadPrefixes().catch(() => {});
    }
    node.setSize?.([320, Math.max(180, node.computeSize?.()[1] || 180)]);
}

export const comfyFetch = (path: string, options?: RequestInit): Promise<Response> => {
    const api = (window as any).comfyAPI?.api?.api || getComfyApp()?.api;
    return api?.fetchApi ? api.fetchApi(path, options) : fetch(path, options);
};
export async function sourceRequest(path: string, body: unknown): Promise<ImageSourceImage> {
    const response = await comfyFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not add that image.');
    const image = { input_name: data.input_name, title: data.title, metadata: data.metadata || {} };
    return stampOrigin(image, path === '/Gallery/source/input' ? (imageOrigin(image) === 'hydrus' ? 'hydrus' : 'external') : imageOrigin(image));
}
/** An image from ComfyUI's input folder (a Load Image node's image, an uploaded file) as a source entry. */
export const sourceFromInput = (name: string) => sourceRequest('/Gallery/source/input', { name });

/** Add images to one Gallery Image Source node. In the single layout the first new image becomes the output. */
export async function addToNode(node: any, images: ImageSourceImage[], urls?: (string | undefined)[]): Promise<number> {
    if (!images.length) return 0;
    const stamped = await withPairedPrefix(images.map(image => stampOrigin(image)), urls);
    const manifest = readSourceManifest(node);
    const room = 32 - manifest.images.length;
    if (room <= 0) throw new Error('This node already holds 32 images.');
    saveSourceManifest(node, { ...manifest, images: [...manifest.images, ...stamped.slice(0, room)], active_index: manifest.layout === 'single' ? manifest.images.length : manifest.active_index });
    return Math.min(room, stamped.length);
}

/**
 * Something dropped on a Gallery Image Source node: a gallery image (dragged from the grid) or image files.
 * Files are uploaded to ComfyUI's input folder first, the way Load Image does it.
 */
export async function appendDropped(node: any, transfer: DataTransfer): Promise<number> {
    // Read everything from the drop synchronously; the transfer is emptied once the event is over.
    let galleryUrl: string | undefined;
    try { const value = JSON.parse(transfer.getData('application/x-gallery-image') || transfer.getData('custom') || 'null'); if (value?.url?.startsWith('/static_gallery/')) galleryUrl = value.url; } catch { /* not a gallery image */ }
    const files = [...transfer.files].filter(file => file.type.startsWith('image/'));
    if (galleryUrl) return addToNode(node, [await sourceRequest('/Gallery/source/local', { url: galleryUrl })], [galleryUrl]);
    return addToNode(node, await uploadImages(files));
}

/** Upload image files to ComfyUI's input folder (as Load Image does) and make source entries of them. */
export async function uploadImages(files: File[]): Promise<ImageSourceImage[]> {
    const images: ImageSourceImage[] = [];
    for (const file of files) {
        const form = new FormData(); form.append('image', file);
        const response = await comfyFetch('/upload/image', { method: 'POST', body: form });
        if (!response.ok) throw new Error('ComfyUI did not accept ' + file.name);
        const data = await response.json();
        images.push({ ...await sourceFromInput((data.subfolder ? data.subfolder + '/' : '') + data.name), title: file.name });
    }
    return images;
}

let loadImageDrop = false;
const isLoadImage = (node: any) => [node?.comfyClass, node?.type].includes('LoadImage');
/**
 * Dropping a Load Image node onto a Gallery Image Source node adds its image there. Dropping an image file on the
 * canvas makes a Load Image node, so this is also how outside images get in. The Load Image node is removed
 * afterwards unless something is connected to it.
 */
export function installLoadImageDrop() {
    if (loadImageDrop || STANDALONE || typeof document === 'undefined') return;
    loadImageDrop = true;
    let start = new Map<any, [number, number]>();
    document.addEventListener('pointerdown', () => { start = new Map((graphNow()?._nodes || []).filter(isLoadImage).map((node: any) => [node, [node.pos[0], node.pos[1]]])); }, true);
    document.addEventListener('pointerup', () => window.setTimeout(() => {
        const graph = graphNow();
        for (const [node, [x, y]] of start) {
            if (node.pos[0] === x && node.pos[1] === y || !graph?._nodes?.includes(node)) continue;
            const cx = node.pos[0] + node.size[0] / 2, cy = node.pos[1] + node.size[1] / 2;
            const title = (window as any).LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
            const target = nodes().find((source: any) => cx >= source.pos[0] && cx <= source.pos[0] + source.size[0] && cy >= source.pos[1] - title && cy <= source.pos[1] + source.size[1]);
            const name = node.widgets?.find((widget: any) => widget.name === 'image')?.value;
            if (!target || typeof name !== 'string' || !name) continue;
            const notify = (text: string) => target.__galleryNotify?.(text);
            notify('adding…');
            void sourceFromInput(name).then(image => addToNode(target, [{ ...image, title: name.split('/').pop() }])).then(() => {
                if (node.outputs?.some((output: any) => output.links?.length)) { node.pos = [x, y]; notify('added (Load Image kept: it is connected)'); }
                else { graph.beforeChange?.(); try { graph.remove(node); } finally { graph.afterChange?.(); } notify('added from Load Image'); }
                getComfyApp()?.canvas?.setDirty?.(true, true);
            }).catch(error => notify(String(error instanceof Error ? error.message : error)));
        }
        start = new Map();
    }, 0), true);
}

type TargetInfo = { options: { value: string; label: string }[]; selected?: string };
function targetInfo(): TargetInfo {
    const chosen = currentTarget();
    return { options: nodes().map((node: any) => ({ value: String(node.id), label: `${node.title || 'Gallery Image Source'} #${node.id} (${readSourceManifest(node).images.length})` })), selected: chosen ? String(chosen.id) : undefined };
}

function localCommand(command: string, payload: any): any {
    if (command === 'write_prompt') {
        const [id, index] = JSON.parse(payload.target);
        const node = (graphNow()?._nodes || []).find((node: any) => String(node.id) === id);
        const widget = node?.widgets?.[index];
        if (!widget || typeof widget.value !== 'string' || typeof payload.text !== 'string' || payload.text.length > 1000000 || !['before', 'after'].includes(payload.position)) throw new Error('Choose a valid prompt target and insertion.');
        const graph = graphNow(); graph.beforeChange?.();
        try {
            // The encoder shows boxes: an append becomes a new box, named after the prefix when one was used.
            if (node.__galleryPromptBoxes && widget.name === 'text') return node.__galleryPromptBoxes.insert(payload.text, payload.position, typeof payload.name === 'string' ? payload.name.slice(0, 80) : undefined);
            widget.value = mergePrompt(widget.value, payload.text, payload.position); if (widget.inputEl) widget.inputEl.value = widget.value; widget.callback?.(widget.value); node.setDirtyCanvas?.(true, true); return widget.value;
        }
        finally { graph.afterChange?.(); }
    }
    if (command === 'prompt_targets') return (graphNow()?._nodes || []).filter((node: any) => !isSource(node)).flatMap((node: any) => (node.widgets || []).flatMap((widget: any, index: number) => typeof widget.value === 'string' && widget.serialize !== false && /text|prompt|prefix|positive|negative/i.test(widget.name) ? [{ value: JSON.stringify([String(node.id), index]), label: `${node.title || node.type} #${node.id} · ${widget.name}` }] : []));
    if (command === 'targets') return targetInfo();
    if (command === 'target' && payload === 'new') { currentTarget(true, true); return targetInfo(); }
    if (command === 'target') { target = nodes().find((node: any) => String(node.id) === payload); if (!target) throw new Error('That target is no longer available.'); return targetInfo(); }
    if (command === 'edit') { const node = currentTarget(true); window.dispatchEvent(new CustomEvent(SOURCE_EDITOR_EVENT, { detail: node })); window.focus(); return true; }
    if (command !== 'append') throw new Error('Unknown image source action.');
    const apply: PromptApply | undefined = Array.isArray(payload) ? undefined : payload?.apply;
    payload = Array.isArray(payload) ? payload : payload?.images;
    if (!Array.isArray(payload) || !payload.length || payload.length > 32 || payload.some(image => typeof image?.input_name !== 'string' || !image.input_name || image.input_name.length > 2048)) throw new Error('Append between 1 and 32 input images.');
    if (JSON.stringify(payload).length > 1800000) throw new Error('Image metadata is too large for this workflow; use fewer images.');
    const updates = (['positive', 'negative'] as const).flatMap(side => {
        if (!apply?.[side]) return [];
        const [id, index] = JSON.parse(apply[side]!);
        const node = (graphNow()?._nodes || []).find((node: any) => String(node.id) === id);
        const widget = node?.widgets?.[index];
        if (!widget || typeof widget.value !== 'string') throw new Error('The selected prompt target is no longer available.');
        if (!['replace', 'before', 'after'].includes(apply.mode)) throw new Error('Invalid prompt operation');
        const text = payload.map((image: ImageSourceImage) => image.prompt?.[side] || '').filter(Boolean).join(', ');
        return [{ node, widget, text, mode: apply.mode, boxes: widget.name === 'text' ? node.__galleryPromptBoxes : undefined, value: mergePrompt(widget.value, text, apply.mode) }];
    });
    if (updates.length === 2 && updates[0].widget === updates[1].widget) throw new Error('Choose different positive and negative prompt targets.');
    const node = currentTarget(true);
    const manifest = readSourceManifest(node);
    if (manifest.images.length + payload.length > 32) throw new Error('This node can contain at most 32 images. Remove sources or choose another node.');
    const graph = graphNow();
    graph.beforeChange?.();
    try {
    saveSourceManifest(node, { ...manifest, images: [...manifest.images, ...payload.map(image => ({ input_name: image.input_name, title: String(image.title || image.input_name).slice(0, 512), metadata: image.metadata || {}, prompt: image.prompt }))] }, false);
    for (const update of updates) { if (update.boxes) { update.boxes.insert(update.text, update.mode, undefined); continue; } update.widget.value = update.value; update.widget.callback?.(update.value); update.node.setDirtyCanvas?.(true, true); }
    } finally { graph.afterChange?.(); }
    target = node;
    window.dispatchEvent(new CustomEvent(SOURCE_EDITOR_EVENT, { detail: node }));
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
export const getPromptTargets = () => command<{ value: string; label: string }[]>('prompt_targets');
/**
 * A source image that is paired with a prefix carries that prefix (`gallery_prefix`) into the workflow, so what
 * is generated from it counts toward the prefix's lineage even when it was not appended under the prefix —
 * and even when the encoder leaves some of its tags out. `urls` are the local files the images were copied from.
 */
async function withPairedPrefix(images: ImageSourceImage[], urls: (string | undefined)[] = []): Promise<ImageSourceImage[]> {
    images = images.map((image, index) => urls[index] ? { ...image, metadata: { ...image.metadata, gallery_url: urls[index] } } : image);
    let library: SharedLibrary;
    try { library = await loadPrefixes(); } catch { return images; }
    return images.map((image, index) => refreshSourcePrefix({ ...image, metadata: { ...image.metadata, ...(urls[index] ? { gallery_url: urls[index] } : {}) } }, library, urls[index]));
}
export const appendToImageSource = async (images: ImageSourceImage[], apply?: PromptApply, urls?: (string | undefined)[]) => {
    const stamped = await withPairedPrefix(images.map(image => stampOrigin(image)), urls);
    return command<string>('append', apply ? { images: stamped, apply } : stamped);
};

export async function appendLocalImages(urls: string[]) {
    if (!urls.length || urls.length > 32) throw new Error('Select between 1 and 32 images per append.');
    const entries: ImageSourceImage[] = [];
    for (const url of urls) {
        const response = await fetch('/Gallery/source/local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not copy the local image.');
        entries.push({ input_name: data.input_name, title: data.title, metadata: data.metadata || {} });
    }
    return appendToImageSource(entries, undefined, urls);
}

export function openGalleryTab() {
    const child = window.open('/Gallery/app', '_blank');
    if (!child) throw new Error('Allow popups for ComfyUI to open Gallery in a new tab.');
    children.add(child);
    for (const old of children) if (old.closed) children.delete(old);
}

export const writePromptTarget = (target: string, text: string, position: 'before' | 'after', name?: string) => command<string>('write_prompt', { target, text, position, name });
