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
