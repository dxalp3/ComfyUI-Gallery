import { hydrusRequest } from './HydrusApi';
import { preferPromptSpaces } from './PromptSpelling';
import type { Suggestion } from './PromptBoxEditor';
import type { SharedLibrary } from './PrefixLibrary';

/** The library is passed in (not imported) because PrefixLibrary itself loads the encoder node. */
export type SuggestDeps = { loadLibrary: () => Promise<SharedLibrary>; expandPrefix: (library: SharedLibrary, name: string) => string[] };

/**
 * Suggestions for the chip inputs (prompt encoder, prefix editor): saved prefixes (`@name`), saved library tags,
 * then the Danbooru dictionary. The library is re-read at most every five seconds.
 */
export function makeSuggest(deps: SuggestDeps) {
    let cached: { at: number; library?: SharedLibrary } = { at: 0 };
    const library = async () => {
        if (Date.now() - cached.at > 5000) {
            cached = { at: Date.now(), library: cached.library };
            try { cached.library = await deps.loadLibrary(); } catch { /* suggestions fall back to Danbooru tags */ }
        }
        return cached.library;
    };
    return async (query: string): Promise<Suggestion[]> => {
        const needle = query.replace(/^@/, '').trim().toLowerCase();
        const found: Suggestion[] = [], seen = new Set<string>();
        const add = (item: Suggestion) => { const key = item.kind + ':' + item.label.toLowerCase(); if (!seen.has(key) && found.length < 10) { seen.add(key); found.push(item); } };
        const shared = await library();
        for (const prefix of shared?.prefixes || []) { if (found.length >= 10) break; if (prefix.name.toLowerCase().includes(needle)) add({ label: prefix.name, kind: 'prefix', terms: deps.expandPrefix(shared!, '@' + prefix.name) }); }
        if (!query.startsWith('@')) {
            // Library entries that are whole {a|b} groups or long tag lists (saved from grouped appends) are not single tags.
            for (const tag of shared?.tags || []) { if (found.length >= 10) break; if (/[{}|]/.test(tag.text) || tag.text.includes(',')) continue; if (tag.text.toLowerCase().includes(needle)) add({ label: tag.text, kind: 'tag' }); }
            if (needle.length >= 2 && found.length < 10) {
                try {
                    const data = await hydrusRequest<{ items: { name: string }[] }>('dictionary', { browse: true, query: needle, categories: [], sort: 'popular', offset: 0, limit: 8 });
                    for (const item of data.items) add({ label: preferPromptSpaces() ? item.name.replace(/_/g, ' ') : item.name, kind: 'tag' });
                } catch { /* the Danbooru dictionary is optional */ }
            }
        }
        return found;
    };
}
