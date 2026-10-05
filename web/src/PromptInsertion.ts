export type PromptInsertion = { position: 'before' | 'after'; format: 'comma' | 'alternatives' | 'optional'; categoryGroups?: boolean; weight: number; prefix: string; suffix: string };
export const defaultInsertion: PromptInsertion = { position: 'after', format: 'comma', weight: 1, prefix: '', suffix: '' };
export function formatInsertion(groups: string[][], options: PromptInsertion): string {
    const clean = groups.map(group => group.map(term => term.trim()).filter(Boolean)).filter(group => group.length);
    const alternatives = (choices: string[]) => {
        const unique = [...new Set(choices)];
        if (options.format === 'optional') return '{' + unique.join('|') + '|}';
        return unique.length > 1 ? '{' + unique.join('|') + '}' : unique[0] || '';
    };
    if (!clean.length) return '';
    const textGroups = options.categoryGroups ? clean.map(group => alternatives(group)).join(', ') : alternatives(clean.map(group => group.join(', ')));
    let text = options.format === 'comma' ? [...new Set(clean.flat())].join(', ') : textGroups;
    text = options.prefix + text + options.suffix;
    if (Number.isFinite(options.weight) && options.weight !== 1) text = '(' + text + ':' + options.weight + ')';
    return text;
}
export function combineEncoderPrompt(own: string, source: string | undefined, mode = 'after'): string {
    if (source === undefined) return own;
    if (mode === 'replace') return source;
    return (mode === 'before' ? [source, own] : [own, source]).map(value => value.trim()).filter(Boolean).join(', ');
}
