import { useMemo, useState } from 'react';
import { splitTop } from './PromptBoxes';
import { Button, Input, Modal, Select, Space, Typography, message } from 'antd';
import { FloatingPanel } from './FloatingPanel';
import { PrefixImages } from './PrefixImages';
import { expandPrefix, expandSearchTerms, matchesPolarity, POLARITY_OPTIONS, type PrefixPolarity, type SharedLibrary } from './PrefixLibrary';
import type { LocalSearchField } from './LocalImageSearch';
import { BASE_Z_INDEX } from './ComfyAppApi';

export type Phrase = { value: string; label: string; side: string; count: number };
const fieldFor = (side: string): LocalSearchField => side === 'hydrus' ? 'hydrus' : side === 'negative' ? 'negative' : side === 'Library prefix' || side === 'Tag' ? 'all' : 'positive';

/** Every single tag in the pool: prompt phrases split at their commas, library tags and Hydrus tags, counted once per spelling. */
function singleTags(pool: Phrase[]): Phrase[] {
    const tags = new Map<string, Phrase>();
    for (const item of pool) {
        if (item.side === 'Library prefix') continue;
        for (const part of item.side === 'hydrus' ? [item.value] : splitTop(item.value, ',')) {
            const tag = part.trim(); if (!tag) continue;
            const key = tag.toLocaleLowerCase().replace(/_/g, ' ');
            const found = tags.get(key);
            if (found) found.count += item.count; else tags.set(key, { value: tag, label: tag, side: 'Tag', count: item.count });
        }
    }
    return [...tags.values()].sort((a, b) => b.count - a.count);
}

/**
 * The older "library search": every phrase indexed from the local images plus the saved prefixes
 * (including prefixes that are not made of Danbooru tags). It lives in its own window now so it
 * no longer takes up room under the prefix editor.
 */
export function LibrarySearchPanel({ open, onClose, pool, shared, status, indexedCount, canAppendToNode, onRefresh, onSearch, onAddToDraft, onEditPrefix, onDeletePrefix, onAppendToNode }: {
    open: boolean; onClose: () => void; pool: Phrase[]; shared: SharedLibrary; status: string; indexedCount: number; canAppendToNode: boolean;
    onRefresh: () => void;
    /** With `prefixId` the search is for the prefix's lineage, not just its tags. */
    onSearch: (terms: string[], field: LocalSearchField, prefixId?: string) => void;
    onAddToDraft: (terms: string[], side: 'positive' | 'negative') => void;
    onEditPrefix: (name: string) => void;
    onDeletePrefix: (id: string) => Promise<void>;
    onAppendToNode: (id: string) => void;
}) {
    const [filter, setFilter] = useState('');
    const [side, setSide] = useState('all');
    const [polarity, setPolarity] = useState<PrefixPolarity>('all');
    const needle = filter.toLocaleLowerCase();
    /** The polarity filter applies to saved prefixes; when it is set, only prefixes are listed. */
    const polarityOk = (item: Phrase) => polarity === 'all' || item.side === 'Library prefix' && matchesPolarity(shared.prefixes.find(value => value.name === item.label) || { tags: [] }, polarity);
    const tags = useMemo(() => side === 'tags' ? singleTags(pool) : [], [side, pool]);
    const rows = (side === 'tags' ? tags : pool).filter(item => polarityOk(item) && (side === 'all' || side === 'tags' || item.side === side || side === 'library' && item.side.startsWith('Library') || side === 'prefixes' && item.side === 'Library prefix') &&
        (item.value + ' ' + item.label).toLocaleLowerCase().includes(needle)).slice(0, 200);
    return <FloatingPanel panelKey="library-search" title="Library search" open={open} onCancel={onClose} footer={null} width={760}>
        <Typography.Paragraph type="secondary">{indexedCount.toLocaleString()} positive/negative phrases are indexed across the loaded local root, listed after your saved prefixes. Comma/newline phrases stay intact. Missing embedded prompts cannot be inferred.</Typography.Paragraph>
        <Space wrap>
            <Input aria-label="Find indexed prompt" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Find a phrase or prefix" allowClear style={{ width: 260 }} />
            <Select aria-label="Prompt vocabulary" value={side} onChange={setSide} style={{ width: 200 }} options={[{ value: 'all', label: 'All' }, { value: 'tags', label: 'Tags only (single tags)' }, { value: 'prefixes', label: 'Saved prefixes only' }, { value: 'library', label: 'Saved prefixes & tags' }, { value: 'positive', label: 'Positive phrases' }, { value: 'negative', label: 'Negative phrases' }, { value: 'hydrus', label: 'Hydrus tags' }]} />
            <Select aria-label="Prefix polarity filter" value={polarity} onChange={setPolarity} options={POLARITY_OPTIONS} style={{ width: 190 }} />
            <Button onClick={onRefresh}>Refresh library</Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>{status}. Prefix definitions are shared with your Prompt Library node.</Typography.Paragraph>
        <div>{rows.map((item, index) => {
            const prefix = item.side === 'Library prefix' ? shared.prefixes.find(value => value.name === item.label) : undefined;
            return <div key={item.side + index} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #8883' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{item.label}</strong>
                    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{prefix ? expandPrefix(shared, '@' + item.label).map(term => <Button key={term} size="small" type="link" onClick={() => onSearch([term], 'all')}>{term}</Button>) : item.value !== item.label ? item.value : ''}</div>
                    <small>{item.side} {item.count ? '· ' + item.count + ' files' : ''}</small>
                    {prefix && <><div>{prefix.negative_terms?.map(term => <Button size="small" key={term} onClick={() => onSearch([term], 'negative')}>Negative: {term}</Button>)}</div><PrefixImages library={shared} prefixId={prefix.id} /></>}
                </div>
                <Space wrap style={{ justifyContent: 'flex-end', maxWidth: 300 }}>
                    <Button title={prefix ? 'Paired images, their lineage and images with these tags' : undefined} onClick={() => onSearch(prefix ? expandPrefix(shared, '@' + item.label) : expandSearchTerms(shared, item.value), fieldFor(item.side), prefix?.id)}>Search</Button>
                    {prefix && canAppendToNode && <Button onClick={() => onAppendToNode(prefix.id)}>Append prefix to node</Button>}
                    {prefix && <Button onClick={() => onEditPrefix(prefix.name)}>Edit prefix</Button>}
                    {prefix && <Button danger onClick={() => Modal.confirm({ title: 'Delete prefix ' + item.label + '?', content: 'Its vocabulary tags and existing workflow text are retained.', zIndex: BASE_Z_INDEX + 90, onOk: () => onDeletePrefix(prefix.id) })}>Delete prefix</Button>}
                    {!prefix && <Button onClick={() => onAddToDraft(expandSearchTerms(shared, item.value), item.side === 'negative' ? 'negative' : 'positive')}>Add to draft</Button>}
                    <Button onClick={() => navigator.clipboard.writeText(item.value).then(() => message.success('Copied prompt text')).catch(error => message.error(String(error)))}>Copy</Button>
                </Space>
            </div>;
        })}</div>
        <Typography.Text type="secondary">Showing up to 200 matches. Refine your search to find more.</Typography.Text>
    </FloatingPanel>;
}
