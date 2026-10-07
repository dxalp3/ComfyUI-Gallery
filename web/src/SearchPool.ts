/** The suggestion pool shared by every search box: prompt phrases of the loaded images, cached Hydrus tags, and the library. */
import { useMemo } from 'react';
import { extractHydrusTags, extractLocalPrompts } from './LocalImageSearch';
import { promptTags } from './PromptTags';
import type { Phrase } from './LibrarySearchPanel';
import type { FileDetails } from './types';

export function indexPrompts(folders: Record<string, Record<string, any>>): Phrase[] {
    const index = new Map<string, Phrase>();
    for (const files of Object.values(folders)) for (const file of Object.values(files)) {
        const prompts = extractLocalPrompts(file.metadata);
        for (const side of ['positive', 'negative'] as const) for (const phrase of promptTags(prompts[side], '')) {
            const key = side + ':' + phrase.toLocaleLowerCase();
            const existing = index.get(key);
            if (existing) existing.count++;
            else index.set(key, { value: phrase, label: phrase, side, count: 1 });
        }
    }
    return [...index.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function libraryPhrases(data: any): Phrase[] {
    if (![1, 2].includes(data?.version) || !Array.isArray(data.tags) || !Array.isArray(data.prefixes)) throw new Error('Unsupported Prompt Library format');
    const tags = data.tags.filter((tag: any) => typeof tag.text === 'string' && typeof tag.id === 'string');
    return [...tags.map((tag: any) => ({ value: tag.text, label: tag.name || tag.text, side: 'Library tag', count: 0 })),
        ...data.prefixes.map((prefix: any) => ({ value: (prefix.tags || []).map((id: string) => tags.find((tag: any) => tag.id === id)?.text).filter(Boolean).join(', '), label: prefix.name, side: 'Library prefix', count: 0 }))].filter(item => item.value || item.side === 'Library prefix');
}


export function hydrusTagPhrases(files: FileDetails[], cached: Record<string, string[]>): Phrase[] {
    const counts = new Map<string, number>();
    files.forEach(file => new Set([...(cached[file.url] || []), ...extractHydrusTags(file.metadata)]).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
    return [...counts].map(([value, count]) => ({ value, label: value, side: 'hydrus', count })).sort((a, b) => b.count - a.count);
}

/** Phrases for suggestions: indexed prompt phrases first, then Hydrus tags, then library entries. */
export function useSearchPool(folders: Record<string, Record<string, FileDetails>> | undefined, cached: Record<string, string[]>, library?: unknown): Phrase[] {
    const indexed = useMemo(() => indexPrompts(folders || {}), [folders]);
    const hydrus = useMemo(() => hydrusTagPhrases(Object.values(folders || {}).flatMap(folder => Object.values(folder)), cached), [folders, cached]);
    const saved = useMemo(() => { try { return library ? libraryPhrases(library) : []; } catch { return []; } }, [library]);
    return useMemo(() => [...indexed, ...hydrus, ...saved], [indexed, hydrus, saved]);
}
