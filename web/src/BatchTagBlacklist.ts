import { parsePrompt, splitTop, type Chip } from './PromptBoxes';
import { tagKey } from './TagConflicts';

export const BATCH_BLACKLIST_KEY = 'comfy-gallery-batch-tag-blacklist';
export const BATCH_BLACKLIST_EVENT = 'gallery-batch-blacklist-changed';
const key = (text: string) => tagKey(text).replace(/[_\s]+/g, ' ').trim();
export function parseBatchBlacklist(text: string): string[] {
    return [...new Set(text.split(/[,\r\n]+/).map(key).filter(Boolean))];
}
/** Protect the whole grouped chip when any nested option contains a blacklisted tag. */
export function batchChipBlocked(chip: Chip, blacklist: readonly string[], depth = 0): boolean {
    if (!blacklist.length) return false;
    const blocked = new Set(blacklist.map(key));
    if (chip.kind === 'tag') return splitTop(chip.text, ',').some(term => blocked.has(key(term)));
    if (depth >= 32) return true;
    return chip.options.some(option => parsePrompt(option).some(part => batchChipBlocked(part, blacklist, depth + 1)));
}
export const eligibleBatchIds = (chips: Chip[], blacklist: readonly string[]) => chips.filter(chip => !batchChipBlocked(chip, blacklist)).map(chip => chip.id);
