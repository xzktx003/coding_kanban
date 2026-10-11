export type NativePreviewImage = {
  dataUrl: string;
  width: number;
  height: number;
};
export type NativeWebsitePreviewData =
  | { status: "unavailable" }
  | {
      status: "ready";
      title: string | null;
      description: string | null;
      image: NativePreviewImage | null;
    };
/** Native kti: the host supports credential-free HTTPS with the default port. */
export function nativeWebsitePreviewUrl(href: string): URL | null {
  try {
    const u = new URL(href);
    return u.protocol === "https:" && !u.username && !u.password && !u.port
      ? u
      : null;
  } catch {
    return null;
  }
}
/** Validate the bounded host projection; never accept HTML or arbitrary image URLs. */
export function nativeWebsiteDisplayData(
  value: unknown,
): NativeWebsitePreviewData {
  const unavailable: NativeWebsitePreviewData = { status: "unavailable" };
  if (!value || typeof value !== "object") return unavailable;
  const v = value as Record<string, unknown>;
  if (v.status !== "ready") return unavailable;
  if (
    !(
      v.title === null ||
      (typeof v.title === "string" && v.title.length <= 300)
    ) ||
    !(
      v.description === null ||
      (typeof v.description === "string" && v.description.length <= 1000)
    )
  )
    return unavailable;
  let image: NativePreviewImage | null = null;
  if (v.image != null) {
    if (typeof v.image !== "object") return unavailable;
    const i = v.image as Record<string, unknown>;
    if (
      typeof i.dataUrl !== "string" ||
      !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/u.test(
        i.dataUrl,
      ) ||
      i.dataUrl.length > 2_796_240 ||
      !Number.isInteger(i.width) ||
      !Number.isInteger(i.height) ||
      Number(i.width) <= 0 ||
      Number(i.height) <= 0 ||
      Number(i.width) > 8192 ||
      Number(i.height) > 8192 ||
      Number(i.width) * Number(i.height) > 16_000_000
    )
      return unavailable;
    image = {
      dataUrl: new TextDecoder().decode(new TextEncoder().encode(i.dataUrl)),
      width: Number(i.width),
      height: Number(i.height),
    };
  }
  if (v.title === null && v.description === null && image === null)
    return unavailable;
  return {
    status: "ready",
    title: v.title === null ? null : Array.from(v.title as string).join(""),
    description:
      v.description === null
        ? null
        : Array.from(v.description as string).join(""),
    image,
  };
}
