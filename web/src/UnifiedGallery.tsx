import { PreviewMedia, stopMedia } from './PreviewMedia';
import { openPrefixManager, imagePrefixKeys } from './PrefixLibrary';
import { extractLocalPrompts, extractHydrusTags } from './LocalImageSearch';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { AppendImagesModal } from './AppendImagesModal';
import { hydrusRequest } from './HydrusApi';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Collapse, Dropdown, Empty, Input, Modal, Select, Space, Slider, Tooltip, Tag, Typography, message } from 'antd';
import { AutoSizer } from 'react-virtualized';
import { FixedSizeGrid } from 'react-window';
import type { GridChildComponentProps } from 'react-window';
function GalleryCell(props: GridChildComponentProps) { return props.data.render(props); }
import { useGalleryContext } from './GalleryContext';
import { useHydrus } from './HydrusContext';
import { ComfyAppApi, BASE_PATH, BASE_Z_INDEX } from './ComfyAppApi';
import { appendLocalImages } from './ImageSourceBridge';
import { ModelViewer } from './ModelViewer';
import { use3DThumbnail } from './GlobalModelRenderer';
import { MetadataView } from './MetadataView';
import type { FileDetails } from './types';
import type { RemoteImage } from './HydrusBrowser';
import { galleryDate, orderGallery, type GalleryEntry, type GalleryOrder } from './GalleryOrder';

function ModelThumbnail({ file }: { file: FileDetails }) {
    const thumbnail = use3DThumbnail(BASE_PATH + file.url, file.name.split('.').pop()?.toLowerCase() || '');
    return thumbnail ? <img src={thumbnail} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <div style={{ padding: 40, color: 'white' }}>3D · Open viewer</div>;
}

export function UnifiedGallery({ sortRequest, source, remote, selectedRemote, setSelectedRemote, copy, download, working, scope, active, onTrashed }: {
    sortRequest?: { type: number; ascending: boolean; revision: number };
    onTrashed: (hashes: string[]) => void;
    source: string; remote: RemoteImage[]; selectedRemote: string[]; setSelectedRemote: React.Dispatch<React.SetStateAction<string[]>>;
    copy: (hashes: string[], append?: boolean) => Promise<void>; download: (hashes: string[]) => Promise<void>; working: boolean; scope: string; active: boolean;
}) {
    const gallery = useGalleryContext();
    const hydrus = useHydrus();
    const [appending, setAppending] = useState<GalleryEntry[]>([]);
    const [selectionMode, setSelectionMode] = useState(false);
    const [trashing, setTrashing] = useState<GalleryEntry[]>([]);
    const [deleting, setDeleting] = useState<GalleryEntry[]>([]);
    const lastClick = useRef<{ id: string; selected: boolean } | undefined>(undefined);
    const [tileSize, setTileSize] = useState(210);
    const [order, setOrder] = useState<GalleryOrder>('date');
    const [ascending, setAscending] = useState(false);
    const [seed, setSeed] = useState(() => Date.now());
    const [viewer, setViewer] = useState<string>();
    const [info, setInfo] = useState<GalleryEntry>();
    const [raw, setRaw] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [actionBusy, setActionBusy] = useState(false);
    const [mediaError, setMediaError] = useState(false);
    const [failedOriginal, setFailedOriginal] = useState<string>();
    const anchor = useRef<string | undefined>(undefined);
    const grid = useRef<FixedSizeGrid>(null);
    const viewerRef = useRef<HTMLDivElement>(null);
    const lastViewerIndex = useRef(0);
    const columns = useRef(1);
    const disabled = working || actionBusy;
    const entries = useMemo(() => {
        const local: GalleryEntry[] = source === 'hydrus' ? [] : gallery.imagesDetailsList.filter(file => !['divider', 'empty-space'].includes(file.type)).map(file => ({
            id: 'local:' + file.url, local: file, name: file.name, date: galleryDate(hydrus.items[file.url]?.metadata, file.timestamp), hash: hydrus.items[file.url]?.hash,
            mime: file.name.split('.').pop()?.toLowerCase().replace('jpeg', 'jpg'), source: 'local',
        }));
        const library: GalleryEntry[] = source === 'local' ? [] : remote.map(file => ({ id: 'hydrus:' + file.hash, remote: file, name: '#' + file.file_id,
            date: galleryDate(file),
            hash: file.hash, mime: file.mime?.split('/')[1]?.replace('jpeg', 'jpg'), source: 'hydrus' }));
        return orderGallery([...local, ...library], order, ascending, seed);
    }, [source, gallery.imagesDetailsList, hydrus.items, remote, order, ascending, seed]);
    useEffect(() => {
        if (!sortRequest) return;
        const order = ({ 2: 'date', 4: 'random', 3: 'mime', 20: 'hash' } as Record<number, GalleryOrder>)[sortRequest.type];
        if (order) { setOrder(order); setAscending(sortRequest.ascending); if (order === 'random') setSeed(value => value + 1); }
    }, [sortRequest]);
    const selected = new Set([...gallery.selectedImages.map(url => 'local:' + url), ...selectedRemote.map(hash => 'hydrus:' + hash)]);
    const selectionActive = selectionMode || selected.size > 0;
    const isVideo = (entry: GalleryEntry) => entry.local?.type === 'media' || entry.remote?.mime?.startsWith('video/');
    const isImage = (entry: GalleryEntry) => entry.local?.type === 'image' || entry.remote?.mime?.startsWith('image/');
    const shownSelected = entries.filter(entry => selected.has(entry.id));
    const index = entries.findIndex(entry => entry.id === viewer);
    const current = entries[index];
    const thumbnail = (entry: GalleryEntry) => entry.local ? `${BASE_PATH}/Gallery/thumbnail?url=${encodeURIComponent(entry.local.url)}&v=${entry.local.timestamp || 0}&root=${encodeURIComponent(gallery.settings.relativePath)}` : `${BASE_PATH}/Gallery/hydrus/thumbnail?hash=${entry.hash}&target=${encodeURIComponent(scope)}`;
    const original = (entry: GalleryEntry) => entry.local ? `${BASE_PATH}${entry.local.url}` : `${BASE_PATH}/Gallery/hydrus/original?hash=${entry.hash}&target=${encodeURIComponent(scope)}`;
    useEffect(() => { setZoom(1); setFailedOriginal(undefined); setMediaError(false); }, [viewer]);
    useEffect(() => {
        if (!active) { stopMedia(viewerRef.current); setViewer(undefined); }
        else if (viewer && index < 0) setViewer(entries[Math.min(lastViewerIndex.current, entries.length - 1)]?.id);
        else if (index >= 0) lastViewerIndex.current = index;
    }, [active, index, viewer, entries]);
    useEffect(() => { setViewer(undefined); setTrashing([]); }, [scope]);
    const setSelection = (ids: Set<string>) => {
        gallery.setSelectedImages([...ids].filter(id => id.startsWith('local:')).map(id => id.slice(6)));
        setSelectedRemote([...ids].filter(id => id.startsWith('hydrus:')).map(id => id.slice(7)));
    };
    const toggle = (entry: GalleryEntry, range = false) => {
        if (disabled) return;
        const next = new Set(selected);
        const start = entries.findIndex(item => item.id === anchor.current);
        const end = entries.findIndex(item => item.id === entry.id);
        if (range && start >= 0 && end >= 0) entries.slice(Math.min(start, end), Math.max(start, end) + 1).forEach(item => next.add(item.id));
        else { if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); anchor.current = entry.id; }
        setSelection(next);
    };
    const run = async (action: () => Promise<unknown>) => {
        if (disabled) return;
        setActionBusy(true);
        try { await action(); } catch (error) { message.error(String(error)); } finally { setActionBusy(false); }
    };
    const targets = (entry?: GalleryEntry) => entry && !selected.has(entry.id) ? [entry] : shownSelected;
    const act = async (key: string, entry?: GalleryEntry) => {
        const list = targets(entry);
        const local = list.flatMap(item => item.local?.type === 'image' ? [item.local.url] : []);
        const hashes = list.flatMap(item => item.remote && (key === 'download' || isImage(item)) ? [item.remote.hash] : []);
        if (key === 'prefix') {
            const sets = list.map(item => {
                const metadata = item.local ? { ...item.local.metadata, hydrus: hydrus.items[item.local.url]?.metadata || (item.local.metadata as any)?.hydrus } : { hydrus: item.remote };
                const prompts = extractLocalPrompts(metadata);
                return { positive: prompts.positive.split(/[,\n]+/).map(value => value.trim()).filter(Boolean), negative: prompts.negative.split(/[,\n]+/).map(value => value.trim()).filter(Boolean), hydrus: extractHydrusTags(metadata) };
            });
            openPrefixManager({ imageKeys: list.flatMap(item => imagePrefixKeys(item, gallery.settings.relativePath)), positive: sets.flatMap(item => item.positive), negative: sets.flatMap(item => item.negative), hydrus: sets.flatMap(item => item.hydrus) }); return;
        }
        if (key === 'source') { setAppending(list.filter(isImage)); return; }
        if (key === 'trash') { setTrashing(list.filter(item => item.remote)); return; }
        if (key === 'delete') { setDeleting(list.filter(item => item.local)); return; }
        if (key === 'select' && entry) return toggle(entry);
        if (key === 'info' && entry) { setInfo(entry); return; }
        if (key === 'metadata' && entry?.local) { hydrus.setDetailsUrl(entry.local.url); return; }
        if (key === 'export') { hydrus.requestExport(local); return; }
        await run(async () => {
            if (key === 'source') {
                if (local.length + hashes.length > 32) throw new Error('Select at most 32 images to append.');
                if (local.length) message.success(await appendLocalImages(local));
                if (hashes.length) await copy(hashes, true);
            }
            if (key === 'copy' && hashes.length) await copy(hashes);
            if (key === 'refresh' && local.length) {
                const results = await hydrus.refresh(local);
                const failed = results.find(item => item.error);
                if (failed) throw new Error(failed.error || 'Refresh failed');
            }
            if (key === 'download') {
                const locals = list.filter(item => item.local);
                if (locals.length) {
                    const zip = new JSZip(); let bytes = 0;
                    for (const item of locals) {
                        const response = await fetch(original(item));
                        if (!response.ok) throw new Error('Could not download ' + item.name);
                        const blob = await response.blob(); bytes += blob.size;
                        if (bytes > 128 * 1024 * 1024) throw new Error('Select fewer local files: metadata ZIPs are limited to 128 MiB.');
                        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(byte => byte.toString(16).padStart(2, '0')).join('');
                        const name = digest.slice(0, 12) + '-' + item.name;
                        zip.file(name, blob);
                        zip.file(name + '.gallery.json', JSON.stringify({ version: 1, sha256: digest, metadata: { ...item.local?.metadata, hydrus: hydrus.items[item.local!.url]?.metadata } }, null, 2));
                    }
                    FileSaver.saveAs(await zip.generateAsync({ type: 'blob' }), 'gallery-with-metadata.zip');
                }
                if (hashes.length) await download(hashes);
            }
        });
    };
    const menu = (entry: GalleryEntry) => ({ items: [
        { key: 'select', label: selected.has(entry.id) ? 'Deselect image' : 'Select image' },
        { key: 'source', disabled: !targets(entry).some(isImage), label: `Append to Image Source (${targets(entry).filter(item => isImage(item)).length})` },
        { key: 'prefix', label: 'Create prefix from selection' },
        { key: 'download', label: 'Download original(s)' },
        ...(entry.local ? [{ key: 'export', label: 'Export local selection to Hydrus' }, { key: 'refresh', label: 'Refresh Hydrus status' }, { key: 'metadata', label: 'Hydrus metadata' }] : [{ key: 'copy', disabled: !targets(entry).some(item => item.remote && isImage(item)), label: 'Save copy to input only (no workflow append)' }]),
        { key: 'info', label: 'View metadata' },
        ...(targets(entry).some(item => item.remote) ? [{ key: 'trash', danger: true, label: `Delete from Hydrus — send to trash (${targets(entry).filter(item => item.remote).length})` }] : []),
        ...(targets(entry).some(item => item.local) ? [{ key: 'delete', danger: true, label: `Delete local file(s) (${targets(entry).filter(item => item.local).length})` }] : []),
    ], onClick: ({ key }: { key: string }) => { void act(key, entry); } });
    const move = (step: number) => { const next = entries[index + step]; if (next) { stopMedia(viewerRef.current); setViewer(next.id); } };
    const advanceAfterRemoval = (removed: Set<string>) => {
        if (!viewer || !removed.has(viewer)) return;
        stopMedia(viewerRef.current);
        const next = entries.slice(index + 1).find(entry => !removed.has(entry.id)) || entries.slice(0, index).reverse().find(entry => !removed.has(entry.id));
        setViewer(next?.id);
    };
    useEffect(() => { if (viewer && index >= 0) grid.current?.scrollToItem({ rowIndex: Math.floor(index / columns.current), columnIndex: index % columns.current }); }, [viewer, index]);
    const closeViewer = () => {
        stopMedia(viewerRef.current);
        setViewer(undefined);
        if (index >= 0) grid.current?.scrollToItem({ rowIndex: Math.floor(index / columns.current), columnIndex: index % columns.current });
    };
    const renderCard = (rowIndex: number, columnIndex: number, count: number, style: React.CSSProperties) => {
                        const entry = entries[rowIndex * count + columnIndex]; if (!entry) return null;
                        return <div style={{ ...style, padding: 6, boxSizing: 'border-box' }}><Dropdown trigger={['contextMenu']} disabled={disabled} menu={menu(entry)}>
                            <div data-gallery-entry={entry.id} tabIndex={0} role="group" aria-label={entry.name} style={{ height: '100%', border: selected.has(entry.id) ? '2px solid #1677ff' : '2px solid #8884', borderRadius: 8, overflow: 'hidden', boxSizing: 'border-box' }}
                                onKeyDown={event => { if ((event.target as HTMLElement).closest('input,button,[role="menu"]')) return;
                                    if (event.key.startsWith('Arrow')) {
                                        event.preventDefault(); const position = entries.findIndex(item => item.id === entry.id);
                                        const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -count : count;
                                        const nextIndex = Math.max(0, Math.min(entries.length - 1, position + step)); const next = entries[nextIndex];
                                        if (event.shiftKey) { if (!anchor.current) anchor.current = entry.id; toggle(next, true); }
                                        grid.current?.scrollToItem({ rowIndex: Math.floor(nextIndex / count), columnIndex: nextIndex % count });
                                        requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-gallery-entry="' + CSS.escape(next.id) + '"]')?.focus());
                                    } if (event.key === 'Enter') { event.preventDefault(); setViewer(entry.id); } if (event.key === ' ') { event.preventDefault(); toggle(entry, event.shiftKey); } }}>
                                <div draggable={!!entry.local && !selectionActive} onDragStart={event => { if (entry.local) { event.dataTransfer.setData('text/uri-list', original(entry)); event.dataTransfer.setData('custom', JSON.stringify({ name: entry.name, folder: gallery.currentFolder, type: entry.local.type, url: entry.local.url })); } }} style={{ height: 'calc(100% - 54px)', background: '#17191d', cursor: 'pointer' }} onClick={event => {
                                    if (event.detail > 1) return;
                                    lastClick.current = undefined;
                                    if (selectionActive) {
                                        lastClick.current = { id: entry.id, selected: selected.has(entry.id) };
                                        toggle(entry, event.shiftKey);
                                    } else if (event.shiftKey || event.ctrlKey || event.metaKey) toggle(entry, event.shiftKey);
                                    else setViewer(entry.id);
                                }} onDoubleClick={() => {
                                    const previous = lastClick.current;
                                    if (previous?.id === entry.id) { const next = new Set(selected); if (previous.selected) next.add(entry.id); else next.delete(entry.id); setSelection(next); }
                                    setViewer(entry.id);
                                }}>
                                    {entry.remote && isVideo(entry) ? <><img src={thumbnail(entry)} alt={entry.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /><span style={{ position: 'absolute', top: 14, right: 14, background: '#111d', color: '#fff', padding: '3px 7px', borderRadius: 5 }}>▶ VIDEO</span></> : entry.local?.type === '3d' ? <ModelThumbnail file={entry.local} /> : entry.local?.type === 'media' ? <video muted loop={gallery.settings.autoPlayVideos} autoPlay={gallery.settings.autoPlayVideos} preload="metadata" src={original(entry)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : entry.local?.type === 'audio' ? <div style={{ padding: 40, color: 'white' }}>AUDIO · Open viewer</div> : <img src={thumbnail(entry)} alt={entry.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
                                </div>
                                <div style={{ padding: 6 }}><Checkbox className="cg-file-checkbox" aria-label={'Select ' + entry.name} checked={selected.has(entry.id)} disabled={disabled} onClick={event => toggle(entry, event.shiftKey)} /> <Tag color={entry.remote ? 'blue' : undefined}>{entry.source === 'local' ? 'Local' : 'Hydrus'}</Tag><Typography.Text ellipsis title={entry.name} style={{ maxWidth: '90%' }}>{entry.name}</Typography.Text></div>
                            </div>
                        </Dropdown></div>;
                    };
    const shortcuts = (event: React.KeyboardEvent) => {
        if (disabled || !active || (event.target as HTMLElement).closest('input,textarea,select,button,[contenteditable="true"],[role="combobox"],[role="menu"]')) return;
        const key = event.key.toLowerCase();
        if ((event.ctrlKey || event.metaKey) && key === 'a') { event.preventDefault(); event.stopPropagation(); setSelection(new Set([...selected, ...entries.map(item => item.id)])); return; }
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const focused = current || entries.find(item => item.id === (event.target as HTMLElement).closest<HTMLElement>('[data-gallery-entry]')?.dataset.galleryEntry);
        if (focused && (key === 'd' || key === 'i')) { event.preventDefault(); event.stopPropagation(); void act(key === 'd' ? 'download' : 'source', focused); }
    };
    return <div className="cg-grid-layout" onKeyDown={shortcuts}>
        <AppendImagesModal entries={appending} onClose={() => setAppending([])} />
        <div className="cg-selection-float"><Button aria-pressed={selectionActive} type={selectionActive ? 'primary' : 'default'} onClick={() => { if (selectionActive) { setSelectionMode(false); setSelection(new Set()); } else setSelectionMode(true); }}>{selectionActive ? 'Selection mode ON' : 'Selection mode'}</Button>{selectionActive && <span>Click selects · Double-click opens</span>}</div>
        <div className="cg-grid-toolbar">
            <span className="cg-grid-summary">{entries.length.toLocaleString()} files{selected.size ? ' · ' + selected.size + ' selected' : ''}</span>
            <Select aria-label="Gallery order" value={order} onChange={setOrder} style={{ width: 155 }} options={[
                { value: 'date', label: 'Import / file date' }, { value: 'name', label: 'Name' }, { value: 'mime', label: 'Filetype' }, { value: 'hash', label: 'SHA-256 hash' }, { value: 'random', label: 'Random' }, { value: 'result', label: 'Search order' }
            ]} />
            <Select aria-label="Gallery sort direction" value={ascending ? 'asc' : 'desc'} onChange={value => setAscending(value === 'asc')} style={{ width: 120 }} disabled={order === 'random' || order === 'result'} options={[{ value: 'desc', label: 'Descending' }, { value: 'asc', label: 'Ascending' }]} />
            {order === 'random' && <Button onClick={() => setSeed(value => value + 1)}>Reshuffle</Button>}
            <Tooltip title="Thumbnail size"><Slider aria-label="Thumbnail size" min={140} max={340} step={20} value={tileSize} onChange={setTileSize} style={{ width: 90, margin: '0 12px' }} /></Tooltip>
            <Button disabled={disabled || !entries.length} onClick={() => setSelection(new Set([...selected, ...entries.map(item => item.id)]))}>Select all shown ({entries.length})</Button>
            <Tooltip title="Selection mode: click selects, double-click opens. Space selects; Enter opens. Ctrl/Cmd+click toggles selection; Shift+click selects a range. Right-click for actions. Gallery order sorts loaded files; missing hashes sort last. Dates use Hydrus import time for remote files and cached matching copies; otherwise local file time."><Button aria-label="Gallery help">?</Button></Tooltip>
        </div>
        {selected.size > 0 && <div className="cg-selection">
            <strong>{selected.size} selected</strong><span>{selected.size - shownSelected.length ? (selected.size - shownSelected.length) + ' outside this view' : ''}</span>
            <Button disabled={disabled || !shownSelected.some(isImage)} onClick={() => void act('source')}>Append to Image Source ({shownSelected.filter(isImage).length})</Button>
            <Button disabled={disabled || !shownSelected.length} onClick={() => void act('download')}>Download selected</Button>
            <Button disabled={disabled || !shownSelected.length} onClick={() => void act('prefix')}>Create prefix from selection</Button>
            <Button disabled={disabled || !shownSelected.some(item => item.local?.type === 'image')} onClick={() => void act('export')}>Export local selection to Hydrus</Button>
            <Button disabled={disabled || !shownSelected.length} onClick={() => { const next = new Set(selected); entries.forEach(item => next.has(item.id) ? next.delete(item.id) : next.add(item.id)); setSelection(next); }}>Invert shown selection</Button>
            <Button danger disabled={disabled || !shownSelected.some(item => item.local)} onClick={() => void act('delete')}>Delete local selected</Button>
            <div className="cg-spacer" /><Button disabled={disabled} onClick={() => setSelection(new Set())}>Clear selection</Button>
        </div>}
        <div style={{ flex: 1, minHeight: 120, position: 'relative' }} aria-label="Unified gallery">
            {!entries.length ? <Empty description="No files loaded. Choose a local folder or search Hydrus." /> : <AutoSizer>{({ width, height }) => {
                const count = Math.max(1, Math.floor(width / tileSize)); columns.current = count;
                return <FixedSizeGrid ref={grid} width={width} height={height} columnCount={count} columnWidth={width / count} rowCount={Math.ceil(entries.length / count)} rowHeight={Math.round(width / count * .7) + 58}
                    itemData={{ render: ({ rowIndex, columnIndex, style }: GridChildComponentProps) => {
                        return renderCard(rowIndex, columnIndex, count, style);
                    } }}
                    itemKey={({ rowIndex, columnIndex }) => entries[rowIndex * count + columnIndex]?.id || `empty-${rowIndex}-${columnIndex}`}>
                    {GalleryCell}
                </FixedSizeGrid>;
            }}</AutoSizer>}
        </div>
        <Modal destroyOnHidden className="cg-viewer" title={current ? `Gallery viewer · ${index + 1} / ${entries.length} · ${current.name}` : 'Gallery viewer'} open={!!current && active} onCancel={closeViewer} width="96vw" zIndex={BASE_Z_INDEX + 10} footer={null}
            afterOpenChange={opened => { if (opened) viewerRef.current?.focus(); }}>
            {current && active && <div ref={viewerRef} tabIndex={-1} onKeyDown={event => {
                if ((event.target as HTMLElement).closest('input,textarea,select,button,[role="menu"],[role="combobox"]') || info) return;
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowLeft' ? -1 : 1); }
                if (event.key === ' ') { event.preventDefault(); toggle(current, event.shiftKey); }
            }}>
                <Space wrap style={{ marginBottom: 12 }}>
                    <Button disabled={index === 0} onClick={() => move(-1)}>Previous image</Button><Button disabled={index === entries.length - 1} onClick={() => move(1)}>Next image</Button>
                    <Checkbox className="cg-file-checkbox" checked={selected.has(current.id)} disabled={disabled} onClick={event => toggle(current, event.shiftKey)}>Selected</Checkbox>
                    <Button onClick={() => setZoom(value => Math.max(.25, value / 1.5))}>Zoom out</Button><Button onClick={() => setZoom(value => Math.min(8, value * 1.5))}>Zoom in</Button><Button onClick={() => setZoom(1)}>Fit</Button>
                    <Button onClick={() => setInfo(current)}>Metadata</Button><Button onClick={closeViewer}>Show in grid</Button><Button danger disabled={disabled} onClick={() => void act(current.local ? 'delete' : 'trash', current)}>Delete</Button><Button disabled={disabled || !targets(current).some(isImage)} onClick={() => void act('source', current)}>Append for img2img</Button>
                    <span>{Math.round(zoom * 100)}% · Arrow keys browse · Space selects · Right-click for actions</span>
                </Space>
                <Dropdown trigger={['contextMenu']} disabled={disabled} menu={menu(current)}>
                    <div style={{ height: '62vh', overflow: 'auto', background: '#111', textAlign: 'center' }}>
                        {current.local?.type === '3d' ? <ModelViewer url={original(current)} type={current.name.split('.').pop() || ''} /> : isVideo(current) ? <PreviewMedia onError={() => setMediaError(true)} key={current.id} controls autoPlay={gallery.settings.autoPlayVideos} src={original(current)} style={{ maxWidth: '100%', height: '100%' }} /> : current.local?.type === 'audio' ? <PreviewMedia audio key={current.id} controls src={original(current)} /> :
                        <img onClick={event => { if (event.detail === 1) toggle(current); }} key={current.id} src={failedOriginal === current.id ? thumbnail(current) : original(current)} alt={'Viewing ' + current.name} onError={() => setFailedOriginal(current.id)} style={{ height: zoom === 1 ? '100%' : `${zoom * 100}%`, maxWidth: zoom === 1 ? '100%' : 'none', objectFit: 'contain' }} />}
                    </div>
                </Dropdown>
                {mediaError && <Typography.Text type="warning">This browser cannot play this video or its codec. Download the original from the context menu to play it externally.</Typography.Text>}
                {failedOriginal === current.id && <Typography.Text type="warning">Original could not be displayed; showing thumbnail. Download original is available in the context menu.</Typography.Text>}
                <div aria-label="Viewer filmstrip" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 10 }}>
                    {entries.slice(Math.max(0, index - 8), index + 9).map(entry => <Button key={entry.id} title={entry.name} aria-label={'View ' + entry.name} type={entry.id === viewer ? 'primary' : 'default'} onClick={event => { if (event.detail > 1) return; lastClick.current = undefined; if (selectionActive) { lastClick.current = { id: entry.id, selected: selected.has(entry.id) }; toggle(entry, event.shiftKey); } else setViewer(entry.id); }} onDoubleClick={() => { const previous = lastClick.current; if (previous?.id === entry.id) { const next = new Set(selected); if (previous.selected) next.add(entry.id); else next.delete(entry.id); setSelection(next); } setViewer(entry.id); }} style={{ height: 65, minWidth: 80, borderColor: selected.has(entry.id) ? '#52c41a' : undefined }}>
                        {entry.local && entry.local.type !== 'image' ? entry.local.type : <img alt="" src={thumbnail(entry)} style={{ width: 60, height: 48, objectFit: 'contain' }} />}{selected.has(entry.id) ? '✓' : ''}
                    </Button>)}
                </div>
            </div>}
        </Modal>
        <Modal title={`Send ${trashing.length} Hydrus file(s) to trash?`} open={!!trashing.length} onCancel={() => setTrashing([])} zIndex={BASE_Z_INDEX + 80} okText="Send to Hydrus trash" okButtonProps={{ danger: true }} confirmLoading={actionBusy} onOk={() => run(async () => {
            const result = await hydrusRequest<{ trashed: string[] }>('trash', { hashes: trashing.map(entry => entry.hash), target: scope });
            advanceAfterRemoval(new Set(result.trashed.map(hash => 'hydrus:' + hash)));
            onTrashed(result.trashed); setSelectedRemote(old => old.filter(hash => !result.trashed.includes(hash))); setTrashing([]);
            message.success(`Sent ${result.trashed.length} file(s) to Hydrus trash`);
        })}><p>This removes the selected Hydrus files from its local file services and sends them to Hydrus trash. Your separate local gallery copies stay intact. Hydrus controls trash retention.</p></Modal>
        <Modal title={`Delete ${deleting.length} local file(s)?`} open={!!deleting.length} onCancel={() => setDeleting([])} zIndex={BASE_Z_INDEX + 80} okText="Delete permanently" okButtonProps={{ danger: true }} confirmLoading={actionBusy} onOk={() => run(async () => {
            const removed = new Set<string>();
            for (const entry of deleting) if (entry.local && await ComfyAppApi.deleteImage(entry.local.url, gallery.settings.relativePath)) removed.add(entry.local.url);
            advanceAfterRemoval(new Set([...removed].map(url => 'local:' + url)));
            gallery.setSelectedImages(old => old.filter(url => !removed.has(url)));
            gallery.mutate(old => old ? { folders: Object.fromEntries(Object.entries(old.folders).map(([folder, files]) => [folder, Object.fromEntries(Object.entries(files).filter(([, file]) => !removed.has(file.url)))])) } : old);
            if (removed.size !== deleting.length) message.error(`${deleting.length - removed.size} file(s) could not be deleted. Reload and try again.`);
            else message.success(`Deleted ${removed.size} local file(s)`);
            setDeleting([]);
        })}><p>This permanently deletes these local originals. Files on the Hydrus server are untouched.</p><ul style={{ maxHeight: 240, overflow: 'auto' }}>{deleting.map(entry => <li key={entry.id}>{entry.local?.url}</li>)}</ul></Modal>
        <Modal destroyOnHidden title="Image metadata" open={!!info} onCancel={() => setInfo(undefined)} footer={null} width="85vw" zIndex={BASE_Z_INDEX + 60}>
            {info?.local ? <MetadataView image={info.local} onShowRaw={() => setRaw(true)} showRawMetadata={raw} setShowRawMetadata={setRaw} /> : <pre style={{ maxHeight: '70vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(info?.remote, null, 2)}</pre>}
        </Modal>
    </div>;
}
