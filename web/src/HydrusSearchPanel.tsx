import { useEffect, useRef, useState } from 'react';
import { Alert, Button, InputNumber, Select, Space, Typography } from 'antd';
import { hydrusRequest } from './HydrusApi';

type Suggestion = { value: string; count?: number };
export function HydrusSearchPanel({ tags, setTags, match, setMatch, limit, setLimit, busy, disabled, configured, scope, onSearch, inputRef }: {
    tags: string[]; setTags: (tags: string[]) => void; match: 'all' | 'any'; setMatch: (match: 'all' | 'any') => void;
    limit: number; setLimit: (limit: number) => void; busy: boolean; disabled: boolean; configured: boolean; scope: string;
    onSearch: () => void; inputRef: React.RefObject<any>;
}) {
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const generation = useRef(0);
    const prefix = query.trim().startsWith('-') ? '-' : '';
    useEffect(() => {
        const version = ++generation.current;
        const search = query.trim().replace(/^-/, '');
        setSuggestions([]); setHasMore(false); setError(''); setLoading(false);
        if (!configured || !search || search.toLowerCase().startsWith('system:')) return;
        setLoading(true);
        const timer = window.setTimeout(async () => {
            try {
                const response = await hydrusRequest<{ tags: Suggestion[]; has_more: boolean }>('suggest', { query: search, limit: 50 });
                if (generation.current !== version) return;
                setSuggestions(response.tags); setHasMore(response.has_more);
            } catch (reason) {
                if (generation.current === version) setError(reason instanceof Error ? reason.message : String(reason));
            } finally { if (generation.current === version) setLoading(false); }
        }, 250);
        return () => { window.clearTimeout(timer); generation.current++; };
    }, [query, scope, configured]);

    const chooseAll = () => {
        setTags(Array.from(new Set([...tags, ...suggestions.map(suggestion => prefix + suggestion.value)])));
        setMatch('any'); setQuery(''); setDropdownOpen(false); inputRef.current?.focus();
    };
    return <>
        <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
            <Select ref={inputRef} aria-label="Hydrus search tags" mode="tags" value={tags} searchValue={query}
                onSearch={setQuery} onChange={values => { setTags(values); setQuery(''); }}
                open={dropdownOpen} onOpenChange={setDropdownOpen} disabled={busy || disabled} loading={loading}
                filterOption={false} optionLabelProp="value" autoClearSearchValue={false}
                options={suggestions.map(suggestion => ({ value: prefix + suggestion.value,
                    label: <Space style={{ display: 'flex', justifyContent: 'space-between' }}><span>{prefix + suggestion.value}</span><Typography.Text type="secondary">{suggestion.count?.toLocaleString() ?? ''}</Typography.Text></Space> }))}
                notFoundContent={loading ? 'Loading tag suggestions…' : error || (query ? 'No suggestions. Press Enter to use your text.' : 'Type to search tags in Hydrus')}
                popupRender={menu => <div>
                    <div style={{ padding: 8, borderBottom: '1px solid #8884' }} onMouseDown={event => event.preventDefault()}>
                        <Button size="small" disabled={loading || !suggestions.length} onClick={chooseAll}>Select all suggestions for OR ({suggestions.length})</Button>
                        {hasMore && <Typography.Paragraph type="secondary" style={{ margin: '6px 0 0' }}>First 50 suggestions shown. Refine your text for more specific matches.</Typography.Paragraph>}
                    </div>{menu}
                </div>}
                onInputKeyDown={event => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); onSearch(); }
                }}
                placeholder="Type a tag for recommendations · press Enter to add" style={{ flex: 1 }} />
            <Select aria-label="Tag match mode" value={match} onChange={setMatch} disabled={busy || disabled} style={{ width: 165 }}
                options={[{ value: 'all', label: 'All tags (AND)' }, { value: 'any', label: 'Any tag (OR)' }]} />
            <InputNumber aria-label="Search result limit" min={1} max={200} value={limit} onChange={value => setLimit(value || 100)} disabled={busy || disabled} />
            <Button type="primary" disabled={!configured || disabled} loading={busy} onClick={onSearch}>Search</Button>
        </Space.Compact>
        <Typography.Paragraph type="secondary">{match === 'all' ? 'All selected tags must match.' : 'Any positive tag can match.'} Excluded tags (-portrait) and system filters always apply. Empty search shows recent images. Ctrl/Cmd+Enter searches added tags.</Typography.Paragraph>
        {error && <Alert type="warning" showIcon message="Tag suggestions unavailable" description={`${error} You can still enter tags manually.`} style={{ marginBottom: 12 }} />}
    </>;
}
