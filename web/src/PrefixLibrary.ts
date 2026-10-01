import { getComfyApp } from './ComfyAppApi';
export type PrefixLibrary = { version: number; tags: { id: string; name: string; text: string }[]; prefixes: { id: string; name: string; tags: string[] }[] };
async function api() {
    const current = (window as any).comfyAPI?.api?.api || getComfyApp()?.api;
    if (current?.getUserData) return current;
    try { return (await import(/* @vite-ignore */ `${location.origin}/scripts/api.js`)).api; } catch { return current; }
}
export async function loadPrefixes(): Promise<PrefixLibrary> {
    const service = await api();
    let value: any;
    if (service?.getUserData) {
        const response = await service.getUserData('prompt-library.json');
        if (response.ok) value = await response.json();
        else if (response.status !== 404) throw new Error('Cannot read the shared Prompt Library');
    }
    if (!value) value = JSON.parse(localStorage.getItem('comfy.prompt-library.v2') || localStorage.getItem('comfy.tag-prefix-library.v1') || '{"version":2,"tags":[],"prefixes":[]}');
    if (![1, 2].includes(value.version) || !Array.isArray(value.tags) || !Array.isArray(value.prefixes)) throw new Error('Unsupported Prompt Library data');
    return value;
}
export function expandPrefix(library: PrefixLibrary, name: string): string[] {
    const prefix = library.prefixes.find(item => item.name.toLowerCase() === name.replace(/^@/, '').toLowerCase());
    return prefix ? prefix.tags.flatMap(id => (library.tags.find(tag => tag.id === id)?.text || '').split(/[,\n]+/)).map(value => value.trim()).filter(Boolean) : [name];
}
export async function savePrefix(name: string, values: string[]) {
    if (!name.trim() || !values.length) throw new Error('Enter a prefix name and at least one tag');
    const library = await loadPrefixes(); // Preserve unrelated definitions from the manager.
    library.version = 2;
    const ids = values.map(text => {
        let tag = library.tags.find(item => item.text === text);
        if (!tag) { tag = { id: crypto.randomUUID(), name: text, text }; library.tags.push(tag); }
        return tag.id;
    });
    const existing = library.prefixes.find(item => item.name === name.trim());
    if (existing) existing.tags = ids;
    else library.prefixes.push({ id: crypto.randomUUID(), name: name.trim(), tags: ids });
    const body = JSON.stringify(library);
    const service = await api();
    if (service?.storeUserData) {
        const response = await service.storeUserData('prompt-library.json', body, { stringify: false, throwOnError: true });
        if (response?.ok === false) throw new Error('Could not save shared Prompt Library');
    }
    localStorage.setItem('comfy.prompt-library.v2', body);
    window.dispatchEvent(new Event('gallery-prefix-library-changed'));
    return service?.storeUserData ? 'Saved to shared Prompt Library' : 'Saved in this browser’s Prompt Library';
}
