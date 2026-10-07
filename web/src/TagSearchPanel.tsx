import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Alert, Button, Checkbox, Dropdown, Select, Space, Tabs, Tag, Typography, message } from 'antd';
import { FloatingPanel } from './FloatingPanel';
import { useGalleryContext } from './GalleryContext';
import { useHydrus } from './HydrusContext';
import { BASE_PATH } from './ComfyAppApi';
import { hydrusRequest } from './HydrusApi';
import { appendLocalImages } from './ImageSourceBridge';
import { extractLocalPrompts, matchesLocalImage, type LocalPrompts, type LocalSearchField } from './LocalImageSearch';
import { ancestorLevels, hashLookup, hasAllTerms, imagePrefixIds, imageTagSet, lineageTree, madeFrom, pairedHashIndex, pairedImages, requiredTerms, type LineageTree } from './PrefixLineage';
import { associateImages, expandPrefix, imagePrefixKeys, imagePrefixRefs, loadPrefixes, type SharedLibrary } from './PrefixLibrary';
import { openImageInfo, openSourcePrefix, localEntry } from './ImageInfo';
import { useSearchPool } from './SearchPool';
import type { FileDetails } from './types';

/**
 * Image search: one window for "Find images" (from a prefix), "Search by image" and tag search.
 *
 * The query is a row of chips, stacked in any order:
 *   tag      typed or suggested (prompt phrases, Hydrus tags, library); filters every result
 *   @prefix  Sources: its paired images and the images later used as a source for it
 *            Generated: everything made from those, grouped by the image it was made from
 *   image    Lineage: the image and what it was made from, back to the original
 *            Generated from it / Same source (other images made from the same source) / Same prefix
 * Images can be dragged into the query from the gallery or from the results.
 */
export type QueryChip = { kind: 'tag'; text: string } | { kind: 'prefix'; id: string; name: string } | { kind: 'image'; url: string; name: string };
/** A prefix a search was started from ("Find images" in the prefix editor). */
export type SearchPrefix = { id?: string; name: string; terms: string[] };
/** `append` adds the chips to an open search instead of starting a new one. */
export type ImageSearchRequest = { chips: QueryChip[]; field?: LocalSearchField; append?: boolean };
export const IMAGE_SEARCH_EVENT = 'gallery-image-search';
export const OPEN_VIEWER_EVENT = 'gallery-open-viewer';
export const openImageSearch = (request: ImageSearchRequest) => window.dispatchEvent(new CustomEvent(IMAGE_SEARCH_EVENT, { detail: request }));
export const IMAGE_DRAG_TYPE = 'application/x-gallery-image';

/** A gallery image dropped from the gallery grid, the classic grid or this window. */
export function droppedImage(event: DragEvent): { url: string; name: string } | undefined {
    try { const value = JSON.parse(event.dataTransfer.getData(IMAGE_DRAG_TYPE) || event.dataTransfer.getData('custom') || 'null'); if (value?.url?.startsWith('/static_gallery/')) return { url: value.url, name: value.name || value.url.split('/').pop() }; } catch { /* not ours */ }
    const uri = event.dataTransfer.getData('text/uri-list').split('\n')[0]?.trim();
    if (!uri) return undefined;
    const path = decodeURI(uri.replace(location.origin, '').replace(BASE_PATH, ''));
    return path.startsWith('/static_gallery/') ? { url: path, name: path.split('/').pop() || path } : undefined;
}

const PAGE = 120;
const encode = (chip: QueryChip) => chip.kind === 'tag' ? chip.text : chip.kind === 'prefix' ? 'prefix::' + chip.id : 'image::' + chip.url;

export async function fetchLocalHashes(urls: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (let start = 0; start < urls.length; start += 2000) {
        const response = await fetch(BASE_PATH + '/Gallery/source/hashes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: urls.slice(start, start + 2000) }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not hash local images');
        Object.assign(result, data.hashes);
    }
    return result;
}

type Hit = { file: FileDetails; note?: string; color?: string };
type Section = { title?: string; hits: Hit[] };
type Input = { input_name: string; title?: string; note: string; original?: boolean };
type ResultTab = { key: string; label: string; hint: string; sections: Section[]; inputs?: Input[]; derived?: { prefixId: string; prefixName: string; urls: string[] } };

export function ImageSearchPanel() {
    const gallery = useGalleryContext();
    const hydrus = useHydrus();
    const [open, setOpen] = useState(false);
    const [chips, setChips] = useState<QueryChip[]>([]);
    const [field, setField] = useState<LocalSearchField>('all');
    const [tab, setTab] = useState('');
    const [strict, setStrict] = useState(false);
    const [library, setLibrary] = useState<SharedLibrary>({ version: 2, tags: [], prefixes: [] });
    const [tabs, setTabs] = useState<ResultTab[]>([]);
    const [aliases, setAliases] = useState<string[][]>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [typed, setTyped] = useState('');
    const [shown, setShown] = useState(PAGE);
    const [dropping, setDropping] = useState(false);
    const [revision, setRevision] = useState(0);
    const cache = useRef(new WeakMap<object, LocalPrompts>());
    const openRef = useRef(open); openRef.current = open;
    const root = gallery.settings.relativePath;
    useEffect(() => {
        const show = (event: Event) => {
            const request = (event as CustomEvent<ImageSearchRequest>).detail;
            if (request.append && openRef.current) setChips(old => [...old, ...request.chips.filter(chip => !old.some(item => encode(item) === encode(chip)))]);
            else { setChips(request.chips); setField(request.field || 'all'); setTab(''); }
            setOpen(true);
        };
        const reload = () => { void loadPrefixes().then(setLibrary).catch(() => undefined); setRevision(value => value + 1); };
        void loadPrefixes().then(setLibrary).catch(() => undefined);
        window.addEventListener(IMAGE_SEARCH_EVENT, show);
        window.addEventListener('gallery-prefix-library-changed', reload);
        return () => { window.removeEventListener(IMAGE_SEARCH_EVENT, show); window.removeEventListener('gallery-prefix-library-changed', reload); };
    }, []);
    const pool = useSearchPool(open ? gallery.data?.folders : undefined, gallery.localHydrusTags);
    const files = useMemo(() => Object.values(gallery.data?.folders || {}).flatMap(folder => Object.values(folder)).filter(file => file.type === 'image'), [gallery.data]);
    const byUrl = useMemo(() => new Map(files.map(file => [file.url, file])), [files]);
    const prefixes = chips.filter(chip => chip.kind === 'prefix') as Extract<QueryChip, { kind: 'prefix' }>[];
    const images = chips.filter(chip => chip.kind === 'image') as Extract<QueryChip, { kind: 'image' }>[];
    const tags = chips.filter(chip => chip.kind === 'tag').map(chip => (chip as Extract<QueryChip, { kind: 'tag' }>).text);
    const scoped = prefixes.length > 0 || images.length > 0;
    const scopeKey = JSON.stringify([prefixes.map(chip => chip.id), images.map(chip => chip.url)]);
    useEffect(() => { setShown(PAGE); }, [scopeKey, tags.join('\n'), field, tab, strict]);

    // Build the result tabs for the prefix and image chips.
    useEffect(() => {
        if (!open || !scoped) { setTabs([]); return; }
        let live = true;
        setBusy(true); setError('');
        void (async () => {
            try {
                const shared = await loadPrefixes();
                const known = Object.fromEntries(Object.entries(hydrus.items).map(([url, item]) => [url, item.hash]));
                const hashOf = hashLookup(fetchLocalHashes, known);
                const many = prefixes.length + images.length > 1;
                const result = new Map<string, ResultTab>();
                const tabFor = (key: string, label: string, hint: string) => { if (!result.has(key)) result.set(key, { key, label, hint, sections: [] }); return result.get(key)!; };
                const hit = (url: string, note?: string, color?: string): Hit[] => { const file = byUrl.get(url); return file ? [{ file, note, color }] : []; };
                // Name an image by its hash: a local file, a paired Hydrus image, or an input copy title.
                const inputTitles = new Map<string, string>();
                const nameOf = (tree: LineageTree, hash: string) => { const url = tree.hashToUrl.get(hash); return url ? byUrl.get(url)?.name || url : inputTitles.get(hash) || 'image ' + hash.slice(0, 8); };
                /** Generated images grouped by the image each was made from. */
                const bySource = (tree: LineageTree, skip: Set<string>, unlinked: string) => {
                    const groups = new Map<string, Hit[]>();
                    for (const [url, node] of tree.nodes) {
                        if (skip.has(url)) continue;
                        const file = byUrl.get(url); if (!file) continue;
                        madeFrom(file.metadata).forEach(input => { if (input.hash && input.title) inputTitles.set(input.hash, input.title); });
                        const key = node.parents[0] || '';
                        if (!groups.has(key)) groups.set(key, []);
                        groups.get(key)!.push({ file, note: tree.usedAsSource.has(url) ? 'used as source' : node.depth > 1 ? 'generation ' + node.depth : undefined, color: tree.usedAsSource.has(url) ? 'green' : 'blue' });
                    }
                    return [...groups].map(([hash, hits]) => ({ title: hash ? 'Made from ' + nameOf(tree, hash) : unlinked, hits: hits.sort((a, b) => (b.file.timestamp || 0) - (a.file.timestamp || 0)) }))
                        .sort((a, b) => b.hits.length - a.hits.length);
                };
                const pairedHashes = images.length ? await pairedHashIndex(shared, hashOf) : new Map<string, Set<string>>();
                const listed = new Set<string>();
                // --- prefix chips ---
                for (const chip of prefixes) {
                    const tag = many ? '@' + chip.name + ' · ' : '';
                    const paired = await pairedImages(files, shared, chip.id, hashOf, known);
                    const seedUrls = await hashOf([...paired.urls]);
                    const tree = await lineageTree(files, paired.hashes, [chip.id], hashOf, paired.urls, 6, seedUrls);
                    const derived = [...tree.usedAsSource];
                    const sources = tabFor('sources', 'Sources', 'Images paired with the prefix, and generated images that were later used as a source (reiterations). Pair those with the prefix so they count as its sources everywhere.');
                    sources.sections.push({ title: tag + 'Paired' + (paired.remoteOnly ? ` (${paired.remoteOnly} more only in Hydrus)` : ''), hits: [...paired.urls].flatMap(url => hit(url, 'paired', 'gold')) });
                    if (derived.length) { sources.sections.push({ title: tag + 'Used as a source later', hits: derived.flatMap(url => hit(url, 'generation ' + tree.nodes.get(url)!.depth, 'green')) }); sources.derived = { prefixId: chip.id, prefixName: chip.name, urls: derived }; }
                    tabFor('generated', 'Generated', 'Everything made from the sources through Gallery Image Source (any number of generations, whatever the prompt), grouped by the image it was made from.')
                        .sections.push(...bySource(tree, new Set(), 'Appended under @' + chip.name).map(section => ({ ...section, title: tag + section.title })));
                    paired.urls.forEach(url => listed.add(url)); tree.nodes.forEach((_, url) => listed.add(url));
                }
                // --- image chips ---
                for (const chip of images) {
                    const file = byUrl.get(chip.url);
                    const tag = many ? chip.name + ' · ' : '';
                    const lineage = tabFor('lineage', 'Lineage', 'The searched image and what it was made from, back to the original.');
                    lineage.sections.push({ title: tag + 'Searched image', hits: hit(chip.url, 'searched', 'purple') });
                    if (!file) continue;
                    const levels = ancestorLevels(file.metadata);
                    lineage.inputs = [...(lineage.inputs || []), ...levels.map(level => ({ input_name: level.input_name, title: level.title, note: level.original ? 'original' : level.depth === 1 ? 'made from' : 'source ' + level.depth + ' back', original: level.original }))];
                    const own = Object.values(await hashOf([chip.url]));
                    const fromIt = await lineageTree(files, own, [], hashOf, new Set([chip.url]), 6, Object.fromEntries(own.map(hash => [chip.url, hash])));
                    tabFor('generated', 'Generated from it', 'Images made from the searched image, grouped by the image they were made from.').sections.push(...bySource(fromIt, new Set(), 'Made from it').map(section => ({ ...section, title: tag + section.title })));
                    // Other images made from the same source image(s) as this one, and what came from those.
                    const direct = madeFrom(file.metadata).flatMap(input => input.hash ? [input.hash] : []);
                    madeFrom(file.metadata).forEach(input => { if (input.hash && input.title) inputTitles.set(input.hash, input.title); });
                    const skip = new Set([chip.url, ...fromIt.nodes.keys()]);
                    const siblings = direct.length ? await lineageTree(files, direct, [], hashOf, skip) : undefined;
                    const sameSource = tabFor('source', 'Same source', 'Other images made from the same source image as the searched one (and what was made from those).');
                    if (siblings) sameSource.sections.push(...bySource(siblings, skip, '').map(section => ({ ...section, title: tag + section.title })));
                    // Images of the prefixes it belongs to that are not in the tabs above.
                    const seen = new Set([...skip, ...(siblings?.nodes.keys() || [])]);
                    for (const id of imagePrefixIds(shared, imagePrefixKeys(localEntry(file, known[file.url]), root), file.metadata, pairedHashes)) {
                        const name = shared.prefixes.find(prefix => prefix.id === id)?.name || 'prefix';
                        const paired = await pairedImages(files, shared, id, hashOf, known);
                        const tree = await lineageTree(files, paired.hashes, [id], hashOf, paired.urls);
                        const hits = [...[...paired.urls].flatMap(url => seen.has(url) ? [] : hit(url, 'paired', 'gold')), ...[...tree.nodes.keys()].flatMap(url => seen.has(url) ? [] : hit(url, 'generated', 'blue'))];
                        tabFor('prefix', 'Same prefix', 'Images of the prefixes the searched image belongs to (by pairing or by descent) that are not in the other tabs.').sections.push({ title: tag + '@' + name, hits });
                    }
                }
                const terms = requiredTerms(prefixes.flatMap(chip => expandPrefix(shared, '@' + chip.name)));
                const spellings = strict && terms.length ? (await hydrusRequest<{ aliases: string[][] }>('aliases', { terms }).catch(() => ({ aliases: terms.map(term => [term]) }))).aliases : undefined;
                if (!live) return;
                // Tabs that add nothing (no images) are hidden; Lineage always shows.
                const order = ['lineage', 'sources', 'generated', 'source', 'prefix'];
                const list = order.flatMap(key => result.get(key) ? [result.get(key)!] : []).filter(item => item.key === 'lineage' || item.key === 'sources' || item.sections.some(section => section.hits.length));
                setLibrary(shared); setAliases(spellings); setTabs(list);
                setTab(current => list.some(item => item.key === current) ? current : (list.find(item => item.key === 'generated') || list.find(item => item.key === 'source') || list[0])?.key || '');
            } catch (reason) { if (live) setError(String(reason)); }
            finally { if (live) setBusy(false); }
        })();
        return () => { live = false; };
    }, [open, scopeKey, strict, files, hydrus.items, revision]);

    const promptsOf = (file: FileDetails) => {
        const metadata = file.metadata;
        if (!metadata || typeof metadata !== 'object') return extractLocalPrompts(metadata);
        let prompts = cache.current.get(metadata);
        if (!prompts) { prompts = extractLocalPrompts(metadata); cache.current.set(metadata, prompts); }
        return prompts;
    };
    const matchesTags = (file: FileDetails) => !tags.length || tags.every(term => matchesLocalImage(file, term, field, gallery.localHydrusTags[file.url] || [], promptsOf(file)));
    const keep = (hits: Hit[]) => hits.filter(item => matchesTags(item.file) && (!strict || !aliases || hasAllTerms(imageTagSet(item.file, gallery.localHydrusTags[item.file.url] || []), aliases)));
    const tagOnly = useMemo<Hit[]>(() => open && !scoped && tags.length ? files.filter(matchesTags).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).map(file => ({ file })) : [], [open, scoped, tags.join('\n'), field, files, gallery.localHydrusTags]);
    const shownTabs = tabs.map(item => ({ ...item, sections: item.sections.map(section => ({ ...section, hits: keep(section.hits) })) }));
    const active = shownTabs.find(item => item.key === tab) || shownTabs[0];
    const currentHits: Hit[] = scoped ? (active?.sections.flatMap(section => section.hits) || []) : tagOnly;
    const allHits = scoped ? shownTabs.flatMap(item => item.sections.flatMap(section => section.hits)) : tagOnly;

    // --- query chips ---
    const needle = typed.replace(/^@/, '').trim().toLowerCase();
    const options = [
        ...library.prefixes.filter(prefix => !needle || prefix.name.toLowerCase().includes(needle)).slice(0, typed.startsWith('@') ? 30 : 8)
            .map(prefix => ({ value: 'prefix::' + prefix.id, label: <span><Tag color="gold" style={{ marginRight: 6 }}>prefix</Tag>{prefix.name}</span> })),
        ...(typed.startsWith('@') || needle.length < 2 ? [] : pool.filter(item => item.side !== 'Library prefix' && item.value.toLowerCase().includes(needle)).slice(0, 30)
            .map((item, index) => ({ key: item.side + index, value: item.value, label: <span>{item.label} <small style={{ opacity: .6 }}>· {item.side}{item.count ? ' · ' + item.count : ''}</small></span> }))),
    ].filter(option => !chips.some(chip => encode(chip) === option.value));
    const fromValues = (values: string[]): QueryChip[] => values.flatMap(value => {
        const existing = chips.find(chip => encode(chip) === value);
        if (existing) return [existing];
        if (value.startsWith('prefix::')) { const prefix = library.prefixes.find(item => item.id === value.slice(8)); return prefix ? [{ kind: 'prefix', id: prefix.id, name: prefix.name } as QueryChip] : []; }
        if (value.startsWith('@')) { const prefix = library.prefixes.find(item => item.name.toLowerCase() === value.slice(1).trim().toLowerCase()); if (prefix) return [{ kind: 'prefix', id: prefix.id, name: prefix.name } as QueryChip]; }
        return value.trim() ? [{ kind: 'tag', text: value.trim() } as QueryChip] : [];
    });
    const chipLabel = (value: string) => {
        const chip = chips.find(item => encode(item) === value);
        if (chip?.kind === 'prefix') return <><b>prefix</b> {chip.name}</>;
        if (chip?.kind === 'image') return <><img alt="" src={`${BASE_PATH}/Gallery/thumbnail?url=${encodeURIComponent(chip.url)}&root=${encodeURIComponent(root)}`} style={{ width: 16, height: 16, objectFit: 'cover', verticalAlign: 'middle', marginRight: 4 }} /><b>image</b> {chip.name}</>;
        return value;
    };
    const kindColor = (value: string) => value.startsWith('prefix::') ? 'gold' : value.startsWith('image::') ? 'blue' : undefined;
    const addImage = (image: { url: string; name: string }, replace = false) => {
        const chip: QueryChip = { kind: 'image', url: image.url, name: image.name };
        setChips(old => replace ? [...old.filter(item => item.kind === 'tag'), chip] : [...old.filter(item => encode(item) !== encode(chip)), chip]);
    };
    const onDrop = (event: DragEvent) => { setDropping(false); const image = droppedImage(event); if (!image) return; event.preventDefault(); addImage(image); };

    // --- selection and opening, shared with the main gallery ---
    const selected = new Set(gallery.selectedImages);
    const toggle = (url: string) => gallery.setSelectedImages(old => old.includes(url) ? old.filter(item => item !== url) : [...old, url]);
    const targets = (url: string) => selected.has(url) ? gallery.selectedImages.filter(item => byUrl.has(item)) : [url];
    const title = scoped ? 'Image search · ' + [...prefixes.map(chip => '@' + chip.name), ...images.map(chip => chip.name)].join(' + ') : 'Image search' + (tags.length ? ' · ' + tags.join(' + ') : '');
    const scopeMain = (hits: Hit[]) => { gallery.setLocalScope({ label: title.replace(/^Image search · /, ''), urls: new Set(hits.map(item => item.file.url)) }); };
    /** Open in the gallery viewer: the main gallery shows this tab's results, so the viewer steps through them. */
    const openInViewer = (url: string) => { scopeMain(currentHits); setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_VIEWER_EVENT, { detail: { url } })), 60); };
    const prefixActions = (url: string) => prefixes.map(chip => ({ key: 'pair:' + chip.id, label: `Pair with @${chip.name}` }));
    const pair = async (prefixId: string, urls: string[]) => {
        const entries = urls.flatMap(url => byUrl.get(url) ? [localEntry(byUrl.get(url)!, hydrus.items[url]?.hash)] : []);
        try { await associateImages(prefixId, entries.flatMap(entry => imagePrefixKeys(entry, root)), Object.assign({}, ...entries.map(entry => imagePrefixRefs(entry, root)))); message.success(`Paired ${entries.length} image(s)`); }
        catch (reason) { message.error(String(reason)); }
    };
    const tile = ({ file, note, color }: Hit) => <Dropdown key={file.url} trigger={['contextMenu']} menu={{ items: [
        { key: 'view', label: 'Open in gallery view' },
        { key: 'select', label: selected.has(file.url) ? 'Deselect' : 'Select' },
        { type: 'divider' as const },
        { key: 'search', label: 'Search by this image (new search)' }, { key: 'add', label: 'Add this image to the search' },
        { type: 'divider' as const },
        { key: 'info', label: 'Metadata' }, { key: 'prefix', label: `Use for prefix… (${targets(file.url).length})` }, ...prefixActions(file.url),
        { key: 'source', label: `Append to Image Source (${targets(file.url).length})` }, { key: 'export', label: `Export to Hydrus (${targets(file.url).length})` },
        { key: 'open', label: 'Open original in a new tab' },
    ], onClick: ({ key }) => {
        if (key === 'view') openInViewer(file.url); if (key === 'select') toggle(file.url);
        if (key === 'search') addImage(file, true); if (key === 'add') addImage(file);
        if (key === 'info') openImageInfo({ url: file.url }); if (key === 'prefix') openSourcePrefix(targets(file.url));
        if (key.startsWith('pair:')) void pair(key.slice(5), targets(file.url));
        if (key === 'source') { void appendLocalImages(targets(file.url)).then(text => message.success(text)).catch(reason => message.error(String(reason))); }
        if (key === 'export') hydrus.requestExport(targets(file.url));
        if (key === 'open') window.open(BASE_PATH + file.url, '_blank');
    } }}>
        <div role="group" aria-label={file.name} draggable title={file.name + ' · click: open in gallery view · Ctrl/Shift-click: select · drag into the search bar to add it'}
            onDragStart={event => { event.dataTransfer.setData(IMAGE_DRAG_TYPE, JSON.stringify({ url: file.url, name: file.name })); event.dataTransfer.setData('text/uri-list', BASE_PATH + file.url); }}
            onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey) toggle(file.url); else openInViewer(file.url); }}
            style={{ minWidth: 0, position: 'relative', cursor: 'pointer', outline: selected.has(file.url) ? '2px solid #1677ff' : undefined, borderRadius: 4 }}>
            <img loading="lazy" decoding="async" alt={file.name} draggable={false} src={`${BASE_PATH}/Gallery/thumbnail?url=${encodeURIComponent(file.url)}&v=${file.timestamp || 0}&root=${encodeURIComponent(root)}`} style={{ width: '100%', height: 130, objectFit: 'contain', background: '#8882', borderRadius: 4 }} />
            <Checkbox aria-label={'Select ' + file.name} checked={selected.has(file.url)} onClick={event => event.stopPropagation()} onChange={() => toggle(file.url)} style={{ position: 'absolute', top: 4, right: 6 }} />
            {note && <Tag color={color} style={{ position: 'absolute', top: 4, left: 4, margin: 0, maxWidth: 'calc(100% - 34px)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note}</Tag>}
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{file.name}</div>
        </div>
    </Dropdown>;
    const grid = (hits: Hit[]) => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>{hits.map(tile)}</div>;
    const sections = (item: ResultTab) => {
        let budget = shown;
        const total = item.sections.reduce((sum, section) => sum + section.hits.length, 0);
        return <>
            <Typography.Paragraph type="secondary">{busy ? 'Following image sources… ' : ''}{item.hint}</Typography.Paragraph>
            {item.derived && !!item.derived.urls.length && <Button size="small" style={{ marginBottom: 8 }} onClick={() => void pair(item.derived!.prefixId, item.derived!.urls)}>Pair the {item.derived.urls.length} later source(s) with @{item.derived.prefixName}</Button>}
            {item.sections.filter(section => section.hits.length).map((section, index) => {
                const visible = section.hits.slice(0, Math.max(0, budget)); budget -= visible.length;
                return <div key={index} style={{ marginBottom: 12 }}>
                    {section.title && <Typography.Text strong style={{ display: 'block', margin: '4px 0' }}>{section.title} <Typography.Text type="secondary">({section.hits.length})</Typography.Text></Typography.Text>}
                    {grid(visible)}
                </div>;
            })}
            {item.inputs && !!item.inputs.length && <><Typography.Text strong style={{ display: 'block', margin: '4px 0' }}>Made from (input images, nearest first)</Typography.Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{item.inputs.map((input, index) => <div key={input.input_name + index} style={{ width: 130, position: 'relative' }}>
                    <img alt={input.title || input.input_name} src={`${BASE_PATH}/Gallery/source/thumbnail?url=${encodeURIComponent('/static_gallery/' + input.input_name)}`} style={{ width: 130, height: 110, objectFit: 'contain', background: '#8882', borderRadius: 4 }} />
                    <Tag color={input.original ? 'magenta' : 'default'} style={{ position: 'absolute', top: 4, left: 4, margin: 0 }}>{input.note}</Tag>
                    <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{input.title || input.input_name}</div>
                </div>)}</div></>}
            {!total && !item.inputs?.length && !busy && <Typography.Text type="secondary">Nothing here{tags.length ? ' that matches the tag chips' : ''}.</Typography.Text>}
            {total > shown && <div style={{ marginTop: 8 }}><Button onClick={() => setShown(value => value + PAGE)}>Show more ({(total - shown).toLocaleString()} left)</Button></div>}
        </>;
    };
    const count = (item: ResultTab) => item.sections.reduce((sum, section) => sum + section.hits.length, 0);
    const selectedHere = allHits.filter(item => selected.has(item.file.url)).length;
    return <FloatingPanel panelKey="tag-search" title={title} open={open} onCancel={() => setOpen(false)} footer={null} width={800}>
        <div onDragOver={event => { if ([...event.dataTransfer.types].some(type => type === IMAGE_DRAG_TYPE || type === 'custom' || type === 'text/uri-list')) { event.preventDefault(); setDropping(true); } }} onDragLeave={() => setDropping(false)} onDrop={onDrop}
            style={{ outline: dropping ? '2px dashed #1677ff' : undefined, borderRadius: 6 }}>
            <Space.Compact style={{ width: '100%' }}>
                <Select mode="tags" aria-label="Image search query" style={{ flex: 1 }} value={chips.map(encode)} searchValue={typed} onSearch={setTyped}
                    onChange={values => { setChips(fromValues(values)); setTyped(''); }} options={options} filterOption={false} tokenSeparators={[',']}
                    placeholder="Tags, @prefix, or drop an image here"
                    tagRender={({ value, closable, onClose }) => <Tag color={kindColor(String(value))} closable={closable} onClose={onClose} style={{ marginInlineEnd: 4 }}>{chipLabel(String(value))}</Tag>} />
                <Select aria-label="Tag search field" value={field} onChange={setField} style={{ width: 170 }} options={[{ value: 'all', label: 'Tags in: all fields' }, { value: 'positive', label: 'Tags in: positive' }, { value: 'negative', label: 'Tags in: negative' }, { value: 'hydrus', label: 'Tags in: Hydrus tags' }, { value: 'name', label: 'Tags in: file name' }]} />
            </Space.Compact>
        </div>
        <Space wrap style={{ margin: '8px 0' }}>
            {prefixes.length > 0 && <Checkbox checked={strict} onChange={event => setStrict(event.target.checked)}>Only images that still have every prefix tag (aliases count)</Checkbox>}
            <Button size="small" disabled={!allHits.length} onClick={() => { scopeMain(allHits); message.success('The main gallery now shows these images (close the Scope chip there to undo)'); }}>Show all in main gallery</Button>
            <Button size="small" disabled={!currentHits.length} onClick={() => gallery.setSelectedImages(old => Array.from(new Set([...old, ...currentHits.map(item => item.file.url)])))}>Select all here</Button>
            {selectedHere > 0 && <><Typography.Text>{selectedHere} selected here</Typography.Text><Button size="small" onClick={() => gallery.setSelectedImages(old => old.filter(url => !allHits.some(item => item.file.url === url)))}>Clear</Button></>}
        </Space>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 8 }} />}
        {!scoped && <>
            <Typography.Paragraph type="secondary">{tags.length ? `${tagOnly.length.toLocaleString()} loaded image(s) have every tag.` : 'Add tags or an @prefix, or drop an image here (from the gallery or from these results).'} Tag chips search the whole gallery until a prefix or image chip is added; then they filter its results.</Typography.Paragraph>
            {sections({ key: 'tags', label: 'Results', hint: '', sections: [{ hits: tagOnly }] })}
        </>}
        {scoped && <Tabs activeKey={active?.key} onChange={setTab} items={shownTabs.map(item => ({ key: item.key, label: `${item.label} (${count(item)})`, children: sections(item) }))} />}
    </FloatingPanel>;
}
