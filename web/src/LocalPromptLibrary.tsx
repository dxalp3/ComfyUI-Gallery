import { useUnsavedPrefix } from './UnsavedPrefix';
import { FloatingPanel } from './FloatingPanel';
import { getPromptTargets, writePromptTarget } from './ImageSourceBridge';
import { formatPromptTerms, prepareInsertion } from './PromptSpelling';
import { PromptPalette } from './PromptPalette';
import { PrefixEditor } from './PrefixEditor';
import { LibrarySearchPanel, type Phrase } from './LibrarySearchPanel';
import { droppedImage, openImageSearch, type SearchPrefix } from './TagSearchPanel';
import { savePrefix, writeLibraryNodeText, loadPrefixes, migrateBrowserPrefixes, expandPrefix, expandSearchTerms, deletePrefix, applyLibraryPrefix, dissociateImages, PREFIX_MANAGER_EVENT, PREFIX_EDITOR_EVENT, type SharedLibrary, type PrefixSeed } from './PrefixLibrary';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Select, Space, Tag, Typography, message } from 'antd';
import { useGalleryContext } from './GalleryContext';
import { extractLocalPrompts, extractHydrusTags, type LocalSearchField } from './LocalImageSearch';
import { libraryPhrases, indexPrompts } from './SearchPool';

/** Opens the library search window (used by Settings and by the prompt library itself). */
export const LIBRARY_SEARCH_EVENT = 'gallery-library-search';
/** Opens the Prompts & prefixes window as it is. */
export const PROMPTS_WINDOW_EVENT = 'gallery-prompts-window';

export { indexPrompts } from './SearchPool';

const nodePrompt = (node: any) => node?.widgets?.find((widget: any) => ['prefix', 'text'].includes(widget.name))?.value || '';

export function LocalPromptSearch({ onLocalSearch, managerOnly = false }: { onLocalSearch: () => void; managerOnly?: boolean }) {
    const gallery = useGalleryContext();
    const [shared, setShared] = useState<SharedLibrary>({ version: 2, tags: [], prefixes: [] });
    const [seed, setSeed] = useState<PrefixSeed>({});
    const [appendTarget, setAppendTarget] = useState<string>();
    const [promptTargets, setPromptTargets] = useState<{ value: string; label: string }[]>([]);
    const [nodeText, setNodeText] = useState('');
    const [prefixName, setPrefixName] = useState('');
    const [prefixTags, setPrefixTags] = useState<string[]>([]);
    const [negativeTags, setNegativeTags] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [open, setOpen] = useState(false);
    /** The prefix editor is its own window, so a prefix can be edited while appending to the workflow (and vice versa). */
    const [editorOpen, setEditorOpen] = useState(false);
    /** Where the palette's Append buttons send tags: the workflow, or the prefix being edited. */
    const [paletteTarget, setPaletteTarget] = useState<'workflow' | 'positive' | 'negative'>('workflow');
    const openRef = useRef(open || editorOpen); openRef.current = open || editorOpen;
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [library, setLibrary] = useState<Phrase[]>([]);
    const [status, setStatus] = useState('');
    useEffect(() => { if (openRef.current) void getPromptTargets().then(setPromptTargets).catch(error => setStatus(String(error))); }, [seed]);
    const indexed = useMemo(() => indexPrompts(gallery.data?.folders || {}), [gallery.data]);
    const load = async () => {
        try {
            const data = await loadPrefixes(); setShared(data); setLibrary(libraryPhrases(data));
            setStatus('Shared ComfyUI user library'); return data;
        } catch (error) { setStatus(String(error)); return undefined; }
    };
    useEffect(() => { void load(); if (open) void getPromptTargets().then(setPromptTargets).catch(error => setStatus(String(error))); }, [open, editorOpen, libraryOpen]);
    useEffect(() => {
        const refresh = () => { if (openRef.current) setStatus('Library may have changed. Refresh library before saving a stale draft.'); else void load(); };
        const show = (event: Event) => {
            const value = (event as CustomEvent<PrefixSeed>).detail || {};
            drafts.markSaved({ name: value.name || '', positive: Array.from(new Set([...(value.positive || []), ...(value.hydrus || [])])), negative: value.negative || [] });
            setNodeText(nodePrompt(value.node));
            setAppendTarget(value.node ? JSON.stringify([String(value.node.id), value.node.widgets.findIndex((widget: any) => ['prefix', 'text'].includes(widget.name))]) : undefined);
            // From a workflow node: the prompts window (append target preset). From images or "edit": the prefix editor window.
            setSeed(value); if (value.node) setOpen(true); else setEditorOpen(true); setPrefixName(value.name || '');
            setNegativeTags(value.negative || []);
            setPrefixTags(Array.from(new Set([...(value.positive || []), ...(value.hydrus || [])])));
            if (value.node) void load().then(data => {
                const selected = data?.prefixes.find(prefix => prefix.id === value.node.properties?.prompt_library_selected_prefix);
                if (data && selected) { drafts.markSaved({ name: selected.name, positive: expandPrefix(data, '@' + selected.name), negative: selected.negative_terms || [] }); setPrefixName(selected.name); setNegativeTags(selected.negative_terms || []); setPrefixTags(expandPrefix(data, '@' + selected.name)); }
            });
        };
        const showLibrary = () => setLibraryOpen(true);
        const showEditor = () => setEditorOpen(true);
        const showPrompts = () => setOpen(true);
        window.addEventListener(PREFIX_EDITOR_EVENT, showEditor);
        window.addEventListener(PROMPTS_WINDOW_EVENT, showPrompts);
        window.addEventListener(PREFIX_MANAGER_EVENT, show);
        window.addEventListener(LIBRARY_SEARCH_EVENT, showLibrary);
        window.addEventListener('gallery-prefix-library-changed', refresh);
        window.addEventListener('focus', refresh);
        return () => { window.removeEventListener(PROMPTS_WINDOW_EVENT, showPrompts); window.removeEventListener(PREFIX_EDITOR_EVENT, showEditor); window.removeEventListener(PREFIX_MANAGER_EVENT, show); window.removeEventListener(LIBRARY_SEARCH_EVENT, showLibrary); window.removeEventListener('gallery-prefix-library-changed', refresh); window.removeEventListener('focus', refresh); };
    }, []);
    const cachedTags = useMemo(() => {
        const counts = new Map<string, number>();
        Object.values(gallery.data?.folders || {}).flatMap(folder => Object.values(folder)).forEach(file => new Set([...(gallery.localHydrusTags[file.url] || []), ...extractHydrusTags(file.metadata)]).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
        return [...counts].map(([value, count]) => ({ value, label: value, side: 'hydrus', count }));
    }, [gallery.localHydrusTags, gallery.data]);
    // The header search suggests indexed phrases first; the library window lists saved prefixes first so they are never buried.
    const pool = [...indexed, ...cachedTags, ...library];
    const libraryPool = [...library, ...indexed, ...cachedTags];
    const options = pool.filter(item => (item.label + ' ' + item.value).toLocaleLowerCase().includes(gallery.searchFileName.replace(/^@/, '').toLocaleLowerCase()) &&
        (!['positive', 'negative', 'hydrus'].includes(gallery.localSearchField) || item.side === gallery.localSearchField || gallery.localSearchField !== 'hydrus' && item.side.startsWith('Library'))).slice(0, 40);

    /** Tag searches get their own window; the main gallery's filter and scroll position are left alone. */
    const openTagSearch = (terms: string[], field: LocalSearchField = 'all', prefix?: SearchPrefix) => openImageSearch({ field, chips: prefix?.id ? [{ kind: 'prefix', id: prefix.id, name: prefix.name }] : Array.from(new Set(terms)).map(text => ({ kind: 'tag' as const, text })) });
    const addToDraft = (terms: string[], side: 'positive' | 'negative' = 'positive') => (side === 'negative' ? setNegativeTags : setPrefixTags)(old => Array.from(new Set([...old, ...terms])));
    const drafts = useUnsavedPrefix({ name: prefixName, positive: prefixTags, negative: negativeTags }, value => { setPrefixName(value.name); setPrefixTags(value.positive); setNegativeTags(value.negative); }, () => save());
    const save = async () => {
        setSaving(true);
        try {
            // Spelling (spaces or canonical underscores) comes from the gallery settings and is applied on save.
            const positive = prefixTags.length ? await formatPromptTerms(prefixTags) : [];
            const negative = negativeTags.length ? await formatPromptTerms(negativeTags) : [];
            setPrefixTags(positive); setNegativeTags(negative);
            message.success(await savePrefix(prefixName, positive, shared.revision, seed.imageKeys, negative, seed.imageRefs));
            drafts.markSaved({ name: prefixName, positive, negative });
            const data = await load();
            const prefix = data?.prefixes.find(item => item.name.toLowerCase() === prefixName.trim().toLowerCase());
            if (prefix) seed.onSaved?.(positive, prefix.id, negative);
            return true;
        } catch (error) { message.error(String(error)); return false; } finally { setSaving(false); }
    };
    const removePrefix = async (id: string) => {
        try { await deletePrefix(id, shared.revision!); await load(); } catch (error) { message.error(String(error)); }
    };
    const appendPrefixToNode = async (id: string) => {
        const prefix = shared.prefixes.find(value => value.id === id);
        if (!prefix || !seed.node) return;
        try {
            const terms = await formatPromptTerms(expandPrefix(shared, '@' + prefix.name));
            if (seed.node.__galleryPromptBoxes) {
                seed.node.properties ||= {}; seed.node.properties.prompt_library_selected_prefix = prefix.id;
                seed.node.__galleryPromptBoxes.insert(terms.join(', '), 'after', prefix.name);
                message.success('Prefix appended to the node'); return;
            }
            const combined = [nodePrompt(seed.node), terms.join(', ')].filter(Boolean).join(', ');
            applyLibraryPrefix(seed.node, shared, prefix.id, combined); setNodeText(combined);
            message.success('Prefix appended to the node');
        } catch (error) { message.error(String(error)); }
    };
    const editPrefix = (name: string) => {
        const prefix = shared.prefixes.find(value => value.name === name);
        if (!prefix) return;
        drafts.markSaved({ name: prefix.name, positive: expandPrefix(shared, '@' + prefix.name), negative: prefix.negative_terms || [] });
        setPrefixName(prefix.name); setPrefixTags(expandPrefix(shared, '@' + prefix.name)); setNegativeTags(prefix.negative_terms || []); setEditorOpen(true);
    };
    const unpair = async (keys: string[]) => {
        try { await dissociateImages(keys, shared.revision); await load(); message.success('Image unpaired from the prefix'); } catch (error) { message.error(String(error)); }
    };
    const draftLabel = prefixName.trim() || 'unnamed prefix';
    const boxed = !!seed.node?.__galleryPromptBoxes;
    return <>
        {!managerOnly && gallery.localScope && <Tag color="blue" closable onClose={() => gallery.setLocalScope(null)} title="Only images found by the image search are shown. Close to show everything again." style={{ alignSelf: 'center' }}>Scope: {gallery.localScope.label} ({gallery.localScope.urls.size})</Tag>}
        {!managerOnly && <><div className="cg-search" title="Drop an image here to search by it together with these terms"
            onDragOver={event => { if ([...event.dataTransfer.types].some(type => type === 'application/x-gallery-image' || type === 'custom' || type === 'text/uri-list')) event.preventDefault(); }}
            onDrop={event => { const image = droppedImage(event); if (!image) return; event.preventDefault(); openImageSearch({ field: gallery.localSearchField, chips: [...gallery.localTerms.map(text => ({ kind: 'tag' as const, text })), { kind: 'image', url: image.url, name: image.name }] }); }}
            onKeyDownCapture={event => {
            if (event.key === 'Enter' && (!gallery.searchFileName.trim() || gallery.localTerms.includes(gallery.searchFileName.trim()))) {
                event.preventDefault(); event.stopPropagation(); gallery.setSearchFileName(''); onLocalSearch();
            }
        }}><Select mode="tags" aria-label="Filter local files" value={gallery.localTerms} searchValue={gallery.searchFileName}
            onSearch={value => { gallery.setSearchFileName(value); onLocalSearch(); }}
            onChange={values => {
                gallery.setSearchFileName('');
                // A saved @prefix searches its lineage (paired images and what was generated from them), not just its exact tags.
                const prefixOf = (value: string) => value.startsWith('@') ? shared.prefixes.find(prefix => prefix.name.toLowerCase() === value.slice(1).trim().toLowerCase()) : undefined;
                const prefixes = values.flatMap(value => prefixOf(value) ? [prefixOf(value)!] : []);
                if (prefixes.length) {
                    const rest = values.filter(value => !prefixOf(value)).flatMap(value => expandSearchTerms(shared, value));
                    openImageSearch({ field: gallery.localSearchField, chips: [...prefixes.map(prefix => ({ kind: 'prefix' as const, id: prefix.id, name: prefix.name })), ...rest.map(text => ({ kind: 'tag' as const, text }))] });
                    return;
                }
                gallery.setLocalTerms(Array.from(new Set(values.flatMap(value => expandSearchTerms(shared, value))))); onLocalSearch();
            }}
            style={{ width: '100%' }} popupMatchSelectWidth={480} filterOption={false} optionLabelProp="value" allowClear
            options={options.filter(item => !gallery.localTerms.includes(item.value)).map((item, i) => ({ key: item.side + i, value: item.side === 'Library prefix' ? '@' + item.label : item.value, label: <span>{item.label} <small>· {item.side}{item.count ? ' · ' + item.count + ' local files' : ''}</small></span> }))}
            placeholder="Local search · Enter stacks a term (AND)" /></div>
        <Select aria-label="Local search category" value={gallery.localSearchField} onChange={value => { gallery.setLocalSearchField(value); onLocalSearch(); }} style={{ width: 150 }} options={[{ value: 'all', label: 'All fields' }, { value: 'positive', label: 'Positive prompt' }, { value: 'negative', label: 'Negative prompt' }, { value: 'hydrus', label: 'Hydrus tag' }, { value: 'name', label: 'Filename' }]} />
        </>}<Button onClick={() => { setSeed({}); setPrefixName(''); setPrefixTags([]); setNegativeTags([]); setOpen(true); }}>Prompts & prefixes</Button>
        <FloatingPanel panelKey="prompt-library" title="Prompts & prefixes" open={open} onCancel={() => setOpen(false)} footer={null} width={1050}>
            <Space wrap style={{ width: '100%', justifyContent: 'space-between', marginBottom: 10 }}>
                <Space wrap><Typography.Text>Append directly to workflow:</Typography.Text><Select aria-label="Library append target" placeholder="Choose a prompt node or text field" value={appendTarget} onChange={setAppendTarget} options={promptTargets} style={{ minWidth: 350 }} /><Button onClick={() => { void getPromptTargets().then(setPromptTargets).catch(error => setStatus(String(error))); }}>Refresh prompt targets</Button></Space>
                <Space wrap><Button onClick={() => openTagSearch([])}>Tag search…</Button><Button onClick={() => setLibraryOpen(true)}>Library search…</Button></Space>
            </Space>
            {!shared.tags.length && !shared.prefixes.length && <Button style={{ marginBottom: 10 }} onClick={() => { void migrateBrowserPrefixes(shared.revision!).then(load).catch(error => message.error(String(error))); }}>Import legacy browser library</Button>}
            {boxed && <Typography.Paragraph type="secondary">Editing {seed.node.title || 'Prompt Encode'} #{seed.node.id}. Appends from here become boxes on the node; reorder, edit or delete them there.</Typography.Paragraph>}
            {seed.node && !boxed && <div style={{ marginBottom: 10 }}>
                <Typography.Paragraph>Editing for {seed.node.title || 'Prompt Library'} #{seed.node.id}. Use “Append to node” in the prefix editor below on a saved prefix, or edit the node text here.</Typography.Paragraph>
                <Input.TextArea aria-label="Editable node prompt" autoSize={{ minRows: 3, maxRows: 9 }} value={nodeText} onChange={event => setNodeText(event.target.value)} />
                <Space style={{ marginTop: 6 }}><Button onClick={() => { try { writeLibraryNodeText(seed.node, nodeText); message.success('Node prompt updated'); } catch (error) { message.error(String(error)); } }}>Apply edited text to node</Button><Button onClick={() => setNodeText(nodePrompt(seed.node))}>Read current node text</Button></Space>
            </div>}
            <Space wrap style={{ width: '100%', marginBottom: 8 }}>
                <Typography.Text>Append buttons send to:</Typography.Text>
                <Select aria-label="Palette target" value={paletteTarget} onChange={setPaletteTarget} style={{ minWidth: 260 }} options={[
                    { value: 'workflow', label: 'Workflow (the prompt target above)' },
                    { value: 'positive', label: 'Prefix editor · positive terms' },
                    { value: 'negative', label: 'Prefix editor · negative terms' }]} />
                <Typography.Text type="secondary">Editing: <Tag>{draftLabel}</Tag>{prefixTags.length} positive · {negativeTags.length} negative</Typography.Text>
                <Button onClick={() => setEditorOpen(true)}>Open prefix editor</Button>
            </Space>
            <PromptPalette chooseSearches onEdit={id => { const prefix = shared.prefixes.find(item => item.id === id); if (prefix) editPrefix(prefix.name); }} onAppend={async (groups, options, meta) => {
                if (paletteTarget !== 'workflow') {
                    // Into the prefix being edited: plain tags stay separate terms; grouped formats become one {…} term.
                    const terms = options.format === 'comma' && options.weight === 1 && !options.prefix && !options.suffix ? groups.flat() : [await prepareInsertion(groups, options)];
                    addToDraft(terms, paletteTarget); setEditorOpen(true); message.success('Added to the prefix editor (' + paletteTarget + ')'); return;
                }
                if (!appendTarget) throw new Error('Choose a prompt target above first.'); const text = await prepareInsertion(groups, options); const value = await writePromptTarget(appendTarget, text, options.position, meta?.name); if (seed.node && JSON.parse(appendTarget)[0] === String(seed.node.id)) setNodeText(value); message.success('Appended to prompt node'); }}
                onChoose={(terms, prefixId) => { const prefix = shared.prefixes.find(item => item.id === prefixId); openTagSearch(terms, 'all', prefix ? { id: prefix.id, name: prefix.name, terms } : undefined); }}
                onSearch={terms => openTagSearch(terms)} />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>{status}. Prefix definitions are shared with your Prompt Library node.</Typography.Paragraph>
        </FloatingPanel>
        <FloatingPanel panelKey="prefix-editor" title={'Prefix editor · ' + draftLabel} open={editorOpen} onCancel={() => { if (!saving) drafts.guard(() => setEditorOpen(false)); }} footer={null} width={900}>
            {drafts.dialog}
            <PrefixEditor onLoad={drafts.markSaved} shared={shared} seed={seed} active={editorOpen} name={prefixName} setName={setPrefixName} positive={prefixTags} setPositive={setPrefixTags} negative={negativeTags} setNegative={setNegativeTags}
                saving={saving} onSave={() => void save()} onDelete={removePrefix} onAppendToNode={seed.node ? id => void appendPrefixToNode(id) : undefined}
                onOpenLibrarySearch={() => setLibraryOpen(true)} onOpenPrompts={() => setOpen(true)}
                onUnpair={image => void unpair(image.keys || [])} />
        </FloatingPanel>
        <LibrarySearchPanel open={libraryOpen} onClose={() => setLibraryOpen(false)} pool={libraryPool} shared={shared} status={status} indexedCount={indexed.length} canAppendToNode={!!seed.node}
            onRefresh={() => void load()} onSearch={(terms, field, prefixId) => { const prefix = shared.prefixes.find(item => item.id === prefixId); openTagSearch(terms, field, prefix ? { id: prefix.id, name: prefix.name, terms } : undefined); }} onAddToDraft={addToDraft} onEditPrefix={editPrefix} onDeletePrefix={removePrefix} onAppendToNode={id => void appendPrefixToNode(id)} />

    </>;
}
