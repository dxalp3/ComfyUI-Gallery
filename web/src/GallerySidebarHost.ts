import { useSyncExternalStore } from 'react';
let host: HTMLElement | null = null;
const listeners = new Set<() => void>();
export function setGallerySidebarHost(element: HTMLElement | null) {
    host = element;
    listeners.forEach(listener => listener());
}
export function useGallerySidebarHost() {
    return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => host);
}
