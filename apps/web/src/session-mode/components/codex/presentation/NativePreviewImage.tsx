import { useEffect, useRef, useState } from "react";
import type { NativePreviewImage as ImageData } from "@agent-orchestrator/shared";
function previewImageUrl(dataUrl: string) {
  const comma = dataUrl.indexOf(","),
    mime = dataUrl.slice(5, dataUrl.indexOf(";")),
    binary = atob(dataUrl.slice(comma + 1)),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}
/** Scope encoded media to the mounted card rather than Chromium's data-URI resource cache. */
export function NativePreviewImage({
  image,
  presentation,
  onError,
}: {
  image: ImageData;
  presentation: "hero" | "thumbnail" | "standalone";
  onError: () => void;
}) {
  const ref = useRef<HTMLImageElement>(null),
    [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = previewImageUrl(image.dataUrl);
    setSrc(url);
    return () => {
      ref.current?.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [image.dataUrl]);
  return (
    <img
      ref={ref}
      className={`codex-native-preview-${presentation}`}
      src={src ?? undefined}
      width={image.width}
      height={image.height}
      alt=""
      draggable={false}
      onError={onError}
    />
  );
}
