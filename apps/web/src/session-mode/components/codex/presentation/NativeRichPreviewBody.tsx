import { useState } from "react";
import { motion } from "framer-motion";
import { NativePreviewImage } from "./NativePreviewImage";
import type { NativeRichPreviewData } from "./NativeSlackPreview";
export function NativeRichPreviewBody({
  data,
  currentIdentity,
  cacheIdentity,
  fallback,
  format,
  reducedMotion,
}: {
  data: NativeRichPreviewData | null;
  currentIdentity: string | null;
  cacheIdentity?: string;
  fallback?: NativeRichPreviewData & { status: "ready" };
  format?: (
    data: NativeRichPreviewData & { status: "ready" },
  ) => NativeRichPreviewData & { status: "ready" };
  reducedMotion: boolean | null;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const ready =
    data?.status === "ready" && cacheIdentity === currentIdentity
      ? (format?.(data) ?? data)
      : data === null
        ? null
        : (fallback ?? null);
  const previewImage =
      ready?.image?.dataUrl !== failedImage ? ready?.image : null,
    thumbnail =
      !!previewImage && previewImage.width / previewImage.height < 1.2;
  const hasText =
      !!ready && (ready.title !== null || ready.description !== null),
    standalone = thumbnail && !hasText,
    hasBody = hasText || !!previewImage;
  const image = (presentation: "hero" | "thumbnail" | "standalone") =>
    previewImage ? (
      <NativePreviewImage
        image={previewImage}
        presentation={presentation}
        onError={() => setFailedImage(previewImage.dataUrl)}
      />
    ) : null;
  return (
    <motion.div
      className="codex-native-slack-body"
      data-ready={hasBody}
      initial={false}
      animate={{ height: hasBody ? "auto" : 0 }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : { duration: 0.3, ease: [0.19, 1, 0.22, 1] }
      }
    >
      {ready && hasBody && (
        <div className="codex-native-rich-content">
          {previewImage && !thumbnail && image("hero")}
          {(hasText || thumbnail) && (
            <div
              className="codex-native-slack-details"
              data-center={ready.description === null}
              data-standalone={standalone}
            >
              {thumbnail && image(standalone ? "standalone" : "thumbnail")}
              {hasText && (
                <div className="codex-native-rich-text">
                  {ready.title !== null && <h3>{ready.title}</h3>}
                  {ready.description !== null && <p>{ready.description}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
