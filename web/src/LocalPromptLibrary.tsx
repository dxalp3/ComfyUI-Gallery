import { savePrefix, loadPrefixes, migrateBrowserPrefixes, expandPrefix, deletePrefix, applyLibraryPrefix, PREFIX_MANAGER_EVENT, type SharedLibrary, type PrefixSeed } from './PrefixLibrary';
import { usePromptSpelling, formatPromptTerms } from './PromptSpelling';
import { HydrusTagSelect } from './HydrusTagSelect';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Input, Modal, Select, Space, Typography, message } from 'antd';
import { BASE_Z_INDEX } from './ComfyAppApi';
import { useGalleryContext } from './GalleryContext';
import { extractLocalPrompts, extractHydrusTags } from './LocalImageSearch';
import { promptTags } from './PromptTags';

type Phrase = { value: string; label: string; side: string; count: number };
export function indexPrompts(folders: Record<string, Record<string, any>>): Phrase[] {
    const index = new Map<string, Phrase>();
    for (const files of Object.values(folders)) for (const file of Object.values(files)) {
        const prompts = extractLocalPrompts(file.metadata);
        for (const side of ['positive', 'negative'] as const) for (const phrase of promptTags(prompts[side], '')) {
            const key = side + ':' + phrase.toLocaleLowerCase();
            const existing = index.get(key);
            if (existing) existing.count++;
            else index.set(key, { value: phrase, label: phrase, side, count: 1 });
        }
    }
    return [...index.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function libraryPhrases(data: any): Phrase[] {
    if (![1, 2].includes(data?.version) || !Array.isArray(data.tags) || !Array.isArray(data.prefixes)) throw new Error('Unsupported Prompt Library format');
    const tags = data.tags.filter((tag: any) => typeof tag.text === 'string' && typeof tag.id === 'string');
    return [...tags.map((tag: any) => ({ value: tag.text, label: tag.name || tag.text, side: 'Library tag', count: 0 })),
        ...data.prefixes.map((prefix: any) => ({ value: (prefix.tags || []).map((id: string) => tags.find((tag: any) => tag.id === id)?.text).filter(Boolean).join(', '), label: prefix.name, side: 'Library prefix', count: 0 }))].filter(item => item.value);
}

export function LocalPromptSearch({ onLocalSearch, managerOnly = false }: { onLocalSearch: () => void; managerOnly?: boolean }) {
    const gallery = useGalleryContext();
    const [shared, setShared] = useState<SharedLibrary>({ version: 2, tags: [], prefixes: [] });
    const [seed, setSeed] = useState<PrefixSeed>({});
    const [spaces, setSpaces] = usePromptSpelling();
    const [prefixName, setPrefixName] = useState('');
    const [prefixTags, setPrefixTags] = useState<string[]>([]);
    const [open, setOpen] = useState(false);
    const openRef = useRef(open); openRef.current = open;
    const [library, setLibrary] = useState<Phrase[]>([]);
    const [status, setStatus] = useState('');
    const [filter, setFilter] = useState('');
    const [side, setSide] = useState('positive');
    const indexed = useMemo(() => indexPrompts(gallery.data?.folders || {}), [gallery.data]);
    const load = async () => {
        try {
            const data = await loadPrefixes(); setShared(data); setLibrary(libraryPhrases(data));
            setStatus('Shared ComfyUI user library'); return data;
        } catch (error) { setStatus(String(error)); return undefined; }
    };
    useEffect(() => { void load(); }, [open]);
    useEffect(() => {
        const refresh = () => { if (openRef.current) setStatus('Library may have changed. Refresh library before saving a stale draft.'); else void load(); };
        const show = (event: Event) => {
            const value = (event as CustomEvent<PrefixSeed>).detail || {};
            setSeed(value); setSide(value.node ? 'library' : 'all'); setOpen(true); setPrefixName(value.name || '');
            setPrefixTags(Array.from(new Set([...(value.positive || []), ...(value.hydrus || [])])));
            if (value.node) void load().then(data => {
                const selected = data?.prefixes.find(prefix => prefix.id === value.node.properties?.prompt_library_selected_prefix);
                if (data && selected) { setPrefixName(selected.name); setPrefixTags(expandPrefix(data, '@' + selected.name)); }
            });
        };
        window.addEventListener(PREFIX_MANAGER_EVENT, show);
        window.addEventListener('gallery-prefix-library-changed', refresh);
        window.addEventListener('focus', refresh);
        return () => { window.removeEventListener(PREFIX_MANAGER_EVENT, show); window.removeEventListener('gallery-prefix-library-changed', refresh); window.removeEventListener('focus', refresh); };
    }, []);
    const cachedTags = useMemo(() => {
        const counts = new Map<string, number>();
        Object.values(gallery.data?.folders || {}).flatMap(folder => Object.values(folder)).forEach(file => new Set([...(gallery.localHydrusTags[file.url] || []), ...extractHydrusTags(file.metadata)]).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
        return [...counts].map(([value, count]) => ({ value, label: value, side: 'hydrus', count }));
    }, [gallery.localHydrusTags, gallery.data]);
    const pool = [...indexed, ...cachedTags, ...library];
    const options = pool.filter(item => (item.label + ' ' + item.value).toLocaleLowerCase().includes(gallery.searchFileName.replace(/^@/, '').toLocaleLowerCase()) &&
        (!['positive', 'negative', 'hydrus'].includes(gallery.localSearchField) || item.side === gallery.localSearchField || gallery.localSearchField !== 'hydrus' && item.side.startsWith('Library'))).slice(0, 40);
    const rows = pool.filter(item => (side === 'all' || item.side === side || side === 'library' && item.side.startsWith('Library')) &&
        (item.value + ' ' + item.label).toLocaleLowerCase().includes(filter.toLocaleLowerCase())).slice(0, 100);
    return <>
        {!managerOnly && <><div className="cg-search" onKeyDownCapture={event => {
            if (event.key === 'Enter' && (!gallery.searchFileName.trim() || gallery.localTerms.includes(gallery.searchFileName.trim()))) {
                event.preventDefault(); event.stopPropagation(); gallery.setSearchFileName(''); onLocalSearch();
            }
        }}><Select mode="tags" aria-label="Filter local files" value={gallery.localTerms} searchValue={gallery.searchFileName}
            onSearch={value => { gallery.setSearchFileName(value); onLocalSearch(); }}
            onChange={values => { gallery.setLocalTerms(Array.from(new Set(values.flatMap(value => gallery.localTerms.includes(value) ? [value] : expandPrefix(shared, value))))); gallery.setSearchFileName(''); onLocalSearch(); }}
            style={{ width: '100%' }} popupMatchSelectWidth={480} filterOption={false} optionLabelProp="value" allowClear
            options={options.filter(item => !gallery.localTerms.includes(item.value)).map((item, i) => ({ key: item.side + i, value: item.side === 'Library prefix' ? '@' + item.label : item.value, label: <span>{item.label} <small>· {item.side}{item.count ? ' · ' + item.count + ' local files' : ''}</small></span> }))}
            placeholder="Local search · Enter stacks a term (AND)" /></div>
        <Select aria-label="Local search category" value={gallery.localSearchField} onChange={value => { gallery.setLocalSearchField(value); onLocalSearch(); }} style={{ width: 150 }} options={[{ value: 'all', label: 'All fields' }, { value: 'positive', label: 'Positive prompt' }, { value: 'negative', label: 'Negative prompt' }, { value: 'hydrus', label: 'Hydrus tag' }, { value: 'name', label: 'Filename' }]} />
        </>}<Button onClick={() => { setSeed({}); setPrefixName(''); setPrefixTags([]); setOpen(true); }}>Prompts & prefixes</Button>
        <Modal title="Prompts & prefixes" open={open} onCancel={() => setOpen(false)} footer={null} width={950} zIndex={BASE_Z_INDEX + 70}>
            <Typography.Paragraph strong>Shared prefix manager</Typography.Paragraph>
            {!shared.tags.length && !shared.prefixes.length && <Button onClick={() => { void migrateBrowserPrefixes(shared.revision!).then(load).catch(error => message.error(String(error))); }}>Import legacy browser library</Button>}
            {seed.node && <Typography.Paragraph>Editing for {seed.node.title || 'Prompt Library'} #{seed.node.id}. Choose “Use in this node” on a saved prefix below.</Typography.Paragraph>}
            {(seed.positive || seed.negative || seed.hydrus) && <Space wrap>{(['positive', 'negative', 'hydrus'] as const).map(side => <Button key={side} disabled={!seed[side]?.length} onClick={() => setPrefixTags(old => Array.from(new Set([...old, ...(seed[side] || [])])))}>Add image {side} ({seed[side]?.length || 0})</Button>)}<Button onClick={() => setPrefixTags([])}>Clear draft terms</Button></Space>}
            <Input aria-label="Prefix name" placeholder="Prefix name (existing name updates it)" value={prefixName} onChange={event => setPrefixName(event.target.value)} />
            <HydrusTagSelect label="Prefix tags" value={prefixTags} onChange={setPrefixTags} active={open} placeholder="Search Danbooru tags, Hydrus tags, or type @prefix" />
            <Checkbox checked={spaces} onChange={event => { setSpaces(event.target.checked); }}>Prefer spaces for recognized Danbooru prompt tags (off preserves canonical underscores)</Checkbox>
            <Button onClick={() => { void formatPromptTerms(prefixTags, spaces).then(setPrefixTags).catch(error => message.error(String(error))); }}>Apply spelling to draft</Button>
            <Button onClick={() => { void savePrefix(prefixName, prefixTags, shared.revision).then(async value => { message.success(value); const data = await load(); const prefix = data?.prefixes.find(item => item.name.toLowerCase() === prefixName.trim().toLowerCase()); if (seed.node && data && prefix) applyLibraryPrefix(seed.node, data, prefix.id, (await formatPromptTerms(expandPrefix(data, '@' + prefix.name), spaces)).join(', ')); }).catch(error => message.error(String(error))); }}>Save prefix</Button>
            <Typography.Paragraph>{indexed.length.toLocaleString()} positive/negative phrases indexed across the loaded local root. Comma/newline phrases stay intact. Missing embedded prompts cannot be inferred.</Typography.Paragraph>
            <Space wrap><Input aria-label="Find indexed prompt" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Find a phrase or prefix" /><Select aria-label="Prompt vocabulary" value={side} onChange={setSide} options={['positive', 'negative', 'hydrus', 'library', 'all'].map(value => ({ value, label: value }))} /><Button onClick={() => void load()}>Refresh library</Button></Space>
            <Typography.Paragraph type="secondary">{status}. Prefix definitions are shared with your Prompt Library node. Save only selected vocabulary tags; the full dictionary stays available without duplicating it.</Typography.Paragraph>
            <div style={{ maxHeight: '55vh', overflow: 'auto' }}>{rows.map((item, i) => <div key={item.side + i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #8883' }}>
                <div style={{ flex: 1, minWidth: 0 }}><strong>{item.label}</strong><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.value !== item.label ? item.value : ''}</div><small>{item.side} {item.count ? '· ' + item.count + ' files' : ''}</small></div>
                <Button onClick={() => { gallery.setLocalSearchField(item.side === 'Library prefix' ? 'all' : item.side === 'hydrus' ? 'hydrus' : item.side === 'negative' ? 'negative' : 'positive'); gallery.setLocalTerms(item.side === 'Library prefix' ? expandPrefix(shared, '@' + item.label) : [item.value]); gallery.setSearchFileName(''); onLocalSearch(); setOpen(false); }}>Search</Button>
                {item.side === 'Library prefix' && seed.node && <Button onClick={() => { const prefix = shared.prefixes.find(value => value.name === item.label)!; void formatPromptTerms(expandPrefix(shared, '@' + prefix.name), spaces).then(terms => { applyLibraryPrefix(seed.node, shared, prefix.id, terms.join(', ')); message.success('Prefix loaded into the node'); }).catch(error => message.error(String(error))); }}>Use in this node</Button>}
                {item.side === 'Library prefix' && <Button onClick={() => { setPrefixName(item.label); setPrefixTags(promptTags(item.value, '')); }}>Edit prefix</Button>}
                {item.side === 'Library prefix' && <Button danger onClick={() => Modal.confirm({ title: 'Delete prefix ' + item.label + '?', content: 'Its vocabulary tags and existing workflow text are retained.', zIndex: BASE_Z_INDEX + 90, onOk: async () => { await deletePrefix(shared.prefixes.find(prefix => prefix.name === item.label)!.id, shared.revision!); await load(); } })}>Delete prefix</Button>}
                {item.side !== 'Library prefix' && <Button onClick={() => setPrefixTags(old => Array.from(new Set([...old, item.value])))}>Add to draft</Button>}
                <Button onClick={() => navigator.clipboard.writeText(item.value).then(() => message.success('Copied prompt text')).catch(error => message.error(String(error)))}>Copy</Button>
            </div>)}</div><Typography.Text type="secondary">Showing up to 100 matches. Refine your search to find more.</Typography.Text>
        </Modal>
    </>;
}
