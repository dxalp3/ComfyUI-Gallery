import { useSyncExternalStore } from 'react';
import type { FileDetails } from './types';

import { collectSessionOutputs } from './SessionOutputCollection';

let outputs: FileDetails[] = [];
const listeners = new Set<() => void>();
const services = new WeakSet<object>();
/** In-memory browser session; scans and historical workflow loads do not populate it. */
export function installSessionOutputs(api: { addEventListener: (name: string, callback: (event: any) => void) => void }) {
    if (!api || services.has(api)) return;
    services.add(api);
    api.addEventListener('executed', event => {
        // Capture execution results as they arrive, without loading historical gallery images.
        outputs = collectSessionOutputs(outputs, event.detail?.output);
        listeners.forEach(listener => listener());
    });
}
export function useSessionOutputs() {
    return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => outputs);
}
