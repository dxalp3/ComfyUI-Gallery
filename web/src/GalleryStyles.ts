// Scoped styles keep the gallery readable under ComfyUI's global control styles.
export const galleryStyles = `
.cg-workspace { flex-direction:column; overflow:hidden; background:var(--cg-bg); color:var(--cg-text); font:13px/1.5 system-ui,sans-serif; outline:none; color-scheme:normal; }
.cg-workspace *, .cg-workspace *::before, .cg-workspace *::after { box-sizing:border-box; }
.cg-header { display:flex; align-items:center; gap:18px; padding:14px 24px; border-bottom:1px solid var(--cg-border); flex:none; }
.cg-brand { display:flex; align-items:center; gap:10px; font-size:19px; letter-spacing:-.4px; margin-right:16px; }
.cg-brand .anticon { color:var(--cg-accent); font-size:23px; }
.cg-spacer { flex:1; }
.cg-filters { display:flex; align-items:center; gap:10px; padding:12px 24px 0; flex-wrap:wrap; flex:none; }
.cg-search { flex:1 1 220px; max-width:480px; }
.cg-target { padding:10px 24px; border-bottom:1px solid var(--cg-border); }
.cg-browser, .cg-grid-layout { display:flex; flex:1; flex-direction:column; min-height:0; min-width:0; }
.cg-browser { padding:0 18px 12px; }
.cg-hydrus-search { flex:none; max-height:45vh; overflow:auto; margin:12px 6px 0; padding:0 14px 12px; border:1px solid var(--cg-border); border-radius:10px; background:var(--cg-panel); }
.cg-grid-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:12px 6px; flex:none; }
.cg-grid-summary { color:var(--cg-muted); margin-right:auto; font-variant-numeric:tabular-nums; }
.cg-selection { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:0 6px 10px; padding:8px 12px; background:var(--cg-panel); border:1px solid var(--cg-border); border-radius:8px; flex:none; }
.cg-workspace .ant-btn { font:inherit; min-height:32px; height:32px; line-height:1; padding:4px 12px; box-shadow:none; }
.cg-workspace .ant-btn-default { color:var(--cg-text); background:var(--cg-control); border:1px solid var(--cg-border); }
.cg-workspace .ant-btn-default:hover { color:var(--cg-accent); border-color:var(--cg-accent); }
.cg-workspace .ant-btn-primary { color:#fff; background:var(--cg-accent); border-color:var(--cg-accent); }
.cg-workspace .ant-btn:disabled { opacity:.45; cursor:not-allowed; }
.cg-workspace .ant-input, .cg-workspace .ant-input-affix-wrapper, .cg-workspace .ant-select-selector, .cg-workspace .ant-input-number { color:var(--cg-text); background:var(--cg-control); border-color:var(--cg-border); font:inherit; }
.cg-workspace input.ant-select-selection-search-input { color:inherit; background:transparent; border:0; border-radius:0; padding:0; box-shadow:none; min-width:0; }
.cg-workspace .ant-input::placeholder { color:var(--cg-muted); opacity:.8; }
.cg-workspace .ant-typography, .cg-workspace .ant-checkbox-wrapper { color:var(--cg-text); }
.cg-workspace .ant-typography-secondary { color:var(--cg-muted); }
.cg-workspace .ant-segmented { background:var(--cg-panel); color:var(--cg-muted); }
.cg-workspace .ant-segmented-item-selected { background:var(--cg-control); color:var(--cg-text); }
.cg-workspace [data-gallery-entry] { background:var(--cg-control); transition:border-color .12s; }
.cg-workspace [data-gallery-entry]:hover { border-color:var(--cg-accent) !important; }
@media(max-width:750px) { .cg-header { gap:8px; padding:10px; flex-wrap:wrap; } .cg-brand { margin-right:0; font-size:16px; } .cg-filters { padding:10px 10px 0; } .cg-browser { padding:0 4px 6px; } }
`;
