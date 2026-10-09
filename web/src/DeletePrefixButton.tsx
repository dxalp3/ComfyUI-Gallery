import { useState } from 'react';
import { Button, Modal } from 'antd';

/** Render in the existing React root (static Modal.confirm uses a legacy renderer). */
export function DeletePrefixButton({ id, name, onDelete }: { id: string; name: string; onDelete: (id: string) => Promise<void> }) {
    const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    return <><Button danger onClick={() => { setError(''); setOpen(true); }}>Delete prefix</Button>
        <Modal open={open} title={'Delete prefix ' + name + '?'} zIndex={3200} confirmLoading={busy} okText="Delete" okButtonProps={{ danger: true }}
            onCancel={() => { if (!busy) setOpen(false); }} onOk={async () => {
                setBusy(true); setError('');
                try { await onDelete(id); setOpen(false); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
            }}>
            <p>Image pairings will be removed. Vocabulary tags and existing workflow text are retained.</p>
            {error && <p role="alert">{error}</p>}
        </Modal></>;
}
