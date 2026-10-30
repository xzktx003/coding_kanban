import { createHash } from "node:crypto";
import {
  inspectRasterImageHeader,
  RASTER_IMAGE_MAX_PREVIEW_PIXELS,
} from "@agent-orchestrator/shared";
import { HttpError } from "./json.js";
export const HISTORY_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const HISTORY_IMAGE_MAX_PREVIEW_PIXELS = RASTER_IMAGE_MAX_PREVIEW_PIXELS;
export class HistoryImageError extends HttpError {
  constructor(
    status: number,
    readonly code: string,
    message: string,
  ) {
    super(status, `${code}: ${message}`);
  }
}
export function historyImageOptions(body: Record<string, unknown>) {
  if (
    typeof body.item_id !== "string" ||
    !body.item_id ||
    body.item_id.length > 512 ||
    /[\x00-\x1f]/.test(body.item_id)
  )
    throw new HttpError(400, "Invalid history image item identity");
  if (
    !Number.isSafeInteger(body.image_index) ||
    Number(body.image_index) < 0 ||
    Number(body.image_index) > 31
  )
    throw new HttpError(400, "Invalid history image index");
  if (body.download !== undefined && typeof body.download !== "boolean")
    throw new HttpError(400, "Invalid history image download intent");
  return {
    itemId: body.item_id,
    index: Number(body.image_index),
    download: body.download === true,
  };
}
export function historyImage(
  source: { mimeType: unknown; data: unknown },
  download = false,
) {
  if (
    !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
      String(source.mimeType),
    )
  )
    throw new HttpError(415, "History image type is not supported");
  if (
    typeof source.data !== "string" ||
    !source.data ||
    source.data.length > Math.ceil(HISTORY_IMAGE_MAX_BYTES / 3) * 4 + 4
  )
    throw new HistoryImageError(
      413,
      "HISTORY_IMAGE_BYTE_LIMIT",
      "history image byte budget exceeded",
    );
  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(source.data) ||
    source.data.length % 4 !== 0
  )
    throw new HttpError(400, "Invalid history image base64");
  const bytes = Buffer.from(source.data, "base64");
  if (!bytes.length || bytes.length > HISTORY_IMAGE_MAX_BYTES)
    throw new HistoryImageError(
      413,
      "HISTORY_IMAGE_BYTE_LIMIT",
      "history image byte budget exceeded",
    );
  const shape = inspectRasterImageHeader(bytes);
  if (!shape || !shape.width || !shape.height)
    throw new HttpError(415, "History image header is invalid or unsupported");
  if (source.mimeType !== shape.mimeType)
    throw new HttpError(415, "History image MIME does not match its bytes");
  if (
    !download &&
    shape.width * shape.height > HISTORY_IMAGE_MAX_PREVIEW_PIXELS
  )
    throw new HistoryImageError(
      413,
      "HISTORY_IMAGE_PREVIEW_PIXEL_LIMIT",
      "preview pixel budget exceeded; explicitly download the original instead",
    );
  return {
    ...shape,
    bytes,
    revision: createHash("sha256").update(bytes).digest("hex"),
  };
}
export type HistoryImage = ReturnType<typeof historyImage>;
export function historyImageHeaders(
  image: HistoryImage,
  index: number,
  download = false,
) {
  return {
    "content-type": image.mimeType,
    "content-length": String(image.bytes.length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": `${download ? "attachment" : "inline"}; filename="history-image-${index + 1}.${image.extension}"`,
    "x-history-image-width": String(image.width),
    "x-history-image-height": String(image.height),
    "x-history-image-revision": image.revision,
  };
}
