import { useState } from 'react';
import { Alert, Button, Input, Select, Space, Switch, Typography } from 'antd';
import { BASE_PATH } from './ComfyAppApi';
import type { SettingsState } from './GalleryContext';

export function FolderRules({ settings, change }: { settings: SettingsState; change: (value: Partial<SettingsState>) => void }) {
    const [preview, setPreview] = useState<any[]>([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const rules = settings.routingRules || [];
    const edit = (index: number, patch: Partial<typeof rules[number]>) => { change({ routingRules: rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule) }); setPreview([]); };
    return <div>
        <Typography.Title level={5}>Local folder rules</Typography.Title>
        <Typography.Paragraph>Match positive or negative prompt text (case-insensitive). First matching rule wins. Destination folders are excluded from further routing. No overwrites; Hydrus-server files are never moved.</Typography.Paragraph>
        {rules.map((rule, i) => <div key={i} style={{ border: '1px solid #8884', borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <Space wrap><Input aria-label={'Rule name ' + (i + 1)} placeholder="Rule name" value={rule.name} onChange={e => edit(i, { name: e.target.value })} /><Select aria-label={'Rule prompt field ' + (i + 1)} value={rule.field} onChange={field => edit(i, { field })} options={['positive', 'negative'].map(value => ({ value, label: value + ' prompt' }))} /><Select aria-label={'Rule match ' + (i + 1)} value={rule.match} onChange={match => edit(i, { match })} options={[{ value: 'all', label: 'All terms' }, { value: 'any', label: 'Any term' }]} /></Space>
            <Select mode="tags" aria-label={'Rule terms ' + (i + 1)} placeholder="Prompt phrases — Enter adds a term" value={rule.terms} onChange={terms => edit(i, { terms })} style={{ width: '100%', margin: '8px 0' }} />
            <Space wrap><Select aria-label={'Rule destination root ' + (i + 1)} value={rule.destinationRoot || ''} onChange={destinationRoot => edit(i, { destinationRoot })} style={{ minWidth: 190 }} options={[{ value: '', label: 'Current gallery root' }, ...(settings.extraFolders || []).map(value => ({ value, label: value }))]} /><Input aria-label={'Rule folder ' + (i + 1)} placeholder="Subfolder, e.g. portraits" value={rule.folder} onChange={e => edit(i, { folder: e.target.value })} /><Button danger onClick={() => { change({ routingRules: rules.filter((_, index) => index !== i) }); setPreview([]); }}>Remove rule</Button></Space>
        </div>)}
        <Space wrap><Button onClick={() => change({ routingRules: [...rules, { name: '', terms: [], field: 'positive', match: 'all', folder: '' }] })}>Add folder rule</Button>
            <Button loading={busy} onClick={async () => { setBusy(true); setError(''); try {
                const response = await fetch(BASE_PATH + '/Gallery/organize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: settings.relativePath, rules, apply: false }) });
                const result = await response.json(); if (!response.ok) throw new Error(result.error); setPreview(result.items);
                if (!result.items.length) setError('No files match these rules. Save extra folders before previewing destinations there.');
            } catch (reason) { setError(String(reason)); } finally { setBusy(false); } }}>Preview moves</Button>
            <Switch aria-label="Automatically organize local images" checked={settings.autoOrganize} onChange={autoOrganize => change({ autoOrganize })} /><span>Automatically organize on scan</span>
        </Space>
        <Typography.Paragraph type="secondary">Saving with automatic organization enabled applies rules to existing and newly scanned images in the active root. Save extra folder paths first. Preview performs no moves. Files still being written are deferred until a later scan; Reload retries them.</Typography.Paragraph>
        {error && <Alert type="info" message={error} />}
        {!!preview.length && <div style={{ maxHeight: 220, overflow: 'auto' }}><strong>{preview.length} matching files</strong>{preview.map(item => <div key={item.url} style={{ padding: 6, overflowWrap: 'anywhere' }}>{item.url} → {item.target}{item.error ? ' · ' + item.error : ''}</div>)}</div>}
    </div>;
}
