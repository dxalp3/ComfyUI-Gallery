import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { theme } from 'antd';
import { addBox, addBoxWithChip, addChips, addModeOf, ADD_MODES, chipItems, convertChip, withItems, balanced, chipTerms, closesChip, compileChip, editChips, expandKeywords, closeBraces, groupChips, groupingKind, groupingName, GROUPING_LABELS, mergeChips, moveBox, moveBoxTo, moveChipTo, moveItem, parsePrompt, parseTyped, pendingKeyword, removeBox, sourceKey, splitChip, splitTop, typingToken, updateBox, type AddMode, type BoxState, type Chip, type GroupBox, type GroupingKind, type OrChip, type SourceBox } from './PromptBoxes';

export type Suggestion = { label: string; kind: 'tag' | 'prefix'; terms?: string[] };
/** What the node's `source_text` input currently provides. `text` is known for Gallery Image Source and after a run. */
export type SourceInfo = { connected: boolean; text?: string; note?: string };

/** What is being dragged right now (dataTransfer contents are not readable while dragging over a target). */
let dragging: { kind: 'chip' | 'box'; id: string } | undefined;
const lower = (event: DragEvent<HTMLElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return event.clientY > rect.top + rect.height / 2; };
const right = (event: DragEvent<HTMLElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return event.clientX > rect.left + rect.width / 2; };

const border = 'var(--border-color, #555)';
const field = 'var(--comfy-input-bg, #222)';
const accent = '#1677ff';
const S: Record<string, CSSProperties> = {
    root: { display: 'flex', flexDirection: 'column', gap: 6, padding: 6, boxSizing: 'border-box', font: '12px system-ui, sans-serif', color: 'var(--input-text, #ddd)', minHeight: '100%' },
    box: { border: `1px solid ${border}`, borderRadius: 6, background: field },
    sourceBox: { border: `1px dashed ${border}`, borderRadius: 6, background: field },
    header: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', flexWrap: 'wrap' },
    body: { display: 'flex', flexDirection: 'column', gap: 6, padding: '0 6px 6px' },
    chips: { display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 22 },
    chip: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 4px 1px 8px', borderRadius: 12, border: `1px solid ${border}`, background: 'var(--comfy-menu-bg, #353535)', maxWidth: '100%', overflowWrap: 'anywhere' },
    orChip: { borderStyle: 'dashed', borderRadius: 6 },
    selected: { outline: `2px solid ${accent}` },
    handle: { cursor: 'grab', opacity: .7, padding: '0 2px', userSelect: 'none' },
    x: { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: '0 3px', fontSize: 14, lineHeight: 1 },
    btn: { border: `1px solid ${border}`, background: 'transparent', color: 'inherit', borderRadius: 4, cursor: 'pointer', padding: '0 6px', minHeight: 20, fontSize: 11 },
    input: { background: field, color: 'inherit', border: `1px solid ${border}`, borderRadius: 4, padding: '2px 6px', font: 'inherit' },
    editor: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: 6, border: `1px solid ${border}`, borderRadius: 6 },
    preview: { padding: '0 8px 6px', opacity: .7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    menu: { position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', maxHeight: 180, overflowY: 'auto', background: 'var(--comfy-menu-bg, #353535)', border: `1px solid ${border}`, borderRadius: 4 },
    option: { padding: '3px 8px', cursor: 'pointer' },
    muted: { opacity: .65, padding: '0 6px 6px' },
};

function Btn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
    return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} style={{ ...S.btn, opacity: disabled ? .4 : 1 }}>{children}</button>;
}

const KIND_COLORS: Record<GroupingKind, string> = { tag: border, alternatives: '#4096ff', optional: '#d89614', group: '#49aa19' };

/** Colour of a chip's kind; single optional tags (`each`) share the optional group's green. */
const modeColor = (mode: AddMode) => KIND_COLORS[mode === 'each' ? 'group' : mode];

/**
 * The parts of a grouped chip with the separator its kind uses: | between alternatives, , inside a group.
 * With `onItems` the parts are editable in place: × removes one, + adds more (with suggestions).
 */
function ChipParts({ chip, suggest, onItems }: { chip: OrChip; suggest?: (query: string) => Promise<Suggestion[]>; onItems?: (items: string[]) => void }) {
    const [adding, setAdding] = useState(false);
    const kind = groupingKind(chip), color = KIND_COLORS[kind];
    const parts = chipItems(chip);
    const separator = kind === 'group' ? ',' : '|';
    return <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, padding: '2px 4px' }}>
        {parts.map((part, index) => <span key={index + part} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {index > 0 && <span aria-hidden style={{ color, fontWeight: 700, padding: kind === 'group' ? '0 4px 0 0' : '0 4px' }}>{separator}</span>}
            <span style={onItems ? { display: 'inline-flex', alignItems: 'center', borderRadius: 4, background: '#ffffff12', padding: '0 0 0 4px' } : undefined}>
                {part}
                {onItems && <button type="button" aria-label={'Remove ' + part} title={'Remove “' + part + '” from this chip'} onClick={event => { event.stopPropagation(); onItems(parts.filter((_, at) => at !== index)); }} style={{ ...S.x, fontSize: 12, opacity: .7 }}>×</button>}
            </span>
        </span>)}
        {onItems && suggest && (adding
            ? <PartInput chip={chip} suggest={suggest} onAdd={items => onItems([...parts, ...items])} onClose={() => setAdding(false)} />
            : <button type="button" aria-label={kind === 'group' ? 'Add a tag to this group' : 'Add an option'} title={kind === 'group' ? 'Add a tag to this group' : 'Add an option'} onClick={event => { event.stopPropagation(); setAdding(true); }}
                style={{ ...S.x, color, fontWeight: 700, padding: '0 4px' }}>+</button>)}
    </span>;
}

/** Inline input in a grouped chip: Enter adds what was typed as more options (`a | b`, `a OR b`) or more group tags. */
function PartInput({ chip, suggest, onAdd, onClose }: { chip: OrChip; suggest: (query: string) => Promise<Suggestion[]>; onAdd: (items: string[]) => void; onClose: () => void }) {
    const [value, setValue] = useState('');
    const [items, setItems] = useState<Suggestion[]>([]);
    const [active, setActive] = useState(-1);
    const input = useRef<HTMLInputElement>(null);
    const request = useRef(0);
    const group = groupingKind(chip) === 'group';
    useEffect(() => { input.current?.focus(); }, []);
    useEffect(() => {
        const { token: query } = typingToken(value);
        if (query.replace(/^@/, '').length < (query.startsWith('@') ? 0 : 2)) { setItems([]); return; }
        const id = ++request.current;
        const timer = window.setTimeout(() => { suggest(query).then(found => { if (id === request.current) { setItems(found); setActive(-1); } }).catch(() => undefined); }, 150);
        return () => window.clearTimeout(timer);
    }, [value]);
    // Group: every tag typed joins the group. Alternatives: `|` or OR separate options; commas stay inside one option.
    const partsOf = (text: string) => group ? parsePrompt(expandKeywords(text)).flatMap(chipTerms) : text.replace(/^[\s{]+|[\s}]+$/g, '').split(/\s+OR\s+|\|/).map(part => part.replace(/^\s*,|,\s*$/g, '').trim()).filter(Boolean);
    const add = (text: string) => { const parts = partsOf(text); if (parts.length) onAdd(parts); setValue(''); setItems([]); requestAnimationFrame(() => input.current?.focus()); };
    const pick = (item: Suggestion) => {
        const before = value.slice(0, typingToken(value).start);
        if (item.kind === 'prefix') { onAdd([...partsOf(before), ...(group ? item.terms || [] : [(item.terms || []).join(', ')])]); setValue(''); setItems([]); return; }
        add(before + item.label);
    };
    return <span onClick={event => event.stopPropagation()} style={{ display: 'inline-flex' }}>
        <input ref={input} autoComplete="off" spellCheck={false} aria-label={group ? 'Add a tag to this group' : 'Add an option'} placeholder={group ? 'tag' : 'option'} value={value}
            onChange={event => setValue(event.target.value)} onBlur={() => { if (value.trim()) add(value); onClose(); }}
            onKeyDown={event => {
                if (event.key === 'ArrowDown' && items.length) { event.preventDefault(); setActive(index => (index + 1) % items.length); }
                else if (event.key === 'ArrowUp' && items.length) { event.preventDefault(); setActive(index => (index <= 0 ? items.length : index) - 1); }
                else if (event.key === 'Enter') { event.preventDefault(); if (items[active]) pick(items[active]); else if (value.trim()) add(value); else onClose(); }
                else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
            }} style={{ ...S.input, width: 110, padding: '0 4px', fontSize: 11 }} />
        <SuggestionMenu anchor={input.current} items={items} active={active} onPick={pick} />
    </span>;
}

/**
 * One chip. A grouped chip is edited in place: its header picks the kind (and shows the weight), its parts
 * keep their separators and can be removed or added to. Clicking the chip opens the small editor for the rest.
 * Chips in group boxes can be dragged (`onDrop` given): drop on another chip to put it before/after that chip.
 */
function ChipView({ chip, selected, picked, onSelect, onPick, onRemove, onDrop, onKind, onItems, suggest }: { chip: Chip; selected: boolean; picked?: boolean; onSelect: () => void; onPick?: () => void; onRemove?: () => void; onDrop?: (chipId: string, after: boolean) => void; onKind?: (mode: AddMode) => void; onItems?: (items: string[]) => void; suggest?: (query: string) => Promise<Suggestion[]> }) {
    const [mark, setMark] = useState<'before' | 'after'>();
    const weighted = chip.weight !== undefined && chip.weight !== 1;
    const mode = addModeOf(chip), color = modeColor(mode);
    const grouped = chip.kind === 'or';
    const remove = onRemove && <button type="button" aria-label="Remove tag" title="Remove" onClick={event => { event.stopPropagation(); onRemove(); }} style={{ ...S.x, color: grouped ? '#fff' : 'inherit' }}>×</button>;
    const select = (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => { if ((event.shiftKey || event.ctrlKey || event.metaKey) && onPick) onPick(); else onSelect(); };
    const label = <span role="button" tabIndex={0} aria-label={'Edit ' + compileChip({ ...chip, enabled: true })} onClick={select}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } }} style={{ cursor: 'pointer' }}>
        {grouped
            ? <ChipParts chip={chip} suggest={suggest} onItems={onItems} />
            : <>{chip.emphasis === 'round' && '('}{chip.emphasis === 'square' && '['}{chip.text}{chip.emphasis === 'round' && ')'}{chip.emphasis === 'square' && ']'}</>}
        {weighted && !grouped && <small style={{ opacity: .7 }}> ×{chip.weight}</small>}
    </span>;
    return <span data-chip-id={chip.id} onClick={event => { if (!(event.target as HTMLElement).closest('button,select,input,[role="button"]')) select(event); }} draggable={!!onDrop} title={onDrop ? 'Click to edit · Shift/Ctrl-click to pick several · drag to reorder or onto another box' : undefined}
        onDragStart={event => { if (!onDrop) return; dragging = { kind: 'chip', id: chip.id }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', compileChip(chip)); }}
        onDragEnd={() => { dragging = undefined; setMark(undefined); }}
        onDragOver={event => { if (!onDrop || dragging?.kind !== 'chip' || dragging.id === chip.id) return; event.preventDefault(); event.stopPropagation(); setMark(right(event) ? 'after' : 'before'); }}
        onDragLeave={() => setMark(undefined)}
        onDrop={event => { if (!onDrop || dragging?.kind !== 'chip') return; event.preventDefault(); event.stopPropagation(); const after = right(event), id = dragging.id; setMark(undefined); if (id !== chip.id) onDrop(id, after); }}
        style={{ ...S.chip, ...(grouped ? { flexDirection: 'column', alignItems: 'stretch', gap: 0, padding: 0, borderRadius: 6, borderColor: color, overflow: 'visible' } : {}), ...(selected ? S.selected : {}), ...(picked ? { outline: `2px dashed ${accent}` } : {}), opacity: chip.enabled ? 1 : .45, textDecoration: chip.enabled ? 'none' : 'line-through', cursor: onDrop ? 'grab' : 'default', boxShadow: mark === 'before' ? `inset 3px 0 0 ${accent}` : mark === 'after' ? `inset -3px 0 0 ${accent}` : undefined }}>
        {grouped
            ? <>
                {/* The header names the grouping (and changes it); the body keeps the separators. */}
                <span title={ADD_MODES.find(item => item.value === mode)?.hint} style={{ display: 'flex', alignItems: 'center', gap: 4, background: color, color: '#fff', fontSize: 10, lineHeight: '15px', padding: '0 2px 0 4px', textTransform: 'uppercase', letterSpacing: .3, borderRadius: '5px 5px 0 0' }}>
                    {onKind
                        ? <select aria-label="Chip kind" value={mode} onClick={event => event.stopPropagation()} onChange={event => onKind(event.target.value as AddMode)}
                            style={{ flex: 1, minWidth: 0, background: 'transparent', color: '#fff', border: 0, font: 'inherit', textTransform: 'uppercase', letterSpacing: .3, cursor: 'pointer', padding: 0 }}>
                            {ADD_MODES.map(item => <option key={item.value} value={item.value} style={{ color: '#000', textTransform: 'none' }}>{item.value === 'each' ? 'Optional' : item.name}</option>)}
                        </select>
                        : <span style={{ flex: 1 }}>{groupingName(chip)}</span>}
                    {weighted && <span>×{chip.weight}</span>}
                    {remove}
                </span>
                {label}
            </>
            : <>{label}{remove}</>}
    </span>;
}

/** Pick what a chip is: the "Add as" kinds (Optional = each tag optional on its own). */
function KindPicker({ value, onChange }: { value: AddMode; onChange: (mode: AddMode) => void }) {
    return <span role="radiogroup" aria-label="Grouping" style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 2 }}>
        {ADD_MODES.map(item => <button key={item.value} type="button" role="radio" aria-checked={item.value === value} title={item.hint} onClick={() => onChange(item.value)}
            style={{ ...S.btn, borderColor: item.value === value ? modeColor(item.value) : border, background: item.value === value ? modeColor(item.value) : 'transparent', color: item.value === value && item.value !== 'tag' ? '#fff' : 'inherit' }}>{item.value === 'each' ? 'Optional' : item.name}</button>)}
    </span>;
}

/** The rest of a chip's settings. Grouped chips edit their kind and parts in the chip itself, so only these remain. */
function ChipEditor({ chip, onChange, onKind, onRemove, onSplit, onMove, onClose }: { chip: Chip; onChange: (chip: Chip) => void; onKind: (mode: AddMode) => void; onRemove: () => void; onSplit: () => void; onMove: (delta: -1 | 1) => void; onClose: () => void }) {
    const [draft, setDraft] = useState(chip.kind === 'tag' ? chip.text : '');
    useEffect(() => setDraft(chip.kind === 'tag' ? chip.text : ''), [chip.id, chip.kind, chip.kind === 'tag' ? chip.text : '']);
    const commit = () => {
        if (chip.kind !== 'tag' || !draft.trim() || draft.trim() === chip.text) return;
        // Typing {a|b}, {a|b|}, {a, b|} or `a OR b OPT` into a tag turns it into that grouping.
        const parsed = parseTyped(draft);
        if (parsed.length === 1) onChange({ ...parsed[0], id: chip.id, enabled: chip.enabled, weight: parsed[0].weight ?? chip.weight });
        else onChange({ ...chip, text: draft.trim() });
    };
    return <div style={{ ...S.editor, flexDirection: 'column', alignItems: 'stretch' }}>
        {chip.kind === 'tag' && <>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <KindPicker value={addModeOf(chip)} onChange={onKind} />
            </div>
            <input autoComplete="off" aria-label="Tag text" value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') commit(); if (event.key === 'Escape') onClose(); }} style={{ ...S.input, minWidth: 120 }} />
        </>}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <label>weight <input type="number" step={0.05} min={0} max={3} aria-label="Weight" placeholder="1" value={chip.weight ?? ''} onChange={event => onChange({ ...chip, weight: event.target.value === '' ? undefined : Number(event.target.value) })} style={{ ...S.input, width: 58 }} /></label>
            {chip.kind === 'tag' && <select aria-label="Brackets" value={chip.emphasis ?? ''} onChange={event => onChange({ ...chip, emphasis: event.target.value === 'round' || event.target.value === 'square' ? event.target.value : undefined })} style={S.input}><option value="">no brackets</option><option value="round">( )</option><option value="square">[ ]</option></select>}
            <label><input type="checkbox" checked={chip.enabled} onChange={event => onChange({ ...chip, enabled: event.target.checked })} /> on</label>
            {chip.kind === 'or' && <Btn label="Split into separate tags" onClick={onSplit}>Split</Btn>}
            <Btn label="Move earlier" onClick={() => onMove(-1)}>◀</Btn><Btn label="Move later" onClick={() => onMove(1)}>▶</Btn><Btn label="Remove tag" onClick={onRemove}>🗑</Btn><Btn label="Done" onClick={onClose}>✓</Btn>
        </div>
    </div>;
}

/** Suggestions float above everything (the node's DOM widget scrolls and would clip them). */
function SuggestionMenu({ anchor, items, active, onPick }: { anchor: HTMLElement | null; items: Suggestion[]; active: number; onPick: (item: Suggestion) => void }) {
    const [rect, setRect] = useState<DOMRect>();
    useLayoutEffect(() => {
        if (!anchor || !items.length) return;
        const update = () => setRect(anchor.getBoundingClientRect());
        update();
        window.addEventListener('scroll', update, true); window.addEventListener('resize', update);
        return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
    }, [anchor, items]);
    if (!anchor || !items.length || !rect || typeof document === 'undefined') return null;
    const below = window.innerHeight - rect.bottom > 190 || rect.top < 190;
    // The menu lives in <body>, outside the editor: take the editor's look (node colours, or the gallery's) from the input.
    const look = getComputedStyle(anchor), value = (name: string) => look.getPropertyValue(name).trim() || undefined;
    return createPortal(<div data-suggestion-menu role="listbox" onMouseDown={event => event.preventDefault()} style={{ ...S.menu, position: 'fixed', left: rect.left, width: Math.max(rect.width, 200), right: 'auto', top: below ? rect.bottom + 2 : undefined, bottom: below ? undefined : window.innerHeight - rect.top + 2, zIndex: 100000, color: value('--input-text') || '#ddd', background: value('--comfy-menu-bg') || '#353535', borderColor: value('--border-color'), font: look.font || '12px system-ui, sans-serif', ['--comfy-menu-hover-bg' as string]: value('--comfy-menu-hover-bg') } as CSSProperties}>
        {items.map((item, index) => <div key={item.kind + item.label} role="option" aria-selected={index === active} onClick={() => onPick(item)} style={{ ...S.option, background: index === active ? 'var(--comfy-menu-hover-bg, #444)' : 'transparent' }}>
            {item.kind === 'prefix' ? '@' : ''}{item.label}{item.kind === 'prefix' && <small style={{ opacity: .6 }}> · prefix</small>}
        </div>)}
    </div>, document.body);
}

/**
 * Text box with library suggestions for the word being typed. A comma ends a tag; Enter adds what was typed.
 * Prompt syntax can be typed as it is: suggestions keep working after `{`, `(` and `|`, and closing the
 * brackets (`{red hair|}`, `{(red hair, blue eyes)|}`, `(red hair:1.2)`) turns what was typed into a chip.
 * Upper-case AND / OR / OPT relate the tags of a chip (see KEYWORDS); a preview shows what will be added.
 * With `onGroup`, an "Add as" choice decides what the typed tags become: separate tags, one chip of
 * alternatives / optional alternatives / an optional group, or every tag optional on its own.
 */
function AddInput({ target, onTargetMode, placeholder, suggest, onText, onPrefix, onGroup }: { target?: OrChip; onTargetMode?: (mode: AddMode) => void; placeholder: string; suggest: (query: string) => Promise<Suggestion[]>; onText: (text: string) => void; onPrefix: (suggestion: Suggestion, typedBefore: string) => void; onGroup?: (mode: AddMode, tags: string[]) => void }) {
    const [value, setValue] = useState('');
    const [items, setItems] = useState<Suggestion[]>([]);
    const [active, setActive] = useState(-1);
    const [mode, setMode] = useState<AddMode>('tag');
    useEffect(() => { setMode(target ? addModeOf(target) : 'tag'); }, [target?.id, target && addModeOf(target)]);
    const [pending, setPending] = useState<string[]>([]);
    const request = useRef(0);
    const input = useRef<HTMLInputElement>(null);
    const grouping = !!onGroup && mode !== 'tag';
    const modeInfo = ADD_MODES.find(item => item.value === mode)!;
    useEffect(() => {
        const { token: query } = typingToken(value);
        // No suggestions for a weight being typed (`red hair:1.`).
        if (/:[\d.]*$/.test(query) || query.replace(/^@/, '').length < (query.startsWith('@') ? 0 : 2)) { setItems([]); return; }
        const id = ++request.current;
        const timer = window.setTimeout(() => { suggest(query).then(found => { if (id === request.current) { setItems(found); setActive(-1); } }).catch(() => { if (id === request.current) setItems([]); }); }, 150);
        return () => window.clearTimeout(timer);
    }, [value]);
    const reset = () => { setValue(''); setItems([]); setActive(-1); };
    const tagsOf = (text: string) => splitTop(text, ',').map(tag => tag.trim()).filter(Boolean);
    /** Enter: in tag mode add the text (keywords applied); in a grouping mode add the collected tags. */
    const commit = (text = value, refocus = true) => {
        // Adding re-renders the node, and ComfyUI then moves focus to the canvas: keep typing in this input.
        if (refocus) requestAnimationFrame(() => input.current?.focus());
        if (target) { const tags = [...pending, ...tagsOf(text)]; if (tags.length) onGroup?.(addModeOf(target), tags); setPending([]); reset(); return; }
        if (grouping) { const tags = [...pending, ...tagsOf(text)]; if (tags.length) onGroup!(mode, tags); setPending([]); reset(); return; }
        const expanded = expandKeywords(closeBraces(text));
        if (expanded.trim()) onText(expanded); reset();
    };
    const collect = (tags: string[]) => { setPending(old => [...old, ...tags.filter(tag => !old.includes(tag))]); reset(); input.current?.focus(); };
    const change = (next: string) => {
        // Closing the brackets of `{tag|}` or `{(a, b)|}` registers the chip right away.
        if (!grouping && next.length > value.length && closesChip(value, next)) { commit(next); return; }
        setValue(next);
    };
    const pick = (item: Suggestion) => {
        const { start, inGroup } = typingToken(value);
        const before = value.slice(0, start);
        const text = item.kind === 'prefix' ? (item.terms || []).join(', ') : item.label;
        if (grouping && !inGroup) { collect([...tagsOf(before), text]); return; }
        // Inside brackets or after AND / OR the chip is not finished yet: put the tag in and keep typing.
        if (inGroup || pendingKeyword(before)) {
            setValue(before + text + (inGroup ? '' : ' ')); setItems([]); setActive(-1); input.current?.focus();
            return;
        }
        const head = before.replace(/,\s*$/, '').trim();
        if (item.kind === 'prefix') onPrefix(item, head); else onText(expandKeywords(head ? head + ', ' + item.label : item.label));
        reset();
    };
    const draft = grouping && pending.length ? groupChips(mode, pending) : [];
    // Tag mode: show what brackets or keywords will make of the text before it is added.
    const preview = !grouping && /[{([]|\b(?:AND|OR|OPT)\b/.test(value) ? parseTyped(value) : [];
    const shown = draft.length ? draft : preview;
    return <div data-add-input>
        {!!shown.length && <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 4, opacity: .85 }}>
            {shown.map(chip => <ChipView key={chip.id} chip={chip} selected={false} onSelect={() => undefined} onRemove={draft.length ? () => setPending([]) : undefined} />)}
            <small style={{ opacity: .7 }}>{draft.length ? 'Enter adds it · comma or a suggestion adds another tag' : 'Enter adds · closing the brackets adds it too'}</small>
        </div>}
        <div style={{ display: 'flex', gap: 4 }}>
            {onGroup && <select aria-label="Add as" title={modeInfo.hint} value={mode} onChange={event => { setMode(event.target.value as AddMode); onTargetMode?.(event.target.value as AddMode); }}
                style={{ ...S.input, flex: '0 0 auto', borderColor: mode === 'tag' ? border : KIND_COLORS[mode === 'each' ? 'group' : mode] }}>
                {ADD_MODES.map(item => <option key={item.value} value={item.value} title={item.hint}>{item.name}</option>)}
            </select>}
            <input ref={input} autoComplete="off" spellCheck={false} aria-label={placeholder} title="Type tags, {a|b} syntax, or AND / OR / OPT between tags (e.g. red hair OR blue hair OPT)"
                placeholder={grouping ? (mode === 'each' ? 'Type tags; each becomes optional on its own' : `Type tags for one ${modeInfo.name.toLowerCase()} chip`) : placeholder} value={value} onChange={event => change(event.target.value)}
                onBlur={event => { if (!(event.relatedTarget as HTMLElement | null)?.closest('[data-add-input],[data-suggestion-menu]')) commit(value, false); }}
                onKeyDown={event => {
                    if (event.key === 'ArrowDown' && items.length) { event.preventDefault(); setActive(index => (index + 1) % items.length); }
                    else if (event.key === 'ArrowUp' && items.length) { event.preventDefault(); setActive(index => (index <= 0 ? items.length : index) - 1); }
                    else if (event.key === 'Enter') { event.preventDefault(); if (items[active]) pick(items[active]); else commit(); }
                    else if (event.key === 'Escape') { setItems([]); setActive(-1); }
                    else if (event.key === ',' && value.trim() && balanced(value)) { event.preventDefault(); if (grouping) collect(tagsOf(value)); else commit(); }
                }} style={{ ...S.input, flex: 1, minWidth: 0, boxSizing: 'border-box' }} />
        </div>
        <SuggestionMenu anchor={input.current} items={items} active={active} onPick={pick} />
    </div>;
}

/** Shift/Ctrl-click several chips, then combine them into one grouped chip. */
function MergeBar({ count, onMerge, onClear }: { count: number; onMerge: (kind: Exclude<GroupingKind, 'tag'>) => void; onClear: () => void }) {
    return <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
        <small>{count} picked · combine as</small>
        {(['alternatives', 'optional', 'group'] as const).map(kind => <button key={kind} type="button" title={GROUPING_LABELS[kind].hint} onClick={() => onMerge(kind)} style={{ ...S.btn, borderColor: KIND_COLORS[kind] }}>{GROUPING_LABELS[kind].name}</button>)}
        <Btn label="Clear picked tags" onClick={onClear}>×</Btn>
    </div>;
}

type Common = { index: number; count: number; state: BoxState; onChange: (state: BoxState) => void };

/** The grip that drags a whole box; the box itself is the drop target. */
function BoxGrip({ id, name, boxRef, onEnd }: { id: string; name: string; boxRef: { current: HTMLDivElement | null }; onEnd: () => void }) {
    return <span draggable role="button" aria-label={'Drag box ' + name + ' to reorder'} title="Drag to reorder boxes" style={S.handle}
        onDragStart={event => { dragging = { kind: 'box', id }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', name); if (boxRef.current) event.dataTransfer.setDragImage(boxRef.current, 12, 12); }}
        onDragEnd={() => { dragging = undefined; onEnd(); }}>⠿</span>;
}

/** One box of chips. `bare` leaves out the box header (name, on/off, ordering) for plain chip lists such as a prefix's terms. */
function GroupView({ box, index, count, state, onChange, suggest, bare, placeholder = 'Add tags (Enter)' }: Common & { box: GroupBox; suggest: (query: string) => Promise<Suggestion[]>; bare?: boolean; placeholder?: string }) {
    const [selected, setSelected] = useState<string>();
    const [activeChipId, setActiveChipId] = useState<string>();
    const [focused, setFocused] = useState(false);
    const [picked, setPicked] = useState<string[]>([]);
    const [renaming, setRenaming] = useState<string>();
    const [mark, setMark] = useState<'before' | 'after'>();
    const ref = useRef<HTMLDivElement>(null);
    const chip = box.chips.find(item => item.id === selected);
    const activeChip = box.chips.find(item => item.id === activeChipId);
    const target = activeChip?.kind === 'or' ? activeChip : undefined;
    const focusInput = () => requestAnimationFrame(() => ref.current?.querySelector<HTMLInputElement>('[data-add-input] input')?.focus());
    useEffect(() => {
        let timer: number | undefined;
        const outside = (event: PointerEvent) => {
            const element = event.target as HTMLElement;
            if (!ref.current?.contains(element) && !element.closest('[data-suggestion-menu]')) { timer = window.setTimeout(() => { setActiveChipId(undefined); setFocused(false); }, 0); }
        };
        document.addEventListener('pointerdown', outside, true);
        return () => { window.clearTimeout(timer); document.removeEventListener('pointerdown', outside, true); };
    }, []);
    const append = (parts: string[]) => {
        if (!target) return;
        const next = withItems(target, [...chipItems(target), ...parts]);
        if (next) onChange(editChips(state, box.id, chips => chips.map(item => item.id === target.id ? next : item)));
    };
    const patch = (value: Partial<Omit<GroupBox, 'kind' | 'id'>>) => onChange(updateBox(state, box.id, value));
    const remove = (id: string) => { setSelected(undefined); onChange(editChips(state, box.id, chips => chips.filter(item => item.id !== id))); };
    const preview = box.chips.map(compileChip).filter(Boolean).join(', ');
    return <div ref={ref}
        onPointerDown={event => { event.stopPropagation(); setFocused(true); }}
        onClick={event => {
            const element = event.target as HTMLElement;
            const chipId = element.closest<HTMLElement>('[data-chip-id]')?.dataset.chipId;
            if (chipId) setActiveChipId(chipId);
            else if (!element.closest('[data-add-input]')) setActiveChipId(undefined);
            if (!element.closest('button,input,select,[draggable="true"]')) focusInput();
        }}
        onDragOver={event => { if (dragging?.kind === 'box' && dragging.id !== box.id) { event.preventDefault(); setMark(lower(event) ? 'after' : 'before'); } else if (dragging?.kind === 'chip') event.preventDefault(); }}
        onDragLeave={() => setMark(undefined)}
        onDrop={event => {
            const current = dragging; if (!current) return;
            event.preventDefault(); setMark(undefined);
            if (current.kind === 'box') { if (current.id !== box.id) onChange(moveBoxTo(state, current.id, { boxId: box.id, after: lower(event) })); }
            else onChange(moveChipTo(state, current.id, box.id));
        }}
        style={{ ...S.box, pointerEvents: 'auto', ...(focused ? { borderColor: accent } : {}), ...(bare ? { paddingTop: 6 } : {}), opacity: box.enabled ? 1 : .6, boxShadow: mark === 'before' ? `0 -3px 0 ${accent}` : mark === 'after' ? `0 3px 0 ${accent}` : undefined }}>
        {!bare && <div style={S.header}>
            <BoxGrip id={box.id} name={box.name || 'untitled'} boxRef={ref} onEnd={() => setMark(undefined)} />
            <Btn label={box.collapsed ? 'Expand box' : 'Collapse box'} onClick={() => patch({ collapsed: !box.collapsed })}>{box.collapsed ? '▸' : '▾'}</Btn>
            <input type="checkbox" aria-label={'Use box ' + box.name} title="Use this box" checked={box.enabled} onChange={event => patch({ enabled: event.target.checked })} />
            {renaming === undefined
                ? <strong title="Double-click to rename" onDoubleClick={() => setRenaming(box.name)} style={{ cursor: 'text' }}>{box.name || 'untitled'}</strong>
                : <input autoFocus aria-label="Box name" value={renaming} onChange={event => setRenaming(event.target.value)} onBlur={() => { patch({ name: renaming.trim() || box.name }); setRenaming(undefined); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setRenaming(undefined); }} style={{ ...S.input, width: 110 }} />}
            <small style={{ opacity: .6 }}>{box.chips.length} tag{box.chips.length === 1 ? '' : 's'}</small>
            <span style={{ flex: 1 }} />
            <Btn label="Move box up" disabled={index === 0} onClick={() => onChange(moveBox(state, box.id, -1))}>▲</Btn>
            <Btn label="Move box down" disabled={index === count - 1} onClick={() => onChange(moveBox(state, box.id, 1))}>▼</Btn>
            <Btn label="Delete box" onClick={() => onChange(removeBox(state, box.id))}>×</Btn>
        </div>}
        {box.collapsed
            ? !!preview && <div style={S.preview} title={preview}>{box.chips.filter(item => item.enabled).map((item, index) => <span key={item.id}>{index > 0 && ', '}<span style={item.kind === 'or' ? { color: KIND_COLORS[groupingKind(item)], fontWeight: 600 } : undefined}>{compileChip(item)}</span></span>)}</div>
            : <div style={S.body}>
                <div style={S.chips}>{box.chips.map(item => <ChipView key={item.id} chip={item} selected={item.id === selected || item.id === activeChipId} picked={picked.includes(item.id)} onSelect={() => { setSelected(item.id); setActiveChipId(item.id); focusInput(); }} onRemove={() => remove(item.id)}
                    onPick={() => setPicked(old => old.includes(item.id) ? old.filter(id => id !== item.id) : [...old, item.id])}
                    onDrop={(sourceId, after) => onChange(moveChipTo(state, sourceId, box.id, { chipId: item.id, after }))}
                    onKind={mode => onChange(convertChip(state, box.id, item.id, mode))} suggest={suggest}
                    onItems={items => { const next = withItems(item, items); onChange(editChips(state, box.id, chips => next ? chips.map(other => other.id === item.id ? next : other) : chips.filter(other => other.id !== item.id))); }} />)}</div>
                {picked.length > 1 && <MergeBar count={picked.length} onClear={() => setPicked([])} onMerge={kind => { onChange(mergeChips(state, box.id, picked, kind)); setPicked([]); }} />}
                {chip && <ChipEditor chip={chip} onKind={mode => { if (mode !== 'alternatives' && mode !== 'optional' && mode !== 'group') setSelected(undefined); onChange(convertChip(state, box.id, chip.id, mode)); }} onClose={() => setSelected(undefined)} onRemove={() => remove(chip.id)} onSplit={() => { setSelected(undefined); onChange(splitChip(state, box.id, chip.id)); }}
                    onChange={next => onChange(editChips(state, box.id, chips => chips.map(item => item.id === next.id ? next : item)))}
                    onMove={delta => onChange(editChips(state, box.id, chips => moveItem(chips, chip.id, delta)))} />}
                <AddInput target={target} onTargetMode={mode => { if (target) onChange(convertChip(state, box.id, target.id, mode)); }} placeholder={placeholder} suggest={suggest} onText={text => target ? append(parseTyped(text).flatMap(chipTerms)) : onChange(addChips(state, box.id, text))}
                    onGroup={(mode, tags) => { if (target) { append(tags); return; } const made = groupChips(mode, tags); if (made.length) onChange(editChips(state, box.id, chips => [...chips, ...made])); }}
                    onPrefix={(item, head) => target ? append([...parseTyped(head).flatMap(chipTerms), ...(item.terms || [])]) : onChange(addChips(state, box.id, [head, (item.terms || []).join(', ')].filter(Boolean).join(', ')))} />
            </div>}
    </div>;
}

/**
 * The connected source text as chips. Chips can be removed (×) without touching the source: they are left
 * out of the prompt when the workflow runs and listed under "Left out", where they can be put back.
 */
function SourceView({ box, index, count, state, onChange, source }: Common & { box: SourceBox; source: SourceInfo }) {
    const [mark, setMark] = useState<'before' | 'after'>();
    const ref = useRef<HTMLDivElement>(null);
    const excluded = box.excluded || [];
    const dropped = new Set(excluded.map(sourceKey));
    // Each top-level part of the source text is one chip; the part's own text is what a removal stores.
    const parts = source.text ? splitTop(source.text, ',').map(part => part.trim()).filter(Boolean) : [];
    const kept = parts.filter(part => !dropped.has(sourceKey(part)));
    const patch = (value: Partial<Pick<SourceBox, 'enabled' | 'collapsed' | 'excluded'>>) => onChange(updateBox(state, box.id, value));
    const setExcluded = (next: string[]) => patch({ excluded: next.length ? next : undefined });
    const status = !source.connected ? 'not connected' : source.text ? kept.length + ' tag' + (kept.length === 1 ? '' : 's') + (kept.length < parts.length ? ` · ${parts.length - kept.length} left out` : '') : 'connected';
    return <div ref={ref}
        onDragOver={event => { if (dragging?.kind === 'box' && dragging.id !== box.id) { event.preventDefault(); setMark(lower(event) ? 'after' : 'before'); } }}
        onDragLeave={() => setMark(undefined)}
        onDrop={event => { const current = dragging; if (current?.kind !== 'box' || current.id === box.id) return; event.preventDefault(); setMark(undefined); onChange(moveBoxTo(state, current.id, { boxId: box.id, after: lower(event) })); }}
        style={{ ...S.sourceBox, opacity: box.enabled && source.connected ? 1 : .6, boxShadow: mark === 'before' ? `0 -3px 0 ${accent}` : mark === 'after' ? `0 3px 0 ${accent}` : undefined }}>
        <div style={S.header}>
            <BoxGrip id={box.id} name="Source" boxRef={ref} onEnd={() => setMark(undefined)} />
            <Btn label={box.collapsed ? 'Expand source box' : 'Collapse source box'} onClick={() => patch({ collapsed: !box.collapsed })}>{box.collapsed ? '▸' : '▾'}</Btn>
            <input type="checkbox" aria-label="Use source box" title="Use the connected source text" checked={box.enabled} onChange={event => patch({ enabled: event.target.checked })} />
            <strong>Source</strong>
            <small style={{ opacity: .6 }}>{status}</small>
            <span style={{ flex: 1 }} />
            <Btn label="Move source box up" disabled={index === 0} onClick={() => onChange(moveBox(state, box.id, -1))}>▲</Btn>
            <Btn label="Move source box down" disabled={index === count - 1} onClick={() => onChange(moveBox(state, box.id, 1))}>▼</Btn>
        </div>
        {!box.collapsed && <>
            {!source.connected
                ? <div style={S.muted}>Connect a text output (for example a Gallery Image Source prompt) to <code>source_text</code>. Its tags appear here and are placed where this box sits.</div>
                : !source.text
                    ? <div style={S.muted}>{source.note || 'Connected prompt will be shown after execution.'}</div>
                    : <div style={{ ...S.body, ...S.chips, padding: '0 6px 6px' }}>{kept.map((part, at) => { const chip = parsePrompt(part)[0]; return chip && <ChipView key={at + part} chip={chip} selected={false} onSelect={() => undefined} onRemove={() => setExcluded([...excluded, part])} />; })}</div>}
            {!!excluded.length && <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, padding: '0 6px 6px' }} aria-label="Source tags left out">
                <small style={{ opacity: .65 }} title="Removed here only: the source and the image lineage are unchanged">Left out:</small>
                {excluded.map(tag => <button key={tag} type="button" title="Put this source tag back" aria-label={'Restore ' + tag} onClick={() => setExcluded(excluded.filter(item => item !== tag))}
                    style={{ ...S.btn, textDecoration: 'line-through', opacity: source.text && !parts.some(part => sourceKey(part) === sourceKey(tag)) ? .45 : .8 }}>{tag} ↺</button>)}
                {excluded.length > 1 && <Btn label="Restore all source tags" onClick={() => setExcluded([])}>restore all</Btn>}
            </div>}
        </>}
    </div>;
}

export function PromptBoxEditor({ state, source, preview, suggest, onChange, notice }: { state: BoxState; source: SourceInfo; preview: string; suggest: (query: string) => Promise<Suggestion[]>; onChange: (state: BoxState) => void; notice?: string }) {
    return <div style={S.root} onWheel={event => event.stopPropagation()}>
        {state.boxes.map((box, index) => box.kind === 'source'
            ? <SourceView key={box.id} box={box} index={index} count={state.boxes.length} state={state} onChange={onChange} source={source} />
            : <GroupView key={box.id} box={box} index={index} count={state.boxes.length} state={state} onChange={onChange} suggest={suggest} />)}
        <AddInput placeholder="New box: type tags and press Enter" suggest={suggest} onText={text => onChange(addBox(state, undefined, text))}
            onGroup={(mode, tags) => { const made = groupChips(mode, tags); if (made.length) onChange(addBoxWithChip(state, made)); }}
            onPrefix={(item, head) => onChange(addBox(head ? addBox(state, undefined, head) : state, item.label, (item.terms || []).join(', ')))} />
        {notice && <div role="status" style={{ opacity: .8, color: '#d89614' }}>{notice}</div>}
        <details>
            <summary style={{ cursor: 'pointer', opacity: .8 }}>Prompt sent to the encoder</summary>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: '4px 0', opacity: .85 }}>{preview || '—'}</div>
        </details>
    </div>;
}

/** Native controls inside the term editor shaped like the gallery's antd controls. */
const TERMS_STYLE = `
.cg-terms > div { border-radius: var(--cg-radius); padding: 8px; }
.cg-terms input:not([type=checkbox]), .cg-terms select { min-height: 30px; padding: 4px 10px !important; border-radius: var(--cg-radius) !important; font: inherit !important; }
.cg-terms input[type=number] { min-height: 26px; padding: 2px 6px !important; }
.cg-terms input:not([type=checkbox]):focus, .cg-terms select:focus { outline: none; border-color: var(--cg-primary) !important; box-shadow: 0 0 0 2px var(--cg-primary-ring); }
.cg-terms button { border-radius: var(--cg-radius) !important; }
.cg-terms [aria-label^="Edit "] { line-height: 1.6; }
`;

const termsBox = (terms: string[]): BoxState => ({ version: 1, boxes: [{ id: 'terms', kind: 'group', name: '', chips: terms.flatMap(parsePrompt), enabled: true, collapsed: false }] });
const termsOf = (state: BoxState): string[] => state.boxes.flatMap(box => box.kind === 'group' ? box.chips.map(compileChip).filter(Boolean) : []);

/**
 * A list of prompt terms (a prefix's tags) edited with the encoder's chips: typed brackets, AND / OR / OPT,
 * "Add as", grouped chips edited in place, weights. Each chip is one term, for example `activator tag`,
 * `{tag1|}`, `{(tag2, tag3)|}` or `(tag4:0.5)`.
 */
export function TermsEditor({ value, onChange, suggest, placeholder }: { value: string[]; onChange: (terms: string[]) => void; suggest: (query: string) => Promise<Suggestion[]>; placeholder?: string }) {
    const [state, setState] = useState<BoxState>(() => termsBox(value));
    // Follow changes made outside (loading another prefix, "add all"), but keep chip identity while editing here.
    useEffect(() => { if (JSON.stringify(termsOf(state)) !== JSON.stringify(value)) setState(termsBox(value)); }, [JSON.stringify(value)]);
    const change = (next: BoxState) => { setState(next); onChange(termsOf(next)); };
    const box = state.boxes[0] as GroupBox;
    // Diegetic: in a gallery window the chips take the gallery's colours, font and control shapes (the node look is for ComfyUI nodes).
    const { token } = theme.useToken();
    const look = { '--comfy-input-bg': token.colorBgContainer, '--comfy-menu-bg': token.colorFillTertiary, '--comfy-menu-hover-bg': token.controlItemBgHover, '--input-text': token.colorText, '--border-color': token.colorBorder,
        '--cg-primary': token.colorPrimary, '--cg-primary-ring': token.controlOutline, '--cg-radius': token.borderRadius + 'px', font: `${token.fontSize}px ${token.fontFamily}`, color: token.colorText } as CSSProperties;
    return <div className="cg-terms" style={{ ...S.root, padding: 0, minHeight: 0, ...look }} onWheel={event => event.stopPropagation()}>
        <style>{TERMS_STYLE}</style>
        <GroupView bare box={box} index={0} count={1} state={state} onChange={change} suggest={suggest} placeholder={placeholder} />
    </div>;
}
