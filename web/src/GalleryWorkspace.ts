import { useSyncExternalStore } from 'react';
import { STANDALONE } from './ComfyAppApi';
export const ASSET_ACTION_EVENT = 'gallery-asset-action';
export const GALLERY_OPEN = 'comfy-gallery:open';
export const GALLERY_CLOSE = 'comfy-gallery:close';
const listeners = new Set<() => void>();
let available = false;
let installed = false;
let tab: HTMLButtonElement | undefined;
export const openWorkspace = () => window.dispatchEvent(new Event(GALLERY_OPEN));
export const closeWorkspace = () => window.dispatchEvent(new Event(GALLERY_CLOSE));
export function useWorkspaceTab() {
    return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => available);
}
export function workspaceTop() {
    const bar = tab?.closest<HTMLElement>('.workflow-tabs-container');
    return bar?.isConnected && bar.getBoundingClientRect().height ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
}
export function setWorkspaceActive(active: boolean) {
    tab?.setAttribute('aria-selected', String(active));
    if (tab) { tab.style.color = 'var(--input-text, #dedede)'; tab.style.background = active ? 'var(--comfy-input-bg, #353535)' : 'transparent'; tab.style.borderBottomColor = active ? 'var(--p-primary-color, #5489bd)' : 'transparent'; }
}
// ComfyUI has no public non-workflow tab API. This owns only its button and
// workspace; it never creates a dummy workflow or patches the workflow store.
export function installWorkspaceTab() {
    if (installed || STANDALONE) return;
    installed = true;
    tab = document.createElement('button');
    tab.id = 'comfy-gallery-workspace-tab'; tab.type = 'button'; tab.textContent = 'Gallery';
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-label', 'Gallery workspace');
    tab.setAttribute('aria-controls', 'comfy-gallery-workspace'); tab.setAttribute('aria-selected', 'false');
    tab.style.cssText = 'display:inline-flex;align-items:center;flex:0 0 auto;align-self:stretch;height:auto;min-width:100px;padding:0 18px;border:0;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;background:transparent;color:#e8edf4;font:500 13px system-ui;cursor:pointer;line-height:normal;';
    tab.addEventListener('click', openWorkspace);
    const attach = () => {
        const bar = Array.from(document.querySelectorAll<HTMLElement>('.workflow-tabs-container')).find(element => element.getBoundingClientRect().height > 0);
        if (bar && tab) {
            // Sit in the same row as the workflow tabs: next to the first real tab, not as an extra child of the
            // container (with the newer top menu that pushed the button above the tab row).
            let item: HTMLElement | null = bar.querySelector<HTMLElement>('[role="tab"]:not(#comfy-gallery-workspace-tab)');
            while (item && item.parentElement && item.parentElement !== bar && item.parentElement.children.length < 2) item = item.parentElement;
            const strip = item?.parentElement || bar;
            const before = item && strip !== bar ? item : bar.firstElementChild;
            if (tab.parentElement !== strip || tab.nextElementSibling !== before) {
                strip.insertBefore(tab, before === tab ? tab.nextElementSibling : before);
                if (tab.getAttribute('aria-selected') !== 'true') tab.style.color = 'var(--fg-color, #e8edf4)';
                window.dispatchEvent(new Event('comfy-gallery:layout'));
            }
        }
        const next = !!bar;
        if (next !== available) { available = next; listeners.forEach(listener => listener()); window.dispatchEvent(new Event('comfy-gallery:layout')); }
    };
    let frame = 0;
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; attach(); }); });
    observer.observe(document.body, { childList: true, subtree: true });
    const navigate = (event: Event) => {
        const target = event.target as HTMLElement;
        if (target.closest('#comfy-gallery-workspace-tab')) return;
        if (target.closest('.workflow-tabs-container [role="tab"], .workflow-tabs-container .new-blank-workflow-button')) closeWorkspace();
    };
    document.addEventListener('click', navigate, true);
    document.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') navigate(event); }, true);
    window.addEventListener('resize', attach);
    attach();
}
