import { appendLocalImages } from './ImageSourceBridge';
import { Button, Checkbox, Dropdown, Image, Tag, Typography, message } from 'antd';
import { useHydrus } from './HydrusContext';
import { hydrusStatus } from './HydrusApi';
import type { HydrusItem } from './HydrusApi';
import type { FileDetails } from './types';
import InfoCircleOutlined from '@ant-design/icons/lib/icons/InfoCircleOutlined';
import SoundOutlined from '@ant-design/icons/lib/icons/SoundOutlined';
import React, { memo, useRef, useState } from 'react';
import { useDrag, useMemoizedFn } from 'ahooks';
import { useGalleryCardContext } from './GalleryContext';
import type { SettingsState } from './GalleryContext';
import { BASE_PATH } from './ComfyAppApi';
import { use3DThumbnail } from './GlobalModelRenderer';

const ImageCard3DThumbnail = ({ image, onClick }: { image: FileDetails, onClick: () => void }) => {
    const typeMatch = image.url.match(/\.([^.]+)$/);
    const type = typeMatch ? typeMatch[1].toLowerCase() : '';
    const thumbnail = use3DThumbnail(`${BASE_PATH}${image.url}`, type);

    if (thumbnail) {
        return (
            <>
                <img
                    style={{
                        objectFit: "cover",
                        maxWidth: ImageCardWidth,
                        width: '100%',
                        height: '100%',
                        userSelect: 'none',
                        cursor: 'pointer',
                    }}
                    src={thumbnail}
                    onClick={onClick}
                    alt={image.name}
                    draggable={false}
                />
                <Image
                    id={image.url}
                    style={{ display: 'none' }}
                    src={`${BASE_PATH}${image.url}`}
                    onClick={onClick}
                />
            </>
        );
    }

    return (
        <div
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: '#23272f', cursor: 'pointer' }}
            onClick={onClick}
        >
            <div style={{ fontSize: '64px', color: '#1890ff', marginBottom: '24px', fontWeight: 'bold' }}>3D</div>
            <Typography.Text style={{ padding: '0 16px', textAlign: 'center', maxWidth: '100%' }} ellipsis>
                {image.name}
            </Typography.Text>
            <Image
                id={image.url}
                style={{ display: 'none' }}
                src={`${BASE_PATH}${image.url}`}
                onClick={onClick}
            />
        </div>
    );
};

export const ImageCardWidth = 350;
export const ImageCardHeight = 450;

interface ImageCardProps {
    image: FileDetails;
    dragFolder: string;
    onInfoClick: (imageName: string) => void;
    onVideoClick: (imageName: string | undefined) => void;
}

// The connector can receive shared context updates cheaply. The memoized media
// subtree only renders when this image, its selection, or its badge changes.
function ImageCard(props: ImageCardProps) {
    const { settings, selectedImages, selectedImageSet, selectImage, setPreviewingVideo } = useGalleryCardContext();
    const { items, requestExport, refresh, setDetailsUrl, imageFiles } = useHydrus();
    const getTargets = useMemoizedFn(() => (selectedImageSet.has(props.image.url) ? selectedImages : [props.image.url]).filter(url => imageFiles[url]));
    return <ImageCardView {...props} settings={settings} selected={selectedImageSet.has(props.image.url)}
        item={items[props.image.url]} selectImage={selectImage} setPreviewingVideo={setPreviewingVideo}
        getTargets={getTargets} requestExport={requestExport} refresh={refresh} setDetailsUrl={setDetailsUrl} />;
}

const ImageCardView = memo(function ImageCardView({
    image,
    dragFolder,
    onInfoClick,
    onVideoClick,
    settings, selected, item, selectImage, setPreviewingVideo,
    getTargets, requestExport, refresh, setDetailsUrl,
}: ImageCardProps & {
    settings: Pick<SettingsState, 'imageThumbFit' | 'videoThumbFit' | 'autoPlayVideos' | 'relativePath'>;
    selected: boolean;
    item?: HydrusItem;
    selectImage: (url: string, range?: boolean) => void;
    setPreviewingVideo: (name: string | undefined) => void;
    getTargets: () => string[];
    requestExport: (urls: string[]) => void;
    refresh: (urls: string[]) => Promise<HydrusItem[]>;
    setDetailsUrl: (url: string) => void;
}) {
    const badge = hydrusStatus(item);
    const dragRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const [targetCount, setTargetCount] = useState(1);
    const [failedThumbnail, setFailedThumbnail] = useState<string>();
    const originalUrl = `${BASE_PATH}${image.url}`;
    const thumbnailUrl = `${BASE_PATH}/Gallery/thumbnail?url=${encodeURIComponent(image.url)}&v=${image.timestamp || 0}&root=${encodeURIComponent(settings.relativePath)}`;

    useDrag(
        {
            name: image.name,
            folder: dragFolder,
            type: image.type,
            url: image.url,
        },
        dragRef,
        {
            onDragStart: () => setDragging(true),
            onDragEnd: () => setDragging(false),
        }
    );

    // Use ctrlKey from click event, not global state
    const handleCardClick = (event: React.MouseEvent) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
            // The click dont stop
            event.stopPropagation();
            event.preventDefault();

            selectImage(image.url, event.shiftKey);
        }
    };

    // Native drag for exporting image as file/image
    const handleNativeDragStart = (event: React.DragEvent<HTMLImageElement | HTMLVideoElement | HTMLAudioElement>) => {
        // Guess MIME based on filename extension (frontend-only, no backend changes)
        const guessMimeFromName = (name?: string) => {
            const ext = (name || '').split('.').pop()?.toLowerCase() || '';
            const map: Record<string, string> = {
                // images
                jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
                // video
                mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
                // audio
                mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac', ogg: 'audio/ogg',
            };
            return map[ext] || '';
        };

        const guessed = guessMimeFromName(image.name || image.url);
        // Fallback to previous simple heuristic if we couldn't guess from extension
        const mimeType = guessed || (image.type === 'image' ? 'image/png' : image.type === 'audio' ? 'audio/wav' : 'video/mp4');

        event.dataTransfer.setData('text/uri-list', `${BASE_PATH}${image.url}`);
        event.dataTransfer.setData('DownloadURL', `${mimeType}:${image.name}:${window.location.origin + BASE_PATH + image.url}`);
        // Optionally, set a drag image
        // event.dataTransfer.setDragImage(event.currentTarget, 10, 10);
    };

    return (<Dropdown trigger={['contextMenu']} disabled={image.type !== 'image'}
        onOpenChange={open => { if (open) setTargetCount(getTargets().length); }}
        menu={{ items: [
            { key: 'source', label: `Append to Image Source (${targetCount})` },
            { key: 'export', label: `Export to Hydrus (${targetCount})` },
            { key: 'refresh', label: `Refresh Hydrus status (${targetCount})` },
            { key: 'metadata', label: 'Hydrus metadata' },
            { key: 'select', label: selected ? 'Deselect image' : 'Select image' },
        ], onClick: async ({ key, domEvent }) => {
            domEvent.stopPropagation();
            const targets = getTargets();
            if (key === 'source') {
                const done = message.loading('Copying images to input…', 0);
                try { message.success(await appendLocalImages(targets)); } catch (error) { message.error(error instanceof Error ? error.message : String(error)); } finally { done(); }
            }
            if (key === 'export') requestExport(targets);
            if (key === 'metadata') setDetailsUrl(image.url);
            if (key === 'select') selectImage(image.url);
            if (key === 'refresh') {
                try { const results = await refresh(targets); const failed = results.filter(item => item.error); if (failed.length) message.warning(failed[0].error); else message.success(`Refreshed ${results.length} image(s).`); }
                catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
            }
        } }}>
        <div
            className='image-card'
            ref={dragRef}
            style={{
                width: ImageCardWidth,
                height: ImageCardHeight,
                borderRadius: 8,
                overflow: "hidden",
                margin: "15px",
                border: dragging ? '2px solid #1890ff' : 'none',
                opacity: dragging ? 0.5 : 1,
                display: "flex",
                alignContent: "center",
                justifyContent: "center",
                alignItems: "center",
                position: "relative",
                cursor: 'grab',
                boxShadow: selected ? '0 0 0 3px #1890ff' : undefined,
            }}
            onClickCapture={event => { if (!(event.target as HTMLElement).closest('[data-gallery-select]')) handleCardClick(event); }}
        >
            <div data-gallery-select style={{ position: 'absolute', top: 10, left: 10, right: 10, zIndex: 4, display: 'flex', justifyContent: 'space-between' }} onClick={event => event.stopPropagation()}>
                <Checkbox aria-label={`Select ${image.name}`} checked={selected}
                    onClick={event => { event.stopPropagation(); selectImage(image.url, event.shiftKey); }} />
                {image.type === 'image' && <Tag color={badge.color} style={{ cursor: 'pointer', margin: 0 }} onClick={() => setDetailsUrl(image.url)}>{badge.label}</Tag>}
            </div>
            {image.type == "image" ? (<>
                <Image
                    id={image.url}
                    style={{
                        objectFit: "cover",
                        ...(settings.imageThumbFit === 'height'
                            ? { maxHeight: ImageCardHeight, width: 'auto', maxWidth: '100%' }
                            : { maxWidth: ImageCardWidth, width: '100%', height: 'auto' }),
                        userSelect: 'none',
                        cursor: 'grab',
                    }}
                    src={failedThumbnail === thumbnailUrl ? originalUrl : thumbnailUrl}
                    preview={{ src: originalUrl }}
                    loading="lazy"
                    decoding="async"
                    onError={() => { if (failedThumbnail !== thumbnailUrl) setFailedThumbnail(thumbnailUrl); }}
                    onClick={() => {
                        // Ensure any leftover media preview state is cleared so this opens as an image
                        try { setPreviewingVideo(undefined); } catch { }
                    }}
                    alt={image.name}
                    draggable
                    onDragStart={handleNativeDragStart}
                />
            </>) : image.type === "audio" ? (<>
                <div
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', cursor: 'pointer' }}
                    onClick={() => {
                        try { setPreviewingVideo(undefined); } catch { }
                        document.getElementById(image.url)?.click();
                    }}
                >
                    <SoundOutlined style={{ fontSize: '64px', color: '#1890ff', marginBottom: '24px' }} />
                    <Typography.Text style={{ marginBottom: '16px', padding: '0 16px', textAlign: 'center', maxWidth: '100%' }} ellipsis>
                        {image.name}
                    </Typography.Text>
                    <audio controls style={{ width: '90%', height: '40px' }} src={`${BASE_PATH}${image.url}`} onClick={(e) => e.stopPropagation()} />
                    <Image
                        id={image.url}
                        style={{ display: 'none' }}
                        src={`${BASE_PATH}${image.url}`}
                        loading="lazy"
                        alt={image.name}
                    />
                </div>
            </>) : image.type === "3d" ? (
                <ImageCard3DThumbnail image={image as any} onClick={() => {
                    try { setPreviewingVideo(undefined); } catch { }
                    document.getElementById(image.url)?.click();
                }} />
            ) : <>
                <video
                    style={{
                        ...(settings.videoThumbFit === 'height'
                            ? { maxHeight: ImageCardHeight }
                            : { maxWidth: ImageCardWidth }),
                        cursor: "pointer"
                    }}
                    src={`${BASE_PATH}${image.url}`}
                    autoPlay={settings.autoPlayVideos}
                    loop={settings.autoPlayVideos}
                    muted={true}
                    preload={!settings.autoPlayVideos ? undefined : "none"}
                    onClick={() => {
                        onVideoClick(image.name);
                        document.getElementById(image.url)?.click();
                    }}
                    draggable
                    onDragStart={handleNativeDragStart}
                />
                <Image
                    id={image.url}
                    style={{
                        display: "none"
                    }}
                    src={`${BASE_PATH}${image.url}`}
                    loading="lazy"
                    // preview={false}
                    alt={image.name}
                />
            </>}
            <div
                style={{
                    position: "absolute",
                    backgroundColor: "#00000042",
                    width: "-webkit-fill-available",
                    padding: "10px",
                    bottom: "0px",
                    display: "flex",
                    alignContent: "center",
                    justifyContent: "space-between",
                    alignItems: "center",
                }}
            >
                <Typography.Text
                    strong
                    style={{
                        margin: 0,
                        color: "white"
                    }}
                    ellipsis={{

                    }}
                >
                    {image.name}
                </Typography.Text>
                <Button
                    color="cyan"
                    variant="filled"
                    icon={<InfoCircleOutlined />}
                    size={"middle"}
                    onClick={() => {
                        onInfoClick(image.name);
                        document.getElementById(image.url)?.click();
                    }}
                />
            </div>
        </div>
    </Dropdown>)
});

export default memo(ImageCard);
