import { ComfyAppApi } from './ComfyAppApi';

export interface HydrusSettings {
    url: string;
    has_access_key: boolean;
    tag_service_key: string;
    default_tags: string[];
    send_metadata?: boolean;
    positive_prompt_tags?: boolean;
    negative_prompt_tags?: boolean;
    prefix_positive_prompt_tags?: boolean;
    profile?: string;
    timeout_seconds?: number;
    max_batch_size?: number;
}

export interface HydrusItem {
    url: string;
    hash?: string;
    exported?: boolean;
    status?: string;
    last_exported_at?: string;
    last_checked_at?: string;
    metadata_checked_at?: string;
    current_present?: boolean;
    metadata?: Record<string, any>;
    error?: string | null;
    success?: boolean;
    warnings?: string[];
}

export interface HydrusBatch {
    items: HydrusItem[];
    summary?: { total: number; succeeded: number; failed: number; warnings?: number };
}

export interface HydrusService { service_key: string; name: string; type: number }
export interface HydrusTest {
    ok: boolean;
    services: HydrusService[];
    permissions?: { permits_everything?: boolean; basic_permissions?: number[] };
    warnings?: string[];
    error?: string;
    capabilities?: { search?: { ok: boolean; error?: string }; services?: { ok: boolean; error?: string } };
}

export async function hydrusRequest<T>(path: string, body?: unknown): Promise<T> {
    const response = await ComfyAppApi.fetchHydrus(path, body === undefined ? undefined : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    let value: any;
    try { value = await response.json(); } catch {
        throw new Error(`The Gallery Hydrus bridge returned an invalid response (${response.status}). Restart ComfyUI after installing the extension.`);
    }
    if (!response.ok) throw new Error(value.error || value.message || `Hydrus request failed (${response.status}).`);
    return value as T;
}

export function hydrusStatus(item?: HydrusItem): { label: string; color: string } {
    if (item?.error || item?.status === 'error') return { label: item?.exported ? 'Hydrus · check failed' : 'Hydrus · error', color: 'orange' };
    if (item?.status === 'deleted') return { label: 'Hydrus · deleted', color: 'red' };
    if (item?.status === 'missing') return { label: 'Hydrus · missing', color: 'orange' };
    if (item?.current_present || ['imported', 'already_present', 'present'].includes(item?.status || '')) return { label: 'In Hydrus', color: 'green' };
    if (item?.exported) return { label: 'Hydrus · previously found', color: 'blue' };
    return { label: 'Hydrus · unchecked', color: 'default' };
}

export function contextTargets(clickedUrl: string, selected: string[]): string[] {
    return selected.includes(clickedUrl) ? selected : [clickedUrl];
}

export function selectRange(url: string, anchor: string | undefined, shown: string[], selected: string[]): string[] {
    const start = anchor ? shown.indexOf(anchor) : -1;
    const end = shown.indexOf(url);
    if (start < 0 || end < 0) return selected.includes(url) ? selected.filter(value => value !== url) : [...selected, url];
    return Array.from(new Set([...selected, ...shown.slice(Math.min(start, end), Math.max(start, end) + 1)]));
}
