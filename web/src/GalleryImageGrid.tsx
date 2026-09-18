import React, { useMemo, useCallback, useEffect, useRef } from 'react';
import { Empty, Image, Spin } from 'antd';
import { AutoSizer } from 'react-virtualized';
import { FixedSizeGrid } from 'react-window';
import type { GridChildComponentProps, GridItemKeySelector } from 'react-window';
import ImageCard, { ImageCardHeight, ImageCardWidth } from './ImageCard';
import { useGalleryContext } from './GalleryContext';
import { MetadataView } from './MetadataView';
import { ModelViewer } from './ModelViewer';
import type { FileDetails } from './types';
import { BASE_PATH } from "./ComfyAppApi";
import { useMemoizedFn } from 'ahooks';

interface GridCellData {
    columnCount: number;
    images: FileDetails[];
    currentFolder: string;
    onInfoClick: (name: string) => void;
    onVideoClick: (name: string | undefined) => void;
}

// Keep the component type and item keys stable across status/selection updates.
// A changing cell function makes react-window unmount and recreate every card.
const gridItemKey: GridItemKeySelector<GridCellData> = ({ columnIndex, rowIndex, data }) => {
    const index = rowIndex * data.columnCount + columnIndex;
    const item = data.images[index];
    return item?.url || `${item?.type || 'empty'}-${item?.name || ''}-${index}`;
};
const GridInner = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) =>
    <div {...props} ref={ref} style={{ ...props.style, position: 'relative' }} />);

const GridCell = React.memo(function GridCell({ columnIndex, rowIndex, style, data }: GridChildComponentProps<GridCellData>) {
        const { columnCount, images, currentFolder, onInfoClick, onVideoClick } = data;
        const index = rowIndex * columnCount + columnIndex;
        const image = images[index];
        if (!image) return null;
        if (image.type === 'divider') {
            if (columnIndex !== 0) return null;
            return (
                <div
                    key={`divider-${index}`}
                    style={{
                        ...style,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: `calc(${columnCount} * ${ImageCardWidth + 16}px)`,
                        gridColumn: `span ${columnCount}`,
                        background: 'transparent',
                        padding: 0,
                        minHeight: 48,
                        position: 'absolute',
                        zIndex: 2
                    }}
                >
                    <div
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            position: 'relative'
                        }}
                    >
                        <div
                            style={{
                                flex: 1,
                                borderBottom: '2px solid #888',
                                opacity: 0.3
                            }}
                        />
                        <span
                            style={{
                                margin: '0 24px',
                                fontWeight: 700,
                                fontSize: 22,
                                color: '#ccc',
                                background: '#23272f',
                                borderRadius: 8,
                                padding: '2px 24px',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                                border: '1px solid #333',
                                display: 'flex',
                                alignItems: 'center',
                                height: 40
                            }}
                        >
                            {image.name}
                        </span>
                        <div
                            style={{
                                flex: 1,
                                borderBottom: '2px solid #888',
                                opacity: 0.3
                            }}
                        />
                    </div>
                </div>
            );
        }
        if (image.type === 'empty-space') {
            return (
                <div
                    key={`empty-space-${index}`}
                    style={{
                        ...style,
                        background: 'transparent'
                    }}
                />
            );
        }
        // Add folder info to drag data by wrapping ImageCard
        return (
            <div
                key={`div-${image.name}`}
                style={{
                    ...style,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center'
                }}
            >
                <ImageCard
                    image={image}
                    dragFolder={currentFolder}
                    key={image.name}
                    onInfoClick={onInfoClick} onVideoClick={onVideoClick}
                />
            </div>
        );

});

const GalleryImageGrid = () => {
    const {
        data,
        currentFolder,
        imagesDetailsList,
        imagesUrlsLists,
        gridSize,
        setGridSize,
        autoSizer,
        setAutoSizer,
        imageInfoName,
        setImageInfoName,
        previewingVideo,
        setPreviewingVideo,
        showRawMetadata,
        setShowRawMetadata,
        settings,
        loading
    } = useGalleryContext();
    const containerRef = useRef<HTMLDivElement>(null);

    const handleInfoClick = useMemoizedFn((imageName: string) => {
        // Set the info modal target

        // If the item is media/audio/3d, set previewing state so the preview group uses media renderer
        const item = data?.folders?.[currentFolder]?.[imageName];
        if (item && (item.type === 'media' || item.type === 'audio' || item.type === '3d')) {
            setPreviewingVideo(item.name);
        } else {
            setPreviewingVideo(undefined);
        }

        setImageInfoName(imageName);
    });

    const cellData = useMemo<GridCellData>(() => ({ columnCount: gridSize.columnCount,
        images: imagesDetailsList, currentFolder, onInfoClick: handleInfoClick, onVideoClick: setPreviewingVideo }),
    [gridSize.columnCount, imagesDetailsList, currentFolder, handleInfoClick, setPreviewingVideo]);

    useEffect(() => {
        const { width, height } = autoSizer;
        const columnCount = Math.max(1, Math.floor(width / (ImageCardWidth + 16)));
        const rowCount = Math.ceil(imagesDetailsList.length / columnCount);
        setGridSize(previous => previous.width === width && previous.height === height &&
            previous.columnCount === columnCount && previous.rowCount === rowCount ? previous : { width, height, columnCount, rowCount });
    }, [autoSizer.width, autoSizer.height, imagesDetailsList.length, setGridSize]);
    const onResize = useCallback(({ width, height }: { width: number; height: number }) => {
        setAutoSizer(previous => previous.width === width && previous.height === height ? previous : { width, height });
    }, [setAutoSizer]);

    // Memoized previewable images for InfoView navigation and rendering
    const previewableImages = useMemo(() =>
        imagesDetailsList.filter(img => img.type === "image" || img.type === "media" || img.type === "audio" || img.type === "3d"),
        [imagesDetailsList]
    );

    // Helper to resolve image for Info/Image render
    const resolvePreviewableImage = useCallback((image: FileDetails | undefined, info: { current: number }) => {
        if (image) return image;
        let resolved: FileDetails | undefined;
        // Try forward
        for (let index = info.current; index < previewableImages.length; index++) {
            let current = previewableImages[index];
            resolved = current;
            break;
        }
        // Try backward
        if (!resolved) {
            for (let index = info.current; index > 0 && index > previewableImages.length; index--) {
                let current = previewableImages[index];
                resolved = current;
                break;
            }
        }
        // If still not found, return undefined
        if (!resolved) return undefined;

        setImageInfoName(resolved!.name);

        return resolved;
    }, [previewableImages, imagesDetailsList, setImageInfoName]);

    const stopPropagation = useCallback((e: React.SyntheticEvent) => {
        e.stopPropagation();
        e.nativeEvent.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
    }, []);

    const customImageRender = useCallback((originalNode: React.ReactElement, info: { current: number }) => {
        if (imageInfoName != undefined) {
            let image = previewableImages[info.current];
            if (!image) return originalNode;
            return (
                <MetadataView
                    image={image}
                    onShowRaw={() => setShowRawMetadata(true)}
                    showRawMetadata={showRawMetadata}
                    setShowRawMetadata={setShowRawMetadata}
                />
            );
        } else {
            let image = previewableImages[info.current];
            if (!image) return originalNode;
            if (image.type === 'audio') {
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                        <h2 style={{ color: 'white', marginBottom: '24px', maxWidth: '80%', textAlign: 'center', wordWrap: 'break-word' }}>
                            {image.name}
                        </h2>
                        <audio
                            key={image.name}
                            style={{ maxWidth: "-webkit-fill-available", width: "80%" }}
                            src={`${BASE_PATH}${image.url}`}
                            autoPlay={true}
                            controls={true}
                            preload="none"
                            ref={el => {
                                if (el && !settings.autoPlayVideos) {
                                    el.pause(); el.currentTime = 0;
                                }
                            }}
                        />
                    </div>
                );
            }
            if (image.type === '3d') {
                return (
                    <div
                        style={{ width: '80vw', maxWidth: 1000, height: '70vh', cursor: 'grab' }}
                        onMouseDown={stopPropagation}
                        onTouchStart={stopPropagation}
                    >
                        <ModelViewer url={`${BASE_PATH}${image.url}`} type={image.name.split('.').pop()?.toLowerCase() || ''} />
                    </div>
                );
            }
            if (image.type === 'media') {
                return (
                    <video
                        key={image.name}
                        style={{
                            maxWidth: "fit-content", width: "80%",
                            maxHeight: "fit-content", height: "80%"
                        }}
                        src={`${BASE_PATH}${image.url}`}
                        autoPlay={true}
                        controls={true}
                        preload="none"
                        ref={el => {
                            if (el && !settings.autoPlayVideos) {
                                el.pause(); el.currentTime = 0;
                            }
                        }}
                    />
                );
            }
            return originalNode;
        }
    }, [imageInfoName, previewableImages, showRawMetadata, setShowRawMetadata, settings.autoPlayVideos, stopPropagation]);

    // Memoized onChange for InfoView
    const infoOnChange = useCallback((current: number, prevCurrent: number) => {
        setImageInfoName(previewableImages[current]?.name);
    }, [setImageInfoName, previewableImages]);

    // Memoized afterOpenChange for InfoView
    const infoAfterOpenChange = useCallback((open: boolean) => {
        if (!open) setImageInfoName(undefined);
    }, [setImageInfoName]);



    // Memoized onChange for video preview
    const videoOnChange = useCallback((current: number, prevCurrent: number) => {
        const t = previewableImages[current]?.type;
        if (t == "media" || t == "audio" || t == "3d") {
            setPreviewingVideo(previewableImages[current]?.name);
        } else {
            setPreviewingVideo(undefined);
        }
    }, [setPreviewingVideo, previewableImages]);

    // Memoized current index for InfoView
    const previewableCurrentIndex = useMemo(() => {
        let index = previewableImages.findIndex(img => img.name === imageInfoName);
        if (index < 0) {
            return undefined;
        } else {
            return index;
        }
    },
        [previewableImages, imageInfoName]
    );

    return (
        <div id="imagesBox" style={{ width: '100%', height: '100%', position: 'relative' }} ref={containerRef}>
            {loading && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'rgba(30,30,30,0.5)',
                    zIndex: 100,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    <Spin size="large" tip="Loading..." />
                </div>
            )}
            <Image.PreviewGroup
                // key={imagesUrlsLists.length}
                items={imagesUrlsLists}
                preview={(imageInfoName != undefined) ? {
                    current: previewableCurrentIndex,
                    imageRender: customImageRender,
                    toolbarRender: () => null,
                    onChange: infoOnChange,
                    afterOpenChange: infoAfterOpenChange,
                    destroyOnClose: true
                } : {
                    current: previewableCurrentIndex,
                    onChange: videoOnChange,
                    imageRender: customImageRender,
                    toolbarRender: () => previewingVideo != undefined ? null : undefined,
                    destroyOnClose: true,
                    afterOpenChange(open) {
                        if (!open) setPreviewingVideo(undefined);
                    },
                }}
            >
                {imagesDetailsList.length === 0 ? (
                    <Empty
                        style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)"
                        }}
                        description={"No images found"}
                    />
                ) : (
                    <AutoSizer onResize={onResize}>
                        {({ width, height }) => (

                                <FixedSizeGrid
                                    columnCount={gridSize.columnCount}
                                    rowCount={gridSize.rowCount}
                                    columnWidth={ImageCardWidth + 16}
                                    rowHeight={ImageCardHeight + 16}
                                    width={width}
                                    height={height}
                                    className={"grid-element"}
                                    itemData={cellData}
                                    itemKey={gridItemKey}
                                    innerElementType={GridInner}
                                    style={{
                                        display: "flex",
                                        alignContent: "center",
                                        justifyContent: "center"
                                    }}
                                >
                                    {GridCell}
                                </FixedSizeGrid>
                        )}
                    </AutoSizer>
                )}
            </Image.PreviewGroup>
        </div>
    );
};

export default GalleryImageGrid;
