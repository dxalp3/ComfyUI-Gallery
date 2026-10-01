import { useEffect, useRef, useState } from 'react';
import { Alert, Button, InputNumber, Select, Space, Typography } from 'antd';
import { hydrusRequest } from './HydrusApi';

type Suggestion = { value: string; count?: number };
export function HydrusSearchPanel({ tags, setTags, match, setMatch, limit, setLimit, busy, disabled, configured, scope, onSearch, inputRef, orGroups, setOrGroups, sortType, setSortType, ascending, setAscending }: {
    tags: string[]; setTags: (tags: string[]) => void; match: 'all' | 'any'; setMatch: (match: 'all' | 'any') => void;
    limit: number; setLimit: (limit: number) => void; busy: boolean; disabled: boolean; configured: boolean; scope: string;
    orGroups: string[][]; setOrGroups: (groups: string[][]) => void; sortType: number; setSortType: (value: number) => void; ascending: boolean; setAscending: (value: boolean) => void;
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, width: '100%', marginBottom: 8 }}>
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
                placeholder="Type a tag for recommendations · press Enter to add" style={{ flex: '1 1 220px', minWidth: 160 }} />
            {orGroups.map((group, index) => <Space.Compact key={index} style={{ display: 'flex', flex: '1 1 260px', maxWidth: 450 }}>
                <span style={{ alignSelf: 'center', padding: '0 8px', fontSize: 12 }}>AND</span>
                <Select mode="tags" aria-label={'OR group ' + (index + 1)} value={group} disabled={busy || disabled} style={{ flex: 1, minWidth: 150 }} placeholder="OR · any of these tags" onChange={values => setOrGroups(orGroups.map((old, i) => i === index ? values : old))} />
                <Button aria-label={'Remove group ' + (index + 1)} disabled={busy || disabled} onClick={() => setOrGroups(orGroups.filter((_, i) => i !== index))}>×</Button>
            </Space.Compact>)}
            <Button title="Add a group where any term can match. Groups are joined with AND." disabled={busy || disabled || orGroups.length >= 20} onClick={() => setOrGroups([...orGroups, []])}>Add OR group</Button>
            <Select aria-label="Tag match mode" value={match} onChange={setMatch} disabled={busy || disabled} style={{ width: 165 }}
                options={[{ value: 'all', label: 'All tags (AND)' }, { value: 'any', label: 'Any tag (OR)' }]} />
            <InputNumber aria-label="Search result limit" min={1} max={200} value={limit} onChange={value => setLimit(value || 100)} disabled={busy || disabled} />
            <Button type="primary" disabled={!configured || disabled} loading={busy} onClick={onSearch}>Search</Button>
        </div>
        <Typography.Paragraph type="secondary">{match === 'all' ? 'All selected tags must match.' : 'Any positive tag can match.'} Excluded tags (-portrait) and system filters always apply. OR chip groups sit alongside the main tags; each group must match. Empty search shows recent images. Ctrl/Cmd+Enter searches added tags.</Typography.Paragraph>
        <Space wrap style={{ marginBottom: 8 }}>
            <span>Hydrus search order</span><Select aria-label="Hydrus search order" value={sortType} onChange={setSortType} disabled={busy || disabled} style={{ width: 210 }} options={[
                [2, 'Import date'], [14, 'Modified date'], [19, 'Archive date'], [18, 'Last viewed'], [4, 'Random'], [3, 'Filetype'], [20, 'SHA-256 hash'], [21, 'Pixel hash'], [22, 'Blurhash'], [0, 'File size'], [5, 'Width'], [6, 'Height'], [7, 'Aspect ratio'], [8, 'Pixel count'], [9, 'Tag count'], [1, 'Duration'], [10, 'Media views'], [11, 'Media viewtime'], [12, 'Bitrate'], [13, 'Has audio'], [15, 'Framerate'], [16, 'Frame count'], [23, 'Colour: lightness'], [24, 'Colour: saturation'], [25, 'Colour: green/red'], [26, 'Colour: blue/yellow'], [27, 'Colour: hue']
            ].map(([value, label]) => ({ value: Number(value), label }))} />
            <Select aria-label="Hydrus sort direction" value={ascending ? 'asc' : 'desc'} onChange={value => setAscending(value === 'asc')} disabled={busy || disabled || sortType === 4 || sortType === 3} options={[{ value: 'desc', label: 'Descending' }, { value: 'asc', label: 'Ascending' }]} />
            <Typography.Text type="secondary">Applied when you Search; result limit applies in Hydrus.</Typography.Text>
        </Space>
        {error && <Alert type="warning" showIcon message="Tag suggestions unavailable" description={`${error} You can still enter tags manually.`} style={{ marginBottom: 12 }} />}
    </>;
}
