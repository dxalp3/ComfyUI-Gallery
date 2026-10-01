import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Collapse, Dropdown, Empty, Input, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { AutoSizer } from 'react-virtualized';
import { FixedSizeGrid } from 'react-window';
import type { GridChildComponentProps } from 'react-window';
function GalleryCell(props: GridChildComponentProps) { return props.data.render(props); }
import { useGalleryContext } from './GalleryContext';
import { useHydrus } from './HydrusContext';
import { hydrusStatus } from './HydrusApi';
import { BASE_PATH, BASE_Z_INDEX } from './ComfyAppApi';
import { appendLocalImages } from './ImageSourceBridge';
import { ModelViewer } from './ModelViewer';
import { use3DThumbnail } from './GlobalModelRenderer';
import { MetadataView } from './MetadataView';
import type { FileDetails } from './types';
import type { RemoteImage } from './HydrusBrowser';
import { orderGallery, type GalleryEntry, type GalleryOrder } from './GalleryOrder';

function ModelThumbnail({ file }: { file: FileDetails }) {
    const thumbnail = use3DThumbnail(BASE_PATH + file.url, file.name.split('.').pop()?.toLowerCase() || '');
    return thumbnail ? <img src={thumbnail} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <div style={{ padding: 40, color: 'white' }}>3D · Open viewer</div>;
}

export function UnifiedGallery({ source, remote, selectedRemote, setSelectedRemote, copy, download, working, scope, active }: {
    source: string; remote: RemoteImage[]; selectedRemote: string[]; setSelectedRemote: React.Dispatch<React.SetStateAction<string[]>>;
    copy: (hashes: string[], append?: boolean) => Promise<void>; download: (hashes: string[]) => Promise<void>; working: boolean; scope: string; active: boolean;
}) {
    const gallery = useGalleryContext();
    const hydrus = useHydrus();
    const [order, setOrder] = useState<GalleryOrder>('date');
    const [ascending, setAscending] = useState(false);
    const [seed, setSeed] = useState(1);
    const [viewer, setViewer] = useState<string>();
    const [info, setInfo] = useState<GalleryEntry>();
    const [raw, setRaw] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [actionBusy, setActionBusy] = useState(false);
    const [failedOriginal, setFailedOriginal] = useState<string>();
    const anchor = useRef<string | undefined>(undefined);
    const grid = useRef<FixedSizeGrid>(null);
    const viewerRef = useRef<HTMLDivElement>(null);
    const columns = useRef(1);
    const disabled = working || actionBusy;
    const entries = useMemo(() => {
        const local: GalleryEntry[] = source === 'hydrus' ? [] : gallery.imagesDetailsList.filter(file => !['divider', 'empty-space'].includes(file.type)).map(file => ({
            id: 'local:' + file.url, local: file, name: file.name, date: file.timestamp, hash: hydrus.items[file.url]?.hash,
            mime: file.name.split('.').pop()?.toLowerCase().replace('jpeg', 'jpg'), source: 'local',
        }));
        const library: GalleryEntry[] = source === 'local' ? [] : remote.map(file => ({ id: 'hydrus:' + file.hash, remote: file, name: '#' + file.file_id,
            date: file.time_imported ?? Math.max(0, ...Object.values(file.file_services?.current || {}).map((service: any) => Number(service.time_imported || 0))),
            hash: file.hash, mime: file.mime?.split('/')[1]?.replace('jpeg', 'jpg'), source: 'hydrus' }));
        return orderGallery([...local, ...library], order, ascending, seed);
    }, [source, gallery.imagesDetailsList, hydrus.items, remote, order, ascending, seed]);
    useEffect(() => { setOrder(source === 'hydrus' ? 'result' : 'date'); }, [source]);
    const selected = new Set([...gallery.selectedImages.map(url => 'local:' + url), ...selectedRemote.map(hash => 'hydrus:' + hash)]);
    const shownSelected = entries.filter(entry => selected.has(entry.id));
    const index = entries.findIndex(entry => entry.id === viewer);
    const current = entries[index];
    const thumbnail = (entry: GalleryEntry) => entry.local ? `${BASE_PATH}/Gallery/thumbnail?url=${encodeURIComponent(entry.local.url)}&v=${entry.local.timestamp || 0}&root=${encodeURIComponent(gallery.settings.relativePath)}` : `${BASE_PATH}/Gallery/hydrus/thumbnail?hash=${entry.hash}&target=${encodeURIComponent(scope)}`;
    const original = (entry: GalleryEntry) => entry.local ? `${BASE_PATH}${entry.local.url}` : `${BASE_PATH}/Gallery/hydrus/original?hash=${entry.hash}&target=${encodeURIComponent(scope)}`;
    useEffect(() => { setZoom(1); setFailedOriginal(undefined); }, [viewer]);
    useEffect(() => { if (!active || (viewer && index < 0)) setViewer(undefined); }, [active, index, viewer]);
    useEffect(() => { setViewer(undefined); }, [scope]);
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
        const hashes = list.flatMap(item => item.remote ? [item.remote.hash] : []);
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
                for (const item of list.filter(item => item.local)) {
                    const link = document.createElement('a'); link.href = original(item); link.download = item.name; link.click();
                }
                if (hashes.length) await download(hashes);
            }
        });
    };
    const menu = (entry: GalleryEntry) => ({ items: [
        { key: 'select', label: selected.has(entry.id) ? 'Deselect image' : 'Select image' },
        { key: 'source', label: `Append to Image Source (${targets(entry).filter(item => item.remote || item.local?.type === 'image').length})` },
        { key: 'download', label: 'Download original(s)' },
        ...(entry.local ? [{ key: 'export', label: 'Export local selection to Hydrus' }, { key: 'refresh', label: 'Refresh Hydrus status' }, { key: 'metadata', label: 'Hydrus metadata' }] : [{ key: 'copy', label: 'Copy Hydrus selection to input' }]),
        { key: 'info', label: 'View metadata' },
    ], onClick: ({ key }: { key: string }) => { void act(key, entry); } });
    const move = (step: number) => { const next = entries[index + step]; if (next) setViewer(next.id); };
    const closeViewer = () => {
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
                                <div draggable={!!entry.local} onDragStart={event => { if (entry.local) { event.dataTransfer.setData('text/uri-list', original(entry)); event.dataTransfer.setData('custom', JSON.stringify({ name: entry.name, folder: gallery.currentFolder, type: entry.local.type, url: entry.local.url })); } }} style={{ height: 150, background: '#17191d', cursor: 'pointer' }} onClick={event => event.shiftKey || event.ctrlKey || event.metaKey ? toggle(entry, event.shiftKey) : setViewer(entry.id)}>
                                    {entry.local?.type === '3d' ? <ModelThumbnail file={entry.local} /> : entry.local?.type === 'media' ? <video muted loop={gallery.settings.autoPlayVideos} autoPlay={gallery.settings.autoPlayVideos} preload="metadata" src={original(entry)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : entry.local?.type === 'audio' ? <div style={{ padding: 40, color: 'white' }}>AUDIO · Open viewer</div> : <img src={thumbnail(entry)} alt={entry.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
                                </div>
                                <div style={{ padding: 6 }}><Checkbox aria-label={'Select ' + entry.name} checked={selected.has(entry.id)} disabled={disabled} onClick={event => toggle(entry, event.shiftKey)} /> <Tag>{entry.source === 'local' ? 'Local' : 'Hydrus'}</Tag>{entry.local?.type === 'image' && <Tag color={hydrusStatus(hydrus.items[entry.local.url]).color} style={{ cursor: 'pointer' }} onClick={() => hydrus.setDetailsUrl(entry.local!.url)}>{hydrusStatus(hydrus.items[entry.local.url]).label}</Tag>}<Typography.Text ellipsis title={entry.name} style={{ maxWidth: '90%' }}>{entry.name}</Typography.Text></div>
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
    return <div onKeyDown={shortcuts}>
        <Space wrap style={{ marginBottom: 12 }}>
            <Select aria-label="Gallery order" value={order} onChange={setOrder} style={{ width: 180 }} options={[
                { value: 'date', label: 'Date' }, { value: 'name', label: 'Name' }, { value: 'mime', label: 'Filetype' }, { value: 'hash', label: 'SHA-256 hash' }, { value: 'random', label: 'Random' }, { value: 'result', label: 'Search / folder order' }
            ]} />
            <Select aria-label="Gallery sort direction" value={ascending ? 'asc' : 'desc'} onChange={value => setAscending(value === 'asc')} disabled={order === 'random' || order === 'result'} options={[{ value: 'desc', label: 'Descending' }, { value: 'asc', label: 'Ascending' }]} />
            {order === 'random' && <Button onClick={() => setSeed(value => value + 1)}>Reshuffle</Button>}
            <Button disabled={disabled || !entries.length} onClick={() => setSelection(new Set([...selected, ...entries.map(item => item.id)]))}>Select all shown ({entries.length})</Button>
            <Button disabled={disabled || !selected.size} onClick={() => setSelection(new Set())}>Clear selection</Button>
            <Button disabled={disabled || !shownSelected.length} onClick={() => void act('source')}>Append to Image Source ({shownSelected.length})</Button>
            <Button disabled={disabled || !shownSelected.length} onClick={() => void act('download')}>Download selected</Button>
            <Button disabled={disabled || !shownSelected.some(item => item.local?.type === 'image')} onClick={() => void act('export')}>Export local selection to Hydrus</Button>
            <Typography.Text type="secondary">{selected.size} selected · {selected.size - shownSelected.length} outside this view</Typography.Text>
        </Space>
        <Typography.Paragraph type="secondary">{entries.length} files · Ctrl/Cmd+click toggles · Shift+click selects a range. Gallery order sorts loaded results; Date uses local file time / Hydrus import time. Missing hashes sort last.</Typography.Paragraph>
        <div style={{ height: '60vh', minHeight: 260 }} aria-label="Unified gallery">
            {!entries.length ? <Empty description="No files loaded. Choose a local folder or search Hydrus." /> : <AutoSizer>{({ width, height }) => {
                const count = Math.max(1, Math.floor(width / 220)); columns.current = count;
                return <FixedSizeGrid ref={grid} width={width} height={height} columnCount={count} columnWidth={width / count} rowCount={Math.ceil(entries.length / count)} rowHeight={225}
                    itemData={{ render: ({ rowIndex, columnIndex, style }: GridChildComponentProps) => {
                        return renderCard(rowIndex, columnIndex, count, style);
                    } }}
                    itemKey={({ rowIndex, columnIndex }) => entries[rowIndex * count + columnIndex]?.id || `empty-${rowIndex}-${columnIndex}`}>
                    {GalleryCell}
                </FixedSizeGrid>;
            }}</AutoSizer>}
        </div>
        <Modal title={current ? `Gallery viewer · ${index + 1} / ${entries.length} · ${current.name}` : 'Gallery viewer'} open={!!current && active} onCancel={closeViewer} width="96vw" zIndex={BASE_Z_INDEX + 10} footer={null}
            afterOpenChange={opened => { if (opened) viewerRef.current?.focus(); }}>
            {current && <div ref={viewerRef} tabIndex={-1} onKeyDown={event => {
                if ((event.target as HTMLElement).closest('input,textarea,select,button,[role="menu"],[role="combobox"]') || info) return;
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowLeft' ? -1 : 1); }
                if (event.key === ' ') { event.preventDefault(); toggle(current, event.shiftKey); }
            }}>
                <Space wrap style={{ marginBottom: 12 }}>
                    <Button disabled={index === 0} onClick={() => move(-1)}>Previous image</Button><Button disabled={index === entries.length - 1} onClick={() => move(1)}>Next image</Button>
                    <Checkbox checked={selected.has(current.id)} disabled={disabled} onClick={event => toggle(current, event.shiftKey)}>Selected</Checkbox>
                    <Button onClick={() => setZoom(value => Math.max(.25, value / 1.5))}>Zoom out</Button><Button onClick={() => setZoom(value => Math.min(8, value * 1.5))}>Zoom in</Button><Button onClick={() => setZoom(1)}>Fit</Button>
                    <Button onClick={() => setInfo(current)}>Metadata</Button><Button disabled={disabled} onClick={() => void act('source', current)}>Append for img2img</Button>
                    <span>{Math.round(zoom * 100)}% · Arrow keys browse · Space selects · Right-click for actions</span>
                </Space>
                <Dropdown trigger={['contextMenu']} disabled={disabled} menu={menu(current)}>
                    <div style={{ height: '62vh', overflow: 'auto', background: '#111', textAlign: 'center' }}>
                        {current.local?.type === '3d' ? <ModelViewer url={original(current)} type={current.name.split('.').pop() || ''} /> : current.local?.type === 'media' ? <video key={current.id} controls autoPlay={gallery.settings.autoPlayVideos} src={original(current)} style={{ maxWidth: '100%', height: '100%' }} /> : current.local?.type === 'audio' ? <audio key={current.id} controls src={original(current)} /> :
                        <img key={current.id} src={failedOriginal === current.id ? thumbnail(current) : original(current)} alt={'Viewing ' + current.name} onError={() => setFailedOriginal(current.id)} style={{ height: zoom === 1 ? '100%' : `${zoom * 100}%`, maxWidth: zoom === 1 ? '100%' : 'none', objectFit: 'contain' }} />}
                    </div>
                </Dropdown>
                {failedOriginal === current.id && <Typography.Text type="warning">Original could not be displayed; showing thumbnail. Download original is available in the context menu.</Typography.Text>}
                <div aria-label="Viewer filmstrip" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 10 }}>
                    {entries.slice(Math.max(0, index - 8), index + 9).map(entry => <Button key={entry.id} title={entry.name} aria-label={'View ' + entry.name} type={entry.id === viewer ? 'primary' : 'default'} onClick={() => setViewer(entry.id)} style={{ height: 65, minWidth: 80, borderColor: selected.has(entry.id) ? '#52c41a' : undefined }}>
                        {entry.local && entry.local.type !== 'image' ? entry.local.type : <img alt="" src={thumbnail(entry)} style={{ width: 60, height: 48, objectFit: 'contain' }} />}{selected.has(entry.id) ? '✓' : ''}
                    </Button>)}
                </div>
            </div>}
        </Modal>
        <Modal title="Image metadata" open={!!info} onCancel={() => setInfo(undefined)} footer={null} width="85vw" zIndex={BASE_Z_INDEX + 60}>
            {info?.local ? <MetadataView image={info.local} onShowRaw={() => setRaw(true)} showRawMetadata={raw} setShowRawMetadata={setRaw} /> : <pre style={{ maxHeight: '70vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(info?.remote, null, 2)}</pre>}
        </Modal>
    </div>;
}
