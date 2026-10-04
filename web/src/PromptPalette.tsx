import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Select, Space, Tabs, Typography } from 'antd';
import { hydrusRequest } from './HydrusApi';
import { expandPrefix, loadPrefixes, type SharedLibrary } from './PrefixLibrary';

type Vocabulary = { items: { name: string; count: number }[]; total: number; categories: { value: string; label: string; count: number; source: string }[] };
const FAVORITES = 'gallery-vocabulary-favorites';
/** An explicit browseable vocabulary, separate from autocomplete suggestions. */
export function PromptPalette({ onChoose }: { onChoose: (terms: string[], prefixId?: string) => void }) {
    const [tab, setTab] = useState('tags');
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('');
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
    const total = tab === 'tags' ? data.total : prefixes.length;
    const group = data.categories.find(item => item.value === category);
    return <div className="cg-prompt-palette" style={{ border: '1px solid #8884', borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <Tabs activeKey={tab} onChange={setTab} items={[{ key: 'tags', label: 'Tags' }, { key: 'prefixes', label: 'Prefixes' }]} />
        <Space wrap>
            <Input aria-label="Browse vocabulary" placeholder={tab === 'tags' ? 'Search common tags and aliases' : 'Search saved prefixes'} value={query} onChange={event => setQuery(event.target.value)} allowClear />
            {tab === 'tags' && <Select showSearch optionFilterProp="label" aria-label="Danbooru wiki category" style={{ width: 240 }} value={category} onChange={setCategory} options={[{ value: '', label: 'All wiki categories / uncategorized' }, ...data.categories.map(item => ({ value: item.value, label: item.label + ' (' + item.count + ')' }))]} />}
            <Select aria-label="Vocabulary order" value={sort} onChange={setSort} options={[{ value: 'popular', label: tab === 'tags' ? 'Most common' : 'Favorites first' }, { value: 'alphabetical', label: 'Alphabetical' }]} />
            <Checkbox checked={onlyFavorites} onChange={event => setOnlyFavorites(event.target.checked)}>Favorites only</Checkbox>
        </Space>
        {group && tab === 'tags' && <div><Typography.Link href={group.source} target="_blank" rel="noreferrer">Danbooru wiki: {group.label}</Typography.Link></div>}
        <div style={{ maxHeight: 235, overflowY: 'auto', marginTop: 8 }} aria-busy={busy}>
            {rows.map(row => <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <Button size="small" aria-label={'Favorite ' + row.label} aria-pressed={favorites.includes(row.key)} onClick={() => favorite(row.key)}>{favorites.includes(row.key) ? '★' : '☆'}</Button>
                <Button size="small" disabled={busy && tab === 'tags'} onClick={() => onChoose(row.terms, row.prefixId)} aria-label={'Add ' + row.label}>{row.label.replace(/_/g, ' ')}</Button>
                <Typography.Text type="secondary" style={{ overflowWrap: 'anywhere' }}>{row.detail}</Typography.Text>
            </div>)}
            {!rows.length && !busy && <Typography.Text type="secondary">No matches. Create a prefix below or change the filters.</Typography.Text>}
        </div>
        <Space><Button size="small" disabled={!offset || busy} onClick={() => setOffset(value => Math.max(0, value - 60))}>Previous vocabulary page</Button><span>{total ? offset + 1 : 0}–{Math.min(offset + 60, total)} / {total.toLocaleString()}</span><Button size="small" disabled={offset + 60 >= total || busy} onClick={() => setOffset(value => value + 60)}>Next vocabulary page</Button></Space>
        <div><Typography.Text type="secondary">Wiki categories use an offline snapshot; tags may belong to several groups. Favorites are saved in this browser. Counts are Danbooru usage, not your Hydrus database.</Typography.Text></div>
        {error && <Alert type="error" message={error} />}
    </div>;
}
