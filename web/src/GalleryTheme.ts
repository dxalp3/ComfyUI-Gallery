import { useEffect, useState } from 'react';
import { theme, type ThemeConfig } from 'antd';
export type GalleryThemeMode = 'comfy' | 'light' | 'dark';

export function useGalleryTheme(mode: GalleryThemeMode): ThemeConfig {
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        let frame = 0;
        const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setRevision(n => n + 1)); });
        for (const element of [document.documentElement, document.body]) observer.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
        return () => { observer.disconnect(); cancelAnimationFrame(frame); };
    }, []);
    void revision;
    const css = getComputedStyle(document.body);
    const native = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const background = native('--comfy-menu-bg', '#252525');
    const probe = document.createElement('span'); probe.style.color = background; document.body.append(probe);
    const channels = getComputedStyle(probe).color.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [37, 37, 37]; probe.remove();
    const dark = mode === 'dark' || mode === 'comfy' && channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 < 140;
    return { algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: {
        zIndexPopupBase: 3100, borderRadius: 5, controlHeight: 30, fontSize: 13,
        fontFamily: 'Inter, system-ui, sans-serif', colorPrimary: '#5489bd',
        colorBgBase: dark ? '#202020' : '#f4f4f4',
        colorBgContainer: mode === 'comfy' ? background : dark ? '#252525' : '#fafafa',
        colorBgElevated: mode === 'comfy' ? background : dark ? '#2c2c2c' : '#ffffff',
        colorText: mode === 'comfy' ? native('--input-text', dark ? '#dedede' : '#262626') : dark ? '#dedede' : '#262626',
        colorBorder: mode === 'comfy' ? native('--border-color', dark ? '#505050' : '#c9c9c9') : dark ? '#505050' : '#c9c9c9',
    } };
}

export const interactionStyles = `
.cg-workspace button,.cg-floating-panel button,.cg-asset-pane button,.gallery-source-node-preview button,.cg-source-picker button { transition:background-color .14s,border-color .14s,box-shadow .14s,opacity .14s; }
.cg-floating-panel .ant-btn:not(:disabled):hover,.cg-asset-pane .ant-btn:not(:disabled):hover { box-shadow:inset 0 0 0 1px currentColor; }
.gallery-source-node-preview button:hover { background:var(--comfy-menu-secondary-bg,#555) !important;opacity:1 !important; }
.gallery-source-node-preview [data-picker-trigger]:hover { box-shadow:inset 0 0 0 2px var(--p-primary-color,#5489bd); }
.gallery-source-node-preview button:focus-visible,.gallery-source-node-preview [data-picker-trigger]:focus-visible,.cg-asset-pane button:focus-visible { outline:2px solid var(--p-primary-color,#5489bd);outline-offset:-2px; }
.cg-asset-pane { height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;padding:12px;box-sizing:border-box;font:13px/1.4 Inter,system-ui,sans-serif; }
.cg-asset-pane header { display:flex;align-items:center;gap:8px; }
.cg-asset-pane header strong { flex:1; }
.cg-asset-tools { display:flex;gap:6px;flex-wrap:wrap; }
.cg-asset-scroll { flex:1;min-height:0;overflow:auto;scrollbar-width:thin; }
.cg-asset-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px; }
.cg-asset-card { min-width:0;width:100%;border:1px solid var(--cg-border);border-radius:5px;padding:4px;background:var(--cg-control);color:var(--cg-text);cursor:pointer;text-align:left; }
.cg-asset-card:hover { border-color:var(--cg-accent);box-shadow:0 0 0 1px var(--cg-accent);background:var(--cg-panel); }
.cg-asset-card img { width:100%;height:100px;object-fit:cover;border-radius:3px;display:block; }
.cg-asset-card span { display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-top:4px;font-size:11px; }
@media(prefers-reduced-motion:reduce) { .cg-workspace *,.cg-floating-panel *,.cg-asset-pane *,.gallery-source-node-preview * { transition:none !important; } }
`;
