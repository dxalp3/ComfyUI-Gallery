import { editChips, moveChipTo, newId, type BoxState, type Chip } from './PromptBoxes';

export const PROMPT_CHIP_TYPE = 'application/x-gallery-prompt-chip';

/** Move within one editor; copy between independent editors and from image/source prompts. */
export function dropPromptChip(state: BoxState, chip: Chip, boxId: string, target?: { chipId: string; after: boolean }): BoxState {
    if (state.boxes.some(box => box.kind === 'group' && box.chips.some(item => item === chip))) return moveChipTo(state, chip.id, boxId, target);
    return editChips(state, boxId, chips => {
        const next = [...chips], at = target ? next.findIndex(item => item.id === target.chipId) : -1;
        next.splice(at < 0 ? next.length : at + (target?.after ? 1 : 0), 0, { ...chip, id: newId() });
        return next;
    });
}
