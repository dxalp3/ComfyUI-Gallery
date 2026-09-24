import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Alert, Button, Empty, InputNumber, Modal, Select, Space, Spin, Tag, Typography } from 'antd';
import { BASE_Z_INDEX } from './ComfyAppApi';
import { clampCrop, cropFromPoints, emptyImageSourceManifest, sourceImageUrl } from './ImageSourceGeometry';
import type { ImageSourceCrop, ImageSourceManifest } from './ImageSourceGeometry';

export { emptyImageSourceManifest };
export type { ImageSourceCrop, ImageSourceImage, ImageSourceManifest } from './ImageSourceGeometry';

type Dimensions = { width: number; height: number };
type Props = {
    open: boolean;
    manifest: ImageSourceManifest;
    onApply: (manifest: ImageSourceManifest) => boolean | void;
    onClose: () => void;
    onBrowse: () => void;
};

const cloneManifest = (value: ImageSourceManifest): ImageSourceManifest => ({ ...value, images: value.images.map(image => ({ ...image, ...(image.crop ? { crop: { ...image.crop } } : {}) })) });
const describe = (name: string) => name.replace(/\\/g, '/').split('/').pop() || name;

export function ImageSourceEditor({ open, manifest, onApply, onClose, onBrowse }: Props) {
    const [draft, setDraft] = useState(() => cloneManifest(manifest));
    const [selected, setSelected] = useState(0);
    const [dimensions, setDimensions] = useState<Record<string, Dimensions>>({});
    const [imageError, setImageError] = useState('');
    const [units, setUnits] = useState<'pixels' | 'percent'>('pixels');
    const [dragCrop, setDragCrop] = useState<ImageSourceCrop>();
    const [previewUrl, setPreviewUrl] = useState('');
    const [previewBusy, setPreviewBusy] = useState(false);
    const [previewError, setPreviewError] = useState('');
    const [previewSize, setPreviewSize] = useState<Dimensions>();
    const drag = useRef<{ start: { x: number; y: number }; index: number; pointerId: number; current: ImageSourceCrop } | null>(null);
    const incoming = JSON.stringify(manifest);
    const serialized = JSON.stringify(draft);
    const dirty = incoming !== serialized;
    const active = draft.images[selected];
    const size = active ? dimensions[active.input_name] : undefined;
    const currentCrop = clampCrop(dragCrop || active?.crop, size);
    const canApply = draft.images.length <= 32;

    useEffect(() => {
        if (open) { setDraft(cloneManifest(manifest)); setSelected(index => Math.min(index, Math.max(0, manifest.images.length - 1))); }
        drag.current = null; setDragCrop(undefined);
    }, [open, incoming]);

    useEffect(() => { setImageError(''); setDragCrop(undefined); drag.current = null; }, [active?.input_name, selected]);
    useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

    useEffect(() => {
        if (!open || !draft.images.length) { setPreviewUrl(''); setPreviewBusy(false); setPreviewError(''); return; }
        const controller = new AbortController();
        let live = true;
        setPreviewBusy(true); setPreviewError('');
        const timer = window.setTimeout(async () => {
            try {
                const path = '/Gallery/source/preview';
                const options: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifest: draft }), signal: controller.signal };
                const api = (window as any).comfyAPI?.app?.app?.api;
                const response: Response = api?.fetchApi ? await api.fetchApi(path, options) : await fetch(path, options);
                if (!response.ok) {
                    let message = 'The composition preview could not be generated.';
                    try { const body = await response.json(); if (typeof body?.error === 'string') message = body.error; } catch { /* Keep a useful error for a non-JSON response. */ }
                    throw new Error(message);
                }
                const blob = await response.blob();
                if (live && !controller.signal.aborted) { setPreviewSize(undefined); setPreviewUrl(URL.createObjectURL(blob)); }
            } catch (reason) {
                if (live && !controller.signal.aborted) setPreviewError(reason instanceof Error ? reason.message : String(reason));
            } finally { if (live) setPreviewBusy(false); }
        }, 350);
        return () => { live = false; window.clearTimeout(timer); controller.abort(); };
    }, [open, serialized]);

    const setCrop = (crop?: ImageSourceCrop) => {
        setDraft(previous => ({ ...previous, images: previous.images.map((image, index) => index === selected ? { ...image, crop: crop ? clampCrop(crop, size) : undefined } : image) }));
    };
    const move = (index: number, delta: number) => {
        const destination = index + delta;
        if (destination < 0 || destination >= draft.images.length) return;
        setDraft(previous => {
            const images = previous.images.slice();
            [images[index], images[destination]] = [images[destination], images[index]];
            return { ...previous, images };
        });
        setSelected(previous => previous === index ? destination : previous === destination ? index : previous);
    };
    const remove = (index: number) => {
        setDraft(previous => ({ ...previous, images: previous.images.filter((_, at) => at !== index) }));
        setSelected(previous => Math.max(0, previous > index ? previous - 1 : Math.min(previous, draft.images.length - 2)));
    };
    const point = (event: PointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    };
    const beginCrop = (event: PointerEvent<HTMLDivElement>) => {
        if (!size || event.button !== 0 || !active) return;
        event.preventDefault();
        const start = point(event);
        const crop = cropFromPoints(start, start, size);
        drag.current = { start, index: selected, pointerId: event.pointerId, current: crop };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragCrop(crop);
    };
    const continueCrop = (event: PointerEvent<HTMLDivElement>) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        const crop = cropFromPoints(drag.current.start, point(event), size);
        drag.current.current = crop;
        setDragCrop(crop);
    };
    const finishCrop = (event: PointerEvent<HTMLDivElement>) => {
        const gesture = drag.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const crop = cropFromPoints(gesture.start, point(event), size);
        // A click by itself keeps the existing crop. Tiny intentional crops remain available numerically.
        if (size && (crop.width * size.width >= 2 || crop.height * size.height >= 2)) {
            setDraft(previous => ({ ...previous, images: previous.images.map((image, index) => index === gesture.index ? { ...image, crop } : image) }));
        }
        drag.current = null; setDragCrop(undefined);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const presetCrop = (ratio: number) => {
        if (!size) return;
        const pixelWidth = Math.min(size.width, size.height * ratio);
        const pixelHeight = pixelWidth / ratio;
        setCrop({ x: (1 - pixelWidth / size.width) / 2, y: (1 - pixelHeight / size.height) / 2, width: pixelWidth / size.width, height: pixelHeight / size.height });
    };
    const scale = (key: keyof ImageSourceCrop) => units === 'percent' ? 100 : (key === 'x' || key === 'width' ? size?.width : size?.height) || 1;
    const changeCoordinate = (key: keyof ImageSourceCrop, value: number | null) => {
        if (value === null) return;
        setCrop({ ...currentCrop, [key]: value / scale(key) });
    };
    const save = () => { if (canApply) { if (onApply(cloneManifest(draft)) !== false) onClose(); } };
    const browse = () => { if (onApply(cloneManifest(draft)) !== false) onBrowse(); };

    return <Modal open={open} onCancel={onClose} title="Gallery Image Source" width={1180} zIndex={BASE_Z_INDEX + 60}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        footer={<Space wrap><span style={{ marginRight: 12 }}>{dirty ? 'Unsaved changes' : 'Changes saved to this node'}</span><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={save} disabled={!canApply}>Save to node</Button></Space>}>
        <style>{`
            .gallery-source-editor .gallery-source-layout { display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: 18px; margin-top: 16px; }
            .gallery-source-editor .gallery-source-main { min-width: 0; }
            .gallery-source-editor .gallery-source-list { max-height: 620px; overflow-y: auto; padding-right: 5px; }
            .gallery-source-editor .gallery-source-item { border: 1px solid #7775; border-radius: 7px; padding: 7px; margin-bottom: 8px; }
            .gallery-source-editor .gallery-source-item.active { border-color: #1677ff; background: #1677ff12; }
            .gallery-source-editor .gallery-source-pick { display: flex; gap: 8px; align-items: center; width: 100%; text-align: left; background: transparent; border: none; color: inherit; cursor: pointer; padding: 0 0 6px; }
            .gallery-source-editor .gallery-source-pick:focus-visible { outline: 2px solid #1677ff; outline-offset: 3px; }
            .gallery-source-editor .gallery-source-pick img { width: 55px; height: 55px; object-fit: contain; background: #8882; }
            .gallery-source-editor .gallery-source-stage { background: #8882; border: 1px solid #7774; padding: 8px; border-radius: 8px; text-align: center; min-height: 160px; margin: 10px 0; }
            .gallery-source-editor .gallery-source-crop { position: relative; display: inline-block; max-width: 100%; overflow: hidden; line-height: 0; touch-action: none; cursor: crosshair; }
            .gallery-source-editor .gallery-source-crop img { display: block; max-width: 100%; max-height: 430px; user-select: none; }
            .gallery-source-editor .gallery-source-rectangle { position: absolute; border: 2px solid #fff; outline: 1px solid #1677ff; box-shadow: 0 0 0 2000px #0008; pointer-events: none; box-sizing: border-box; }
            .gallery-source-editor .gallery-source-numeric { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; }
            .gallery-source-editor .gallery-source-numeric label { display: flex; flex-direction: column; gap: 4px; }
            @media (max-width: 760px) { .gallery-source-editor .gallery-source-layout { grid-template-columns: 1fr; } .gallery-source-editor .gallery-source-list { max-height: 225px; } }
        `}</style>
        <div className="gallery-source-editor">
            <Typography.Paragraph style={{ marginBottom: 8 }}>Add images from the gallery, crop each source, then choose how to combine them. Connect this node’s <strong>IMAGE</strong> output to <strong>VAE Encode</strong> for img2img.</Typography.Paragraph>
            <Space wrap><Button onClick={browse} disabled={draft.images.length >= 32}>Browse / append images</Button><Tag>{draft.images.length} / 32 images</Tag>{dirty && <Tag color="gold">Unsaved changes</Tag>}</Space>
            {!draft.images.length ? <Empty style={{ margin: '36px 0' }} description="Append local or Hydrus images from the gallery to start." /> : <div className="gallery-source-layout">
                <div>
                    <Typography.Title level={5} style={{ marginTop: 0 }}>Sources in output order</Typography.Title>
                    <div className="gallery-source-list" aria-label="Image source list">
                        {draft.images.map((image, index) => <div className={`gallery-source-item${selected === index ? ' active' : ''}`} key={`${index}:${image.input_name}`}>
                            <button className="gallery-source-pick" type="button" aria-pressed={selected === index} aria-label={`Edit image ${index + 1}: ${image.title || describe(image.input_name)}`} onClick={() => setSelected(index)}>
                                <img src={`/Gallery/source/thumbnail?url=${encodeURIComponent(`/static_gallery/${image.input_name}`)}`} loading="lazy" alt="" />
                                <span style={{ overflowWrap: 'anywhere', lineHeight: 1.4 }}><strong>{index + 1}.</strong> {image.title || describe(image.input_name)}{image.crop && <small style={{ display: 'block' }}>Cropped</small>}</span>
                            </button>
                            <Space size={4}><Button size="small" onClick={() => move(index, -1)} disabled={!index} aria-label={`Move image ${index + 1} earlier`}>↑</Button><Button size="small" onClick={() => move(index, 1)} disabled={index === draft.images.length - 1} aria-label={`Move image ${index + 1} later`}>↓</Button><Button size="small" danger onClick={() => remove(index)} aria-label={`Remove image ${index + 1}`}>Remove</Button></Space>
                        </div>)}
                    </div>
                </div>
                <div className="gallery-source-main">
                    {active && <>
                        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}><Typography.Title level={5} style={{ margin: 0 }}>Crop image {selected + 1}</Typography.Title>{size && <Typography.Text type="secondary">Original: {size.width} × {size.height}</Typography.Text>}</Space>
                        <Typography.Text type="secondary">Drag a rectangle on the image or enter an exact crop below. Cropping removes pixels from the output.</Typography.Text>
                        <div className="gallery-source-stage">
                            <div className="gallery-source-crop" onPointerDown={beginCrop} onPointerMove={continueCrop} onPointerUp={finishCrop} onPointerCancel={() => { drag.current = null; setDragCrop(undefined); }}>
                                <img src={sourceImageUrl(active.input_name)} alt={`Crop source ${selected + 1}`} draggable={false} onLoad={event => {
                                    const image = event.currentTarget;
                                    setDimensions(previous => ({ ...previous, [active.input_name]: { width: image.naturalWidth, height: image.naturalHeight } })); setImageError('');
                                }} onError={() => setImageError('This input image could not be loaded. Re-add it from the gallery if it was moved or deleted.')} />
                                {size && <div className="gallery-source-rectangle" style={{ left: `${currentCrop.x * 100}%`, top: `${currentCrop.y * 100}%`, width: `${currentCrop.width * 100}%`, height: `${currentCrop.height * 100}%` }} />}
                            </div>
                        </div>
                        {imageError && <Alert type="error" message={imageError} showIcon />}
                        <Space wrap><Button onClick={() => setCrop()} disabled={!active.crop}>Reset crop</Button><Button onClick={() => presetCrop(1)} disabled={!size}>Square</Button><Button onClick={() => presetCrop(4 / 3)} disabled={!size}>4:3</Button><Button onClick={() => presetCrop(3 / 2)} disabled={!size}>3:2</Button><Button onClick={() => presetCrop(16 / 9)} disabled={!size}>16:9</Button><Select aria-label="Crop coordinate units" value={units} onChange={setUnits} options={[{ value: 'pixels', label: 'Pixels' }, { value: 'percent', label: 'Percent' }]} style={{ width: 110 }} /></Space>
                        <div className="gallery-source-numeric">
                            {(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}><span>{({ x: 'Left', y: 'Top', width: 'Width', height: 'Height' })[key]} {units === 'pixels' ? '(px)' : '(%)'}</span><InputNumber aria-label={`Crop ${key}`} disabled={!size} min={key === 'x' || key === 'y' ? 0 : units === 'percent' ? 0.01 : 1} max={scale(key)} step={units === 'pixels' ? 1 : 0.1} precision={units === 'pixels' ? 0 : 2} value={Number((currentCrop[key] * scale(key)).toFixed(units === 'pixels' ? 0 : 2))} onChange={value => changeCoordinate(key, value)} style={{ width: 116 }} /></label>)}
                        </div>
                    </>}
                    <Typography.Title level={5} style={{ margin: '20px 0 10px' }}>Combine images</Typography.Title>
                    <Space wrap align="end">
                        <label style={{ display: 'grid', gap: 4 }}><span>Layout</span><Select aria-label="Composition layout" value={draft.layout} onChange={layout => setDraft(previous => ({ ...previous, layout }))} style={{ width: 205 }} options={[{ value: 'single', label: 'Single — first image' }, { value: 'horizontal', label: 'Stitch horizontally' }, { value: 'vertical', label: 'Stitch vertically' }, { value: 'grid', label: 'Grid' }]} /></label>
                        {draft.layout === 'grid' && <label style={{ display: 'grid', gap: 4 }}><span>Columns</span><InputNumber aria-label="Grid columns" min={1} max={32} precision={0} value={draft.columns} onChange={value => setDraft(previous => ({ ...previous, columns: value || 1 }))} /></label>}
                        {draft.layout !== 'single' && <><label style={{ display: 'grid', gap: 4 }}><span>Gap (px)</span><InputNumber aria-label="Stitch gap" min={0} max={4096} precision={0} value={draft.gap} onChange={value => setDraft(previous => ({ ...previous, gap: value || 0 }))} /></label><label style={{ display: 'grid', gap: 4 }}><span>Background</span><input aria-label="Stitch background" type="color" value={draft.background} onChange={event => setDraft(previous => ({ ...previous, background: event.target.value }))} style={{ height: 32, width: 60, cursor: 'pointer' }} /></label></>}
                    </Space>
                    {draft.layout === 'single' && draft.images.length > 1 && <Alert style={{ marginTop: 10 }} type="info" message="Single mode outputs only the first image. Choose a stitch layout to include every source." />}
                    <Typography.Title level={5} style={{ margin: '20px 0 8px' }}>Output preview</Typography.Title>
                    {previewError && <Alert showIcon type="error" message={previewError} style={{ marginBottom: 8 }} />}
                    <div className="gallery-source-stage" aria-live="polite" aria-busy={previewBusy}>
                        {previewBusy && <div style={{ margin: '10px 0' }}><Spin size="small" /> Updating preview…</div>}
                        {previewUrl ? <img src={previewUrl} alt="Combined image preview" onLoad={event => setPreviewSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={{ maxWidth: '100%', maxHeight: 340, opacity: previewBusy || previewError ? 0.5 : 1, display: 'block', margin: 'auto' }} /> : !previewBusy && !previewError && <Typography.Text type="secondary">Preview will appear here.</Typography.Text>}
                        {previewError && previewUrl && <Typography.Text type="secondary">Showing the previous preview.</Typography.Text>}
                    </div>
                    <Typography.Text type="secondary">{previewSize ? `Preview: ${previewSize.width} × ${previewSize.height}. ` : ''}The node outputs the full composition at the sources’ original resolution.</Typography.Text>
                </div>
            </div>}
        </div>
    </Modal>;
}
