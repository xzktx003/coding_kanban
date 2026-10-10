import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@session/components/ui/dialog";
export function CodexImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="codex-image-preview"
        onClick={() => setOpen(true)}
        aria-label={`放大${alt}`}
      >
        <img src={src} alt={alt} loading="lazy" />
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
