import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Popconfirm, Radio, Select, Space, Tag, Typography, message } from 'antd';
import { FloatingPanel } from './FloatingPanel';
import { BASE_Z_INDEX } from './ComfyAppApi';
import { loadExclusiveSets, parseExclusiveSets, resetExclusiveSets, saveExclusiveSets, type ExclusiveSet } from './TagConflicts';

export const EXCLUSIVE_TAGS_EVENT = 'gallery-exclusive-tags';
export const openExclusiveTags = () => window.dispatchEvent(new Event(EXCLUSIVE_TAGS_EVENT));

type Row = ExclusiveSet & { key: number };
let keys = 0;
const rowsOf = (sets: ExclusiveSet[]): Row[] => sets.map(set => ({ ...set, key: keys++ }));

/**
 * The exclusive tag index: every set is a group of tags that exclude each other. Edit the sets here or import
 * a file (JSON or one set per line — for example a list another tool or an LLM wrote), then save. The list is
 * saved per ComfyUI user; "Back to built-in list" removes your copy.
 */
export function ExclusiveTagsPanel() {
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<Row[]>([]);
    const [custom, setCustom] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [filter, setFilter] = useState('');
    const [mode, setMode] = useState<'merge' | 'replace'>('merge');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const file = useRef<HTMLInputElement>(null);
    const apply = (data: { sets: ExclusiveSet[]; custom: boolean }) => { setRows(rowsOf(data.sets)); setCustom(data.custom); setDirty(false); };
    const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); } finally { setBusy(false); } };
    useEffect(() => {
        const show = () => { setOpen(true); setFilter(''); void run(async () => apply(await loadExclusiveSets())); };
        window.addEventListener(EXCLUSIVE_TAGS_EVENT, show);
        return () => window.removeEventListener(EXCLUSIVE_TAGS_EVENT, show);
    }, []);
    const edit = (key: number, patch: Partial<ExclusiveSet>) => { setRows(old => old.map(row => row.key === key ? { ...row, ...patch } : row)); setDirty(true); };
    const importFile = async (chosen: File) => {
        const sets = parseExclusiveSets(await chosen.text());
        if (!sets.length) throw new Error('No sets found in ' + chosen.name + '. Each set needs at least two tags.');
        setRows(old => mode === 'replace' ? rowsOf(sets) : [...old, ...rowsOf(sets)]); setDirty(true);
        message.success(`${sets.length} set(s) ${mode === 'replace' ? 'loaded' : 'added'} from ${chosen.name}. Save to keep them.`);
    };
    const exportFile = () => {
        const blob = new Blob([JSON.stringify({ version: 1, sets: rows.map(({ name, tags }) => ({ name, tags })) }, null, 2)], { type: 'application/json' });
        const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'gallery-exclusive-tags.json' });
        link.click(); URL.revokeObjectURL(link.href);
    };
    const needle = filter.trim().toLowerCase().replace(/_/g, ' ');
    const shown = needle ? rows.filter(row => (row.name + ' ' + row.tags.join(' ')).toLowerCase().replace(/_/g, ' ').includes(needle)) : rows;
    const short = rows.filter(row => row.tags.length < 2).length;
    return <FloatingPanel panelKey="exclusive-tags" title={'Exclusive tag sets · ' + rows.length + (dirty ? ' · unsaved' : '')} open={open} onCancel={() => setOpen(false)} width={900} zIndex={BASE_Z_INDEX + 40}
        footer={<Space wrap>
            <Button onClick={() => setOpen(false)}>Close</Button>
            <Popconfirm title="Use the built-in list again?" description="Your saved list is removed." onConfirm={() => void run(async () => { apply(await resetExclusiveSets()); message.success('Back to the built-in list'); })} disabled={!custom}>
                <Button disabled={!custom || busy}>Back to built-in list</Button>
            </Popconfirm>
            <Button type="primary" loading={busy} disabled={!dirty} onClick={() => void run(async () => { apply(await saveExclusiveSets(rows.map(({ name, tags }) => ({ name, tags })))); message.success('Exclusive tag sets saved'); })}>Save</Button>
        </Space>}>
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            Tags in one set describe the same attribute; with <b>Exclusive tags</b> on (Gallery settings), choosing one turns the others off.
            {custom ? ' You are using your own list (saved as gallery-exclusive-tags.json in your ComfyUI user folder).' : ' This is the built-in list; saving keeps an edited copy for your ComfyUI user.'}
        </Typography.Paragraph>
        <Space wrap style={{ marginBottom: 8 }}>
            <Input allowClear aria-label="Filter sets" placeholder="Find a set or tag" value={filter} onChange={event => setFilter(event.target.value)} style={{ width: 220 }} />
            <Button onClick={() => { setRows(old => [{ name: '', tags: [], key: keys++ }, ...old]); setDirty(true); setFilter(''); }}>Add set</Button>
            <Radio.Group size="small" value={mode} onChange={event => setMode(event.target.value)} options={[{ value: 'merge', label: 'Import adds sets' }, { value: 'replace', label: 'Import replaces all' }]} optionType="button" />
            <Button onClick={() => file.current?.click()}>Import file…</Button>
            <input ref={file} type="file" accept=".json,.txt,.csv,application/json,text/plain" hidden onChange={event => { const chosen = event.target.files?.[0]; event.target.value = ''; if (chosen) void run(() => importFile(chosen)); }} />
            <Button disabled={!rows.length} onClick={exportFile}>Export JSON</Button>
        </Space>
        <details style={{ marginBottom: 8 }}><summary style={{ cursor: 'pointer' }}>File formats</summary>
            <Typography.Paragraph type="secondary" style={{ margin: '6px 0' }}>JSON: <code>{'{"sets": [{"name": "Hair length", "tags": ["short hair", "long hair"]}]}'}</code>, a plain list of lists <code>{'[["day", "night"]]'}</code>, or <code>{'{"Hair length": ["short hair", "long hair"]}'}</code>.
                Text: one set per line, <code>Hair length: short hair, long hair</code> or <code>day | night</code>; <code>#</code> starts a comment. Spaces and underscores are interchangeable. Sets with fewer than two tags are skipped.</Typography.Paragraph>
        </details>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 8 }} />}
        {short > 0 && <Alert type="warning" showIcon message={`${short} set(s) have fewer than two tags and are dropped on save.`} style={{ marginBottom: 8 }} />}
        <div>{shown.slice(0, 300).map(row => <div key={row.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #8883' }}>
            <Input aria-label="Set name" placeholder="Set name" value={row.name} maxLength={80} onChange={event => edit(row.key, { name: event.target.value })} style={{ width: 170, flex: 'none' }} />
            <Select mode="tags" aria-label={'Tags of ' + (row.name || 'set')} value={row.tags} tokenSeparators={[',', '|']} open={false} suffixIcon={null}
                onChange={tags => edit(row.key, { tags })} placeholder="Type tags; comma or Enter adds" style={{ flex: 1, minWidth: 0 }}
                tagRender={({ label, closable, onClose }) => <Tag closable={closable} onClose={onClose} style={{ marginInlineEnd: 4 }}>{String(label).replace(/_/g, ' ')}</Tag>} />
            <Button aria-label={'Delete set ' + row.name} danger onClick={() => { setRows(old => old.filter(item => item.key !== row.key)); setDirty(true); }}>×</Button>
        </div>)}</div>
        {shown.length > 300 && <Typography.Text type="secondary">Showing 300 of {shown.length} sets; use the filter to find others.</Typography.Text>}
        {!shown.length && !busy && <Typography.Text type="secondary">{rows.length ? 'No set matches the filter.' : 'No sets yet: add one or import a file.'}</Typography.Text>}
    </FloatingPanel>;
}
