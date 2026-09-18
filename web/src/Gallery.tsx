import { GalleryProvider } from './GalleryContext';
import GalleryOpenButton from './GalleryOpenButton';
import GalleryModal from './GalleryModal';
import { HydrusProvider } from './HydrusContext';

function Gallery() {
    return (
        <GalleryProvider>
            <HydrusProvider>
            <GalleryOpenButton />
            <GalleryModal />
            </HydrusProvider>
        </GalleryProvider>
    );
}

export default Gallery;
