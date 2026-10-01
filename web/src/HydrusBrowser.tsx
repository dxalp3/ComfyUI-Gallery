import { useGalleryContext } from './GalleryContext';
import { indexPrompts } from './LocalPromptLibrary';
import type { LocalSearchField } from './LocalImageSearch';
import { useEffect, useMemo, useRef, useState } from 'react';
import { UnifiedGallery } from './UnifiedGallery';
import { Alert, Button, Checkbox, Modal, Select, Space, Spin, Tabs, Tag, Tree } from 'antd';
import { hydrusRequest } from './HydrusApi';
import { HydrusSearchPanel } from './HydrusSearchPanel';
import { useHydrus } from './HydrusContext';
import { appendToImageSource } from './ImageSourceBridge';

export type RemoteImage = { hash: string; file_id: number; mime: string; width: number; height: number; tags?: Record<string, any>; [key: string]: any };
type Page = { page_key: string; name: string; is_media_page: boolean; selected?: boolean; pages?: Page[] };
type Results = { items: RemoteImage[]; total: number; offset?: number; page_name?: string; page_state?: number };
type InputCopy = { name: string; subfolder: string; type: string; input_name: string; url: string; hash: string };

export function HydrusBrowser({ open, source = 'hydrus', searchOpen, onSearchComplete, onSourceChange }: { onSourceChange: (source: string) => void; source?: string; open: boolean; searchOpen: boolean; onSearchComplete: () => void }) {
    const gallery = useGalleryContext();
    const [shareTags, setShareTags] = useState(true);
    const [localBranch, setLocalBranch] = useState<string[]>([]);
    const [localField, setLocalField] = useState<LocalSearchField>('positive');
    const [localQuery, setLocalQuery] = useState('');
    const [localEditor, setLocalEditor] = useState(false);
    const localSuggestions = useMemo(() => Array.from(new Set(indexPrompts(gallery.data?.folders || {}).map(item => item.value).concat(Object.values(gallery.localHydrusTags).flat()))), [gallery.data, gallery.localHydrusTags]);
    const { settings, setSettingsOpen, reloadMemory } = useHydrus();
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
        if (kind === 'search') {
            gallery.setLibrarySearch({ tags, match, orGroups, share: shareTags, localTerms: localBranch, localField });
            gallery.setSearchFileName(''); gallery.setLocalTerms([]);
            onSourceChange(source === 'both' || localBranch.length || (shareTags && (tags.length || orGroups.length)) ? 'both' : 'hydrus');
        }
        try {
            if (kind === 'pages') {
                const data = await hydrusRequest<{ pages: Page }>('pages', {});
                if (version !== requestVersion.current) return;
                setPages(data.pages?.pages || (data.pages?.is_media_page ? [data.pages] : []));
            } else {
                const data = (!settings?.has_access_key || localBranch.length > 0 && !tags.length && !orGroups.length) && kind === 'search' ? { items: [], total: 0 } : await hydrusRequest<Results>(kind, kind === 'search' ? { tags, match, limit, or_groups: orGroups, file_sort_type: sortType, file_sort_asc: ascending } : { page_key: key, offset, limit });
                if (version !== requestVersion.current) return;
                setResult(data); reloadMemory();
                onSearchComplete();
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
            let completed = 0;
            const failures: string[] = [];
            for (const hash of hashes) {
                if (cancelDownloads.current) break;
                setProgress(`Saving ${completed + 1} of ${hashes.length} to output/downloads`);
                try { const result = await hydrusRequest<{ warning?: string }>('save_output', { hash, target: scope }); completed++; if (result.warning) failures.push(result.warning); }
                catch (reason) { failures.push(String(reason)); }
            }
            setNotice(`${completed} file(s) saved to ComfyUI output/downloads.`);
            if (failures.length) setError(failures.join('\n'));
            reloadMemory(); await gallery.runAsync();
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setDownloading(false); setProgress(''); actionBusy.current = false; }
    };
    const treeData = (list: Page[]): any[] => list.map(page => ({ key: page.page_key,
        title: `${page.name}${page.selected ? ' · active' : ''}`, selectable: page.is_media_page,
        children: page.pages ? treeData(page.pages) : undefined }));
    const items = result?.items || [];
    return <section className="cg-browser" aria-label="Gallery results">
        <div className="cg-hydrus-search" style={{ display: !searchOpen ? 'none' : undefined }}>
            {!settings?.has_access_key && <Alert type="warning" message="Configure your Hydrus connection first." action={<Button onClick={() => setSettingsOpen(true)}>Open settings</Button>} />}
            <Tabs activeKey={tab} onChange={changeTab} items={[{ key: 'search', label: 'Library search', disabled: working }, { key: 'pages', label: 'Open client pages', disabled: working }]} />
            {tab === 'search' ? <><Space wrap style={{ marginBottom: 8 }}><Checkbox checked={shareTags} onChange={event => setShareTags(event.target.checked)}>Match these Hydrus tags against local prompts and cached tags too</Checkbox><Button onClick={() => setLocalEditor(true)}>OR local group{localBranch.length ? ' (' + localBranch.length + ')' : ''}</Button>{!!localBranch.length && <Tag closable onClose={() => setLocalBranch([])} title={localBranch.join(' AND ')}>{localField}: {localBranch.join(' AND ').slice(0, 90)}</Tag>}</Space><HydrusSearchPanel tags={tags} setTags={setTags} match={match} setMatch={setMatch} limit={limit} setLimit={setLimit}
                orGroups={orGroups} setOrGroups={setOrGroups} sortType={sortType} setSortType={setSortType} ascending={ascending} setAscending={setAscending}
                busy={busy} disabled={working} configured={!!settings?.has_access_key || !!localBranch.length} scope={scope} onSearch={() => read('search')} inputRef={searchRef} /></> : <>
                <Space wrap><Button loading={busy} disabled={working} onClick={() => read('pages')}>Reload open pages</Button><Button disabled={!pageKey || busy || working} onClick={() => read('page')}>Reload page images</Button><span>Requires Manage Pages permission.</span></Space>
                <Tree style={{ maxHeight: 180, overflow: 'auto' }} key={JSON.stringify(pages)} defaultExpandAll treeData={treeData(pages)} selectedKeys={[pageKey]} disabled={working}
                    onSelect={keys => { if (keys.length) { const key = String(keys[0]); setPageKey(key); void read('page', key); } }} />
                {result && <Space style={{ marginBottom: 12 }}><Button disabled={!result.offset || busy || working} onClick={() => read('page', pageKey, Math.max(0, (result.offset || 0) - limit))}>Previous page</Button><span>Files {(result.offset || 0) + (result.total ? 1 : 0)}–{Math.min((result.offset || 0) + limit, result.total)} of {result.total}</span><Button disabled={(result.offset || 0) + limit >= result.total || busy || working} onClick={() => read('page', pageKey, (result.offset || 0) + limit)}>Next page</Button></Space>}
            </>}
        </div>
        <Modal title="OR local search group" open={localEditor} onCancel={() => setLocalEditor(false)} onOk={() => setLocalEditor(false)} okText="Use local group" zIndex={3030}>
            <p>Hydrus tag query OR these local terms. Local terms are ANDed together across all loaded folders.</p>
            <Select aria-label="Local group category" value={localField} onChange={setLocalField} options={['all', 'positive', 'negative', 'hydrus', 'name'].map(value => ({ value, label: value === 'hydrus' ? 'Hydrus tag (cached)' : value }))} style={{ width: '100%', marginBottom: 8 }} />
            <Select mode="tags" aria-label="Local group terms" value={localBranch} onChange={setLocalBranch} onSearch={setLocalQuery} options={localSuggestions.filter(value => value.toLocaleLowerCase().includes(localQuery.toLocaleLowerCase())).slice(0, 100).map(value => ({ value, label: value }))} style={{ width: '100%' }} placeholder="Enter adds a prompt or identifier" />
        </Modal>
        {gallery.librarySearch && <Space wrap style={{ marginBottom: 8 }}><small>Library query · local {shareTags ? 'shared tags' : 'group'} OR Hydrus results · all loaded folders</small><Button size="small" onClick={() => gallery.setLibrarySearch(null)}>Clear local query</Button></Space>}
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }} />}
        {notice && <Alert type="success" showIcon message={notice} style={{ marginBottom: 12 }} />}
        {(busy || working) && <Space><Spin size="small" /><span aria-live="polite">{progress || 'Searching Hydrus…'}</span>{working && <Button onClick={() => { cancelCopies.current = true; cancelDownloads.current = true; }}>Cancel remaining</Button>}</Space>}
        <UnifiedGallery onTrashed={hashes => setResult(old => old ? { ...old, items: old.items.filter(item => !hashes.includes(item.hash)), total: Math.max(0, old.total - hashes.length) } : old)} source={source} remote={items} selectedRemote={selected} setSelectedRemote={setSelected} copy={copy} download={download} working={working} scope={scope} active={open} />
    </section>;
}
