import { useMemo, useState, useSyncExternalStore } from 'react';
import { BATCH_BLACKLIST_EVENT, BATCH_BLACKLIST_KEY, parseBatchBlacklist } from './BatchTagBlacklist';

const snapshot = () => { try { return localStorage.getItem(BATCH_BLACKLIST_KEY) || ''; } catch { return ''; } };
const subscribe = (notify: () => void) => {
    const storage = (event: StorageEvent) => { if (event.key === BATCH_BLACKLIST_KEY || event.key === null) notify(); };
    window.addEventListener('storage', storage); window.addEventListener(BATCH_BLACKLIST_EVENT, notify);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener(BATCH_BLACKLIST_EVENT, notify); };
};
export function useBatchTagBlacklist() {
    const text = useSyncExternalStore(subscribe, snapshot, () => '');
    return useMemo(() => parseBatchBlacklist(text), [text]);
}
export function BatchBlacklistEditor() {
    const blacklist = useBatchTagBlacklist();
    const [draft, setDraft] = useState<string>();
    const [error, setError] = useState('');
    return <details style={{ padding: '4px 6px' }}>
        <summary style={{ cursor: 'pointer' }}>Batch blacklist ({blacklist.length})</summary>
        <p style={{ margin: '6px 0' }}>Skipped by Select all, ranges and selection mode. Groups containing a listed tag are skipped whole. Individual editing remains available. Saved for this browser across encoder and gallery editors.</p>
        <textarea aria-label="Batch tag blacklist" rows={3} value={draft ?? blacklist.join('\n')} onChange={event => setDraft(event.target.value)} placeholder="One tag per line, or comma-separated" style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', color: 'inherit', border: '1px solid #8886', borderRadius: 4 }} />
        <button type="button" onClick={() => {
            try { localStorage.setItem(BATCH_BLACKLIST_KEY, parseBatchBlacklist(draft ?? blacklist.join('\n')).join('\n')); window.dispatchEvent(new Event(BATCH_BLACKLIST_EVENT)); setDraft(undefined); setError(''); }
            catch { setError('Could not save the blacklist in this browser.'); }
        }}>Save batch blacklist</button>
        {error && <div role="alert">{error}</div>}
    </details>;
}
