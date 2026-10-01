import { useState } from 'react';
import { Button, InputNumber, Select, Space, Typography, Modal, Tag } from 'antd';
import { HydrusTagSelect } from './HydrusTagSelect';
import { BASE_Z_INDEX } from './ComfyAppApi';

export function HydrusSearchPanel({ tags, setTags, match, setMatch, limit, setLimit, busy, disabled, configured, scope, onSearch, inputRef, orGroups, setOrGroups, sortType, setSortType, ascending, setAscending }: {
    tags: string[]; setTags: (tags: string[]) => void; match: 'all' | 'any'; setMatch: (match: 'all' | 'any') => void;
    limit: number; setLimit: (limit: number) => void; busy: boolean; disabled: boolean; configured: boolean; scope: string;
    orGroups: string[][]; setOrGroups: (groups: string[][]) => void; sortType: number; setSortType: (value: number) => void; ascending: boolean; setAscending: (value: boolean) => void;
    onSearch: () => void; inputRef: React.RefObject<any>;
}) {
    const [editing, setEditing] = useState<number | null>(null);
    const [draft, setDraft] = useState<string[]>([]);
    const commitGroup = () => {
        if (!draft.length || editing === null) return;
        setOrGroups(editing === orGroups.length ? [...orGroups, draft] : orGroups.map((old, i) => i === editing ? draft : old));
        setEditing(null);
    };
    return <>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <HydrusTagSelect inputRef={inputRef} label="Hydrus search tags" value={tags} onChange={setTags} disabled={busy || disabled} onSubmit={onSearch} onChooseAll={() => setMatch('any')} style={{ flex: '1 1 340px', minWidth: 180 }} />
            {orGroups.map((group, index) => <Tag key={index} closable onClose={() => setOrGroups(orGroups.filter((_, i) => i !== index))} style={{ maxWidth: 230, cursor: 'pointer', padding: '6px 8px' }} title={group.join(' OR ')}>
                <span role="button" tabIndex={0} aria-label={'Edit OR group ' + (index + 1)} onClick={() => { setDraft(group); setEditing(index); }} onKeyDown={event => { if (event.key === 'Enter') { setDraft(group); setEditing(index); } }} style={{ display: 'inline-block', maxWidth: 185, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom' }}>AND ({group.join(' OR ')})</span>
            </Tag>)}
            <Button disabled={busy || disabled || orGroups.length >= 20} onClick={() => { setDraft([]); setEditing(orGroups.length); }}>Add OR group</Button>
            <Select aria-label="Tag match mode" value={match} onChange={setMatch} disabled={busy || disabled} style={{ width: 145 }} options={[{ value: 'all', label: 'All tags (AND)' }, { value: 'any', label: 'Any tag (OR)' }]} />
            <InputNumber aria-label="Search result limit" min={1} max={200} value={limit} onChange={value => setLimit(value || 100)} disabled={busy || disabled} />
            <Button aria-label="Search" type="primary" disabled={!configured || disabled} loading={busy} onClick={onSearch}>Search</Button>
        </div>
        <Typography.Paragraph type="secondary">Enter adds a tag; Enter on an empty input searches. Counts are from your Hydrus database's local-file domain. Click an OR chip to edit its alternatives.</Typography.Paragraph>
        <Modal title="OR tag group" open={editing !== null} onCancel={() => setEditing(null)} onOk={commitGroup} okText="Apply OR group" okButtonProps={{ disabled: !draft.length }} zIndex={BASE_Z_INDEX + 30} width={600}>
            <Typography.Paragraph>Any tag in this group can match. This group is ANDed with the other search chips.</Typography.Paragraph>
            <HydrusTagSelect label="OR group tags" value={draft} onChange={setDraft} active={editing !== null} onSubmit={commitGroup} />
        </Modal>
        <Space wrap style={{ marginBottom: 8 }}>
            <span>Hydrus search order</span><Select aria-label="Hydrus search order" value={sortType} onChange={setSortType} disabled={busy || disabled} style={{ width: 210 }} options={[
                [2, 'Import date'], [14, 'Modified date'], [19, 'Archive date'], [18, 'Last viewed'], [4, 'Random'], [3, 'Filetype'], [20, 'SHA-256 hash'], [21, 'Pixel hash'], [22, 'Blurhash'], [0, 'File size'], [5, 'Width'], [6, 'Height'], [7, 'Aspect ratio'], [8, 'Pixel count'], [9, 'Tag count'], [1, 'Duration'], [10, 'Media views'], [11, 'Media viewtime'], [12, 'Bitrate'], [13, 'Has audio'], [15, 'Framerate'], [16, 'Frame count'], [23, 'Colour: lightness'], [24, 'Colour: saturation'], [25, 'Colour: green/red'], [26, 'Colour: blue/yellow'], [27, 'Colour: hue']
            ].map(([value, label]) => ({ value: Number(value), label }))} />
            <Select aria-label="Hydrus sort direction" value={ascending ? 'asc' : 'desc'} onChange={value => setAscending(value === 'asc')} disabled={busy || disabled || sortType === 4 || sortType === 3} options={[{ value: 'desc', label: 'Descending' }, { value: 'asc', label: 'Ascending' }]} />
            <Typography.Text type="secondary">Applied when you Search; result limit applies in Hydrus.</Typography.Text>
        </Space>
    </>;
}
