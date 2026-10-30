import type { ImageGenerationItem } from "@session/bindings/ImageGenerationItem";

export type NativeImageLimit = {
  type: "usageLimitExceeded";
  limitId: "image_gen";
  resetsAt: number | null;
};

/** Optional native metadata is not yet present in the generated item binding. */
export function nativeImageLimit(
  item: ImageGenerationItem,
): NativeImageLimit | null {
  const failure = (item as ImageGenerationItem & { failure?: unknown }).failure;
  if (!failure || typeof failure !== "object" || Array.isArray(failure))
    return null;
  const value = failure as Record<string, unknown>;
  if (
    value.type !== "usageLimitExceeded" ||
    value.limitId !== "image_gen" ||
    (value.resetsAt !== null &&
      (typeof value.resetsAt !== "number" || !Number.isFinite(value.resetsAt)))
  )
    return null;
  return {
    type: "usageLimitExceeded",
    limitId: "image_gen",
    resetsAt: value.resetsAt as number | null,
  };
}

export function nativeImageResetDate(
  seconds: number | null,
  locale: string,
): string | null {
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const now = new Date();
    return now.getFullYear() === date.getFullYear() &&
      now.getMonth() === date.getMonth() &&
      now.getDate() === date.getDate()
      ? date.toLocaleTimeString(locale, { timeStyle: "short" })
      : date.toLocaleString(locale, {
          timeStyle: "short",
          dateStyle: "medium",
        });
  } catch {
    return null;
  }
}
