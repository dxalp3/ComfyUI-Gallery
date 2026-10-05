export type PromptInsertion = { position: 'before' | 'after'; format: 'comma' | 'alternatives'; weight: number; prefix: string; suffix: string };
export const defaultInsertion: PromptInsertion = { position: 'after', format: 'comma', weight: 1, prefix: '', suffix: '' };
export function formatInsertion(groups: string[][], options: PromptInsertion): string {
    const clean = groups.map(group => group.map(term => term.trim()).filter(Boolean)).filter(group => group.length);
    let text = options.format === 'alternatives' ? [...new Set(clean.map(group => group.join(', ')))].join('|') : [...new Set(clean.flat())].join(', ');
    if (!text) return '';
    if (options.format === 'alternatives' && new Set(clean.map(group => group.join(', '))).size > 1) text = '{' + text + '}';
    text = options.prefix + text + options.suffix;
    if (Number.isFinite(options.weight) && options.weight !== 1) text = '(' + text + ':' + options.weight + ')';
    return text;
}
export function combineEncoderPrompt(own: string, source: string | undefined, mode = 'after'): string {
    if (source === undefined) return own;
    if (mode === 'replace') return source;
    return (mode === 'before' ? [source, own] : [own, source]).map(value => value.trim()).filter(Boolean).join(', ');
}
