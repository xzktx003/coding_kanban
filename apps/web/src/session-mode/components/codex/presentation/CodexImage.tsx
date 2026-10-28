import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@session/components/ui/dialog";
export function CodexImage({
  src,
  alt,
  onError,
}: {
  src: string;
  alt: string;
  onError?: () => void;
}) {
  const { t } = useTranslation("thread");
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  // A new src is a new attempt: keep a prior failure from hiding fresh bytes.
  useEffect(() => setFailed(false), [src]);
  // The original renders an unloadable attachment as a plain, smaller tile with
  // no zoom affordance — there is nothing left to enlarge once the bytes are
  // gone, so the button and its dialog go away with them.
  if (failed) {
    const label = t("userMessage.attachmentFailed");
    return (
      <div
        className="codex-image-failed"
        role="img"
        aria-label={label}
        title={label}
      >
        {t("userMessage.attachmentFailedShort")}
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        className="codex-image-preview"
        onClick={() => setOpen(true)}
        aria-label={`放大${alt}`}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => {
            setFailed(true);
            setOpen(false);
            onError?.();
          }}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="codex-file-preview max-w-[90vw] max-h-[90dvh] overflow-auto">
          <DialogTitle>{alt}</DialogTitle>
          <img
            src={src}
            alt={`${alt}大图`}
            className="max-w-full max-h-[70dvh] object-contain mx-auto"
          />
          <a href={src} download className="text-sm underline">
            下载图片
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}
