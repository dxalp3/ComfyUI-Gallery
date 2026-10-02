import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Modal, Space, Typography, message } from 'antd';
import { hydrusRequest } from './HydrusApi';
import { useHydrus } from './HydrusContext';

type Job = { id: number; hash: string; kind: string; state: string; payload: { text?: string; tags?: string[] }; remote?: string; error?: string };
type Status = { target: string; jobs: Job[]; indexed: number; processed: number; discovered: number; last_complete?: number; indexing: boolean; error?: string };

export function HydrusSyncPanel({ visible }: { visible: boolean }) {
    const hydrus = useHydrus();
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<Status>();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const previous = useRef('');
    const load = async () => {
        try {
            const next = await hydrusRequest<Status>('sync_status', {});
            const revision = JSON.stringify([next.target, next.indexed, next.last_complete, next.jobs.map(job => [job.id, job.state])]);
            if (previous.current && previous.current !== revision) hydrus.reloadMemory();
            previous.current = revision;
            setStatus(next); setError('');
        }
        catch (reason) { setError(String(reason)); }
    };
    useEffect(() => {
        if (!visible) return;
        void load();
        const timer = window.setInterval(() => { void load(); }, 5000);
        return () => window.clearInterval(timer);
    }, [visible, hydrus.settings?.url, hydrus.settings?.profile]);
    const resolve = async (id: number, choice: string) => {
        setBusy(true);
        try {
            setStatus(await hydrusRequest<Status>('sync_resolve', { id, choice, target: status?.target }));
            hydrus.reloadMemory();
        } catch (reason) { message.error(String(reason)); }
        finally { setBusy(false); }
    };
    const conflicts = status?.jobs.filter(job => job.state === 'conflict').length || 0;
    const pending = status?.jobs.filter(job => job.state === 'pending').length || 0;
    const label = conflicts ? `Sync · ${conflicts} conflicts` : pending ? `Sync · ${pending} pending` : status?.error ? 'Sync · offline/error' : status?.indexing ? 'Sync · indexing' : 'Hydrus sync';
    return <>
        <Button onClick={() => { setOpen(true); void load(); }}>{label}</Button>
        <Modal title="Hydrus background synchronization" open={open && visible} onCancel={() => setOpen(false)} footer={null} width={860} zIndex={3045} styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}>
            <Space direction="vertical" style={{ width: '100%' }}>
                <Typography.Paragraph>Changes stay in a persistent queue while Hydrus is unavailable. Tags are added without removing existing tags or restoring deleted mappings. Different generation notes require a decision; originals remain intact.</Typography.Paragraph>
                {(error || status?.error) && <Alert type="warning" message={error || status?.error} description="Pending changes are preserved. Check the connection or permissions; background retries continue." />}
                <Typography.Text>{status?.indexed || 0} files indexed · {status?.processed || 0}/{status?.discovered || 0} checked in this pass. {status?.last_complete ? `Last completed: ${new Date(status.last_complete * 1000).toLocaleString()}` : 'Initial indexing is not complete.'}</Typography.Text>
                <Typography.Text type="secondary">Discovery uses the Gallery generation-note name and refreshes linked files. Other Hydrus files are indexed when browsed. Automatic refresh runs every 15 minutes; media thumbnails still require Hydrus.</Typography.Text>
                <Button onClick={() => { void hydrusRequest('sync_retry', {}).then(() => { message.info('Background synchronization requested'); void load(); }).catch(reason => message.error(String(reason))); }}>Sync now</Button>
                {!status?.jobs.length && <Typography.Text>No pending changes.</Typography.Text>}
                <Collapse items={status?.jobs.map(job => ({ key: String(job.id), label: `${job.state === 'conflict' ? 'Conflict' : 'Pending'} · ${job.kind} · ${job.hash.slice(0, 16)}`, children: <Space direction="vertical" style={{ width: '100%' }}>
                    <Typography.Text copyable>{job.hash}</Typography.Text>
                    {job.error && <Alert type="warning" message={job.error} />}
                    <Typography.Text strong>Local change</Typography.Text>
                    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflow: 'auto' }}>{job.payload.text || job.payload.tags?.join(', ')}</pre>
                    {job.state === 'pending' && <Button disabled={busy} onClick={() => void resolve(job.id, 'cancel')}>Cancel this pending change</Button>}
                    {job.state === 'conflict' && <>
                        <Typography.Text strong>Hydrus note</Typography.Text>
                        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflow: 'auto' }}>{job.remote ?? '(note removed)'}</pre>
                        <Space wrap>
                            <Button disabled={busy} onClick={() => void resolve(job.id, 'remote')}>Keep Hydrus</Button>
                            <Button disabled={busy} onClick={() => void resolve(job.id, 'both')}>Keep both as separate notes</Button>
                            <Button disabled={busy} onClick={() => void resolve(job.id, 'local')}>Replace this note with local</Button>
                        </Space>
                    </>}
                </Space> }))} />
            </Space>
        </Modal>
    </>;
}
