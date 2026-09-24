import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Dropdown, Empty, Modal, Space, Spin, Tabs, Tag, Tree, Typography } from 'antd';
import { BASE_Z_INDEX } from './ComfyAppApi';
import { hydrusRequest, selectRange } from './HydrusApi';
import { HydrusSearchPanel } from './HydrusSearchPanel';
import { downloadHydrusImages } from './HydrusDownloads';
import { useHydrus } from './HydrusContext';
import { appendToImageSource } from './ImageSourceBridge';

type RemoteImage = { hash: string; file_id: number; mime: string; width: number; height: number; tags?: Record<string, any>; [key: string]: any };
type Page = { page_key: string; name: string; is_media_page: boolean; selected?: boolean; pages?: Page[] };
type Results = { items: RemoteImage[]; total: number; offset?: number; page_name?: string; page_state?: number };
type InputCopy = { name: string; subfolder: string; type: string; input_name: string; url: string; hash: string };

export function HydrusBrowser({ open, onClose, embedded = false }: { open: boolean; onClose: () => void; embedded?: boolean }) {
    const { settings, setSettingsOpen, settingsOpen } = useHydrus();
    const [tab, setTab] = useState('search');
    const [tags, setTags] = useState<string[]>([]);
    const [match, setMatch] = useState<'all' | 'any'>('all');
    const [limit, setLimit] = useState(100);
    const [pages, setPages] = useState<Page[]>([]);
    const [pageKey, setPageKey] = useState('');
    const [result, setResult] = useState<Results>();
    const [selected, setSelected] = useState<string[]>([]);
    const [copies, setCopies] = useState<Record<string, InputCopy>>({});
    const [busy, setBusy] = useState(false);
    const [copying, setCopying] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [focusedHash, setFocusedHash] = useState('');
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [details, setDetails] = useState<RemoteImage>();
    const [progress, setProgress] = useState('');
    const requestVersion = useRef(0);
    const cancelCopies = useRef(false);
    const cancelDownloads = useRef(false);
    const actionBusy = useRef(false);
    const selectionAnchor = useRef<string | undefined>(undefined);
    const gridRef = useRef<HTMLDivElement>(null);
    const detailsRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<any>(null);
    const working = copying || downloading;
    const scope = `${settings?.url}|${settings?.profile}`;
    useEffect(() => {
        requestVersion.current++; setResult(undefined); setSelected([]); setPages([]); setPageKey(''); setCopies({}); setDetails(undefined); setBusy(false); setFocusedHash('');
    }, [scope]);
    useEffect(() => { if (!open) { requestVersion.current++; cancelCopies.current = true; cancelDownloads.current = true; setBusy(false); setDetails(undefined); } }, [open]);

    const read = async (kind: 'search' | 'pages' | 'page', key = pageKey, offset = 0) => {
        const version = ++requestVersion.current;
        setBusy(true); setError(''); setNotice('');
        if (kind !== 'pages') { setResult(undefined); setSelected([]); setFocusedHash(''); selectionAnchor.current = undefined; }
        try {
            if (kind === 'pages') {
                const data = await hydrusRequest<{ pages: Page }>('pages', {});
                if (version !== requestVersion.current) return;
                setPages(data.pages?.pages || (data.pages?.is_media_page ? [data.pages] : []));
            } else {
                const data = await hydrusRequest<Results>(kind, kind === 'search' ? { tags, match, limit } : { page_key: key, offset, limit });
                if (version !== requestVersion.current) return;
                setResult(data);
                setFocusedHash(data.items[0]?.hash || '');
            }
        } catch (reason) { if (version === requestVersion.current) setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { if (version === requestVersion.current) setBusy(false); }
    };
    const changeTab = (value: string) => {
        requestVersion.current++; setBusy(false); setTab(value); setResult(undefined); setSelected([]); setError('');
        if (value === 'pages') void read('pages');
    };
    const copy = async (hashes: string[], useWorkflow = false) => {
        if (actionBusy.current) return;
        if (useWorkflow && hashes.length > 32) { setError('Select at most 32 images to append to a node.'); return; }
        actionBusy.current = true;
        setCopying(true); setError(''); setNotice(''); cancelCopies.current = false;
        let completed = 0;
        const inputs: InputCopy[] = [];
        const failures: string[] = [];
        try {
            for (const hash of hashes) {
                if (cancelCopies.current) break;
                setProgress(`Copying ${completed + failures.length + 1} of ${hashes.length}`);
                try {
                    const input = copies[hash] || await hydrusRequest<InputCopy>('import', { hash });
                    setCopies(previous => ({ ...previous, [hash]: input }));
                    completed++;
                    if (useWorkflow) inputs.push(input);
                } catch (reason) { failures.push(`${hash.slice(0, 10)}: ${reason instanceof Error ? reason.message : String(reason)}`); }
            }
            if (useWorkflow && inputs.length) {
                try { setNotice(await appendToImageSource(inputs.map(input => ({ input_name: input.input_name, title: `Hydrus ${input.hash.slice(0, 12)}` })))); }
                catch (reason) { failures.push(reason instanceof Error ? reason.message : String(reason)); }
            }
            if (!useWorkflow) setNotice(`${completed} image(s) copied into ComfyUI input/hydrus. Use their names in Load Image nodes.`);
            if (failures.length) setError(failures.join('\n'));
        } finally { setCopying(false); setProgress(''); actionBusy.current = false; }
    };
    const download = async (hashes: string[]) => {
        if (!hashes.length || actionBusy.current) return;
        actionBusy.current = true; cancelDownloads.current = false;
        setDownloading(true); setError(''); setNotice('');
        try {
            const result = await downloadHydrusImages(hashes, () => cancelDownloads.current, setProgress);
            setNotice(`${result.completed} image(s) downloaded${hashes.length > 1 && result.completed ? ' in a ZIP' : ''}.${result.cancelled ? ' Remaining downloads cancelled.' : ''}`);
            if (result.failures.length) setError(result.failures.join('\n'));
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setDownloading(false); setProgress(''); actionBusy.current = false; }
    };
    const treeData = (list: Page[]): any[] => list.map(page => ({ key: page.page_key,
        title: `${page.name}${page.selected ? ' · active' : ''}`, selectable: page.is_media_page,
        children: page.pages ? treeData(page.pages) : undefined }));
    const toggle = (hash: string, range = false) => {
        if (working) return;
        setSelected(previous => range ? selectRange(hash, selectionAnchor.current, items.map(item => item.hash), previous) :
            previous.includes(hash) ? previous.filter(value => value !== hash) : [...previous, hash]);
        if (!range || !selectionAnchor.current) selectionAnchor.current = hash;
        setFocusedHash(hash);
    };
    const items = result?.items || [];
    const hasMore = tab === 'pages' && !!result && (result.offset || 0) + limit < result.total;
    const thumbnailUrl = (hash: string) => `/Gallery/hydrus/thumbnail?hash=${hash}&target=${encodeURIComponent(scope)}`;
    const browseDetails = (direction: number) => {
        const index = items.findIndex(item => item.hash === details?.hash);
        const next = items[index + direction];
        if (next) { setDetails(next); setFocusedHash(next.hash); }
    };
    const handleKeys = (event: React.KeyboardEvent, inDetails = false) => {
        if (!open || settingsOpen || working || busy) return;
        const target = event.target as HTMLElement;
        if (target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="menu"], [role="tree"], [role="treeitem"], [role="tablist"], [role="tab"]')) return;
        const index = Math.max(0, items.findIndex(item => item.hash === (inDetails ? details?.hash : focusedHash)));
        const current = items[index];
        const key = event.key.toLowerCase();
        const consume = () => { event.preventDefault(); event.stopPropagation(); };
        if ((event.ctrlKey || event.metaKey) && key === 'a') { consume(); setSelected(items.map(item => item.hash)); return; }
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (key === '?') { consume(); setShowShortcuts(value => !value); return; }
        if (key === '/' && !inDetails) {
            consume(); if (tab !== 'search') changeTab('search');
            requestAnimationFrame(() => searchRef.current?.focus()); return;
        }
        if (!current) return;
        if (event.key.startsWith('Arrow')) {
            consume();
            if (inDetails) { browseDetails(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1); return; }
            const cards = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-hydrus-result]') || []);
            const columns = Math.max(1, cards.filter(card => card.offsetTop === cards[0]?.offsetTop).length);
            const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns;
            const next = Math.max(0, Math.min(items.length - 1, index + step));
            if (event.shiftKey) {
                if (!selectionAnchor.current) selectionAnchor.current = current.hash;
                toggle(items[next].hash, true);
            } else { setFocusedHash(items[next].hash); selectionAnchor.current = items[next].hash; }
            cards[next]?.focus({ preventScroll: true }); cards[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } else if (key === 'd') { consume(); void download([current.hash]); }
        else if (key === 'i') { consume(); void copy([current.hash], true); }
        else if (!target.closest('button, [role="button"], [role="tab"]')) {
            if (event.key === ' ') { consume(); toggle(current.hash, event.shiftKey); }
            else if (event.key === 'Enter' && !inDetails) { consume(); setDetails(current); }
        }
    };
    const shortcutHelp = <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Keyboard controls"
        description="Arrows: move between images · Shift+Arrows / Shift+click: select range · Space: toggle selection · Enter: view image · Ctrl/Cmd+A: select results · /: focus search · Ctrl/Cmd+Enter in search: run search · D: download focused image · I: use for img2img · Escape: close the top view · ?: show/hide this help. Shortcuts leave text editing and menus alone." />;

    const Wrapper = embedded ? EmbeddedHydrus : Modal;
    return <>
        <Wrapper title="Hydrus library" open={open} onCancel={() => { if (!working && !details && !settingsOpen) onClose(); }} width="92vw" zIndex={BASE_Z_INDEX + 30}
            footer={<Button disabled={working} onClick={onClose}>Close</Button>} maskClosable={!working} keyboard={!working && !details && !settingsOpen}>
            <div onKeyDownCapture={event => handleKeys(event)}>
            <Typography.Paragraph type="secondary">Find source images in your main client, copy their originals to ComfyUI input, or append them to Gallery Image Source for cropping and img2img.</Typography.Paragraph>
            {!settings?.has_access_key && <Alert type="warning" message="Configure your Hydrus connection first." action={<Button onClick={() => setSettingsOpen(true)}>Open settings</Button>} />}
            <Tabs activeKey={tab} onChange={changeTab} items={[{ key: 'search', label: 'Search Hydrus', disabled: working }, { key: 'pages', label: 'Open client pages', disabled: working }]} />
            {tab === 'search' && <HydrusSearchPanel tags={tags} setTags={setTags} match={match} setMatch={setMatch} limit={limit} setLimit={setLimit}
                busy={busy} disabled={working} configured={!!settings?.has_access_key} scope={scope} onSearch={() => read('search')} inputRef={searchRef} />}
            {tab === 'pages' && <Space style={{ marginBottom: 12 }}><Button loading={busy} disabled={working} onClick={() => read('pages')}>Reload open pages</Button><Button disabled={!pageKey || busy || working} onClick={() => read('page')}>Reload page images</Button><Typography.Text type="secondary">Requires Manage Pages permission. Page order matches the main client.</Typography.Text></Space>}
            <Space wrap style={{ marginBottom: 12 }}>
                <Button disabled={!items.length || working} onClick={() => setSelected(items.map(item => item.hash))}>Select results ({items.length})</Button>
                <Button disabled={!selected.length || working} onClick={() => setSelected([])}>Clear</Button>
                <Button type="primary" disabled={!selected.length || working} onClick={() => copy(selected)}>Copy selected to input ({selected.length})</Button>
                <Button disabled={!selected.length || working} onClick={() => copy(selected, true)}>Append selected to Image Source ({selected.length})</Button>
                <Button disabled={!selected.length || working} onClick={() => download(selected)}>Download selected ({selected.length})</Button>
                <Button onClick={() => setShowShortcuts(value => !value)}>Keyboard controls</Button>
                {working && <><Spin size="small" /><span aria-live="polite">{progress}</span><Button onClick={() => { cancelCopies.current = true; cancelDownloads.current = true; }}>Cancel remaining</Button></>}
            </Space>
            {showShortcuts && shortcutHelp}
            {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }} />}
            {notice && <Alert type="success" showIcon message={notice} style={{ marginBottom: 12 }} />}
            <div style={{ display: 'flex', gap: 16, minHeight: 250, maxHeight: '57vh', overflow: 'auto' }}>
                {tab === 'pages' && <div style={{ width: 240, flexShrink: 0, overflow: 'auto' }}><Tree key={JSON.stringify(pages)} defaultExpandAll treeData={treeData(pages)} selectedKeys={[pageKey]} disabled={working}
                    onSelect={keys => { if (keys.length) { const key = String(keys[0]); setPageKey(key); void read('page', key); } }} />{!pages.length && !busy && <Empty description="No open pages loaded" />}</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                    {busy ? <Spin style={{ display: 'block', margin: 60 }} /> : items.length ? <>
                        <Typography.Paragraph>{result?.page_name ? `${result.page_name} · ` : ''}{items.length} local images shown{tab === 'pages' ? ` · ${result?.total} files on page` : ''}{result?.page_state ? ' · page still loading in Hydrus; reload shortly' : ''}</Typography.Paragraph>
                        <div ref={gridRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
                            {items.map(item => <Dropdown key={item.hash} trigger={['contextMenu']} disabled={working} menu={{ items: [{ key: 'use', label: 'Append for img2img' }, { key: 'copy', label: 'Copy to ComfyUI input' }, { key: 'download', label: 'Download original' }, { key: 'info', label: 'View metadata' }],
                                onClick: ({ key }) => { if (key === 'info') setDetails(item); else if (key === 'download') void download(selected.includes(item.hash) ? selected : [item.hash]); else void copy(selected.includes(item.hash) ? selected : [item.hash], key === 'use'); } }}>
                                <Card size="small" data-hydrus-result={item.hash} role="group" aria-label={`Hydrus image ${item.file_id}`} tabIndex={item.hash === focusedHash ? 0 : -1}
                                    onFocus={() => setFocusedHash(item.hash)} style={{ borderColor: selected.includes(item.hash) ? '#1677ff' : undefined, boxShadow: item.hash === focusedHash ? '0 0 0 2px #4096ff' : undefined }}
                                    cover={<img loading="lazy" src={thumbnailUrl(item.hash)} alt={`Hydrus file ${item.file_id}`} style={{ height: 150, objectFit: 'contain', background: '#17191d', cursor: 'pointer' }} onClick={event => event.shiftKey || event.ctrlKey || event.metaKey ? toggle(item.hash, event.shiftKey) : setDetails(item)} />}>
                                    <Space><Checkbox aria-label={`Select Hydrus file ${item.file_id}`} checked={selected.includes(item.hash)} disabled={working} onClick={event => toggle(item.hash, event.shiftKey)} /><Typography.Text type="secondary">{item.width} × {item.height}</Typography.Text>{copies[item.hash] && <Tag color="green">Copied</Tag>}</Space>
                                    <Typography.Paragraph ellipsis style={{ margin: '6px 0' }} title={item.hash}>#{item.file_id} · {item.hash.slice(0, 12)}</Typography.Paragraph>
                                    <Space wrap><Button size="small" type="primary" disabled={working} onClick={() => copy([item.hash], true)}>Append for img2img</Button><Button size="small" disabled={working} onClick={() => copy([item.hash])}>Copy to input</Button><Button size="small" disabled={working} onClick={() => download([item.hash])}>Download</Button></Space>
                                    {copies[item.hash] && <Typography.Paragraph copyable style={{ fontSize: 11, wordBreak: 'break-all', marginTop: 8 }}>{copies[item.hash].input_name}</Typography.Paragraph>}
                                </Card>
                            </Dropdown>)}
                        </div>
                    </> : <Empty description={result ? 'No local images in these results. Try other tags or the next page.' : tab === 'pages' ? 'Choose a page from your main client' : 'Search your Hydrus library'} />}
                </div>
            </div>
            {tab === 'pages' && result && <Space style={{ marginTop: 12 }}><Button disabled={!result.offset || busy || working} onClick={() => read('page', pageKey, Math.max(0, (result.offset || 0) - limit))}>Previous</Button><span>Files {(result.offset || 0) + (result.total ? 1 : 0)}–{Math.min((result.offset || 0) + limit, result.total)} of {result.total}</span><Button disabled={!hasMore || busy || working} onClick={() => read('page', pageKey, (result.offset || 0) + limit)}>Next</Button></Space>}
            </div>
        </Wrapper>
        <Modal title="Hydrus source image" open={!!details} onCancel={() => setDetails(undefined)}
            afterOpenChange={visible => { if (visible) detailsRef.current?.focus(); }}
            modalRender={node => <div onKeyDownCapture={event => handleKeys(event, true)}>{node}</div>} footer={<Space>
            <Button disabled={working || !details || items[0]?.hash === details.hash} onClick={() => browseDetails(-1)}>Previous image</Button>
            <Button disabled={working || !details || items[items.length - 1]?.hash === details.hash} onClick={() => browseDetails(1)}>Next image</Button>
            <Button disabled={working} onClick={() => { if (details) void download([details.hash]); }}>Download</Button>
            <Button disabled={working} type="primary" onClick={() => { if (details) { void copy([details.hash], true); setDetails(undefined); } }}>Append for img2img</Button>
        </Space>} zIndex={BASE_Z_INDEX + 40} width={720}>
            <div ref={detailsRef} tabIndex={0} aria-label="Hydrus source image controls">
            <Typography.Paragraph type="secondary">← → browse · Space select · D download · I img2img · Escape close</Typography.Paragraph>
            {working && <Typography.Paragraph aria-live="polite">{progress}</Typography.Paragraph>}
            {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }} />}
            {notice && <Alert type="success" showIcon message={notice} style={{ marginBottom: 12 }} />}
            {showShortcuts && shortcutHelp}
            {details && <><Checkbox checked={selected.includes(details.hash)} disabled={working} onClick={event => toggle(details.hash, event.shiftKey)}>Selected for bulk actions</Checkbox>
                <img src={thumbnailUrl(details.hash)} style={{ maxHeight: 300, maxWidth: '100%', display: 'block', margin: '0 auto 16px' }} alt={`Hydrus file ${details.file_id}`} />
                <Typography.Text copyable>{details.hash}</Typography.Text>
                <div style={{ margin: '12px 0' }}>{Object.values(details.tags || {}).flatMap(service => service.display_tags?.['0'] || []).filter((tag, i, all) => all.indexOf(tag) === i).map(tag => <Tag key={tag}>{tag}</Tag>)}</div>
                <Collapse items={[{ key: 'metadata', label: 'Full Hydrus metadata', children: <pre style={{ maxHeight: 350, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(details, null, 2)}</pre> }]} /></>}
            </div>
        </Modal>
    </>;
}

function EmbeddedHydrus({ children, open }: any) { return open ? <section aria-label="Hydrus library">{children}</section> : null; }
