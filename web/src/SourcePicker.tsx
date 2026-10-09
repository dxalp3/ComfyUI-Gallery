import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Segmented, Space, Tooltip, Typography, message } from 'antd';
import { AppstoreOutlined, CheckOutlined, CloseOutlined, SortAscendingOutlined, SortDescendingOutlined, UnorderedListOutlined, UploadOutlined } from '@ant-design/icons';
import { FloatingPanel } from './FloatingPanel';
import { BASE_PATH, BASE_Z_INDEX } from './ComfyAppApi';
import { useGalleryContext } from './GalleryContext';
import { addToNode, comfyFetch, readSourceManifest, saveSourceManifest, sourceFromInput, sourceRequest, SOURCE_PICKER_EVENT, uploadImages } from './ImageSourceBridge';

/** Open the picker for one Gallery Image Source node. */
export const openSourcePicker = (node: any) => window.dispatchEvent(new CustomEvent(SOURCE_PICKER_EVENT, { detail: node }));

type Tab = 'all' | 'imported' | 'generated' | 'node';
type Item = { key: string; kind: 'input' | 'gallery' | 'node'; name: string; thumb: string; time: number; width?: number; height?: number; url?: string; input?: string; index?: number };
type InputImage = { name: string; modified: number; width?: number; height?: number };
const sourceThumb = (name: string) => `${BASE_PATH}/Gallery/source/thumbnail?url=${encodeURIComponent('/static_gallery/' + name)}`;

/**
 * The image picker of a Gallery Image Source node, laid out like Load Image's: All / Imported (ComfyUI's input
 * folder) / Generated (the gallery) / In this node, a search box, sort order, grid or list, and Upload.
 * Clicking an image adds it to the node; in "In this node" it picks the output image or removes one.
 */
export function SourcePicker() {
    const gallery = useGalleryContext();
    const [node, setNode] = useState<any>();
    const [tab, setTab] = useState<Tab>('all');
    const [query, setQuery] = useState('');
    const [newest, setNewest] = useState(true);
    const [grid, setGrid] = useState(true);
    const [inputs, setInputs] = useState<InputImage[]>([]);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [added, setAdded] = useState<string[]>([]);
    const [revision, setRevision] = useState(0);
    const [shown, setShown] = useState(120);
    const file = useRef<HTMLInputElement>(null);
    const root = gallery.settings.relativePath;
    const loadInputs = () => comfyFetch('/Gallery/source/inputs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(response => response.json()).then(data => { if (data.error) throw new Error(data.error); setInputs(data.images); }).catch(reason => setError(String(reason instanceof Error ? reason.message : reason)));
    useEffect(() => {
        const open = (event: Event) => { setNode((event as CustomEvent).detail); setAdded([]); setError(''); setQuery(''); setShown(120); void loadInputs(); if (!gallery.data) void gallery.runAsync?.().catch(() => undefined); };
        const changed = () => setRevision(value => value + 1);
        window.addEventListener(SOURCE_PICKER_EVENT, open);
        window.addEventListener('gallery-source-changed', changed);
        return () => { window.removeEventListener(SOURCE_PICKER_EVENT, open); window.removeEventListener('gallery-source-changed', changed); };
    }, []);
    useEffect(() => setShown(120), [tab, query, newest]);
    const manifest = useMemo(() => { try { return node ? readSourceManifest(node) : undefined; } catch { return undefined; } }, [node, revision]);
    const items = useMemo(() => {
        const imported: Item[] = inputs.map(image => ({ key: 'input:' + image.name, kind: 'input', name: image.name, thumb: sourceThumb(image.name), time: image.modified, width: image.width, height: image.height, input: image.name }));
        const generated: Item[] = Object.values(gallery.data?.folders || {}).flatMap(folder => Object.values(folder)).filter(item => item.type === 'image').map(item => {
            const [width, height] = (item.metadata?.fileinfo?.resolution || '').split('x').map(Number);
            return { key: 'gallery:' + item.url, kind: 'gallery', name: item.name, thumb: `${BASE_PATH}/Gallery/thumbnail?url=${encodeURIComponent(item.url)}&v=${item.timestamp || 0}&root=${encodeURIComponent(root)}`, time: item.timestamp || 0, width: width || undefined, height: height || undefined, url: item.url };
        });
        const own: Item[] = (manifest?.images || []).map((image, index) => ({ key: 'node:' + index, kind: 'node', name: image.title || image.input_name, thumb: sourceThumb(image.input_name), time: -index, index }));
        const list = tab === 'node' ? own : tab === 'imported' ? imported : tab === 'generated' ? generated : [...imported, ...generated];
        const needle = query.trim().toLowerCase();
        const found = needle ? list.filter(item => item.name.toLowerCase().includes(needle)) : list;
        return tab === 'node' ? found : [...found].sort((a, b) => newest ? b.time - a.time : a.time - b.time);
    }, [inputs, gallery.data, manifest, tab, query, newest, root]);
    const run = async (label: string, action: () => Promise<void>) => { setBusy(label); setError(''); try { await action(); } catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); } finally { setBusy(''); } };
    const pick = (item: Item) => run(item.key, async () => {
        if (!node) return;
        if (item.kind === 'node') { if (manifest?.layout === 'single') saveSourceManifest(node, { ...manifest, active_index: item.index! }); return; }
        const image = item.kind === 'input' ? await sourceFromInput(item.input!) : await sourceRequest('/Gallery/source/local', { url: item.url });
        await addToNode(node, [{ ...image, title: item.name.split('/').pop() }], [item.url]);
        setAdded(old => [...old, item.key]);
    });
    const remove = (index: number) => { if (!node || !manifest) return; const images = manifest.images.filter((_, at) => at !== index); saveSourceManifest(node, { ...manifest, images, active_index: Math.min(manifest.active_index || 0, Math.max(0, images.length - 1)) }); };
    const upload = (files: File[]) => run('upload', async () => {
        if (!node || !files.length) return;
        const count = await addToNode(node, await uploadImages(files));
        message.success(`Uploaded and added ${count} image(s)`); void loadInputs();
    });
    const count = manifest?.images.length || 0;
    const tile = (item: Item) => {
        const active = item.kind === 'node' && manifest?.layout === 'single' && item.index === (manifest.active_index || 0);
        const done = added.includes(item.key);
        const size = item.width && item.height ? `${item.width} × ${item.height}` : '';
        const label = item.kind === 'node' ? (manifest?.layout === 'single' ? 'Use as the output image' : item.name) : 'Add to this node';
        const remover = item.kind === 'node' && <Button size="small" type="text" danger icon={<CloseOutlined />} aria-label={'Remove ' + item.name} title="Remove from this node" onClick={event => { event.stopPropagation(); remove(item.index!); }} />;
        const picture = <div style={{ position: 'relative', width: grid ? '100%' : 56, aspectRatio: grid ? '1' : undefined, height: grid ? undefined : 56, flex: 'none', background: '#8882', borderRadius: 6, overflow: 'hidden', outline: active ? '2px solid #1677ff' : done ? '2px solid #52c41a' : undefined, outlineOffset: -2 }}>
            <img loading="lazy" src={item.thumb} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {(active || done) && <CheckOutlined style={{ position: 'absolute', top: 4, right: 4, color: '#fff', background: active ? '#1677ff' : '#52c41a', borderRadius: 8, padding: 2, fontSize: 11 }} />}
            {busy === item.key && <div style={{ position: 'absolute', inset: 0, background: '#0008', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>adding…</div>}
        </div>;
        return <Tooltip key={item.key} title={label} mouseEnterDelay={.6}>
            <div role="button" tabIndex={0} aria-label={label + ': ' + item.name} onClick={() => void pick(item)} onKeyDown={event => { if (event.key === 'Enter') void pick(item); }}
                style={grid ? { cursor: 'pointer', minWidth: 0, textAlign: 'center' } : { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: 4, borderRadius: 6 }}>
                {grid && <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', height: 16 }}>{size}</Typography.Text>}
                {picture}
                <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography.Text style={{ fontSize: 11, display: 'block', overflowWrap: 'anywhere', lineHeight: 1.3, flex: 1, textAlign: grid ? 'center' : 'left' }}>{item.name.split('/').pop()}{!grid && size && <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{size}</Typography.Text>}</Typography.Text>
                    {remover}
                </div>
            </div>
        </Tooltip>;
    };
    return <FloatingPanel panelKey="source-picker" title={`Gallery Image Source${node ? ' #' + node.id : ''} · ${count} image${count === 1 ? '' : 's'}`} open={!!node} onCancel={() => setNode(undefined)} width={420} zIndex={BASE_Z_INDEX + 30} footer={null}
        initialSize={{ width: 420, height: Math.min(innerHeight - 80, 640) }}>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }} wrap>
            <Segmented size="small" value={tab} onChange={value => setTab(value as Tab)} options={[{ value: 'all', label: 'All' }, { value: 'imported', label: 'Imported' }, { value: 'generated', label: 'Generated' }, { value: 'node', label: `In this node (${count})` }]} />
            <Button size="small" icon={<UploadOutlined />} loading={busy === 'upload'} onClick={() => file.current?.click()}>Upload</Button>
            <input ref={file} type="file" accept="image/*" multiple hidden onChange={event => { const files = [...(event.target.files || [])]; event.target.value = ''; void upload(files); }} />
        </Space>
        <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
            <Input allowClear placeholder="Search…" aria-label="Search images" value={query} onChange={event => setQuery(event.target.value)} />
            <Button aria-label={newest ? 'Newest first' : 'Oldest first'} title={newest ? 'Newest first' : 'Oldest first'} icon={newest ? <SortDescendingOutlined /> : <SortAscendingOutlined />} disabled={tab === 'node'} onClick={() => setNewest(value => !value)} />
            <Button aria-label="List view" type={grid ? 'default' : 'primary'} icon={<UnorderedListOutlined />} onClick={() => setGrid(false)} />
            <Button aria-label="Grid view" type={grid ? 'primary' : 'default'} icon={<AppstoreOutlined />} onClick={() => setGrid(true)} />
        </Space.Compact>
        {error && <Alert type="error" showIcon closable message={error} onClose={() => setError('')} style={{ marginBottom: 8 }} />}
        {!items.length
            ? <Empty description={tab === 'node' ? 'No images in this node yet.' : tab === 'generated' && !gallery.data ? 'Loading the gallery…' : 'No images found.'} />
            : <div style={grid ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 8 } : { display: 'flex', flexDirection: 'column', gap: 2 }}>{items.slice(0, shown).map(tile)}</div>}
        {items.length > shown && <Button block style={{ marginTop: 8 }} onClick={() => setShown(value => value + 120)}>Show more ({(items.length - shown).toLocaleString()} left)</Button>}
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>Click an image to add it{manifest?.layout === 'single' ? '; in “In this node”, click one to make it the output image' : ''}. Image files and gallery images can also be dropped on the node, or a Load Image node dropped onto it.</Typography.Paragraph>
    </FloatingPanel>;
}
