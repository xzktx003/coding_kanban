import { open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { relative, isAbsolute, sep } from "node:path";
import type { AcpImage } from "./types.js";
export async function readImages(
  paths: string[],
  root: string,
): Promise<AcpImage[]> {
  if (!paths.length) return [];
  if (paths.length > 8) throw new Error("最多发送 8 张图片");
  const base = await realpath(root);
  const images: AcpImage[] = [];
  let total = 0;
  for (const path of paths) {
    const canonical = await realpath(path);
    const rel = relative(base, canonical);
    if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
      throw new Error("图片必须来自当前应用的附件目录");
    const file = await open(
      canonical,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const st = await file.stat();
      if (!st.isFile() || st.size > 10 * 1024 * 1024)
        throw new Error("图片不能超过 10 MB");
      total += st.size;
      if (total > 32 * 1024 * 1024) throw new Error("图片总大小不能超过 32 MB");
      const bytes = Buffer.alloc(st.size + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== st.size) throw new Error("图片读取期间发生变化");
      const b = bytes.subarray(0, bytesRead);
      const mimeType = b
        .subarray(0, 8)
        .equals(Buffer.from("\x89PNG\r\n\x1a\n", "latin1"))
        ? "image/png"
        : b[0] === 255 && b[1] === 216 && b[2] === 255
          ? "image/jpeg"
          : ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString())
            ? "image/gif"
            : b.subarray(0, 4).toString() === "RIFF" &&
                b.subarray(8, 12).toString() === "WEBP"
              ? "image/webp"
              : null;
      if (!mimeType) throw new Error("仅支持 PNG、JPEG、GIF、WebP 图片");
      images.push({ mimeType, data: b.toString("base64") });
    } finally {
      await file.close();
    }
  }
  return images;
}
