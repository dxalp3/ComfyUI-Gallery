import { ImageSourceTarget } from './ImageSourceHost';
import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Collapse, Modal, Select, Space, Typography, message } from 'antd';
import { appendToImageSource, getPromptTargets } from './ImageSourceBridge';
import { extractHydrusTags, extractLocalPrompts } from './LocalImageSearch';
import { HydrusTagSelect } from './HydrusTagSelect';
import { hydrusRequest } from './HydrusApi';
import { useHydrus } from './HydrusContext';
import type { GalleryEntry } from './GalleryOrder';
import type { ImageSourceImage, PromptApply } from './ImageSourceGeometry';

type Row = { entry: GalleryEntry; metadata: any; positive: string[]; negative: string[]; usePositive: boolean; useNegative: boolean; useTags: boolean; tags: string[]; sync: boolean };
export function AppendImagesModal({ entries, onClose }: { entries: GalleryEntry[]; onClose: () => void }) {
    const hydrus = useHydrus();
    const [rows, setRows] = useState<Row[]>([]);
    const [targets, setTargets] = useState<{ value: string; label: string }[]>([]);
    const [apply, setApply] = useState<PromptApply>({ mode: 'after' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    useEffect(() => {
        if (!entries.length) return;
        setError(''); setNotice('');
        setRows(entries.map(entry => {
            const metadata = entry.local ? { ...entry.local.metadata, hydrus: hydrus.items[entry.local.url]?.metadata || (entry.local.metadata as any)?.hydrus } : { hydrus: entry.remote };
            const prompts = extractLocalPrompts(metadata);
            return { entry, metadata, positive: prompts.positive.split(/[,\n]+/).map(value => value.trim()).filter(Boolean), negative: prompts.negative.split(/[,\n]+/).map(value => value.trim()).filter(Boolean), usePositive: false, useNegative: false, useTags: false, tags: extractHydrusTags(metadata), sync: false };
        }));
        void getPromptTargets().then(setTargets).catch(reason => setError(String(reason)));
    }, [entries]);
    const update = (index: number, values: Partial<Row>) => setRows(old => old.map((row, i) => i === index ? { ...row, ...values } : row));
    const append = async () => {
        setBusy(true); setError(''); setNotice('');
        try {
            const images: ImageSourceImage[] = [];
            for (const row of rows) {
                let copied: any;
                if (row.entry.local) {
                    const response = await fetch('/Gallery/source/local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: row.entry.local.url, metadata: row.metadata }) });
                    copied = await response.json();
                    if (!response.ok) throw new Error(copied.error || 'Local image copy failed');
                } else copied = await hydrusRequest('import', { hash: row.entry.hash });
                if (copied.warning) throw new Error(copied.warning + ' Retry after checking Hydrus permissions; workflow was not changed.');
                const metadata = { ...row.metadata, ...copied.metadata, hydrus: copied.metadata?.hydrus || row.metadata.hydrus };
                images.push({ input_name: copied.input_name, title: row.entry.name, metadata, prompt: { positive: Array.from(new Set([...(row.usePositive ? row.positive : []), ...(row.useTags ? row.tags : [])])).join(', '), negative: row.useNegative ? row.negative.join(', ') : '', tags: row.tags } });
            }
            // Append first so a missing workflow target cannot silently become a copy-only action.
            const result = await appendToImageSource(images, apply);
            const failures: string[] = [];
            for (const row of rows.filter(row => row.sync)) {
                const hash = row.entry.hash || hydrus.items[row.entry.local?.url || '']?.hash;
                if (!hash) { failures.push(row.entry.name + ': no known Hydrus correspondence'); continue; }
                try { await hydrusRequest('tag_sync', { hash, tags: row.tags, target: `${hydrus.settings?.url}|${hydrus.settings?.profile}` }); }
                catch (reason) { failures.push(row.entry.name + ': ' + String(reason)); }
            }
            if (rows.some(row => row.sync) && !failures.length) message.info("Hydrus tag changes saved to the background sync queue.");
            hydrus.reloadMemory();
            if (failures.length) { setNotice(result); setError('Images were appended. Tag sync failed: ' + failures.join('; ')); }
            else onClose();
        } catch (reason) { setError(String(reason)); }
        finally { setBusy(false); }
    };
    return <Modal title="Append images and prompts" open={entries.length > 0} onCancel={() => { if (!busy) onClose(); }} width={900} zIndex={3045} footer={<Space><Button disabled={busy} onClick={onClose}>Cancel</Button><Button type="primary" loading={busy} disabled={!!notice || !rows.length || rows.length > 32} onClick={() => void append()}>Append to workflow</Button></Space>}>
        <Typography.Paragraph>Each image retains its metadata. Enable only the prompt terms you want this reference to contribute. Saved prefixes expand into editable tags; removing a term here does not remove it from the original image.</Typography.Paragraph>
        <ImageSourceTarget /><Space wrap>
            <Select aria-label="Prompt write mode" value={apply.mode} onChange={mode => setApply(old => ({ ...old, mode }))} options={[{ value: 'replace', label: 'Replace target prompt' }, { value: 'before', label: 'Add before target prompt' }, { value: 'after', label: 'Add after target prompt' }]} style={{ width: 225 }} />
            <Select aria-label="Positive prompt target" allowClear placeholder="Positive target (optional)" value={apply.positive} options={targets} onChange={positive => setApply(old => ({ ...old, positive }))} style={{ width: 270 }} />
            <Select aria-label="Negative prompt target" allowClear placeholder="Negative target (optional)" value={apply.negative} options={targets} onChange={negative => setApply(old => ({ ...old, negative }))} style={{ width: 270 }} />
        </Space>
        <Typography.Paragraph type="secondary">Without targets, enabled prompts remain on the source node's positive/negative STRING outputs. Connect its IMAGE output to your VAE Encode or ControlNet image input.</Typography.Paragraph>
        <Collapse defaultActiveKey={['0']} items={rows.map((row, index) => ({ key: String(index), label: row.entry.name, children: <Space direction="vertical" style={{ width: '100%' }}>
            <Checkbox checked={row.usePositive} onChange={event => update(index, { usePositive: event.target.checked })}>Load positive prompt</Checkbox>
            <HydrusTagSelect label={'Positive terms ' + index} value={row.positive} onChange={positive => update(index, { positive })} />
            <Checkbox checked={row.useNegative} onChange={event => update(index, { useNegative: event.target.checked })}>Load negative prompt</Checkbox>
            <HydrusTagSelect label={'Negative terms ' + index} value={row.negative} onChange={negative => update(index, { negative })} />
            <Typography.Text>Hydrus tags: keep all, remove individual terms, or type @prefix to use the shared tag manager.</Typography.Text>
            <HydrusTagSelect label={'Image Hydrus tags ' + index} value={row.tags} onChange={tags => update(index, { tags })} />
            <Checkbox checked={row.useTags} onChange={event => update(index, { useTags: event.target.checked })}>Load selected Hydrus tags into the positive prompt</Checkbox>
            <Checkbox checked={row.sync} onChange={event => update(index, { sync: event.target.checked })}>Add these tags to the corresponding Hydrus file</Checkbox>
            <Typography.Text type="secondary">Sync adds tags to your configured service; omitted tags are not deleted remotely.</Typography.Text>
        </Space> }))} style={{ marginTop: 12 }} />
        {notice && <Alert type="success" message={notice} />}{error && <Alert type="error" message={error} />}
    </Modal>;
}
