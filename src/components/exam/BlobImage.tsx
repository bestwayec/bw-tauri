import { useBlobMedia } from "@/lib/media";

type Props = {
  src: string | null;
  alt: string;
  className?: string;
};

/**
 * Authenticated exam image (map labelling, diagrams): fetched with the
 * student Bearer token into a Blob URL, with loading/error states instead
 * of a silent broken image.
 */
export default function BlobImage({ src, alt, className }: Props) {
  const media = useBlobMedia(src);
  if (!src) return null;
  if (media.loading) {
    return (
      <div
        role="status"
        aria-label="Loading image"
        className={`grid max-h-96 min-h-32 w-full animate-pulse place-items-center rounded-2xl bg-white/5 text-xs text-white/40 ring-1 ring-white/10 ${className ?? ""}`}
      >
        Loading image…
      </div>
    );
  }
  if (media.error || !media.url) {
    return (
      <p role="alert" className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
        Image failed to load: {media.error ?? "Unknown media error."}
      </p>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- Tauri app (no next/image optimizer); authenticated blob URL
  return <img src={media.url} alt={alt} loading="lazy" className={className} />;
}
