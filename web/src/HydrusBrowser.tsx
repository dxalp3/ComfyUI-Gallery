import { useEffect, useRef, useState } from 'react';
import { UnifiedGallery } from './UnifiedGallery';
import { Alert, Button, Space, Spin, Tabs, Tree } from 'antd';
import { hydrusRequest } from './HydrusApi';
import { HydrusSearchPanel } from './HydrusSearchPanel';
import { downloadHydrusImages } from './HydrusDownloads';
import { useHydrus } from './HydrusContext';
import { appendToImageSource } from './ImageSourceBridge';

export type RemoteImage = { hash: string; file_id: number; mime: string; width: number; height: number; tags?: Record<string, any>; [key: string]: any };
type Page = { page_key: string; name: string; is_media_page: boolean; selected?: boolean; pages?: Page[] };
type Results = { items: RemoteImage[]; total: number; offset?: number; page_name?: string; page_state?: number };
type InputCopy = { name: string; subfolder: string; type: string; input_name: string; url: string; hash: string };

export function HydrusBrowser({ open, onClose, embedded = false, source = 'hydrus' }: { source?: string; open: boolean; onClose: () => void; embedded?: boolean }) {
    const { settings, setSettingsOpen } = useHydrus();
    const [tab, setTab] = useState('search');
    const [tags, setTags] = useState<string[]>([]);
    const [match, setMatch] = useState<'all' | 'any'>('all');
    const [limit, setLimit] = useState(100);
    const [orGroups, setOrGroups] = useState<string[][]>([]);
    const [sortType, setSortType] = useState(2);
    const [ascending, setAscending] = useState(false);
    const [pages, setPages] = useState<Page[]>([]);
    const [pageKey, setPageKey] = useState('');
    const [result, setResult] = useState<Results>();
    const [selected, setSelected] = useState<string[]>([]);
    const [copies, setCopies] = useState<Record<string, InputCopy>>({});
    const [busy, setBusy] = useState(false);
    const [copying, setCopying] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [progress, setProgress] = useState('');
    const requestVersion = useRef(0);
    const cancelCopies = useRef(false);
    const cancelDownloads = useRef(false);
    const actionBusy = useRef(false);
    const searchRef = useRef<any>(null);
    const working = copying || downloading;
    const scope = `${settings?.url}|${settings?.profile}`;
    useEffect(() => {
        requestVersion.current++; setResult(undefined); setSelected([]); setPages([]); setPageKey(''); setCopies({}); setBusy(false);
    }, [scope]);
    useEffect(() => { if (!open) { requestVersion.current++; cancelCopies.current = true; cancelDownloads.current = true; setBusy(false); } }, [open]);

    const read = async (kind: 'search' | 'pages' | 'page', key = pageKey, offset = 0) => {
        const version = ++requestVersion.current;
        setBusy(true); setError(''); setNotice('');
        if (kind !== 'pages') { setResult(undefined); setSelected([]); }
        try {
            if (kind === 'pages') {
                const data = await hydrusRequest<{ pages: Page }>('pages', {});
                if (version !== requestVersion.current) return;
                setPages(data.pages?.pages || (data.pages?.is_media_page ? [data.pages] : []));
            } else {
                const data = await hydrusRequest<Results>(kind, kind === 'search' ? { tags, match, limit, or_groups: orGroups, file_sort_type: sortType, file_sort_asc: ascending } : { page_key: key, offset, limit });
                if (version !== requestVersion.current) return;
                setResult(data);
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
    const items = result?.items || [];
    return <section aria-label="Gallery workspace">
        <div style={{ display: source === 'local' ? 'none' : undefined }}>
            {!settings?.has_access_key && <Alert type="warning" message="Configure your Hydrus connection first." action={<Button onClick={() => setSettingsOpen(true)}>Open settings</Button>} />}
            <Tabs activeKey={tab} onChange={changeTab} items={[{ key: 'search', label: 'Search Hydrus', disabled: working }, { key: 'pages', label: 'Open client pages', disabled: working }]} />
            {tab === 'search' ? <HydrusSearchPanel tags={tags} setTags={setTags} match={match} setMatch={setMatch} limit={limit} setLimit={setLimit}
                orGroups={orGroups} setOrGroups={setOrGroups} sortType={sortType} setSortType={setSortType} ascending={ascending} setAscending={setAscending}
                busy={busy} disabled={working} configured={!!settings?.has_access_key} scope={scope} onSearch={() => read('search')} inputRef={searchRef} /> : <>
                <Space wrap><Button loading={busy} disabled={working} onClick={() => read('pages')}>Reload open pages</Button><Button disabled={!pageKey || busy || working} onClick={() => read('page')}>Reload page images</Button><span>Requires Manage Pages permission.</span></Space>
                <Tree style={{ maxHeight: 180, overflow: 'auto' }} key={JSON.stringify(pages)} defaultExpandAll treeData={treeData(pages)} selectedKeys={[pageKey]} disabled={working}
                    onSelect={keys => { if (keys.length) { const key = String(keys[0]); setPageKey(key); void read('page', key); } }} />
                {result && <Space style={{ marginBottom: 12 }}><Button disabled={!result.offset || busy || working} onClick={() => read('page', pageKey, Math.max(0, (result.offset || 0) - limit))}>Previous page</Button><span>Files {(result.offset || 0) + (result.total ? 1 : 0)}–{Math.min((result.offset || 0) + limit, result.total)} of {result.total}</span><Button disabled={(result.offset || 0) + limit >= result.total || busy || working} onClick={() => read('page', pageKey, (result.offset || 0) + limit)}>Next page</Button></Space>}
            </>}
        </div>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }} />}
        {notice && <Alert type="success" showIcon message={notice} style={{ marginBottom: 12 }} />}
        {(busy || working) && <Space><Spin size="small" /><span aria-live="polite">{progress || 'Searching Hydrus…'}</span>{working && <Button onClick={() => { cancelCopies.current = true; cancelDownloads.current = true; }}>Cancel remaining</Button>}</Space>}
        <UnifiedGallery source={source} remote={items} selectedRemote={selected} setSelectedRemote={setSelected} copy={copy} download={download} working={working} scope={scope} active={open} />
    </section>;
}
