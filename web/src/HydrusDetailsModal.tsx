import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Empty, Modal, Space, Tag, Typography } from 'antd';
import { BASE_Z_INDEX } from './ComfyAppApi';
import { useHydrus } from './HydrusContext';
import { hydrusStatus } from './HydrusApi';

const formatTime = (value?: string) => value ? new Date(value).toLocaleString() : 'Never';
const boolLabel = (value: unknown, yes = 'Yes', no = 'No') => typeof value === 'boolean' ? value ? yes : no : 'Unknown';

export function HydrusDetailsModal() {
    const { detailsUrl, setDetailsUrl, imageFiles, items, refresh, requestExport } = useHydrus();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { setError(''); }, [detailsUrl]);
    const item = detailsUrl ? items[detailsUrl] : undefined;
    const metadata = item?.metadata || {};
    const badge = hydrusStatus(item);
    const services = metadata.services_v2 || {};
    const serviceName = (key: string) => {
        const service = Array.isArray(services) ? services.find(value => value.service_key === key) : services[key];
        return service?.name || key;
    };
    const tagEntries = Object.entries(metadata.tags || {}) as [string, any][];
    const ratings = Object.entries(metadata.ratings || {});
    const notes = Object.entries(metadata.notes || {});
    const presence = item?.status === 'missing' ? 'Not found locally in this client' : item?.status === 'deleted' ? 'Deleted or in Hydrus trash' : metadata.is_trashed ? 'In Hydrus trash' : metadata.is_local ? 'Local in this Hydrus client' :
        metadata.is_deleted || item?.status === 'deleted' ? 'Deleted from Hydrus' : item?.status === 'missing' ? 'Not found in this client' :
        metadata.is_local === false ? 'Known to Hydrus; not stored locally' : 'Not checked';
    const refreshOne = async () => {
        if (!detailsUrl) return;
        setBusy(true); setError('');
        try {
            const response = await refresh([detailsUrl]);
            if (response[0]?.error) setError(response[0].error);
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setBusy(false); }
    };

    return <Modal title="Hydrus metadata" open={!!detailsUrl} zIndex={BASE_Z_INDEX + 20} width={780}
        onCancel={() => setDetailsUrl(undefined)} footer={<Space>
            <Button onClick={() => setDetailsUrl(undefined)}>Close</Button>
            <Button loading={busy} onClick={refreshOne}>Refresh from Hydrus</Button>
            <Button type="primary" disabled={busy} onClick={() => { if (detailsUrl) { requestExport([detailsUrl]); setDetailsUrl(undefined); } }}>Export to Hydrus</Button>
        </Space>}>
        <Space style={{ marginBottom: 12 }}><Tag color={badge.color}>{badge.label}</Tag><Typography.Text strong>{detailsUrl ? imageFiles[detailsUrl]?.name || detailsUrl : ''}</Typography.Text></Space>
        <Alert showIcon type={item?.error || error ? 'warning' : 'info'} style={{ marginBottom: 16 }}
            message={error || item?.error || 'Saved metadata snapshot'}
            description="This snapshot survives ComfyUI restarts and can be viewed while Hydrus is offline. Use Refresh from Hydrus to check changes made in the client. Export history and current file presence are tracked separately." />
        <Descriptions size="small" bordered column={1} items={[
            { key: 'presence', label: 'Last known presence', children: presence },
            { key: 'exported', label: 'Previously imported or found', children: item?.exported ? 'Yes' : 'No confirmation recorded' },
            { key: 'exported_at', label: 'Last export', children: formatTime(item?.last_exported_at) },
            { key: 'checked_at', label: 'Last checked', children: formatTime(item?.last_checked_at) },
            { key: 'snapshot_at', label: 'Metadata snapshot saved', children: formatTime(item?.metadata_checked_at || item?.last_checked_at) },
            { key: 'hash', label: 'SHA-256', children: item?.hash ? <Typography.Text copyable style={{ wordBreak: 'break-all' }}>{item.hash}</Typography.Text> : 'Not calculated yet' },
            { key: 'inbox', label: 'Inbox / archive', children: boolLabel(metadata.is_inbox, 'Inbox', 'Archived') },
            { key: 'trash', label: 'In trash', children: boolLabel(metadata.is_trashed) },
            { key: 'deleted', label: 'Deleted', children: item?.status === 'deleted' ? 'Yes' : boolLabel(metadata.is_deleted) },
            { key: 'file', label: 'Hydrus file ID', children: metadata.file_id ?? 'Unknown' },
        ]} />
        <Typography.Title level={5}>Tags by service</Typography.Title>
        {tagEntries.length === 0 ? <Typography.Paragraph type="secondary">No tag metadata cached.</Typography.Paragraph> : tagEntries.map(([key, value]) => {
            const statuses = value.display_tags || value.storage_tags || {};
            return <div key={key} style={{ marginBottom: 12 }}><Typography.Text strong>{value.name || serviceName(key)}</Typography.Text>
                {Object.entries(statuses).map(([status, tags]) => <div key={status} style={{ marginTop: 6 }}>
                    <Typography.Text type="secondary" style={{ marginRight: 8 }}>{({ '0': 'Current', '1': 'Deleted', '2': 'Pending', '3': 'Petitioned' } as Record<string, string>)[status] || status}:</Typography.Text>
                    {Array.isArray(tags) && tags.length ? tags.map((tag: string) => <Tag key={tag} style={{ marginBottom: 4 }}>{tag}</Tag>) : 'None'}
                </div>)}
            </div>;
        })}
        <Typography.Title level={5}>Ratings</Typography.Title>
        {ratings.length ? <Descriptions size="small" column={1} items={ratings.map(([key, value]) => ({ key, label: serviceName(key), children: value === null ? 'Unrated' : String(value) }))} /> : <Typography.Paragraph type="secondary">No ratings cached.</Typography.Paragraph>}
        {notes.length > 0 && <Collapse style={{ marginTop: 12 }} items={notes.map(([key, value]) => ({ key, label: `Note: ${key}`, children: <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(value)}</pre> }))} />}
        <Collapse style={{ marginTop: 16 }} items={[{ key: 'raw', label: 'Raw cached Hydrus metadata', children: Object.keys(metadata).length ?
            <pre style={{ maxHeight: 350, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(metadata, null, 2)}</pre> : <Empty description="Refresh or export this image to record metadata." /> }]} />
    </Modal>;
}
