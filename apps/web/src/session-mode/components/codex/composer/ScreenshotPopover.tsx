import { Camera } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@session/components/ui/button";
import { uploadBrowserFile } from "@session/browser-dialog";

export function ScreenshotPopover({ onScreenshotTaken }: { onScreenshotTaken: (path: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  const available = Boolean(navigator.mediaDevices?.getDisplayMedia);
  async function capture() {
    let stream: MediaStream | undefined;
    setCapturing(true);
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video"); video.srcObject = stream; video.muted = true;
      await video.play();
      const canvas = document.createElement("canvas");
      const ratio = Math.min(1, 2560 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("截图失败")), "image/png"));
      onScreenshotTaken(await uploadBrowserFile(new File([blob], "screenshot.png", { type: "image/png" })));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotAllowedError")) toast.error(error instanceof Error ? error.message : "截图失败");
    } finally { stream?.getTracks().forEach(track => track.stop()); setCapturing(false); }
  }
  return <Button variant="ghost" disabled={!available || capturing} onClick={capture} title={available ? "选择屏幕或窗口截图" : "此浏览器不支持屏幕截图，可使用上传图片"} className="justify-start gap-2 px-2"><Camera size={16} /><span>{capturing ? "正在截图…" : "屏幕截图"}</span></Button>;
}
