import { useState } from 'react';
import { Alert, Button, Space, Tooltip, Typography } from 'antd';
import { CloudUploadOutlined, DatabaseOutlined, ReloadOutlined } from '@ant-design/icons';
import { useGalleryContext } from './GalleryContext';
import { useHydrus } from './HydrusContext';
import { HydrusBrowser } from './HydrusBrowser';

export function HydrusToolbar() {
    const { selectedImages, setSelectedImages, imagesDetailsList, unfilteredFolderImages } = useGalleryContext();
    const { imageFiles, items, settingsError, setSettingsOpen, requestExport, refresh } = useHydrus();
    const [browserOpen, setBrowserOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<{ text: string; error: boolean }>();
    const shown = imagesDetailsList.filter(file => file.type !== 'divider' && file.type !== 'empty-space').map(file => file.url);
    const selectedImageUrls = selectedImages.filter(url => imageFiles[url]);
    const hiddenCount = selectedImages.filter(url => !shown.includes(url)).length;
    const refreshSelected = async (urls = selectedImageUrls) => {
        setBusy(true); setNotice(undefined);
        try {
            const results = await refresh(urls);
            const failures = results.filter(item => item.error || item.success === false);
            setNotice({ text: failures.length ? `${failures.length} image(s) could not be refreshed. ${failures[0].error || 'Check the connection and permissions.'}` : `Updated Hydrus status for ${results.length} image(s).`, error: failures.length > 0 });
        } catch (error) { setNotice({ text: error instanceof Error ? error.message : String(error), error: true }); }
        finally { setBusy(false); }
    };
    return <div style={{ padding: '8px 4px 12px' }}>
        <Space wrap size={[8, 8]}>
            <Button icon={<DatabaseOutlined />} onClick={() => setBrowserOpen(true)}>Browse Hydrus</Button>
            <Button icon={<DatabaseOutlined />} onClick={() => setSettingsOpen(true)}>Hydrus settings</Button>
            <Tooltip title="Update cached Hydrus tags for every local image in this folder, including images hidden by search.">
                <Button loading={busy} disabled={!unfilteredFolderImages.some(file => file.type === 'image')} onClick={() => refreshSelected(unfilteredFolderImages.filter(file => file.type === 'image').map(file => file.url))}>Refresh folder tags</Button>
            </Tooltip>
            <Tooltip title="Selects every file in the current folder and search results, including cards outside the viewport.">
                <Button disabled={!shown.length} onClick={() => setSelectedImages(Array.from(new Set([...selectedImages, ...shown])))}>Select all shown ({shown.length})</Button>
            </Tooltip>
            <Button disabled={!selectedImages.length} onClick={() => setSelectedImages([])}>Clear selection</Button>
            <Button disabled={!shown.length} onClick={() => setSelectedImages(shown.filter(url => imageFiles[url] && !items[url]?.exported))}>Select without export history</Button>
            <Typography.Text type="secondary">{selectedImages.length ? `${selectedImages.length} selected${hiddenCount ? ` · ${hiddenCount} outside this view` : ''}` : 'Checkbox to select · Shift for range · Ctrl/Cmd to toggle'}</Typography.Text>
            {selectedImages.length > 0 && <>
                <Button type="primary" icon={<CloudUploadOutlined />} disabled={!selectedImageUrls.length || busy} onClick={() => requestExport(selectedImages)}>Export to Hydrus ({selectedImageUrls.length})</Button>
                <Button icon={<ReloadOutlined />} loading={busy} disabled={!selectedImageUrls.length} onClick={() => refreshSelected()}>Refresh Hydrus status</Button>
                {selectedImageUrls.length !== selectedImages.length && <Typography.Text type="secondary">{selectedImages.length - selectedImageUrls.length} non-image file(s) excluded</Typography.Text>}
            </>}
        </Space>
        {(notice || settingsError) && <Alert style={{ marginTop: 8 }} showIcon closable
            type={notice ? notice.error ? 'warning' : 'success' : 'warning'}
            message={notice?.text || settingsError} afterClose={() => setNotice(undefined)} />}
        <HydrusBrowser open={browserOpen} onClose={() => setBrowserOpen(false)} />
    </div>;
}
