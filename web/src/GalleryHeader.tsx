import { useEffect, useRef, useState } from 'react';
import { Flex, InputNumber, AutoComplete, Button, Segmented, Modal, message, Popconfirm, Select, Tooltip } from 'antd';
import { CloseSquareFilled, DoubleLeftOutlined, DoubleRightOutlined } from '@ant-design/icons';
import { useGalleryContext } from './GalleryContext';
import { useDebounce, useCountDown } from 'ahooks';
import Typography from 'antd/es/typography/Typography';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { BASE_PATH, ComfyAppApi, STANDALONE } from './ComfyAppApi';

const GalleryHeader = () => {
    const {
        showSettings, setShowSettings,
        searchFileName, setSearchFileName,
        localSearchField, setLocalSearchField, qualities, setQualities,
        sortMethod, setSortMethod,
        imagesAutoCompleteNames,
        autoCompleteOptions, setAutoCompleteOptions,
        setOpen,
        selectedImages, setSelectedImages,
        siderCollapsed, setSiderCollapsed
    } = useGalleryContext();

    const [search, setSearch] = useState(searchFileName);
    const [showClose, setShowClose] = useState(false);
    const [targetDate, setTargetDate] = useState<number>();
    const [countdown] = useCountDown({
        targetDate,
        onEnd: () => {
            setOpen(false);
            setShowClose(false);
            setTargetDate(undefined);
        },
    });
    const dragCounter = useRef(0);

    const [downloading, setDownloading] = useState(false);
    const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Show close button only when dragging
    useEffect(() => {
        const onDragStart = () => { if (!STANDALONE) setShowClose(true); };
        const onDragEnd = () => {
            setShowClose(false);
            setTargetDate(undefined);
        };
        window.addEventListener('dragstart', onDragStart);
        window.addEventListener('dragend', onDragEnd);
        return () => {
            window.removeEventListener('dragstart', onDragStart);
            window.removeEventListener('dragend', onDragEnd);
        };
    }, []);

    // Debounce the search input to prevent lag
    const debouncedSearch = useDebounce(search, { wait: 100 });

    useEffect(() => {
        setSearchFileName(debouncedSearch);

        if (!debouncedSearch || debouncedSearch.length == 0) {
            setAutoCompleteOptions(imagesAutoCompleteNames);
        } else {
            setAutoCompleteOptions(
                imagesAutoCompleteNames.filter(opt =>
                    typeof opt.value === 'string' && opt.value.toLowerCase().includes(debouncedSearch.toLowerCase())
                )
            );
        }
    }, [debouncedSearch, imagesAutoCompleteNames, setAutoCompleteOptions]);

    return (
        <Flex
            justify={"space-between"}
            align={"center"}
            gap={12}
            wrap
        >
            <div
                style={{
                    display: "flex",
                    alignContent: "center",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "20px",
                }}      
            >
                <Button
                    size="middle"
                    onClick={() => setSiderCollapsed((prev: boolean) => !prev)}
                >
                    {siderCollapsed ? <DoubleRightOutlined /> : <DoubleLeftOutlined />}
                </Button>
                <Button 
                    size={"middle"} 
                    onClick={() => setShowSettings(true)}
                >
                    Settings
                </Button>
            </div>
            {selectedImages && selectedImages.length > 0 && (
                <>
                    <Popconfirm
                        title="Download Selected Images"
                        description={`Are you sure you want to download ${selectedImages.length} selected image(s)?`}
                        onConfirm={async () => {
                            setDownloading(true);
                            try {
                                const zip = new JSZip();
                                await Promise.all(selectedImages.map(async (url) => {
                                    try {
                                        const fetchUrl = url.startsWith('http') ? url : `${BASE_PATH}${url}`;
                                        const response = await fetch(fetchUrl);
                                        const blob = await response.blob();
                                        const filename = url.split('/').pop() || 'image';
                                        zip.file(filename, blob);
                                    } catch (e) {
                                        console.error('Failed to fetch image:', url, e);
                                    }
                                }));
                                const content = await zip.generateAsync({ type: 'blob' });
                                FileSaver.saveAs(content, 'comfy-ui-gallery-images.zip');
                            } catch (error) {
                                message.error('Failed to download images.');
                            } finally {
                                setDownloading(false);
                            }
                        }}
                        onCancel={() => message.info('Download cancelled')}
                        okText={`Download (${selectedImages.length})`}
                        cancelText="Cancel"
                        okButtonProps={{ loading: downloading }}
                    >
                        <Button
                            type="primary"
                            loading={downloading}
                            style={{ marginLeft: 8 }}
                            className="selectedImagesActionButton"
                        >
                            Download Selected
                        </Button>
                    </Popconfirm>
                    <Popconfirm
                        title="Delete Selected Images"
                        description={`Are you sure you want to delete ${selectedImages.length} selected image(s)? This cannot be undone.`}
                        onConfirm={async () => {
                            let deleted = 0;
                            for (const url of selectedImages) {
                                try {
                                    const success = await ComfyAppApi.deleteImage(url);
                                    if (success) deleted++;
                                    await new Promise(res => setTimeout(res, 50));
                                } catch (e) {
                                    console.error('Failed to delete image:', url, e);
                                }
                            }
                            if (deleted > 0) {
                                message.success(`Deleted ${deleted} image(s).`);
                                setSelectedImages([]);
                            } else {
                                message.error(`Failed to delete images.`);
                            }
                        }}
                        onCancel={() => message.info('Delete cancelled')}
                        okText={`Delete (${selectedImages.length})`}
                        cancelText="Cancel"
                        okButtonProps={{ danger: true }}
                    >
                        <Button
                            danger
                            style={{ marginLeft: 8 }}
                            className="selectedImagesActionButton"
                        >
                            Delete Selected
                        </Button>
                    </Popconfirm>
                </>
            )}
            {showClose && (
                <div
                    style={{ 
                        display: 'inline-block' 
                    }}
                    onDragEnter={e => {
                        e.preventDefault();
                        dragCounter.current++;
                        if (!targetDate) {
                            setTargetDate(Date.now() + 3000);
                        }
                    }}
                    onDragLeave={e => {
                        e.preventDefault();
                        dragCounter.current--;
                        if (dragCounter.current === 0 && targetDate) {
                            setTargetDate(undefined);
                        }
                    }}
                >
                    <Button
                        type="default"
                        style={{ 
                            marginLeft: "8px",
                            display: "flex",
                            alignItems: "center",
                            position: "relative",
                            cursor: "pointer",
                            justifyContent: "center",
                            alignContent: "center",
                            flexWrap: "wrap",
                            width: 150
                        }}
                        tabIndex={-1} // Prevent focus flicker
                    >
                        {targetDate
                            ? (
                                <Typography 
                                    style={{ 
                                        color: '#ff4d4f', 
                                        fontWeight: 500 
                                    }}
                                >
                                    {`   Close in ${Math.ceil(countdown / 1000)}s   `}
                                </Typography>
                            ) : (
                                <Typography 
                                    style={{ 
                                        color: '#888', 
                                        fontWeight: 400 
                                    }}
                                >
                                    Hover to close 3s
                                </Typography>
                            )
                        }
                    </Button>
                </div>
            )}
            <Flex gap={8} style={{ flex: '1 1 430px', minWidth: 280, maxWidth: 780 }}>
                <Tooltip title="Search all files in the current folder. Hydrus tags come from the saved metadata snapshot; use Refresh folder tags to fetch later changes.">
                    <Select
                        aria-label="Local search field"
                        value={localSearchField}
                        onChange={setLocalSearchField}
                        style={{ width: 190, flexShrink: 0 }}
                        options={[
                            { value: 'all', label: 'All fields' },
                            { value: 'name', label: 'File name' },
                            { value: 'hydrus', label: 'Hydrus tags (cached)' },
                            { value: 'positive', label: 'Positive prompt' },
                            { value: 'negative', label: 'Negative prompt' },
                        ]}
                    />
                </Tooltip>
                <AutoComplete
                    aria-label="Search local images"
                    options={localSearchField === 'name' ? autoCompleteOptions : []}
                    style={{ flex: 1, minWidth: 150 }}
                    onSearch={text => setSearch(text)}
                    value={search}
                    onChange={val => setSearch(val)}
                    placeholder={localSearchField === 'all' ? 'Search names, cached tags or prompts' : localSearchField === 'hydrus' ? 'Search cached Hydrus tags' : localSearchField === 'name' ? 'Search file names' : `Search ${localSearchField} prompts`}
                    allowClear={{ clearIcon: <CloseSquareFilled /> }}
                />
            </Flex>
            <InputNumber aria-label="Local minimum width" placeholder="Min width" min={0} max={32768} value={qualities.minWidth || null} onChange={value => setQualities(previous => ({ ...previous, minWidth: value || 0 }))} />
            <InputNumber aria-label="Local minimum height" placeholder="Min height" min={0} max={32768} value={qualities.minHeight || null} onChange={value => setQualities(previous => ({ ...previous, minHeight: value || 0 }))} />
            <Select aria-label="Local image format" value={qualities.format} style={{ width: 120 }} onChange={format => setQualities(previous => ({ ...previous, format }))}
                options={[{ value: '', label: 'All formats' }, ...['png', 'jpg', 'webp', 'gif', 'avif'].map(value => ({ value, label: value.toUpperCase() }))]} />
            <Segmented<string>
                style={{ 
                    marginRight: 15 
                }}
                options={['Newest', 'Oldest', 'Name ↑', 'Name ↓']}
                value={sortMethod}
                onChange={value => setSortMethod(value as any)}
            />
        </Flex>
    );
};

export default GalleryHeader;
