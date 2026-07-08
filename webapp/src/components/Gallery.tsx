import type { CardImage } from "@agromarket/contracts";
import type PhotoSwipeLightbox from "photoswipe/lightbox";
import "photoswipe/style.css";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";

interface GalleryProps {
  images: CardImage[];
  title: string;
}

const DEFAULT_WIDTH = 1600;
const DEFAULT_HEIGHT = 1200;

/**
 * Инлайн-галерея на CSS scroll-snap + полноэкранный просмотр с pinch-zoom через PhotoSwipe.
 * PhotoSwipe сканирует DOM (`<a data-pswp-width/height>`) — точные размеры уточняются по мере
 * загрузки превью (onLoad); до этого используется приблизительный дефолт (не критично для UX).
 */
export function Gallery({ images, title }: GalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({});

  useEffect(() => {
    if (!containerRef.current) return;
    let lightbox: PhotoSwipeLightbox | undefined;
    let cancelled = false;

    import("photoswipe/lightbox").then(({ default: PhotoSwipeLightboxCtor }) => {
      if (cancelled || !containerRef.current) return;
      lightbox = new PhotoSwipeLightboxCtor({
        gallery: containerRef.current,
        children: "a",
        pswpModule: () => import("photoswipe")
      });
      lightbox.init();
    });

    return () => {
      cancelled = true;
      lightbox?.destroy();
    };
  }, []);

  function handleScroll() {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  }

  function handleImageLoad(id: string, event: SyntheticEvent<HTMLImageElement>) {
    const img = event.currentTarget;
    setDims((prev) => ({ ...prev, [id]: { width: img.naturalWidth, height: img.naturalHeight } }));
  }

  if (images.length === 0) {
    return <div className="gallery gallery--empty" aria-hidden="true" />;
  }

  return (
    <div className="gallery" ref={containerRef}>
      <div className="gallery-track" ref={trackRef} onScroll={handleScroll}>
        {images.map((img, index) => {
          const size = dims[img.id] ?? { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
          return (
            <a
              key={img.id}
              className="gallery-slide"
              href={img.url}
              target="_blank"
              rel="noreferrer"
              data-pswp-width={size.width}
              data-pswp-height={size.height}
            >
              <img
                src={img.url}
                alt={img.altText ?? title}
                loading={index === 0 ? "eager" : "lazy"}
                onLoad={(event) => handleImageLoad(img.id, event)}
              />
            </a>
          );
        })}
      </div>
      {images.length > 1 && (
        <div className="gallery-dots">
          {images.map((img, index) => (
            <span key={img.id} className={`gallery-dot${index === active ? " gallery-dot--active" : ""}`} />
          ))}
        </div>
      )}
    </div>
  );
}
