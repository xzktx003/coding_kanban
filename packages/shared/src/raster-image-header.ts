/** Header inspection only: never decodes pixels or retains the original bytes. */
export const RASTER_IMAGE_MAX_PREVIEW_PIXELS = 40_000_000;
export const INLINE_RASTER_IMAGE_MAX_BASE64 = 128 * 1024;
export interface RasterImageHeader {
  mimeType: string;
  width: number;
  height: number;
  extension: string;
}
export function inspectRasterImageHeader(
  bytes: Uint8Array,
): RasterImageHeader | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, text: string) =>
    bytes.length >= start + text.length &&
    Array.from(text).every(
      (char, index) => bytes[start + index] === char.charCodeAt(0),
    );
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    ascii(1, "PNG\r\n\x1a\n") &&
    ascii(12, "IHDR")
  )
    return {
      mimeType: "image/png",
      width: view.getUint32(16),
      height: view.getUint32(20),
      extension: "png",
    };
  if (bytes.length >= 10 && (ascii(0, "GIF87a") || ascii(0, "GIF89a")))
    return {
      mimeType: "image/gif",
      width: view.getUint16(6, true),
      height: view.getUint16(8, true),
      extension: "gif",
    };
  if (
    bytes.length >= 25 &&
    ascii(0, "RIFF") &&
    ascii(8, "WEBP") &&
    view.getUint32(4, true) + 8 <= bytes.length
  ) {
    if (ascii(12, "VP8L") && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      return {
        mimeType: "image/webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        extension: "webp",
      };
    }
    const uint24 = (at: number) =>
      bytes[at]! + bytes[at + 1]! * 256 + bytes[at + 2]! * 65536;
    if (bytes.length >= 30 && ascii(12, "VP8X"))
      return {
        mimeType: "image/webp",
        width: uint24(24) + 1,
        height: uint24(27) + 1,
        extension: "webp",
      };
    if (
      bytes.length >= 30 &&
      ascii(12, "VP8 ") &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    )
      return {
        mimeType: "image/webp",
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
        extension: "webp",
      };
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2,
      segments = 0;
    while (
      offset < bytes.length &&
      offset < 2 * 1024 * 1024 &&
      ++segments <= 4096
    ) {
      if (bytes[offset++] !== 255) return null;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 217 || marker === 218) return null;
      if (marker === 1 || (marker >= 208 && marker <= 216)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 8
      )
        return {
          mimeType: "image/jpeg",
          height: view.getUint16(offset + 3),
          width: view.getUint16(offset + 5),
          extension: "jpg",
        };
      offset += length;
    }
  }
  return null;
}
/** Small validated images may remain inline; others use an explicit readonly reader. */
export function safeInlineRasterImage(
  mimeType: unknown,
  data: unknown,
): boolean {
  if (
    typeof data !== "string" ||
    !data ||
    data.length > INLINE_RASTER_IMAGE_MAX_BASE64 ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data) ||
    typeof atob !== "function"
  )
    return false;
  try {
    const decoded = atob(data),
      bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0)),
      shape = inspectRasterImageHeader(bytes);
    return (
      !!shape &&
      shape.mimeType === mimeType &&
      shape.width > 0 &&
      shape.height > 0 &&
      shape.width * shape.height <= RASTER_IMAGE_MAX_PREVIEW_PIXELS
    );
  } catch {
    return false;
  }
}
