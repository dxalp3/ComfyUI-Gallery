import { createRoot } from 'react-dom/client';
import { PromptBoxEditor, type SourceInfo } from './PromptBoxEditor';
import { makeSuggest, type SuggestDeps } from './PromptSuggest';
import { hideWidget } from './NodeWidgets';
import { alwaysTogether, chipTerms, compileBoxes, composeWithSource, disableConflicts, insertText, neverTogether, parseState, reconcileText, stateFromText, type BoxState } from './PromptBoxes';
import { conflicts, EXCLUSIVE_MODE_EVENT, exclusiveMode } from './TagConflicts';
import { getComfyApp } from './ComfyAppApi';
import { sourcePrompt } from './ImageSourceGeometry';
import type { SharedLibrary } from './PrefixLibrary';

/** What the connected `source_text` provides: known at edit time for Gallery Image Source, otherwise after a run. */
export function sourcePromptInfo(node: any): SourceInfo {
    const input = node.inputs?.find((item: any) => item.name === 'source_text');
    if (input?.link == null) return { connected: false };
    const graph = node.graph || getComfyApp()?.graph;
    const link = graph?.links?.get?.(input.link) || graph?.links?.[input.link];
    const source = graph?.getNodeById?.(link?.origin_id) || graph?._nodes?.find((value: any) => value.id === link?.origin_id);
    if ((source?.comfyClass || source?.type) === 'GalleryImageSource' && [4, 5].includes(link?.origin_slot)) {
        try { return { connected: true, text: sourcePrompt(JSON.parse(source.widgets.find((value: any) => value.name === 'sources').value), link.origin_slot === 4 ? 'positive' : 'negative') }; }
        catch { return { connected: true, note: 'Source settings unavailable' }; }
    }
    return typeof node.__galleryRuntimeSource === 'string' ? { connected: true, text: node.__galleryRuntimeSource } : { connected: true, note: 'Connected prompt will be shown after execution.' };
}

export function effectiveSourceText(node: any): string | undefined {
    const info = sourcePromptInfo(node);
    return info.connected ? info.text ?? info.note : undefined;
}

type Deps = SuggestDeps;


/**
 * Replace the encoder's two text boxes with the tag-box editor.
 *
 * The boxes live in `node.properties.prompt_boxes`. Every edit compiles them into the hidden `text`
 * widget (so ComfyUI still resolves {a|b|c} dynamic prompts when it queues the workflow) and switches
 * `source_mode` to "boxes", which makes the backend put the connected source text where the source box sits.
 */
export function installPromptBoxes(node: any, deps: Deps) {
    if ((node.comfyClass || node.type) !== 'GalleryPromptEncode' || node.__galleryPromptBoxes || !node.addDOMWidget || typeof document === 'undefined') return;
    if (!node.inputs?.some((input: any) => input.name === 'source_text')) node.addInput?.('source_text', 'STRING');
    if (!node.widgets?.some((widget: any) => widget.name === 'source_mode')) node.addWidget?.('combo', 'source_mode', 'after', () => undefined, { values: ['after', 'before', 'replace', 'boxes'] });
    const widget = (name: string) => node.widgets?.find((item: any) => item.name === name);
    const hasSource = () => sourcePromptInfo(node).connected;
    const saved = parseState(node.properties?.prompt_boxes);
    let state: BoxState = saved ?? stateFromText(String(widget('text')?.value ?? ''), String(widget('source_mode')?.value ?? 'after'), hasSource());

    const suggest = makeSuggest(deps);

    const host = document.createElement('div');
    host.style.cssText = 'width:100%;height:100%;overflow:auto;box-sizing:border-box;background:var(--comfy-input-bg,#222);border-radius:6px';
    const root = createRoot(host);
    /** Exclusive tags in "never together" mode change how the boxes compile (see neverTogether). */
    const together = () => exclusiveMode() === 'together' ? conflicts : undefined;
    const compiledNow = () => compileBoxes(state, together());
    /** Keep the stored prompt in step with the boxes (the exclusive mode can change without an edit). */
    const sync = () => {
        const compiled = compiledNow(), text = widget('text');
        if (text && text.value !== compiled) { text.value = compiled; if (text.inputEl) text.inputEl.value = compiled; text.callback?.(compiled); node.setDirtyCanvas?.(true, true); }
    };
    const render = () => {
        const source = sourcePromptInfo(node);
        const mode = exclusiveMode(), names = (ids: string[]) => ids.map(id => state.boxes.flatMap(box => box.kind === 'group' ? box.chips : []).find(chip => chip.id === id)).map(chip => chip && chipTerms(chip)[0]).join(' / ');
        const notes = [notice,
            ...(mode === 'together' ? neverTogether(state, conflicts).map(ids => 'Never together: ' + names(ids)) : []),
            ...(mode !== 'off' ? alwaysTogether(state, conflicts).map(([a, b]) => `${a} and ${b} are both always used (make one optional)`) : [])].filter(Boolean);
        root.render(<PromptBoxEditor state={state} source={source} preview={composeWithSource(compiledNow(), source.text)} suggest={suggest} onChange={commit} notice={notes.join(' · ')} />);
    };
    window.addEventListener(EXCLUSIVE_MODE_EVENT, () => { sync(); render(); });
    /** Shown under the boxes after an edit, e.g. which tags "Exclusive tags" turned off. */
    let notice = '';
    function commit(next: BoxState) {
        notice = '';
        if (exclusiveMode() === 'disable') {
            const result = disableConflicts(state, next, conflicts);
            next = result.state;
            if (result.disabled.length) notice = 'Exclusive tags turned off: ' + result.disabled.join(', ');
        }
        state = next;
        node.properties ||= {}; node.properties.prompt_boxes = state;
        const compiled = compiledNow(), text = widget('text'), mode = widget('source_mode');
        if (text && text.value !== compiled) { text.value = compiled; if (text.inputEl) text.inputEl.value = compiled; text.callback?.(compiled); }
        if (mode && mode.value !== 'boxes') { mode.value = 'boxes'; mode.callback?.('boxes'); }
        node.setDirtyCanvas?.(true, true); node.graph?.change?.();
        render();
    }
    /** Re-read the stored text: if something else changed it (an API call, another extension) the boxes follow it. */
    const refresh = () => {
        const text = widget('text');
        if (text && typeof text.value === 'string') {
            const next = reconcileText(state, text.value, String(widget('source_mode')?.value ?? 'boxes'), hasSource(), together());
            if (next !== state) { commit(next); return; }
        }
        render();
    };

    hideWidget(widget('text')); hideWidget(widget('source_mode'));
    const dom = node.addDOMWidget('prompt_boxes', 'prompt_boxes', host, { serialize: false, hideOnZoom: false, getMinHeight: () => 240, getHeight: () => 320 });
    if (dom) dom.serialize = false;
    node.__galleryPromptBoxes = {
        /** Library and image-prompt appends arrive here as text and become their own box. Returns the compiled prompt. */
        insert(text: string, position: 'before' | 'after' | 'replace', name?: string) { commit(insertText(state, text, position, name)); return compiledNow(); },
    };

    for (const key of ['onConnectionsChange', 'onConfigure']) {
        const previous = node[key];
        node[key] = function (...args: any[]) {
            const result = previous?.apply(this, args);
            if (key === 'onConfigure') state = parseState(node.properties?.prompt_boxes) ?? state;
            setTimeout(refresh, 0);
            return result;
        };
    }
    const executed = node.onExecuted;
    node.onExecuted = function (data: any) {
        const result = executed?.call(this, data);
        if (Array.isArray(data?.source_text) && typeof data.source_text[0] === 'string') node.__galleryRuntimeSource = data.source_text[0];
        render();
        return result;
    };
    const changed = () => refresh();
    window.addEventListener('gallery-source-changed', changed);
    const removed = node.onRemoved;
    node.onRemoved = function (...args: any[]) {
        window.removeEventListener('gallery-source-changed', changed);
        setTimeout(() => root.unmount(), 0);
        return removed?.apply(this, args);
    };

    node.setSize?.([Math.max(400, node.size?.[0] || 0), Math.max(node.size?.[1] || 0, node.computeSize?.()[1] || 0, 460)]);
    if (saved) refresh(); else commit(state);
}
