import { copyTranscriptText } from "@session/services/codexTranscriptMemoryBudget";

/** Preview only: bound traversal before serialization, then detach the result. */
export function sourcePreview(value: unknown, limit = 2048): string {
  let remaining = Math.max(32, Math.min(limit, 8192));
  const seen = new WeakSet<object>();
  const visit = (entry: unknown, depth: number): unknown => {
    if (remaining <= 0) return "…";
    if (typeof entry === "string") {
      const text = entry.slice(0, remaining);
      remaining -= text.length;
      return text.length < entry.length ? text + "…" : text;
    }
    if (entry === null || typeof entry !== "object") {
      remaining -= 8;
      return entry;
    }
    if (depth > 4 || seen.has(entry)) return "…";
    seen.add(entry);
    if (Array.isArray(entry)) {
      const result: unknown[] = [];
      for (let i = 0; i < Math.min(16, entry.length) && remaining > 0; i++)
        result.push(visit(entry[i], depth + 1));
      if (result.length < entry.length) result.push("…");
      return result;
    }
    const result: Record<string, unknown> = {};
    let count = 0;
    for (const key in entry) {
      if (!Object.prototype.hasOwnProperty.call(entry, key)) continue;
      if (count++ >= 16 || remaining <= 0) {
        result["…"] = "…";
        break;
      }
      const safeKey = key.slice(0, 128);
      remaining -= safeKey.length;
      Object.defineProperty(result, safeKey, {
        value: visit((entry as Record<string, unknown>)[key], depth + 1),
        enumerable: true,
      });
    }
    return result;
  };
  const result =
    JSON.stringify(
      visit(value, 0),
      (_, item) => (typeof item === "bigint" ? String(item) : item),
      2,
    ) ?? "";
  return copyTranscriptText(
    result.length > limit ? result.slice(0, limit) + "…" : result,
  );
}
