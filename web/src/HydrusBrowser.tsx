import { HydrusTagSelect } from './HydrusTagSelect';
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

export function HydrusBrowser({ open, source = 'hydrus', searchMode, viewRevision, onSourceChange }: { onSourceChange: (source: string) => void; source?: string; open: boolean; searchMode: string; viewRevision: number }) {
    const gallery = useGalleryContext();
    const hybrid = searchMode === 'both';
    const [shareTags, setShareTags] = useState(true);
    const autoView = useRef<number | null>(null);
    const [sortRequest, setSortRequest] = useState<{ type: number; ascending: boolean; revision: number }>();
    const [localBranch, setLocalBranch] = useState<string[]>([]);
    const [fieldJoin, setFieldJoin] = useState<'all' | 'any'>('any');
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
    const lastSampling = useRef('2:false');
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

    useEffect(() => { requestVersion.current++; setBusy(false); }, [viewRevision]);
    const localCount = gallery.imagesDetailsList.filter(file => !['divider', 'empty-space'].includes(file.type)).length;
    useEffect(() => {
        if (autoView.current !== viewRevision || busy || !result || !hybrid) return;
        onSourceChange(localCount && result.items.length ? 'both' : localCount ? 'local' : result.items.length ? 'hydrus' : 'both');
    }, [localCount, result, busy, hybrid, viewRevision, onSourceChange]);

    const read = async (kind: 'search' | 'pages' | 'page', key = pageKey, offset = 0) => {
        const version = ++requestVersion.current;
        setBusy(true); setError(''); setNotice('');
        if (kind !== 'pages') { setResult(undefined); setSelected([]); }
        if (kind === 'search') {
            autoView.current = hybrid ? viewRevision : null;
            gallery.setLibrarySearch(hybrid ? { tags, match, orGroups, share: shareTags, localTerms: localBranch, localField, fieldJoin } : null);
            gallery.setSearchFileName(''); gallery.setLocalTerms([]);
            onSourceChange(hybrid ? 'both' : 'hydrus');
        }
        try {
            if (kind === 'pages') {
                const data = await hydrusRequest<{ pages: Page }>('pages', {});
                if (version !== requestVersion.current) return;
                setPages(data.pages?.pages || (data.pages?.is_media_page ? [data.pages] : []));
            } else {
                const data = !settings?.has_access_key && kind === 'search' ? { items: [], total: 0 } : await hydrusRequest<Results>(kind, kind === 'search' ? { tags, match, limit, metadata_terms: localBranch, metadata_field: localField, field_join: fieldJoin, or_groups: orGroups, file_sort_type: sortType, file_sort_asc: ascending, expand_danbooru_aliases: gallery.settings.hydrusSearchAliases !== false } : { page_key: key, offset, limit });
                if (version !== requestVersion.current) return;
                setResult(data); reloadMemory();
                if (kind === 'search') {
                    const sampling = `${sortType}:${ascending}`;
                    if (sampling !== lastSampling.current || sortType === 4) setSortRequest({ type: sortType, ascending, revision: version });
                    lastSampling.current = sampling;
                }
                else { autoView.current = null; onSourceChange('hydrus'); }
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
        <div className="cg-hydrus-search" style={{ display: searchMode === 'local' ? 'none' : undefined }}>
            {!settings?.has_access_key && <Alert type="warning" message="Configure your Hydrus connection first." action={<Button onClick={() => setSettingsOpen(true)}>Open settings</Button>} />}
            <Tabs activeKey={tab} onChange={changeTab} items={[{ key: 'search', label: hybrid ? 'Search both libraries' : 'Search Hydrus', disabled: working }, { key: 'pages', label: 'Open client pages', disabled: working }]} />
            {tab === 'search' ? <>{<Space wrap style={{ marginBottom: 8 }}>{hybrid && <Checkbox checked={shareTags} onChange={event => setShareTags(event.target.checked)}>Match these Hydrus tags against local prompts and cached tags too</Checkbox>}<Button onClick={() => setLocalEditor(true)}>Metadata group{localBranch.length ? ' (' + localBranch.length + ')' : ''}</Button>{!!localBranch.length && <Tag closable onClose={() => setLocalBranch([])} title={localBranch.join(' AND ')}>{localField}: {localBranch.join(' AND ').slice(0, 90)}</Tag>}</Space>}<HydrusSearchPanel localSuggestions={hybrid ? localSuggestions : []} tags={tags} setTags={setTags} match={match} setMatch={setMatch} limit={limit} setLimit={setLimit}
                orGroups={orGroups} setOrGroups={setOrGroups} sortType={sortType} setSortType={setSortType} ascending={ascending} setAscending={setAscending}
                busy={busy} disabled={working} configured={hybrid || !!settings?.has_access_key} scope={scope} onSearch={() => read('search')} inputRef={searchRef} /></> : <>
                <Space wrap><Button loading={busy} disabled={working} onClick={() => read('pages')}>Reload open pages</Button><Button disabled={!pageKey || busy || working} onClick={() => read('page')}>Reload page images</Button><span>Requires Manage Pages permission.</span></Space>
                <Tree style={{ maxHeight: 180, overflow: 'auto' }} key={JSON.stringify(pages)} defaultExpandAll treeData={treeData(pages)} selectedKeys={[pageKey]} disabled={working}
                    onSelect={keys => { if (keys.length) { const key = String(keys[0]); setPageKey(key); void read('page', key); } }} />
                {result && <Space style={{ marginBottom: 12 }}><Button disabled={!result.offset || busy || working} onClick={() => read('page', pageKey, Math.max(0, (result.offset || 0) - limit))}>Previous page</Button><span>Files {(result.offset || 0) + (result.total ? 1 : 0)}–{Math.min((result.offset || 0) + limit, result.total)} of {result.total}</span><Button disabled={(result.offset || 0) + limit >= result.total || busy || working} onClick={() => read('page', pageKey, (result.offset || 0) + limit)}>Next page</Button></Space>}
            </>}
        </div>
        <Modal title="Metadata search group" open={localEditor} onCancel={() => setLocalEditor(false)} onOk={() => setLocalEditor(false)} okText="Use metadata group" zIndex={3030}>
            <p>Search available prompts, cached Hydrus tags or identifiers. Terms in this group are ANDed. Combine this group with the tag query using AND or OR.</p>
            <Select aria-label="Combine search groups" value={fieldJoin} onChange={setFieldJoin} options={[{value:"any",label:"Tag query OR metadata group"},{value:"all",label:"Tag query AND metadata group"}]} style={{width:"100%",marginBottom:8}} /><Select aria-label="Local group category" value={localField} onChange={setLocalField} options={['all', 'positive', 'negative', 'hydrus', 'name'].map(value => ({ value, label: value === 'hydrus' ? 'Hydrus tag (cached)' : value }))} style={{ width: '100%', marginBottom: 8 }} />
            <HydrusTagSelect label="Local group terms" value={localBranch} onChange={setLocalBranch} localSuggestions={localSuggestions} placeholder="Add a prompt, identifier, or @prefix" />
        </Modal>
        {hybrid && gallery.librarySearch && <Space wrap style={{ marginBottom: 8 }}><small>{localCount} local · {items.length} Hydrus · all loaded folders</small><Button size="small" onClick={() => gallery.setLibrarySearch(null)}>Clear local query</Button></Space>}
        {result && (result as any).metadata_scanned !== undefined && <Alert type="info" message={`Prompt search used ${(result as any).metadata_scanned} indexed Hydrus files. ${(result as any).sampling_fallback ? "This sampling option is unavailable in the cache; import date was used." : ""} ${(result as any).index_status?.last_complete ? "Background index available; results reflect the last refresh." : "Initial indexing is still incomplete; check Hydrus sync and search again as it progresses."}`} />}
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }} />}
        {notice && <Alert type="success" showIcon message={notice} style={{ marginBottom: 12 }} />}
        {(busy || working) && <Space><Spin size="small" /><span aria-live="polite">{progress || 'Searching Hydrus…'}</span>{working && <Button onClick={() => { cancelCopies.current = true; cancelDownloads.current = true; }}>Cancel remaining</Button>}</Space>}
        <UnifiedGallery sortRequest={sortRequest} onTrashed={hashes => setResult(old => old ? { ...old, items: old.items.filter(item => !hashes.includes(item.hash)), total: Math.max(0, old.total - hashes.length) } : old)} source={source} remote={items} selectedRemote={selected} setSelectedRemote={setSelected} copy={copy} download={download} working={working} scope={scope} active={open} />
    </section>;
}
