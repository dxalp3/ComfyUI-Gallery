import { formatInsertion, type PromptInsertion } from './PromptInsertion';
import { hydrusRequest } from './HydrusApi';
import { useEffect, useState } from 'react';
export const preferPromptSpaces = () => localStorage.getItem('gallery-prompt-spaces') !== 'false';
export function setPromptSpaces(value: boolean) {
    localStorage.setItem('gallery-prompt-spaces', String(value));
    window.dispatchEvent(new Event('gallery-prompt-spelling'));
}
export function usePromptSpelling() {
    const [spaces, setSpaces] = useState(preferPromptSpaces);
    useEffect(() => {
        const refresh = () => setSpaces(preferPromptSpaces());
        window.addEventListener('gallery-prompt-spelling', refresh); window.addEventListener('storage', refresh);
        return () => { window.removeEventListener('gallery-prompt-spelling', refresh); window.removeEventListener('storage', refresh); };
    }, []);
    return [spaces, setPromptSpaces] as const;
}
export async function formatPromptTerms(terms: string[], spaces = preferPromptSpaces()) {
    const result = await hydrusRequest<{ terms: string[] }>('format_terms', { terms, prefer_spaces: spaces });
    return result.terms;
}

export async function prepareInsertion(groups: string[][], options: PromptInsertion): Promise<string> {
    if (groups.length > 10000 || groups.reduce((sum, group) => sum + group.reduce((size, term) => size + term.length + 2, 0), 0) > 1000000) throw new Error('This insertion is too large. Narrow the selection.');
    const unique = [...new Set(groups.flat().map(term => term.trim()).filter(Boolean))];
    const replacements = new Map<string, string>();
    for (let offset = 0; offset < unique.length; offset += 500) {
        const batch = unique.slice(offset, offset + 500);
        const formatted = await formatPromptTerms(batch);
        batch.forEach((term, index) => replacements.set(term, formatted[index]));
    }
    return formatInsertion(groups.map(group => group.map(term => replacements.get(term.trim()) || term)), options);
}
