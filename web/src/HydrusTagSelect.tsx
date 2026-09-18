import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button, Select, Typography } from 'antd';
import { hydrusRequest } from './HydrusApi';
import { useHydrus } from './HydrusContext';

type Suggestion = { value: string; count?: number };

/** Reusable tag entry for export fields and saved defaults, including manual tags. */
export function HydrusTagSelect({ value = [], onChange, disabled = false, active = true, serviceKey, label, placeholder, style }: {
    value?: string[]; onChange?: (tags: string[]) => void; disabled?: boolean; active?: boolean;
    serviceKey?: string; label: string; placeholder?: string; style?: CSSProperties;
}) {
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
    const change = (tags: string[]) => { onChange?.(Array.from(new Set(tags))); setQuery(''); };
    return <Select aria-label={label} mode="tags" value={value} onChange={change} disabled={disabled}
        searchValue={query} onSearch={setQuery} open={open && active} onOpenChange={setOpen}
        loading={loading} filterOption={false} optionLabelProp="value" autoClearSearchValue={false}
        style={style} placeholder={placeholder || 'Type for Hydrus recommendations · Enter adds a tag'}
        options={suggestions.map(tag => ({ value: tag.value, label: <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{tag.value}</span><Typography.Text type="secondary">{tag.count?.toLocaleString() || ''}</Typography.Text></div> }))}
        notFoundContent={loading ? 'Loading recommendations…' : 'Press Enter to add your own tag.'}
        popupRender={menu => <div>
            <div style={{ padding: 8, borderBottom: '1px solid #8884' }} onMouseDown={event => event.preventDefault()}>
                <Button size="small" disabled={loading || !suggestions.length} onClick={() => { change([...value, ...suggestions.map(tag => tag.value)]); setOpen(false); }}>Add all suggestions ({suggestions.length})</Button>
                {hasMore && <div>First 50 shown; refine your text to narrow the list.</div>}
                {error && <Typography.Text type="warning">Recommendations unavailable: {error} Manual tags still work.</Typography.Text>}
                {!settings?.has_access_key && <Typography.Text type="secondary">Save a Hydrus connection to load recommendations.</Typography.Text>}
            </div>{menu}
        </div>} />;
}
