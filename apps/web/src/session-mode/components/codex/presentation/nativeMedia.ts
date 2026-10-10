/** Media may be embedded or explicitly served over HTTP; active document URLs are never images/audio. */
export function nativeMediaUrl(value: string, kind: "image" | "audio") {
  if (/^https?:\/\//i.test(value)) return value;
  if (
    new RegExp(`^data:${kind}/[\\w.+-]+;base64,[A-Za-z0-9+/=\\s]+$`).test(value)
  )
    return value;
  return null;
}
export function nativeImageData(value: string) {
  const embedded = nativeMediaUrl(value, "image");
  if (embedded) return embedded;
  const base64 = value.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) return null;
  const mime = base64.startsWith("iVBORw0KGgo")
    ? "image/png"
    : base64.startsWith("/9j/")
      ? "image/jpeg"
      : base64.startsWith("UklGR")
        ? "image/webp"
        : base64.startsWith("R0lGOD")
          ? "image/gif"
          : null;
  return mime ? `data:${mime};base64,${base64}` : null;
}
