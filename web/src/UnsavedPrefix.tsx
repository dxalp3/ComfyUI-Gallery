import { useRef, useState } from 'react';
import { Button, Modal, Space } from 'antd';

export type PrefixDraft = { name: string; positive: string[]; negative: string[] };

/** Closing or replacing a draft is a transaction; failed saves leave it open. */
export function useUnsavedPrefix(value: PrefixDraft, restore: (value: PrefixDraft) => void, save: () => Promise<boolean>) {
    const baseline = useRef<PrefixDraft>({ name: '', positive: [], negative: [] });
    const current = useRef(value); current.current = value;
    const saver = useRef(save); saver.current = save;
    const [pending, setPending] = useState<{ action: () => void }>();
    const [saving, setSaving] = useState(false);
    const markSaved = (draft: PrefixDraft) => { baseline.current = structuredClone(draft); };
    const guard = (action: () => void) => {
        // Let inputs commit their blur changes before comparing the draft.
        window.setTimeout(() => {
            if (JSON.stringify(current.current) === JSON.stringify(baseline.current)) action();
            else setPending({ action });
        }, 0);
    };
    const finish = () => { const action = pending?.action; setPending(undefined); action?.(); };
    const dialog = <Modal title="Save changes?" open={!!pending} zIndex={3200} closable={!saving} keyboard={!saving} maskClosable={false}
        onCancel={() => { if (!saving) setPending(undefined); }} footer={<Space>
            <Button disabled={saving} onClick={() => setPending(undefined)}>Cancel</Button>
            <Button disabled={saving} onClick={() => { restore(structuredClone(baseline.current)); finish(); }}>Discard</Button>
            <Button type="primary" loading={saving} onClick={async () => {
                setSaving(true);
                try { if (await saver.current()) finish(); } finally { setSaving(false); }
            }}>Save</Button>
        </Space>}>This prefix has unsaved changes.</Modal>;
    return { guard, markSaved, dialog };
}
