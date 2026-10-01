import Button from 'antd/es/button/button';
import { useGalleryContext } from './GalleryContext';
import { useWorkspaceTab } from './GalleryWorkspace';
const GalleryOpenButton = () => {
    const { setOpen, settings } = useGalleryContext();
    const hasTab = useWorkspaceTab();
    return <Button id="comfy-ui-gallery-open-button" onClick={() => setOpen(true)} type="primary"
        style={hasTab || settings.hideOpenButton ? { display: 'none' } : { position: 'fixed', top: 8, right: 16, zIndex: 900 }}>
        {settings.buttonLabel || 'Open Gallery'}
    </Button>;
};
export default GalleryOpenButton;
