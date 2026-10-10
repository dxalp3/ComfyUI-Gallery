import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { getComfyApp } from './ComfyAppApi';
import { removeSourceImage, type ImageSourceImage } from './ImageSourceGeometry';
import { filterSourceHistory, sourcePickerPlacement, type HistoryTab } from './SourceHistory';
import { addToNode, readSourceHistory, readSourceManifest, saveSourceManifest, SOURCE_PICKER_EVENT, uploadImages, type SourcePickerRequest } from './ImageSourceBridge';

export { openSourcePicker } from './ImageSourceBridge';

const styles = `
.cg-source-picker { --sp-bg:var(--comfy-menu-bg,#242424); --sp-field:var(--comfy-input-bg,#171717); --sp-text:var(--input-text,#ddd); --sp-border:var(--border-color,#555); --sp-accent:var(--p-primary-color,#70a9ff); position:fixed;z-index:3100;box-sizing:border-box;background:var(--sp-bg);color:var(--sp-text);border:1px solid var(--sp-border);border-radius:8px;box-shadow:0 8px 28px #0007;font:12px system-ui,sans-serif;display:flex;flex-direction:column;overflow:visible; }
.cg-source-picker * { box-sizing:border-box; }
.cg-source-picker button,.cg-source-picker input,.cg-source-picker select { font:inherit;color:inherit;border:1px solid var(--sp-border);background:var(--sp-field);border-radius:4px; }
.cg-source-picker button { cursor:pointer;padding:5px 8px; }
.cg-source-picker button:hover { background:var(--comfy-menu-secondary-bg,var(--sp-bg));border-color:var(--sp-accent); }
.cg-source-picker button:focus-visible,.cg-source-picker input:focus-visible,.cg-source-picker select:focus-visible { outline:2px solid var(--sp-accent);outline-offset:1px; }
.cg-source-picker button:disabled { opacity:.5;cursor:default; }
.cg-source-picker header { display:flex;align-items:center;gap:8px;padding:9px 10px 5px;flex:none; }
.cg-source-picker header strong { flex:1;font-size:12px; }
.cg-source-picker .sp-tabs { display:flex;gap:3px;padding:5px 10px;flex:none; }
.cg-source-picker .sp-tabs button { flex:1;border-color:transparent;background:transparent;white-space:nowrap;padding:6px 2px; }
.cg-source-picker .sp-tabs button[aria-selected=true] { background:var(--sp-field);border-color:var(--sp-border);box-shadow:inset 0 -2px var(--sp-accent); }
.cg-source-picker .sp-tools { display:flex;gap:5px;padding:4px 10px 9px;flex:none; }
.cg-source-picker .sp-tools input { min-width:0;flex:1;padding:6px 8px; }
.cg-source-picker .sp-scroll { overflow:auto;min-height:0;padding:2px 10px 10px;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--sp-border) var(--sp-field); }
.cg-source-picker .sp-grid { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px; }
.cg-source-picker .sp-tile { position:relative;min-width:0; }
.cg-source-picker .sp-image { display:block;width:100%;padding:0;overflow:hidden;position:relative;aspect-ratio:1;background:var(--sp-field); }
.cg-source-picker .sp-image img { display:block;width:100%;height:100%;object-fit:cover; }
.cg-source-picker .sp-image[aria-pressed=true] { outline:2px solid var(--sp-accent);outline-offset:2px; }
.cg-source-picker .sp-check { position:absolute;top:3px;left:3px;background:var(--sp-bg);border-radius:3px;padding:0 3px; }
.cg-source-picker .sp-remove { position:absolute;top:3px;right:3px;padding:0 4px;line-height:18px;opacity:.85; }
.cg-source-picker .sp-name { display:block;margin-top:4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11px; }
.cg-source-picker .sp-list { display:flex;flex-direction:column;gap:7px; }
.cg-source-picker .sp-list .sp-tile { display:flex;align-items:center;gap:8px; }
.cg-source-picker .sp-list .sp-image { flex:none;width:52px;height:52px; }
.cg-source-picker .sp-list .sp-name { flex:1;margin:0;padding-right:22px; }
.cg-source-picker footer { padding:8px 10px;border-top:1px solid var(--sp-border);display:flex;align-items:center;gap:8px;flex:none; }
.cg-source-picker footer span { flex:1;opacity:.65;font-size:11px; }
.cg-source-picker .sp-empty { padding:24px 10px;text-align:center;opacity:.7; }
.cg-source-picker .sp-error { padding:4px 10px 8px;color:#ff8a80; }
.cg-source-picker .sp-arrow { position:absolute;width:10px;height:10px;background:var(--sp-bg);transform:rotate(45deg);pointer-events:none; }
`;

/** A node-local popover. No gallery index, input-folder scan, or gallery theme is involved. */
export function SourcePicker() {
    const [request, setRequest] = useState<SourcePickerRequest>();
    const [placement, setPlacement] = useState<ReturnType<typeof sourcePickerPlacement>>();
    const [tab, setTab] = useState<HistoryTab>('all');
    const [query, setQuery] = useState('');
    const [newest, setNewest] = useState(true);
    const [grid, setGrid] = useState(true);
    const [error, setError] = useState('');
    const [batch, setBatch] = useState(false);
    const [selection, setSelection] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [revision, setRevision] = useState(0);
    const root = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), file = useRef<HTMLInputElement>(null);
    const current = useRef(request); current.current = request;
    const close = (focus = false) => {
        const previous = current.current;
        setRequest(undefined); current.current = undefined;
        if (focus) requestAnimationFrame(() => {
            if (previous?.trigger?.isConnected) previous.trigger.focus({ preventScroll: true });
            else previous?.node.__galleryFocusPreview?.();
        });
    };
    useEffect(() => {
        const open = (event: Event) => {
            const detail = (event as CustomEvent<SourcePickerRequest>).detail;
            if (!detail?.node || typeof detail.anchor !== 'function') return;
            if (current.current?.node === detail.node) { close(); return; }
            setBatch(!!detail.batch);
            const state = readSourceManifest(detail.node);
            setSelection((state.batch_indices || []).map(index => state.images[index]?.input_name).filter(Boolean));
            setPlacement(undefined); setError(''); setQuery(''); setTab('all'); setRequest(detail);
        };
        const changed = () => setRevision(value => value + 1);
        window.addEventListener(SOURCE_PICKER_EVENT, open);
        window.addEventListener('gallery-source-changed', changed);
        return () => { window.removeEventListener(SOURCE_PICKER_EVENT, open); window.removeEventListener('gallery-source-changed', changed); };
    }, []);
    useEffect(() => {
        if (!request) return;
        request.node.__galleryPickerOpen = true;
        request.trigger?.setAttribute('aria-expanded', 'true');
        request.node.__galleryRefreshPreview?.();
        let frame = 0, last = '';
        const update = () => {
            const app = getComfyApp(), graph = app?.canvas?.graph || app?.graph;
            const anchor = request.anchor();
            if (!anchor || graph && !graph._nodes?.includes(request.node) || anchor.bottom <= 0 || anchor.top >= innerHeight || anchor.right <= 0 || anchor.left >= innerWidth) { close(); return; }
            const next = sourcePickerPlacement(anchor, { width: innerWidth, height: innerHeight });
            const serialized = JSON.stringify(next);
            if (last !== serialized) { last = serialized; setPlacement(next); }
            frame = requestAnimationFrame(update);
        };
        update();
        const outside = (event: PointerEvent) => {
            if (root.current?.contains(event.target as Node) || request.trigger?.contains(event.target as Node)) return;
            const anchor = request.anchor();
            if (anchor && event.clientX >= anchor.left && event.clientX <= anchor.right && event.clientY >= anchor.top && event.clientY <= anchor.bottom) return;
            close();
        };
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } };
        document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true);
        return () => {
            cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true);
            request.node.__galleryPickerOpen = false; request.trigger?.setAttribute('aria-expanded', 'false'); request.node.__galleryRefreshPreview?.();
        };
    }, [request]);
    useEffect(() => { if (request && placement) search.current?.focus({ preventScroll: true }); }, [request, !!placement]);
    const manifest = useMemo(() => { try { return request ? readSourceManifest(request.node) : undefined; } catch { return undefined; } }, [request, revision]);
    const history = useMemo(() => { try { return request ? readSourceHistory(request.node) : []; } catch { return []; } }, [request, revision]);
    if (!request || !placement || !manifest) return null;
    const items = filterSourceHistory(history, tab, query, newest);
    const counts = { all: history.length, imported: filterSourceHistory(history, 'imported', '', false).length, generated: filterSourceHistory(history, 'generated', '', false).length };
    const node = request.node;
    const pick = (image: ImageSourceImage) => {
        setError('');
        if (batch) { setSelection(old => old.includes(image.input_name) ? old.filter(name => name !== image.input_name) : [...old, image.input_name]); return; }
        try {
            let state = readSourceManifest(node);
            let index = state.images.findIndex(item => item.input_name === image.input_name);
            if (index < 0) {
                if (state.images.length >= 32) throw new Error('This node already holds 32 images. Remove one before restoring another.');
                index = state.images.length;
                state = { ...state, images: [...state.images, image] };
            }
            saveSourceManifest(node, state.layout === 'single' ? { ...state, active_index: index } : state);
            if (state.layout !== 'single') node.__galleryFocusImage?.(index);
            if (current.current?.node === node) close(true);
        } catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); }
    };
    const applyBatch = () => {
        try {
            const state = readSourceManifest(node), images = [...state.images];
            for (const name of selection) if (!images.some(image => image.input_name === name)) { const image = history.find(image => image.input_name === name); if (image) images.push(image); }
            if (images.length > 32) throw new Error('A node can hold at most 32 images. Remove some images first.');
            const indices = selection.map(name => images.findIndex(image => image.input_name === name)).filter(index => index >= 0);
            if (!indices.length) throw new Error('Select at least one image.');
            saveSourceManifest(node, { ...state, images, batch_indices: indices }); close(true);
        } catch (reason) { setError(String(reason)); }
    };
    const upload = async (files: File[]) => {
        if (!files.length) return;
        setBusy(true); setError('');
        try { await addToNode(node, await uploadImages(files)); }
        catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); }
        finally { setBusy(false); }
    };
    const position: CSSProperties = { left: placement.left, top: placement.top, bottom: placement.bottom, width: placement.width, maxHeight: placement.maxHeight };
    return createPortal(<div ref={root} role="dialog" aria-modal="false" aria-label="This node's image history" className="cg-source-picker" data-placement={placement.side} style={position}
        onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <style>{styles}</style>
        <span className="sp-arrow" style={{ left: placement.arrow - 5, ...(placement.side === 'below' ? { top: -6, borderLeft: '1px solid var(--sp-border)', borderTop: '1px solid var(--sp-border)' } : { bottom: -6, borderRight: '1px solid var(--sp-border)', borderBottom: '1px solid var(--sp-border)' }) }} />
        <header><strong>Image history{node.id != null ? ` · #${node.id}` : ''}</strong><button aria-label="Close image picker" onClick={() => close(true)}>×</button></header>
        <div className="sp-tabs" role="tablist" aria-label="History source">
            {(['all', 'imported', 'generated'] as const).map(key => <button key={key} role="tab" aria-selected={key === tab} onClick={() => setTab(key)}>{key === 'all' ? 'In this node' : key === 'imported' ? 'Imported' : 'Generated'} <small>{counts[key]}</small></button>)}
        </div>
        <div className="sp-tools">
            <input ref={search} type="search" placeholder="Search this node…" aria-label="Search this node's history" value={query} onChange={event => setQuery(event.target.value)} />
            <button title={newest ? 'Newest first' : 'Oldest first'} aria-label={newest ? 'Newest first' : 'Oldest first'} onClick={() => setNewest(value => !value)}>{newest ? '↓' : '↑'}</button>
            <button title={grid ? 'Show list' : 'Show grid'} aria-label={grid ? 'Show list' : 'Show grid'} onClick={() => setGrid(value => !value)}>{grid ? '☰' : '▦'}</button>
        </div>
        <div className="sp-tools"><button aria-pressed={batch} onClick={() => setBatch(value => !value)}>{batch ? 'Cancel batch selection' : 'Select batch images'}</button>
            {batch && <><button onClick={() => setSelection(items.map(image => image.input_name))}>Select shown</button><button onClick={() => setSelection([])}>Clear</button></>}
        </div>
        {error && <div className="sp-error" role="alert">{error}</div>}
        <div className="sp-scroll">
            {!items.length ? <div className="sp-empty">{query ? 'No matching images in this node.' : history.length ? 'No images of this type in this node.' : 'Images added to this node will appear here.'}</div> :
                <div className={grid ? 'sp-grid' : 'sp-list'}>{items.map(image => {
                    const index = manifest.images.findIndex(item => item.input_name === image.input_name);
                    const selected = batch ? selection.includes(image.input_name) : index >= 0 && index === (manifest.layout === 'single' ? manifest.active_index || 0 : node.__galleryViewIndex || 0);
                    const name = image.title || image.input_name.split('/').pop()!;
                    return <div className="sp-tile" key={image.input_name}>
                        <button className="sp-image" disabled={busy} aria-label={(index < 0 ? 'Restore ' : 'Select ') + name} aria-pressed={selected}
                            title={(index < 0 ? 'Restore from history: ' : 'Select image: ') + image.input_name} onClick={() => void pick(image)}>
                            <img loading="lazy" src={'/Gallery/source/thumbnail?url=' + encodeURIComponent('/static_gallery/' + image.input_name)} alt="" />
                            {(index >= 0 || selected) && <span className="sp-check">{selected ? '✓' : '•'}</span>}
                        </button>
                        <span className="sp-name" title={name}>{name}</span>
                        {index >= 0 && <button className="sp-remove" disabled={busy} title="Remove from node (keep in history)" aria-label={'Remove ' + name + ' from node'} onClick={() => {
                            try { const state = readSourceManifest(node); const at = state.images.findIndex(item => item.input_name === image.input_name); saveSourceManifest(node, removeSourceImage(state, at)); }
                            catch (reason) { setError(String(reason)); }
                        }}>×</button>}
                    </div>;
                })}</div>}
        </div>
        <footer><span>{batch ? `${selection.length} selected for batch output` : `${manifest.images.length} in node · ${history.length} in history`}</span>{batch && <button disabled={busy || !selection.length} onClick={applyBatch}>Use batch</button>}<button disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Adding…' : 'Upload'}</button>
            <input ref={file} type="file" accept="image/*" multiple hidden onChange={event => { const files = [...(event.target.files || [])]; event.target.value = ''; void upload(files); }} />
        </footer>
    </div>, document.body);
}
