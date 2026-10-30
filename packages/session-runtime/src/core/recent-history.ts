import { HttpError } from "./json.js";
import { createHash } from "node:crypto";

export const RECENT_HISTORY_PAGE_BYTES = 2 * 1024 * 1024;
export const RECENT_HISTORY_DATA_BYTES = RECENT_HISTORY_PAGE_BYTES - 160 * 1024;
export const RECENT_HISTORY_TEXT_BYTES = 64 * 1024;
export interface RecentHistoryOptions {
  cursor?: string;
  limit?: number;
  metadataOnly?: boolean;
}
export interface RecentHistoryPage<T> {
  data: T[];
  nextCursor: string | null;
  revision: string;
  truncated: boolean;
  projection: "cc-messages" | "acp-entries";
  metadata?: Record<string, unknown>;
}
export function historySessionIdentity(
  value: unknown,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 512 ||
    /[\x00-\x1f]/.test(value)
  )
    throw new HttpError(400, "Invalid history session identity");
}
export function recentHistoryOptions(
  value: Record<string, unknown>,
): RecentHistoryOptions {
  if (
    value.cursor !== undefined &&
    (typeof value.cursor !== "string" || value.cursor.length > 2048)
  )
    throw new HttpError(400, "Invalid history cursor");
  if (
    value.limit !== undefined &&
    (!Number.isSafeInteger(value.limit) ||
      Number(value.limit) < 1 ||
      Number(value.limit) > 256)
  )
    throw new HttpError(400, "Invalid history page limit");
  if (
    value.metadataOnly !== undefined &&
    typeof value.metadataOnly !== "boolean"
  )
    throw new HttpError(400, "Invalid history metadataOnly");
  return value as RecentHistoryOptions;
}
export function historyCursor(
  kind: string,
  session: string,
  before: string,
): string {
  return Buffer.from(JSON.stringify([1, kind, session, before])).toString(
    "base64url",
  );
}
export function historyBefore(
  kind: string,
  session: string,
  cursor?: string,
): string | null {
  if (cursor === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw new Error();
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 4 ||
      parsed[0] !== 1 ||
      parsed[1] !== kind ||
      parsed[2] !== session ||
      typeof parsed[3] !== "string" ||
      !parsed[3]
    )
      throw new Error();
    return parsed[3];
  } catch {
    throw new HttpError(400, "History cursor does not belong to this session");
  }
}
/** Split by Unicode code point, never producing malformed UTF-8 at a page seam. */
export function* historyTextParts(
  text: string,
  maxBytes = RECENT_HISTORY_TEXT_BYTES,
): Generator<string> {
  let start = 0,
    bytes = 0,
    index = 0;
  for (const point of text) {
    const width = Buffer.byteLength(point);
    if (bytes + width > maxBytes && index > start) {
      yield text.slice(start, index);
      start = index;
      bytes = 0;
    }
    bytes += width;
    index += point.length;
  }
  if (index > start || !text) yield text.slice(start);
}
export function historyDetailOptions(value: Record<string, unknown>): {
  itemId: string;
  offset: number;
  limit: number;
} {
  if (
    typeof value.item_id !== "string" ||
    !value.item_id ||
    value.item_id.length > 512 ||
    value.item_id.includes("\0")
  )
    throw new HttpError(400, "Invalid history item identity");
  const offset = value.offset ?? 0,
    limit = value.limit ?? RECENT_HISTORY_TEXT_BYTES;
  if (
    !Number.isSafeInteger(offset) ||
    Number(offset) < 0 ||
    !Number.isSafeInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > RECENT_HISTORY_TEXT_BYTES
  )
    throw new HttpError(400, "Invalid history detail range");
  return {
    itemId: value.item_id,
    offset: Number(offset),
    limit: Number(limit),
  };
}
export function historyDetailText(
  value: unknown,
  options: { offset: number; limit: number },
) {
  const text = JSON.stringify(value, null, 2);
  if (text === undefined)
    throw new HttpError(404, "History item is unavailable");
  if (Buffer.byteLength(text) > 64 * 1024 * 1024)
    throw new HttpError(413, "History item exceeds the bounded detail budget");
  // Offsets are UTF-16 positions into the immutable JSON representation. Avoid
  // splitting a surrogate pair and keep the actual wire chunk below 64 KiB.
  if (options.offset > text.length)
    throw new HttpError(400, "History detail offset is outside this item");
  if (
    options.offset > 0 &&
    /[\uDC00-\uDFFF]/.test(text[options.offset] ?? "") &&
    /[\uD800-\uDBFF]/.test(text[options.offset - 1] ?? "")
  )
    throw new HttpError(
      400,
      "History detail offset splits a Unicode code point",
    );
  // Count the fragment's actual JSON wire representation, reserving space for
  // both reader revisions and the envelope. Ordinary ASCII can use nearly the
  // whole page while control characters and Unicode still stay bounded.
  const budget=Math.min(options.limit,64*1024-1024);
  let end=options.offset,size=0;
  for(const point of text.slice(options.offset)){
    const code=point.codePointAt(0)!;
    const cost=code===34||code===92?2:code<32?[8,9,10,12,13].includes(code)?2:6:
      code<128?1:code<2048?2:code>=0xd800&&code<=0xdfff?6:code<=65535?3:4;
    if(size+cost>budget)break;
    size+=cost;end+=point.length;
  }
  if(end===options.offset&&end<text.length)throw new HttpError(400,"History detail limit cannot contain the next Unicode code point");
  const fragment = text.slice(options.offset, end);
  return {
    text: fragment,
    nextOffset: end < text.length ? end : null,
    format: "json" as const,
    itemRevision: createHash("sha256").update(text).digest("hex"),
  };
}
