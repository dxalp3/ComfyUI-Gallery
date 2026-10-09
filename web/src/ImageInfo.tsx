/**
 * One metadata window for every image (local, Hydrus, or both) and the small "Use for prefix" flow.
 *
 * Local only    → generation metadata (prompt, workflow, picks)
 * Hydrus only   → Hydrus metadata (tags, notes, ratings), plus the picks found in its generation note
 * Both          → the two as tabs of the same window
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Empty, Input, Select, Space, Tabs, Tag, Typography, message } from 'antd';
import { FloatingPanel } from './FloatingPanel';
import { BASE_PATH, BASE_Z_INDEX } from './ComfyAppApi';
import { useHydrus } from './HydrusContext';
import { hydrusStatus, type HydrusItem } from './HydrusApi';
import { useGalleryContext } from './GalleryContext';
import { MetadataView } from './MetadataView';
import { AppendImagesModal } from './AppendImagesModal';
import { associateImages, dissociateImages, expandPrefix, imagePrefixKeys, imagePrefixRefs, loadPrefixes, openPrefixManager, savePrefix, sidesLabel, type PrefixImage, type SharedLibrary } from './PrefixLibrary';
import { PrefixImages } from './PrefixImages';
import { formatPromptTerms } from './PromptSpelling';
import { HydrusTagSelect } from './HydrusTagSelect';
import { extractHydrusTags, extractLocalPrompts } from './LocalImageSearch';
import { chosenTags, promptResolutions } from './PromptResolution';
import { GROUPING_LABELS } from './PromptBoxes';
import { promptTags } from './PromptTags';
import type { GalleryEntry } from './GalleryOrder';
import { openImageSearch } from './TagSearchPanel';
import type { RemoteImage } from './HydrusBrowser';

export const IMAGE_INFO_EVENT = 'gallery-image-info';
export const SOURCE_PREFIX_EVENT = 'gallery-source-prefix';
type InfoRequest = { url?: string; remote?: RemoteImage; tab?: 'generation' | 'hydrus' };
/** Open the metadata window for a local file (`url`) or a Hydrus-only file (`remote`). */
export const openImageInfo = (request: InfoRequest) => window.dispatchEvent(new CustomEvent(IMAGE_INFO_EVENT, { detail: request }));
/** Open the "Use for prefix" flow for gallery entries, or for local files by URL. */
export const openSourcePrefix = (entries: GalleryEntry[] | string[]) => window.dispatchEvent(new CustomEvent(SOURCE_PREFIX_EVENT, { detail: entries }));
export const localEntry = (file: GalleryEntry['local'] & object, hash?: string): GalleryEntry => ({ id: 'local:' + file.url, source: 'local', name: file.name, local: file, hash });

const formatTime = (value?: string) => value ? new Date(value).toLocaleString() : 'Never';
const boolLabel = (value: unknown, yes = 'Yes', no = 'No') => typeof value === 'boolean' ? value ? yes : no : 'Unknown';

/** Which option of every {a|b} group the image was made with. */
export function PromptPicks({ metadata }: { metadata: unknown }) {
    const resolutions = useMemo(() => promptResolutions(metadata), [metadata]);
    if (!resolutions.length) return null;
    return <div style={{ margin: '8px 0 12px' }}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>Picked options</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 6 }}>Only the picked options become prompt tags (Hydrus export, local search). The full prompt stays in the metadata.</Typography.Paragraph>
        {resolutions.map(item => <div key={item.id} style={{ marginBottom: 8 }}>
            {resolutions.length > 1 && <Typography.Text strong>{item.title} #{item.id}</Typography.Text>}
            {item.choices.length ? item.choices.map((choice, index) => <div key={index} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', margin: '3px 0' }}>
                <Tag>{GROUPING_LABELS[choice.kind].name}</Tag>
                {choice.options.map(option => <Tag key={option} color={option === choice.chosen ? 'green' : undefined} style={{ opacity: option === choice.chosen ? 1 : .55, textDecoration: option === choice.chosen ? undefined : 'line-through' }}>{option}</Tag>)}
                {!chosenTags(choice).length && <Typography.Text type="secondary">→ nothing</Typography.Text>}
            </div>) : <Typography.Text type="secondary">The picks could not be matched to the prompt (it was edited after the run).</Typography.Text>}
        </div>)}
    </div>;
}

function HydrusDetailsBody({ metadata, item }: { metadata: Record<string, any>; item?: HydrusItem }) {
    const services = metadata.services_v2 || {};
    const serviceName = (key: string) => {
        const service = Array.isArray(services) ? services.find((value: any) => value.service_key === key) : services[key];
        return service?.name || key;
    };
    const tagEntries = Object.entries(metadata.tags || {}) as [string, any][];
    const ratings = Object.entries(metadata.ratings || {});
    const notes = Object.entries(metadata.notes || {});
    const presence = item?.status === 'missing' ? 'Not found locally in this client' : item?.status === 'deleted' ? 'Deleted or in Hydrus trash' : metadata.is_trashed ? 'In Hydrus trash' : metadata.is_local ? 'Local in this Hydrus client' :
        metadata.is_deleted ? 'Deleted from Hydrus' : metadata.is_local === false ? 'Known to Hydrus; not stored locally' : 'Not checked';
    return <>
        <Descriptions size="small" bordered column={1} items={[
            { key: 'presence', label: 'Last known presence', children: presence },
            ...(item ? [{ key: 'exported', label: 'Previously imported or found', children: item.exported ? 'Yes' : 'No confirmation recorded' },
                { key: 'exported_at', label: 'Last export', children: formatTime(item.last_exported_at) },
                { key: 'checked_at', label: 'Last checked', children: formatTime(item.last_checked_at) },
                { key: 'snapshot_at', label: 'Metadata snapshot saved', children: formatTime(item.metadata_checked_at || item.last_checked_at) }] : []),
            { key: 'hash', label: 'SHA-256', children: item?.hash || metadata.hash ? <Typography.Text copyable style={{ wordBreak: 'break-all' }}>{item?.hash || metadata.hash}</Typography.Text> : 'Not calculated yet' },
            { key: 'inbox', label: 'Inbox / archive', children: boolLabel(metadata.is_inbox, 'Inbox', 'Archived') },
            { key: 'trash', label: 'In trash', children: boolLabel(metadata.is_trashed) },
            { key: 'deleted', label: 'Deleted', children: item?.status === 'deleted' ? 'Yes' : boolLabel(metadata.is_deleted) },
            { key: 'file', label: 'Hydrus file ID', children: metadata.file_id ?? 'Unknown' },
        ]} />
        <Typography.Title level={5}>Tags by service</Typography.Title>
        {tagEntries.length === 0 ? <Typography.Paragraph type="secondary">No tag metadata cached.</Typography.Paragraph> : tagEntries.map(([key, value]) => {
            const statuses = value.display_tags || value.storage_tags || {};
            return <div key={key} style={{ marginBottom: 12 }}><Typography.Text strong>{value.name || serviceName(key)}</Typography.Text>
                {Object.entries(statuses).map(([status, tags]) => <div key={status} style={{ marginTop: 6 }}>
                    <Typography.Text type="secondary" style={{ marginRight: 8 }}>{({ '0': 'Current', '1': 'Deleted', '2': 'Pending', '3': 'Petitioned' } as Record<string, string>)[status] || status}:</Typography.Text>
                    {Array.isArray(tags) && tags.length ? tags.map((tag: string) => <Tag key={tag} style={{ marginBottom: 4 }}>{tag}</Tag>) : 'None'}
                </div>)}
            </div>;
        })}
        <Typography.Title level={5}>Ratings</Typography.Title>
        {ratings.length ? <Descriptions size="small" column={1} items={ratings.map(([key, value]) => ({ key, label: serviceName(key), children: value === null ? 'Unrated' : String(value) }))} /> : <Typography.Paragraph type="secondary">No ratings cached.</Typography.Paragraph>}
        {notes.length > 0 && <Collapse style={{ marginTop: 12 }} items={notes.map(([key, value]) => ({ key, label: `Note: ${key}`, children: <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(value)}</pre> }))} />}
        <Collapse style={{ marginTop: 16 }} items={[{ key: 'raw', label: 'Raw cached Hydrus metadata', children: Object.keys(metadata).length ?
            <pre style={{ maxHeight: 350, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(metadata, null, 2)}</pre> : <Empty description="Refresh or export this image to record metadata." /> }]} />
    </>;
}

/** The metadata window (replaces the separate "Hydrus metadata" and "View metadata" windows). */
export function ImageInfoPanel() {
    const { detailsUrl, setDetailsUrl, imageFiles, items, refresh, requestExport } = useHydrus();
    const [request, setRequest] = useState<InfoRequest>();
    const [tab, setTab] = useState<'generation' | 'hydrus'>('generation');
    const [raw, setRaw] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    // Existing callers open it through setDetailsUrl (the Hydrus badge, older menus) — that means the Hydrus tab.
    useEffect(() => { if (detailsUrl) { setRequest({ url: detailsUrl, tab: 'hydrus' }); setTab('hydrus'); } }, [detailsUrl]);
    useEffect(() => {
        const open = (event: Event) => { const detail = (event as CustomEvent<InfoRequest>).detail || {}; setRequest(detail); setTab(detail.tab || (detail.url ? 'generation' : 'hydrus')); setError(''); setRaw(false); };
        window.addEventListener(IMAGE_INFO_EVENT, open);
        return () => window.removeEventListener(IMAGE_INFO_EVENT, open);
    }, []);
    const close = () => { setRequest(undefined); setDetailsUrl(undefined); };
    const url = request?.url;
    const file = url ? imageFiles[url] : undefined;
    const item = url ? items[url] : undefined;
    const hydrusMetadata: Record<string, any> = request?.remote || item?.metadata || {};
    const hasHydrus = !!request?.remote || !!item?.hash || !!item?.exported || Object.keys(item?.metadata || {}).length > 0;
    const hasLocal = !!file;
    const badge = hydrusStatus(item);
    const metadata = file ? { ...file.metadata, hydrus: item?.metadata || (file.metadata as any)?.hydrus } : { hydrus: request?.remote };
    const entry: GalleryEntry | undefined = file ? localEntry(file, item?.hash) : request?.remote ? { id: 'hydrus:' + request.remote.hash, source: 'hydrus', name: '#' + request.remote.file_id, remote: request.remote, hash: request.remote.hash } : undefined;
    const refreshOne = async () => {
        if (!url) return;
        setBusy(true); setError('');
        try { const response = await refresh([url]); if (response[0]?.error) setError(response[0].error); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setBusy(false); }
    };
    const hydrusTab = <>
        {url && <Alert showIcon type={item?.error || error ? 'warning' : 'info'} style={{ marginBottom: 16 }} message={error || item?.error || 'Saved metadata snapshot'}
            description="This snapshot survives ComfyUI restarts and can be viewed while Hydrus is offline. Use Refresh from Hydrus to check changes made in the client." />}
        {!hasLocal && <PromptPicks metadata={metadata} />}
        <HydrusDetailsBody metadata={hydrusMetadata} item={item} />
    </>;
    const generationTab = file && <>
        <PromptPicks metadata={metadata} />
        <MetadataView image={file} onShowRaw={() => setRaw(true)} showRawMetadata={raw} setShowRawMetadata={setRaw} />
    </>;
    const open = !!request && (hasLocal || hasHydrus);
    return <FloatingPanel panelKey="image-metadata" title={'Metadata · ' + (file?.name || entry?.name || '')} open={open} zIndex={BASE_Z_INDEX + 20} width={hasLocal ? '85vw' : 780}
        onCancel={close} footer={<Space wrap>
            <Button onClick={close}>Close</Button>
            {entry && <Button onClick={() => openSourcePrefix([entry])}>Use for prefix…</Button>}
            {file && <Button onClick={() => openImageSearch({ chips: [{ kind: 'image', url: file.url, name: file.name }] })}>Search by image</Button>}
            {url && <Button loading={busy} onClick={refreshOne}>Refresh from Hydrus</Button>}
            {url && <Button type="primary" disabled={busy} onClick={() => { requestExport([url]); close(); }}>Export to Hydrus</Button>}
        </Space>}>
        <Space style={{ marginBottom: 8 }}>{url && <Tag color={badge.color}>{badge.label}</Tag>}<Typography.Text strong>{file?.name || entry?.name}</Typography.Text></Space>
        {hasLocal && hasHydrus
            ? <Tabs activeKey={tab} onChange={value => setTab(value as 'generation' | 'hydrus')} items={[{ key: 'generation', label: 'Generation', children: generationTab }, { key: 'hydrus', label: 'Hydrus', children: hydrusTab }]} />
            : hasLocal ? generationTab : hydrusTab}
    </FloatingPanel>;
}
/** Kept for the existing import in GalleryModal. */
export const HydrusDetailsModal = ImageInfoPanel;

/**
 * "Use for prefix": make or change a prefix right here, from an image. The image's own tags are a fixed list
 * of chips (they cannot be deleted, only taken into the prefix and back out); the prefix's tags are edited
 * next to them, with its paired images below. Saving pairs the image(s); "Pair only" pairs without changes.
 */
export function SourcePrefixPanel() {
    const gallery = useGalleryContext();
    const hydrus = useHydrus();
    const hydrusRef = useRef(hydrus); hydrusRef.current = hydrus;
    const [entries, setEntries] = useState<GalleryEntry[]>([]);
    const [library, setLibrary] = useState<SharedLibrary>({ version: 2, tags: [], prefixes: [] });
    const [prefixId, setPrefixId] = useState<string>();
    const [name, setName] = useState('');
    const [positive, setPositive] = useState<string[]>([]);
    const [negative, setNegative] = useState<string[]>([]);
    const [side, setSide] = useState<'positive' | 'negative'>('positive');
    const [appending, setAppending] = useState<GalleryEntry[]>([]);
    const [busy, setBusy] = useState(false);
    const root = gallery.settings.relativePath;
    const reload = () => loadPrefixes().then(value => { setLibrary(value); return value; }).catch(reason => { message.error(String(reason)); return undefined; });
    useEffect(() => {
        const open = (event: Event) => {
            const detail = (event as CustomEvent<GalleryEntry[] | string[]>).detail || [];
            const files = hydrusRef.current.imageFiles, items = hydrusRef.current.items;
            setEntries(detail.flatMap(value => typeof value !== 'string' ? [value] : files[value] ? [localEntry(files[value], items[value]?.hash)] : []));
            setPrefixId(undefined); setName(''); setSide('positive'); void reload();
        };
        window.addEventListener(SOURCE_PREFIX_EVENT, open);
        window.addEventListener('gallery-prefix-library-changed', reload);
        return () => { window.removeEventListener(SOURCE_PREFIX_EVENT, open); window.removeEventListener('gallery-prefix-library-changed', reload); };
    }, []);
    const metadataOf = (entry: GalleryEntry) => entry.local ? { ...entry.local.metadata, hydrus: hydrus.items[entry.local.url]?.metadata || (entry.local.metadata as any)?.hydrus } : { hydrus: entry.remote };
    const tags = useMemo(() => {
        const sets = { positive: new Set<string>(), negative: new Set<string>(), hydrus: new Set<string>() };
        for (const entry of entries) {
            const metadata = metadataOf(entry), prompts = extractLocalPrompts(metadata);
            promptTags(prompts.positive, '').forEach(tag => sets.positive.add(tag));
            promptTags(prompts.negative, '').forEach(tag => sets.negative.add(tag));
            extractHydrusTags(metadata).forEach(tag => sets.hydrus.add(tag));
        }
        return { positive: [...sets.positive], negative: [...sets.negative], hydrus: [...sets.hydrus] };
    }, [entries, hydrus.items]);
    const prefix = library.prefixes.find(item => item.id === prefixId);
    // An existing prefix starts with its own tags; a new one with the image's positive prompt.
    useEffect(() => {
        if (prefix) { setName(prefix.name); setPositive(expandPrefix(library, '@' + prefix.name)); setNegative(prefix.negative_terms || []); }
        else { setPositive(tags.positive); setNegative([]); }
    }, [prefixId, entries]);
    const keys = entries.flatMap(entry => imagePrefixKeys(entry, root));
    const refs = Object.assign({}, ...entries.map(entry => imagePrefixRefs(entry, root)));
    const pairedWith = [...new Set(keys.map(key => library.associations?.[key]?.prefix_id).filter(Boolean))] as string[];
    const close = () => setEntries([]);
    const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } catch (reason) { message.error(String(reason)); } finally { setBusy(false); } };
    const pair = () => run(async () => { if (!prefix) return; await associateImages(prefix.id, keys, refs, library.revision); message.success(`Paired ${entries.length} image(s) with “${prefix.name}”`); await reload(); });
    const unpair = (id: string) => run(async () => { await dissociateImages(keys.filter(key => library.associations?.[key]?.prefix_id === id), library.revision); await reload(); });
    const unpairImage = (image: PrefixImage) => run(async () => { await dissociateImages(image.keys || [], library.revision); await reload(); });
    const save = () => run(async () => {
        const label = (prefix?.name || name).trim();
        if (!label) throw new Error('Name the new prefix first.');
        // Spelling (spaces or canonical underscores) follows the gallery settings, as in the prefix editor.
        const terms = positive.length ? await formatPromptTerms(positive) : [], negativeTerms = negative.length ? await formatPromptTerms(negative) : [];
        message.success(await savePrefix(label, terms, library.revision, keys, negativeTerms, refs));
        const fresh = await reload();
        setPrefixId(fresh?.prefixes.find(item => item.name.toLowerCase() === label.toLowerCase())?.id);
    });
    const thumb = (entry: GalleryEntry) => entry.local ? `${BASE_PATH}/Gallery/thumbnail?url=${encodeURIComponent(entry.local.url)}&v=${entry.local.timestamp || 0}&root=${encodeURIComponent(root)}` : `${BASE_PATH}/Gallery/hydrus/thumbnail?hash=${entry.hash}&target=${encodeURIComponent(`${hydrus.settings?.url}|${hydrus.settings?.profile}`)}`;
    const value = side === 'positive' ? positive : negative, setValue = side === 'positive' ? setPositive : setNegative;
    const has = (tag: string) => value.some(item => item.toLowerCase() === tag.toLowerCase());
    /** The image's tags of one kind: click takes a tag into the prefix (or back out). They are never deleted here. */
    const imageTags = (key: 'positive' | 'negative' | 'hydrus', label: string): React.ReactNode => !!tags[key].length && <div style={{ marginBottom: 8 }}>
        <Space size={4}><Typography.Text strong>{label}</Typography.Text><Typography.Text type="secondary">({tags[key].filter(has).length}/{tags[key].length} in the prefix)</Typography.Text>
            <Button size="small" type="link" disabled={tags[key].every(has)} onClick={() => setValue(old => [...old, ...tags[key].filter(tag => !old.some(item => item.toLowerCase() === tag.toLowerCase()))])}>add all →</Button></Space>
        <div role="list" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 150, overflowY: 'auto' }}>
            {tags[key].map(tag => { const inside = has(tag); return <Tag key={tag} role="listitem" color={inside ? 'blue' : undefined} title={inside ? 'In the prefix · click to take it back out' : 'Click to add to the prefix'}
                onClick={() => setValue(old => inside ? old.filter(item => item.toLowerCase() !== tag.toLowerCase()) : [...old, tag])}
                style={{ cursor: 'pointer', margin: 0, opacity: inside ? .6 : 1, userSelect: 'none' }}>{inside ? '✓ ' : '+ '}{tag}</Tag>; })}
        </div>
    </div>;
    const total = positive.length + negative.length;
    return <>
        <FloatingPanel panelKey="source-prefix" title={'Use for prefix · ' + entries.length + ' image' + (entries.length === 1 ? '' : 's')} open={entries.length > 0} onCancel={close} width={980} zIndex={BASE_Z_INDEX + 30}
            footer={<Space wrap>
                <Button onClick={close}>Close</Button>
                <Button onClick={() => { setAppending(entries); close(); }}>Append images and prompts…</Button>
                <Button disabled={!prefix || busy} onClick={() => void pair()} title="Pair the image(s) with this prefix without changing its tags">Pair only</Button>
                <Button type="link" onClick={() => { openPrefixManager({ name: prefix?.name || name, positive, negative, imageKeys: keys, imageRefs: refs }); close(); }}>Full prefix editor…</Button>
                <Button type="primary" loading={busy} disabled={!total || !(prefix || name.trim())} onClick={() => void save()}>{prefix ? `Save “${prefix.name}” and pair` : `Create prefix with ${total} tag(s)`}</Button>
            </Space>}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>{entries.slice(0, 8).map(entry => <img key={entry.id} src={thumb(entry)} alt={entry.name} style={{ width: 84, height: 84, objectFit: 'contain', background: '#8882', borderRadius: 4 }} />)}{entries.length > 8 && <Typography.Text type="secondary">+{entries.length - 8}</Typography.Text>}</div>
            {!!pairedWith.length && <div style={{ marginBottom: 8 }}><Typography.Text>Paired with: </Typography.Text>{pairedWith.map(id => <Tag key={id} closable onClose={event => { event.preventDefault(); void unpair(id); }}>{library.prefixes.find(item => item.id === id)?.name || 'deleted prefix'}</Tag>)}</div>}
            <Space.Compact style={{ width: '100%' }}>
                <Select showSearch allowClear optionFilterProp="label" aria-label="Prefix for these images" placeholder="New prefix (or pick an existing one)" value={prefixId} onChange={setPrefixId} style={{ flex: 1 }}
                    options={library.prefixes.map(item => ({ value: item.id, label: item.name + ' · ' + sidesLabel(item) }))} />
                {!prefix && <Input aria-label="New prefix name" placeholder="Name of the new prefix" value={name} onChange={event => setName(event.target.value)} style={{ flex: 1 }} />}
            </Space.Compact>
            <Typography.Paragraph type="secondary" style={{ margin: '6px 0 4px' }}>{prefix ? 'Editing “' + prefix.name + '”: its tags are on the right. Saving changes them and pairs the image(s); “Pair only” pairs without changing anything.' : 'A new prefix starts with the image’s positive prompt. Saving creates it and pairs the image(s).'} Tag spelling follows Settings.</Typography.Paragraph>
            <Tabs size="small" activeKey={side} onChange={key => setSide(key as 'positive' | 'negative')} items={(['positive', 'negative'] as const).map(key => ({ key, label: `${key === 'positive' ? 'Positive' : 'Negative'} (${(key === 'positive' ? positive : negative).length})` }))} />
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 340px', minWidth: 0 }}>
                    <Typography.Title level={5} style={{ marginTop: 0 }}>From the image{entries.length === 1 ? '' : 's'}</Typography.Title>
                    {side === 'positive' ? <>{imageTags('positive', 'Positive prompt')}{imageTags('hydrus', 'Hydrus tags')}</> : imageTags('negative', 'Negative prompt')}
                    {!tags[side === 'positive' ? 'positive' : 'negative'].length && !(side === 'positive' && tags.hydrus.length) && <Typography.Text type="secondary">No {side} tags found on the image{entries.length === 1 ? '' : 's'}.</Typography.Text>}
                </div>
                <div style={{ flex: '1 1 340px', minWidth: 0 }}>
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}><Typography.Title level={5} style={{ margin: 0 }}>Prefix {side} tags</Typography.Title><Button size="small" disabled={!value.length} onClick={() => setValue([])}>Clear</Button></Space>
                    <HydrusTagSelect label={'Prefix ' + side + ' tags'} value={value} onChange={setValue} active={entries.length > 0} placeholder="Any other tag: Danbooru, Hydrus, your library, or @prefix" style={{ width: '100%', marginTop: 6 }} />
                    {prefix && <PrefixImages library={library} prefixId={prefix.id} onRemove={image => void unpairImage(image)} />}
                </div>
            </div>
        </FloatingPanel>
        <AppendImagesModal entries={appending} onClose={() => setAppending([])} />
    </>;
}
