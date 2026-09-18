/** Comma/newline phrases stay intact; prose is never split into individual words. */
export function promptTags(text: string, namespace: 'positive_prompt' | 'negative_prompt' | ''): string[] {
    const phrases = text.split(/[,\r\n]+/).map(value => value.trim()).filter(Boolean);
    return Array.from(new Set(phrases.map(value => namespace ? `${namespace}:${value}` : value)));
}
