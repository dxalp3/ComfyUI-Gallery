import { useEffect, useState } from 'react';
import { Button, Select, Space, Typography, message } from 'antd';
import { ImageSourceEditor, emptyImageSourceManifest } from './ImageSourceEditor';
import { useGalleryContext } from './GalleryContext';
import { SOURCE_BROWSE_EVENT, SOURCE_EDITOR_EVENT, editSourceTarget, getSourceTargets, readSourceManifest, saveSourceManifest, setSourceTarget } from './ImageSourceBridge';
import type { ImageSourceManifest } from './ImageSourceGeometry';
import { STANDALONE } from './ComfyAppApi';

export function ImageSourceHost() {
    const { setOpen } = useGalleryContext();
    const [node, setNode] = useState<any>();
    const [manifest, setManifest] = useState<ImageSourceManifest>(emptyImageSourceManifest);
    useEffect(() => {
        const edit = (event: Event) => {
            const target = (event as CustomEvent).detail;
            try { setManifest(readSourceManifest(target)); setNode(target); }
            catch (error) { message.error(String(error)); }
        };
        const browse = () => setOpen(true);
        window.addEventListener(SOURCE_EDITOR_EVENT, edit);
        window.addEventListener(SOURCE_BROWSE_EVENT, browse);
        return () => { window.removeEventListener(SOURCE_EDITOR_EVENT, edit); window.removeEventListener(SOURCE_BROWSE_EVENT, browse); };
    }, [setOpen]);
    return <ImageSourceEditor open={!!node} manifest={manifest} onClose={() => setNode(undefined)}
        onApply={value => { try { saveSourceManifest(node, value); setManifest(value); return true; } catch (error) { message.error(String(error)); return false; } }}
        onBrowse={() => { setNode(undefined); setOpen(true); }} />;
}

export function ImageSourceTarget() {
    const [info, setInfo] = useState<Awaited<ReturnType<typeof getSourceTargets>>>({ options: [] });
    const [error, setError] = useState('');
    useEffect(() => {
        let live = true, busy = false;
        const refresh = async () => {
            if (busy) return;
            busy = true;
            try { const result = await getSourceTargets(); if (live) { setInfo(previous => JSON.stringify(previous) === JSON.stringify(result) ? previous : result); setError(''); } }
            catch (reason) { if (live) setError(reason instanceof Error ? reason.message : String(reason)); }
            finally { busy = false; }
        };
        void refresh(); const timer = window.setInterval(refresh, 2000);
        return () => { live = false; window.clearInterval(timer); };
    }, []);
    return <Space wrap style={{ marginBottom: 12 }}>
        <Typography.Text>Img2img target{STANDALONE ? ' in opening tab' : ''}:</Typography.Text>
        <Select aria-label="Image Source target" style={{ minWidth: 260 }} value={info.selected} options={[...info.options, { value: 'new', label: 'Create new Gallery Image Source' }]}
            placeholder={info.options.length ? 'Choose a Gallery Image Source node' : 'Create a node on first append'}
            onChange={id => { void setSourceTarget(id).then(setInfo).catch(reason => message.error(String(reason))); }} />
        <Button onClick={() => { void editSourceTarget().catch(reason => message.error(String(reason))); }}>Edit images / crop / stitch</Button>
        {error && <Typography.Text type="secondary">{error}</Typography.Text>}
    </Space>;
}
