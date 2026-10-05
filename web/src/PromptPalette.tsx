import { defaultInsertion, type PromptInsertion } from './PromptInsertion';
import { PrefixImages } from './PrefixImages';
import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, InputNumber, Select, Space, Tabs, Typography } from 'antd';
import { hydrusRequest } from './HydrusApi';
import { expandPrefix, loadPrefixes, type SharedLibrary } from './PrefixLibrary';

type Vocabulary = { items: { name: string; count: number }[]; total: number; categories: { value: string; label: string; count: number; source: string }[] };
const FAVORITES = 'gallery-vocabulary-favorites';
/** An explicit browseable vocabulary, separate from autocomplete suggestions. */
export function PromptPalette({ onChoose, onSearch, onAppend }: { onAppend?: (groups: string[][], options: PromptInsertion) => Promise<void>; onChoose: (terms: string[], prefixId?: string, negativeTerms?: string[]) => void; onSearch?: (terms: string[]) => void }) {
    type Pick = { key: string; label: string; terms: string[]; prefixId?: string };
    const [selected, setSelected] = useState<Record<string, Pick>>({});
    const [insertion, setInsertion] = useState<PromptInsertion>(defaultInsertion);
    const [prefixSide, setPrefixSide] = useState('positive');
    const [inserting, setInserting] = useState(false);
    const [tab, setTab] = useState('tags');
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('');
    const [categoryPicks, setCategoryPicks] = useState<string[]>([]);
    const [categoryGroups, setCategoryGroups] = useState(true);
    const [sort, setSort] = useState('popular');
    const [onlyFavorites, setOnlyFavorites] = useState(false);
    const [favorites, setFavorites] = useState<string[]>(() => { try { const stored = JSON.parse(localStorage.getItem(FAVORITES) || '[]'); return Array.isArray(stored) ? stored.filter(value => typeof value === 'string') : []; } catch { return []; } });
    const [library, setLibrary] = useState<SharedLibrary>({ version: 2, tags: [], prefixes: [] });
    const [data, setData] = useState<Vocabulary>({ items: [], total: 0, categories: [] });
    const [offset, setOffset] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { const load = () => { void loadPrefixes().then(setLibrary).catch(error => setError(String(error))); }; load(); window.addEventListener('gallery-prefix-library-changed', load); return () => window.removeEventListener('gallery-prefix-library-changed', load); }, []);
    useEffect(() => { setOffset(0); }, [query, category, sort, onlyFavorites, tab]);
    useEffect(() => {
        if (tab !== 'tags') { setBusy(false); return; }
        let live = true; setBusy(true);
        const timer = setTimeout(() => { void hydrusRequest<Vocabulary>('dictionary', { browse: true, query, category, sort, offset, limit: 60, ...(onlyFavorites ? { favorites: favorites.filter(value => value.startsWith('tag:')).map(value => value.slice(4)) } : {}) }).then(value => { if (live) { setData(value); setError(''); } }).catch(error => { if (live) setError(String(error)); }).finally(() => { if (live) setBusy(false); }); }, 150);
        return () => { live = false; clearTimeout(timer); };
    }, [tab, query, category, sort, offset, onlyFavorites, favorites]);
    const favorite = (key: string) => setFavorites(old => { const next = old.includes(key) ? old.filter(value => value !== key) : [...old, key]; localStorage.setItem(FAVORITES, JSON.stringify(next)); return next; });
    const prefixes = library.prefixes.filter(prefix => (prefix.name + ' ' + expandPrefix(library, '@' + prefix.name).join(' ')).toLowerCase().includes(query.toLowerCase()) && (!onlyFavorites || favorites.includes('prefix:' + prefix.id))).sort((a, b) => sort === 'alphabetical' ? a.name.localeCompare(b.name) : Number(favorites.includes('prefix:' + b.id)) - Number(favorites.includes('prefix:' + a.id)) || a.name.localeCompare(b.name));
    const rows = tab === 'tags' ? data.items.map(item => ({ key: 'tag:' + item.name, label: item.name, detail: item.count.toLocaleString() + ' Danbooru snapshot uses', terms: [item.name], prefixId: undefined as string | undefined })) : prefixes.slice(offset, offset + 60).map(prefix => ({ key: 'prefix:' + prefix.id, label: prefix.name, detail: expandPrefix(library, '@' + prefix.name).join(', '), terms: expandPrefix(library, '@' + prefix.name), prefixId: prefix.id }));
    const allMatching = async (wholeCategory = false, categoryValue = category): Promise<Pick[]> => {
        if (tab === 'prefixes') return prefixes.map(prefix => ({ key: 'prefix:' + prefix.id, label: prefix.name, terms: expandPrefix(library, '@' + prefix.name), prefixId: prefix.id }));
        const value = await hydrusRequest<Vocabulary>('dictionary', { browse: true, selection: true, query: wholeCategory ? '' : query, category: categoryValue, sort, offset: 0, limit: 10000, ...(!wholeCategory && onlyFavorites ? { favorites: favorites.filter(value => value.startsWith('tag:')).map(value => value.slice(4)) } : {}) });
        if (value.total > 10000) throw new Error('More than 10,000 tags match. Choose a category or narrow the search before selecting all.');
        return value.items.map(item => ({ key: 'tag:' + item.name, label: item.name, terms: [item.name] }));
    };
    const append = async (picks: Pick[], options = insertion) => {
        if (!onAppend || !picks.length) return;
        setInserting(true); setError('');
        try {
            const groups = picks.map(row => prefixSide === 'negative' && row.prefixId ? library.prefixes.find(prefix => prefix.id === row.prefixId)?.negative_terms || [] : row.terms).filter(terms => terms.length);
            if (!groups.length) throw new Error('These prefixes contain no terms on the selected side.');
            await onAppend(groups, options);
        } catch (error) { setError(String(error)); } finally { setInserting(false); }
    };
    const appendCategories = async () => {
        setInserting(true); setError('');
        try {
            const picks: Pick[] = [];
            let total = 0;
            for (const value of categoryPicks) {
                const items = await allMatching(true, value);
                total += items.length;
                if (total > 10000) throw new Error('The selected categories exceed 10,000 tags. Select fewer categories.');
                if (categoryGroups) picks.push({ key: value, label: value, terms: items.map(item => item.label) });
                else picks.push(...items);
            }
            await append(picks, { ...insertion, format: insertion.format === 'optional' ? 'optional' : 'alternatives', categoryGroups });
        } catch (error) { setError(String(error)); } finally { setInserting(false); }
    };
    const selectAll = async () => { setInserting(true); setError(''); try { const all = await allMatching(); setSelected(Object.fromEntries(all.map(row => [row.key, row]))); } catch (error) { setError(String(error)); } finally { setInserting(false); } };
    const total = tab === 'tags' ? data.total : prefixes.length;
    const group = data.categories.find(item => item.value === category);
    return <div className="cg-prompt-palette" style={{ border: '1px solid #8884', borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <Tabs activeKey={tab} onChange={value => { setTab(value); setSelected({}); }} items={[{ key: 'tags', label: 'Tags' }, { key: 'prefixes', label: 'Prefixes' }]} />
        <Space wrap>
            <Input aria-label="Browse vocabulary" placeholder={tab === 'tags' ? 'Search common tags and aliases' : 'Search saved prefixes'} value={query} onChange={event => setQuery(event.target.value)} allowClear />
            {tab === 'tags' && <Select showSearch optionFilterProp="label" aria-label="Danbooru wiki category" style={{ width: 240 }} value={category} onChange={setCategory} options={[{ value: '', label: 'All wiki categories / uncategorized' }, ...data.categories.map(item => ({ value: item.value, label: item.label + ' (' + item.count + ')' }))]} />}
            <Select aria-label="Vocabulary order" value={sort} onChange={setSort} options={[{ value: 'popular', label: tab === 'tags' ? 'Most common' : 'Favorites first' }, { value: 'alphabetical', label: 'Alphabetical' }]} />
            <Checkbox checked={onlyFavorites} onChange={event => setOnlyFavorites(event.target.checked)}>Favorites only</Checkbox>
        </Space>
        {group && tab === 'tags' && <div><Typography.Link href={group.source} target="_blank" rel="noreferrer">Danbooru wiki: {group.label}</Typography.Link></div>}
        {onAppend && <><Space wrap style={{ marginTop: 10 }}>
            <Button disabled={busy || inserting} onClick={() => void selectAll()}>Select all matching</Button>
            <Button disabled={!Object.keys(selected).length || inserting} onClick={() => setSelected({})}>Clear picks</Button>
            <Button type="primary" disabled={!Object.keys(selected).length || busy} loading={inserting} onClick={() => void append(Object.values(selected))}>Append selected ({Object.keys(selected).length})</Button>
            {tab === 'tags' && category && <Button disabled={busy || inserting} onClick={() => { setInserting(true); void allMatching(true).then(rows => append(rows, { ...insertion, format: insertion.format === 'optional' ? 'optional' : 'alternatives' })).catch(error => setError(String(error))).finally(() => setInserting(false)); }}>Append entire category as alternatives</Button>}
        </Space><Space wrap style={{ marginTop: 8 }}>
            <Select aria-label="Insertion position" value={insertion.position} onChange={position => setInsertion(old => ({ ...old, position }))} options={[{value:'after',label:'Append after'},{value:'before',label:'Prepend before'}]} />
            <Select aria-label="Insertion format" value={insertion.format} onChange={format => setInsertion(old => ({ ...old, format }))} options={[{value:'comma',label:'Comma-separated tags'},{value:'alternatives',label:'Alternatives {a|b|c}'},{value:'optional',label:'Optional alternatives {a|b|c|}'}]} />
            <label>Weight <InputNumber aria-label="Insertion weight" min={0} max={3} step={0.05} value={insertion.weight} onChange={weight => setInsertion(old => ({ ...old, weight: weight ?? 1 }))} /></label>
            <Input aria-label="Insertion prefix" placeholder="Text before insertion" value={insertion.prefix} onChange={event => setInsertion(old => ({ ...old, prefix: event.target.value }))} style={{width:175}} />
            <Input aria-label="Insertion suffix" placeholder="Text after insertion" value={insertion.suffix} onChange={event => setInsertion(old => ({ ...old, suffix: event.target.value }))} style={{width:175}} />
            {tab === 'prefixes' && <Select aria-label="Prefix polarity to append" value={prefixSide} onChange={setPrefixSide} options={[{value:'positive',label:'Positive prefix terms'},{value:'negative',label:'Negative prefix terms'}]} />}
        </Space>{tab === 'tags' && <Space wrap style={{ marginTop: 8, display:'flex' }}>
            <Select mode="multiple" showSearch optionFilterProp="label" aria-label="Categories to append" placeholder="Choose several whole categories" value={categoryPicks} onChange={setCategoryPicks} style={{minWidth:280, flex:1}} options={data.categories.map(item => ({value:item.value,label:item.label + ' (' + item.count + ')'}))} />
            <Select aria-label="Category grouping" value={categoryGroups ? 'separate' : 'combined'} onChange={value => setCategoryGroups(value === 'separate')} options={[{value:'separate',label:'One group per category'},{value:'combined',label:'One combined group'}]} />
            <Button disabled={!categoryPicks.length || inserting} onClick={() => void appendCategories()}>Append categories ({categoryPicks.length})</Button>
        </Space>}<div><Typography.Text type="secondary">Selection spans pages. Category append includes the whole category, ignoring search/favorites. Each prefix is one alternative. Optional alternatives add an empty choice (one tag/prefix or nothing). Category groups can be separate or combined. Braces use your workflow's dynamic-prompt handling.</Typography.Text></div></>}
        <div style={{ maxHeight: 235, overflowY: 'auto', marginTop: 8 }} aria-busy={busy}>
            {rows.map(row => <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                {onAppend && <><Checkbox aria-label={'Pick ' + row.label} checked={!!selected[row.key]} disabled={busy || inserting} onChange={event => setSelected(old => { const next = { ...old }; if (event.target.checked) next[row.key] = row; else delete next[row.key]; return next; })} /><Button size="small" disabled={busy || inserting} aria-label={'Append ' + row.label} onClick={() => void append([row])}>Append</Button></>}
                <Button size="small" aria-label={'Favorite ' + row.label} aria-pressed={favorites.includes(row.key)} onClick={() => favorite(row.key)}>{favorites.includes(row.key) ? '★' : '☆'}</Button>
                <Button size="small" disabled={busy && tab === 'tags'} onClick={() => onChoose(row.terms, row.prefixId, library.prefixes.find(prefix => prefix.id === row.prefixId)?.negative_terms)} aria-label={'Add ' + row.label}>{row.label.replace(/_/g, ' ')}</Button>
                {onSearch && <Button size="small" onClick={() => onSearch(row.terms)} aria-label={'Search local for ' + row.label}>Search</Button>}{row.prefixId && <PrefixImages library={library} prefixId={row.prefixId} />}
                <Typography.Text type="secondary" style={{ overflowWrap: 'anywhere' }}>{row.detail}</Typography.Text>
            </div>)}
            {!rows.length && !busy && <Typography.Text type="secondary">No matches. Create a prefix below or change the filters.</Typography.Text>}
        </div>
        <Space><Button size="small" disabled={!offset || busy} onClick={() => setOffset(value => Math.max(0, value - 60))}>Previous vocabulary page</Button><span>{total ? offset + 1 : 0}–{Math.min(offset + 60, total)} / {total.toLocaleString()}</span><Button size="small" disabled={offset + 60 >= total || busy} onClick={() => setOffset(value => value + 60)}>Next vocabulary page</Button></Space>
        <div><Typography.Text type="secondary">Wiki categories use an offline snapshot; tags may belong to several groups. Favorites are saved in this browser. Counts are Danbooru usage, not your Hydrus database.</Typography.Text></div>
        {error && <Alert type="error" message={error} />}
    </div>;
}
