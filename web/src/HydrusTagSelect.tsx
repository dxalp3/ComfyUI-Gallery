import { loadPrefixes, expandPrefix, type PrefixLibrary } from './PrefixLibrary';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button, Select, Typography } from 'antd';
import { hydrusRequest } from './HydrusApi';
import { useHydrus } from './HydrusContext';

type Suggestion = { value: string; count?: number; local?: boolean };

/** Reusable tag entry for export fields and saved defaults, including manual tags. */
export function HydrusTagSelect({ localSuggestions = [], value = [], onChange, disabled = false, active = true, serviceKey, label, placeholder, style, onSubmit, onChooseAll, inputRef }: {
    localSuggestions?: string[];
    onSubmit?: () => void; onChooseAll?: () => void; inputRef?: React.RefObject<any>;
    value?: string[]; onChange?: (tags: string[]) => void; disabled?: boolean; active?: boolean;
    serviceKey?: string; label: string; placeholder?: string; style?: CSSProperties;
}) {
    const [library, setLibrary] = useState<PrefixLibrary>({ version: 2, tags: [], prefixes: [] });
    const [dictionary, setDictionary] = useState<string[]>([]);
    useEffect(() => { const load = () => { void loadPrefixes().then(setLibrary).catch(() => {}); }; load(); window.addEventListener('gallery-prefix-library-changed', load); return () => window.removeEventListener('gallery-prefix-library-changed', load); }, [active]);
    const { settings } = useHydrus();
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [open, setOpen] = useState(false);
    const generation = useRef(0);
    useEffect(() => {
        const version = ++generation.current;
        setSuggestions([]); setHasMore(false); setError(''); setLoading(false);
        if (!active || disabled || !open || !query.trim() || !settings?.has_access_key) return;
        setLoading(true);
        const timer = window.setTimeout(async () => {
            try {
                const response = await hydrusRequest<{ tags: Suggestion[]; has_more: boolean }>('suggest', {
                    query: query.trim(), limit: 50, ...(serviceKey ? { tag_service_key: serviceKey } : {}),
                });
                if (version !== generation.current) return;
                setSuggestions(response.tags); setHasMore(response.has_more);
            } catch (reason) { if (version === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); }
            finally { if (version === generation.current) setLoading(false); }
        }, 250);
        return () => { window.clearTimeout(timer); generation.current++; };
    }, [query, open, active, disabled, serviceKey, settings?.url, settings?.profile, settings?.has_access_key]);
    useEffect(() => { if (!active) { setQuery(''); setOpen(false); } }, [active]);
    useEffect(() => { let live = true; const timer = setTimeout(() => { if (query.trim()) void hydrusRequest<{ tags: string[] }>('dictionary', { query }).then(data => { if (live) setDictionary(data.tags); }).catch(() => {}); else setDictionary([]); }, 250); return () => { live = false; clearTimeout(timer); }; }, [query]);
    useEffect(() => { if (open) void loadPrefixes().then(setLibrary).catch(() => {}); }, [open]);
    const change = (tags: string[]) => { onChange?.(Array.from(new Set(tags.flatMap(tag => value.includes(tag) ? [tag] : expandPrefix(library, tag))))); setQuery(''); };
    const prefix = query.trim().startsWith('-') ? '-' : '';
    const choices: Suggestion[] = [...suggestions, ...Array.from(new Set([...library.prefixes.map(prefix => '@' + prefix.name), ...localSuggestions, ...dictionary])).filter(tag => query.trim() && tag.toLocaleLowerCase().replace(/_/g, ' ').includes(query.trim().replace(/^-/, '').toLocaleLowerCase().replace(/_/g, ' ')) && !suggestions.some(remote => remote.value === tag)).slice(0, 40).map(value => ({ value, local: true }))];
    return <div className="cg-tag-input" style={style} onKeyDownCapture={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && (!query.trim() || value.includes(query.trim()) || event.ctrlKey || event.metaKey)) {
            event.preventDefault(); event.stopPropagation(); setQuery(''); setOpen(false); onSubmit?.();
        }
    }}><Select ref={inputRef} aria-label={label} mode="tags" value={value} onChange={change} disabled={disabled}
        searchValue={query} onSearch={setQuery} open={open && active} onOpenChange={setOpen}
        loading={loading} filterOption={false} optionLabelProp="value" autoClearSearchValue={false}
        style={{ width: '100%' }} popupMatchSelectWidth={440} placeholder={placeholder || 'Type for Hydrus recommendations · Enter adds a tag'}
        options={choices.map(tag => ({ ...tag, value: prefix + tag.value.replace(/^-/, '') })).filter(tag => !value.includes(tag.value)).map(tag => ({ value: tag.value, label: <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{tag.value}</span><Typography.Text type="secondary"><strong>{tag.local ? (tag.value.startsWith('@') ? 'saved prefix' : 'vocabulary') : `${tag.count?.toLocaleString() ?? '—'} files`}</strong></Typography.Text></div> }))}
        notFoundContent={loading ? 'Loading recommendations…' : 'Press Enter to add your own tag.'}
        popupRender={menu => <div>
            <div style={{ padding: 8, borderBottom: '1px solid #8884' }} onMouseDown={event => event.preventDefault()}>
                <Button size="small" disabled={loading || !suggestions.length} onClick={() => { change([...value, ...suggestions.map(tag => prefix + tag.value.replace(/^-/, ''))]); onChooseAll?.(); setOpen(false); }}>{onChooseAll ? 'Select all suggestions for OR' : 'Add all suggestions'} ({suggestions.length})</Button>
                {hasMore && <div>First 50 shown; refine your text to narrow the list.</div>}
                {error && <Typography.Text type="warning">Recommendations unavailable: {error} Manual tags still work.</Typography.Text>}
                {!settings?.has_access_key && <Typography.Text type="secondary">Save a Hydrus connection to load recommendations.</Typography.Text>}
            </div>{menu}
        </div>} /></div>;
}
