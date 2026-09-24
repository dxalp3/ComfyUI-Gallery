import { STANDALONE } from './ComfyAppApi';
import { ImageSourceHost } from './ImageSourceHost';
import { GalleryProvider } from './GalleryContext';
import GalleryOpenButton from './GalleryOpenButton';
import GalleryModal from './GalleryModal';
import { HydrusProvider } from './HydrusContext';

function Gallery() {
    return (
        <GalleryProvider>
            <HydrusProvider>
            {!STANDALONE && <GalleryOpenButton />}
            <ImageSourceHost />
            <GalleryModal />
            </HydrusProvider>
        </GalleryProvider>
    );
}

export default Gallery;
