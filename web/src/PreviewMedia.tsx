import { useLayoutEffect, useRef } from 'react';
import type { VideoHTMLAttributes } from 'react';

export function stopMedia(root: HTMLElement | null) {
    root?.querySelectorAll<HTMLMediaElement>('video,audio').forEach(media => media.pause());
}
/** Stop detached media immediately, including during modal exit animations. */
export function PreviewMedia({ audio = false, ...props }: VideoHTMLAttributes<HTMLVideoElement> & { audio?: boolean }) {
    const ref = useRef<HTMLMediaElement | null>(null);
    useLayoutEffect(() => {
        const media = ref.current;
        if (media && props.src && media.getAttribute('src') !== props.src) { media.src = props.src; media.load(); }
        return () => { if (media) { media.pause(); media.removeAttribute('src'); media.load(); } };
    }, [props.src]);
    return audio ? <audio {...props as any} ref={ref as any} /> : <video {...props} ref={ref as any} />;
}
