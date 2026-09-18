import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { ComfyAppApi } from './ComfyAppApi';

const MAX_BATCH_BYTES = 128 * 1024 * 1024;

export async function downloadHydrusImages(hashes: string[], cancelled: () => boolean, progress: (text: string) => void) {
    const unique = Array.from(new Set(hashes));
    const zip = new JSZip();
    const failures: string[] = [];
    let completed = 0;
    let totalBytes = 0;
    for (let i = 0; i < unique.length; i++) {
        if (cancelled()) break;
        const hash = unique[i];
        progress(`Downloading ${i + 1} of ${unique.length}`);
        try {
            const response = await ComfyAppApi.fetchHydrus(`download?hash=${encodeURIComponent(hash)}`);
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || `Download failed (HTTP ${response.status}).`);
            }
            const filename = response.headers.get('Content-Disposition')?.match(/filename="?([a-f0-9]{64}\.[a-z0-9]+)"?/i)?.[1] || `${hash}.image`;
            // Bound ZIP memory before collecting large responses. Individual originals
            // use the bridge's 256 MiB limit, bulk archives use 128 MiB total.
            const remaining = unique.length === 1 ? 256 * 1024 * 1024 : MAX_BATCH_BYTES - totalBytes;
            const reader = response.body?.getReader();
            if (!reader) throw new Error('Streaming downloads are unavailable in this browser.');
            let size = 0;
            const chunks: Uint8Array[] = [];
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    size += value.length;
                    if (size > remaining) throw new Error('The selection exceeds the download memory limit; download this image separately.');
                    chunks.push(value);
                }
            } catch (error) { await reader.cancel(); throw error; }
            finally { reader.releaseLock(); }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            totalBytes += size;
            if (unique.length === 1) FileSaver.saveAs(new Blob([bytes]), filename);
            else zip.file(filename, bytes);
            completed++;
        } catch (reason) { failures.push(`${hash.slice(0, 10)}: ${reason instanceof Error ? reason.message : String(reason)}`); }
    }
    if (unique.length > 1 && completed > 0) {
        progress('Preparing ZIP download…');
        FileSaver.saveAs(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), 'hydrus-images.zip');
    }
    return { completed, failures, cancelled: cancelled() };
}
