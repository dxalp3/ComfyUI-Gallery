import { useState, type Dispatch, type SetStateAction } from 'react';
import { Button, Input, Modal, Select, Space, Tabs, Typography } from 'antd';
import { HydrusTagSelect } from './HydrusTagSelect';
import { PrefixImageGrid, PrefixImages, seedImages } from './PrefixImages';
import { expandPrefix, matchesPolarity, POLARITY_OPTIONS, sidesLabel, type PrefixImage, type PrefixPolarity, type PrefixSeed, type SharedLibrary } from './PrefixLibrary';
import type { SearchPrefix } from './TagSearchPanel';
import { BASE_Z_INDEX } from './ComfyAppApi';

/**
 * One place to pick, create, edit and save a prefix. Positive and negative terms get their own tab,
 * clearing is per side, and the image the prefix is being made from stays visible beside the terms.
 * Spelling (spaces vs underscores) is a gallery setting applied on save, not a checkbox here.
 */
export function PrefixEditor({ shared, seed, active, name, setName, positive, setPositive, negative, setNegative, saving, onSave, onDelete, onAppendToNode, onSearchImages, onOpenLibrarySearch, onOpenPrompts, onUnpair }: {
    shared: SharedLibrary; seed: PrefixSeed; active: boolean;
    name: string; setName: (value: string) => void;
    positive: string[]; setPositive: Dispatch<SetStateAction<string[]>>;
    negative: string[]; setNegative: Dispatch<SetStateAction<string[]>>;
    saving: boolean; onSave: () => void; onDelete: (id: string) => Promise<void>;
    onAppendToNode?: (id: string) => void; onSearchImages: (terms: string[], prefix?: SearchPrefix) => void; onOpenLibrarySearch: () => void;
    onOpenPrompts?: () => void; onUnpair?: (image: PrefixImage) => void;
}) {
    const existing = shared.prefixes.find(prefix => prefix.name.toLowerCase() === name.trim().toLowerCase());
    const [polarity, setPolarity] = useState<PrefixPolarity>('all');
    const sources = seedImages(seed.imageRefs);
    const load = (id?: string) => {
        const prefix = shared.prefixes.find(value => value.id === id);
        if (!prefix) return;
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
            <Button onClick={() => { setName(''); setPositive([]); setNegative([]); }}>New prefix</Button>
            <Input aria-label="Prefix name" placeholder="Prefix name (an existing name updates it)" value={name} onChange={event => setName(event.target.value)} style={{ width: 280 }} />
            <Button type="primary" loading={saving} disabled={!name.trim() || (!positive.length && !negative.length)} onClick={onSave}>Save prefix</Button>
            {existing && onAppendToNode && <Button onClick={() => onAppendToNode(existing.id)}>Append to node</Button>}
            {existing && <Button danger onClick={() => Modal.confirm({ title: 'Delete prefix ' + existing.name + '?', content: 'Its vocabulary tags and existing workflow text are retained.', zIndex: BASE_Z_INDEX + 90, onOk: () => onDelete(existing.id) })}>Delete prefix</Button>}
            <Button disabled={!positive.length && !existing} title={existing ? 'Images paired with this prefix and everything generated from them' : 'Images whose prompt contains these tags'}
                onClick={() => onSearchImages(positive, { id: existing?.id, name: existing?.name || name.trim() || 'draft', terms: existing ? expandPrefix(shared, '@' + existing.name) : positive })}>Find images</Button>
            <Button type="link" onClick={onOpenLibrarySearch}>Library search…</Button>
            {onOpenPrompts && <Button type="link" onClick={onOpenPrompts}>Prompts & palette…</Button>}
        </Space>
        <Typography.Text type="secondary" style={{ display: 'block', margin: '4px 0 8px' }}>{existing ? 'Saving updates “' + existing.name + '”.' : name.trim() ? 'Saving creates a new prefix.' : 'Name the prefix to save it.'} Tag spelling follows Settings.</Typography.Text>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
                <Tabs size="small" items={[
                    { key: 'positive', label: 'Positive terms (' + positive.length + ')', children: <Space direction="vertical" style={{ width: '100%' }}>
                        {(!!seed.positive || !!seed.hydrus) && <Space wrap>{(['positive', 'hydrus'] as const).map(side => <Button key={side} disabled={!seed[side]?.length} onClick={() => add(side)}>Add image {side} ({seed[side]?.length || 0})</Button>)}</Space>}
                        <HydrusTagSelect label="Prefix tags" value={positive} onChange={setPositive} active={active} placeholder="Search Danbooru tags, Hydrus tags, or type @prefix" />
                        <Button size="small" disabled={!positive.length} onClick={() => setPositive([])}>Clear positive terms</Button>
                    </Space> },
                    { key: 'negative', label: 'Negative terms (' + negative.length + ')', children: <Space direction="vertical" style={{ width: '100%' }}>
                        {!!seed.negative && <Button disabled={!seed.negative.length} onClick={() => add('negative')}>Add image negative ({seed.negative.length})</Button>}
                        <HydrusTagSelect label="Negative prefix tags" value={negative} onChange={setNegative} active={active} placeholder="Negative terms are kept separate from positive tags" />
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
