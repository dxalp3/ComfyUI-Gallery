import { compileChip, editChips, formatSelectedChips, newId, parsePrompt, splitTop, type AddMode, type BoxState, type Chip } from './PromptBoxes';
import { tagKey } from './TagConflicts';

export const BATCH_BLACKLIST_KEY = 'comfy-gallery-batch-tag-blacklist';
export const BATCH_BLACKLIST_EVENT = 'gallery-batch-blacklist-changed';
const key = (text: string) => tagKey(text).replace(/[_\s]+/g, ' ').trim();
export function parseBatchBlacklist(text: string): string[] {
    return [...new Set(text.split(/[,\r\n]+/).map(key).filter(Boolean))];
}
/** Individual terms inside nested groups, with inherited weights kept for batch edits. */
export function batchTagItems(chips: Chip[], depth = 0): Chip[] {
    if (depth > 32) return [];
    return chips.flatMap(chip => {
        if (chip.kind === 'tag') return splitTop(chip.text, ',').flatMap(text => parsePrompt(text)).map(item => ({ ...item, enabled: chip.enabled, weight: chip.weight ?? item.weight, ...(chip.emphasis && item.kind === 'tag' ? { emphasis: chip.emphasis } : {}) }));
        return batchTagItems(chip.options.flatMap(parsePrompt), depth + 1).map(item => ({ ...item, enabled: chip.enabled && item.enabled, weight: chip.weight === undefined ? item.weight : chip.weight * (item.weight ?? 1) }));
    });
}
export const batchTagName = (chip: Chip) => chip.kind === 'tag' ? key(chip.text) : key(compileChip(chip));
export const availableBatchTags = (chips: Chip[]) => [...new Set(batchTagItems(chips).map(batchTagName))].sort();
export const batchChipBlocked = (chip: Chip, blacklist: readonly string[]) => batchTagItems([chip]).every(item => blacklist.some(tag => key(tag) === batchTagName(item)));
export const eligibleBatchIds = (chips: Chip[], blacklist: readonly string[]) => chips.filter(chip => !batchChipBlocked(chip, blacklist)).map(chip => chip.id);

/** Remove matching leaves while retaining the surrounding grouping and its weight. */
export function removeTagsFromChip(chip: Chip, tags: readonly string[], depth = 0): Chip | undefined {
    if (depth > 32) return chip;
    const blocked = new Set(tags.map(key));
    if (chip.kind === 'tag') {
        const parts = splitTop(chip.text, ',').filter(text => !parsePrompt(text).some(item => blocked.has(batchTagName(item))));
        return parts.length ? { ...chip, text: parts.join(', ') } : undefined;
    }
    const options = chip.options.map(option => parsePrompt(option).map(item => removeTagsFromChip(item, tags, depth + 1)).filter((item): item is Chip => !!item).map(item => compileChip({ ...item, enabled: true })).join(', ')).filter(Boolean);
    return options.length ? { ...chip, options } : undefined;
}
export function applyBatchTags(state: BoxState, boxId: string, ids: string[], blacklist: readonly string[], action: 'remove' | 'enable' | 'disable' | 'format', mode: AddMode = 'tag'): BoxState {
    const eligible = new Set<string>();
    const partitioned = editChips(state, boxId, chips => chips.flatMap(chip => {
        if (!ids.includes(chip.id)) return [chip];
        const selected = batchTagItems([chip]).filter(item => !blacklist.some(tag => key(tag) === batchTagName(item)));
        if (!selected.length) return [chip];
        if ((action === 'enable' || action === 'disable') && selected.length === batchTagItems([chip]).length) { eligible.add(chip.id); return [{ ...chip, enabled: action === 'enable' }]; }
        const remaining = removeTagsFromChip(chip, selected.map(batchTagName));
        const made = action === 'remove' ? [] : selected.map(item => { const id = newId(); eligible.add(id); return { ...item, id, enabled: action === 'enable' ? true : action === 'disable' ? false : item.enabled }; });
        return [...(remaining ? [remaining] : []), ...made];
    }));
    return action === 'format' ? formatSelectedChips(partitioned, boxId, [...eligible], mode) : partitioned;
}
