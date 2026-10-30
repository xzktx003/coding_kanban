import { safeInlineRasterImage } from "./raster-image-header.js";
type Block = Record<string, any>;
export function projectClaudeImageContent(value: unknown): {
  content: unknown;
  truncated: boolean;
  historyImages: { index: number; mimeType: string }[];
} {
  if (!Array.isArray(value))
    return { content: value, truncated: false, historyImages: [] };
  let truncated = false,
    imageIndex = 0;
  const historyImages: { index: number; mimeType: string }[] = [];
  const content = value.map((block: Block) => {
    if (!block || block.type !== "image") return block;
    const index = imageIndex++,
      source = block.source;
    if (
      source?.type === "base64" &&
      safeInlineRasterImage(source.media_type, source.data)
    )
      return block;
    truncated = true;
    if (
      source?.type === "base64" &&
      typeof source.data === "string" &&
      ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        source.media_type,
      ) &&
      index < 32
    )
      historyImages.push({ index, mimeType: source.media_type });
    return { type: "text", text: "[图片附件，完整内容可按需读取]" };
  });
  return { content: truncated ? content : value, truncated, historyImages };
}
