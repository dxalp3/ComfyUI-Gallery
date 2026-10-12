import { stripUnresolved } from './PromptResolution';
import { splitTop } from './PromptBoxes';

/** Editable prompt terms retain grouping/brackets; search/export tags deliberately omit unresolved choices. */
export function promptTerms(text: string): string[] {
    return [...new Set(splitTop(text, '\n').flatMap(line => splitTop(line, ',')).map(term => term.trim()).filter(Boolean))];
}

/** Comma/newline phrases stay intact; prose is never split into individual words. {a|b} groups whose pick is unknown are left out. */
export function promptTags(text: string, namespace: 'positive_prompt' | 'negative_prompt' | ''): string[] {
    const phrases = stripUnresolved(text).split(/[,\r\n]+/).map(value => value.trim()).filter(Boolean);
    return Array.from(new Set(phrases.map(value => namespace ? `${namespace}:${value}` : value)));
}
