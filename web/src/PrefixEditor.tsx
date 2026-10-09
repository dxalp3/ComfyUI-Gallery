import { DeletePrefixButton } from './DeletePrefixButton';
import type { PrefixDraft } from './UnsavedPrefix';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { Button, Input, Select, Space, Tabs, Typography } from 'antd';
import { TermsEditor } from './PromptBoxEditor';
import { makeSuggest } from './PromptSuggest';
import { PrefixImageGrid, PrefixImages, seedImages } from './PrefixImages';
import { expandPrefix, loadPrefixes, matchesPolarity, POLARITY_OPTIONS, sidesLabel, type PrefixImage, type PrefixPolarity, type PrefixSeed, type SharedLibrary } from './PrefixLibrary';

/**
 * One place to pick, create, edit and save a prefix. Positive and negative terms get their own tab,
 * clearing is per side, and the image the prefix is being made from stays visible beside the terms.
 * Spelling (spaces vs underscores) is a gallery setting applied on save, not a checkbox here.
 */
/** Suggestions for the term editors: saved prefixes, library tags and the Danbooru dictionary. */
const suggest = makeSuggest({ loadLibrary: loadPrefixes, expandPrefix });

export function PrefixEditor({ onLoad, shared, seed, active, name, setName, positive, setPositive, negative, setNegative, saving, onSave, onDelete, onAppendToNode, onOpenLibrarySearch, onOpenPrompts, onUnpair }: {
    onLoad: (draft: PrefixDraft) => void;
    shared: SharedLibrary; seed: PrefixSeed; active: boolean;
    name: string; setName: (value: string) => void;
    positive: string[]; setPositive: Dispatch<SetStateAction<string[]>>;
    negative: string[]; setNegative: Dispatch<SetStateAction<string[]>>;
    saving: boolean; onSave: () => void; onDelete: (id: string) => Promise<void>;
    onAppendToNode?: (id: string) => void; onOpenLibrarySearch: () => void;
    onOpenPrompts?: () => void; onUnpair?: (image: PrefixImage) => void;
}) {
    const existing = shared.prefixes.find(prefix => prefix.name.toLowerCase() === name.trim().toLowerCase());
    const [polarity, setPolarity] = useState<PrefixPolarity>('all');
    const sources = seedImages(seed.imageRefs);
    const load = (id?: string) => {
        const prefix = shared.prefixes.find(value => value.id === id);
        if (!prefix) return;
        onLoad({ name: prefix.name, positive: expandPrefix(shared, '@' + prefix.name), negative: prefix.negative_terms || [] });
        setName(prefix.name); setPositive(expandPrefix(shared, '@' + prefix.name)); setNegative(prefix.negative_terms || []);
    };
    const add = (side: 'positive' | 'negative' | 'hydrus') => (side === 'negative' ? setNegative : setPositive)(old => Array.from(new Set([...old, ...(seed[side] || [])])));
    return <div className="cg-prefix-editor" style={{ border: '1px solid #8884', borderRadius: 8, padding: 10 }}>
        <Typography.Text strong>Prefix editor</Typography.Text>
        {!!seed.imageKeys?.length && <Typography.Paragraph style={{ margin: '4px 0 0' }}>Saving pairs this prefix with the selected image(s). Its terms will be enabled when you append them to a workflow.</Typography.Paragraph>}
        <Space wrap style={{ marginTop: 8, width: '100%' }}>
            <Select aria-label="Prefix polarity filter" value={polarity} onChange={setPolarity} options={POLARITY_OPTIONS} style={{ width: 190 }} />
            <Select showSearch optionFilterProp="label" aria-label="Existing prefix" placeholder="Load an existing prefix…" value={existing?.id} onChange={load} style={{ minWidth: 240 }}
                options={shared.prefixes.filter(prefix => matchesPolarity(prefix, polarity)).map(prefix => ({ value: prefix.id, label: prefix.name + ' · ' + sidesLabel(prefix) }))} notFoundContent={shared.prefixes.length ? 'No prefix matches this filter' : 'No saved prefixes yet'} />
            <Button onClick={() => { onLoad({ name: '', positive: [], negative: [] }); setName(''); setPositive([]); setNegative([]); }}>New prefix</Button>
            <Input aria-label="Prefix name" placeholder="Prefix name (an existing name updates it)" value={name} onChange={event => setName(event.target.value)} style={{ width: 280 }} />
            <Button type="primary" loading={saving} disabled={!name.trim() || (!positive.length && !negative.length)} onClick={onSave}>Save prefix</Button>
            {existing && onAppendToNode && <Button onClick={() => onAppendToNode(existing.id)}>Append to node</Button>}
            {existing && <DeletePrefixButton id={existing.id} name={existing.name} onDelete={onDelete} />}
            <Button type="link" onClick={onOpenLibrarySearch}>Library search…</Button>
            {onOpenPrompts && <Button type="link" onClick={onOpenPrompts}>Prompts & palette…</Button>}
        </Space>
        <Typography.Text type="secondary" style={{ display: 'block', margin: '4px 0 8px' }}>{existing ? 'Saving updates “' + existing.name + '”.' : name.trim() ? 'Saving creates a new prefix.' : 'Name the prefix to save it.'} Tag spelling follows Settings.</Typography.Text>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
                <Tabs size="small" items={[
                    { key: 'positive', label: 'Positive terms (' + positive.length + ')', children: <Space direction="vertical" style={{ width: '100%' }}>
                        {(!!seed.positive || !!seed.hydrus) && <Space wrap>{(['positive', 'hydrus'] as const).map(side => <Button key={side} disabled={!seed[side]?.length} onClick={() => add(side)}>Add image {side} ({seed[side]?.length || 0})</Button>)}</Space>}
                        <TermsEditor value={positive} onChange={terms => setPositive(terms)} suggest={suggest} placeholder="Terms: tags, {a|} or a OPT, a OR b, (tag:0.5), @prefix" />
                        <Button size="small" disabled={!positive.length} onClick={() => setPositive([])}>Clear positive terms</Button>
                    </Space> },
                    { key: 'negative', label: 'Negative terms (' + negative.length + ')', children: <Space direction="vertical" style={{ width: '100%' }}>
                        {!!seed.negative && <Button disabled={!seed.negative.length} onClick={() => add('negative')}>Add image negative ({seed.negative.length})</Button>}
                        <TermsEditor value={negative} onChange={terms => setNegative(terms)} suggest={suggest} placeholder="Negative terms (kept separate from the positive ones)" />
                        <Button size="small" disabled={!negative.length} onClick={() => setNegative([])}>Clear negative terms</Button>
                    </Space> },
                ]} />
            </div>
            <div style={{ flex: '0 0 250px', minWidth: 0 }}>
                <Typography.Text strong>{sources.length ? 'Source image' + (sources.length > 1 ? 's' : '') : 'Source image'}</Typography.Text>
                {sources.length ? <PrefixImageGrid images={sources} /> : <Typography.Text type="secondary" style={{ display: 'block' }}>None attached. Open this editor from an image in the viewer to pair the image with the prefix.</Typography.Text>}
                {existing && <PrefixImages library={shared} prefixId={existing.id} defaultOpen onRemove={onUnpair} />}
            </div>
        </div>
    </div>;
}
