import { createHash } from "node:crypto";
import { projectClaudeImageContent } from "@agent-orchestrator/shared";
import { HttpError } from "../core/json.js";
import {
  historyBefore,
  historyCursor,
  historyTextParts,
  RECENT_HISTORY_DATA_BYTES,
  type RecentHistoryOptions,
  type RecentHistoryPage,
} from "../core/recent-history.js";

export function ccMessageIdentity(
  value: Record<string, unknown>,
  index: number,
): string {
  return typeof value.uuid === "string" && value.uuid.length <= 512
    ? value.uuid
    : `sdk-${index}-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}
export function ccMessageImageSources(
  row: Record<string, any>,
): { mimeType: unknown; data: unknown }[] {
  const content = row.message?.content ?? row.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block?.type === "image")
    .map((block) => ({
      mimeType: block.source?.media_type,
      data: block.source?.type === "base64" ? block.source.data : undefined,
    }));
}
function preview(value: unknown, depth = 0): unknown {
  if (typeof value === "string")
    return historyTextParts(value, 32 * 1024).next().value;
  if (!value || typeof value !== "object") return value;
  if (depth > 12) return "[完整内容可按需读取]";
  if (Array.isArray(value))
    return value.slice(0, 64).map((item) => preview(item, depth + 1));
  const original = value as Record<string, unknown>;
  // A shortened base64 field is not a valid image/document. Preserve its type as
  // an explicit text attachment preview instead of sending corrupt source data.
  if (
    (original.type === "base64" ||
      original.type === "image" ||
      original.type === "document") &&
    (typeof original.data === "string" || original.source)
  )
    return { type: "text", text: "[附件完整内容可按需读取]" };
  return Object.fromEntries(
    Object.entries(original)
      .slice(0, 64)
      .map(([key, item]) => [key, preview(item, depth + 1)]),
  );
}
export function ccRecentPage(
  sessionId: string,
  values: unknown,
  revision: string,
  options: RecentHistoryOptions = {},
): RecentHistoryPage<Record<string, unknown>> {
  if (!Array.isArray(values))
    throw new HttpError(502, "Claude history did not return a message array");
  const before = historyBefore("cc", sessionId, options.cursor);
  let end = values.length;
  if (before) {
    end = values.findIndex(
      (row, index) =>
        row &&
        typeof row === "object" &&
        ccMessageIdentity(row, index) === before,
    );
    if (end < 0)
      throw new HttpError(
        409,
        "History cursor expired; reload the recent page",
      );
  }
  const data: Record<string, unknown>[] = [];
  let bytes = 0,
    truncated = false,
    index = end - 1;
  for (; index >= 0; index--) {
    const original = values[index];
    if (!original || typeof original !== "object" || Array.isArray(original))
      throw new HttpError(502, "Claude history contains an invalid message");
    const itemId = ccMessageIdentity(original, index);
    let row = original as Record<string, unknown>;
    const images = projectClaudeImageContent(
      original.message?.content ?? original.content,
    );
    if (images.truncated) {
      row = {
        ...row,
        ...(original.message
          ? { message: { ...original.message, content: images.content } }
          : { content: images.content }),
        historyDetail: { itemId },
        truncated: true,
        ...(images.historyImages.length
          ? { historyImages: images.historyImages }
          : {}),
      };
    }
    let raw = JSON.stringify(row);
    if (Buffer.byteLength(raw) > 128 * 1024) {
      row = {
        ...(preview(row) as Record<string, unknown>),
        uuid: itemId,
        historyDetail: { itemId },
        truncated: true,
      };
      raw = JSON.stringify(row);
      if (Buffer.byteLength(raw) > 128 * 1024) {
        row = {
          type: original.type,
          uuid: itemId,
          session_id: sessionId,
          parent_tool_use_id: original.parent_tool_use_id ?? null,
          message: {
            role:
              original.message?.role ??
              (original.type === "user" ? "user" : "assistant"),
            content: [
              {
                type: "text",
                text: "[此消息超出最近页的预览预算，完整内容可按需读取]",
              },
            ],
          },
          historyDetail: { itemId },
          truncated: true,
        };
        raw = JSON.stringify(row);
      }
      const historyImages = ccMessageImageSources(original)
        .slice(0, 32)
        .flatMap((image, index) =>
          typeof image.data === "string" &&
          ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
            String(image.mimeType),
          )
            ? [{ index, mimeType: image.mimeType }]
            : [],
        );
      if (historyImages.length) {
        row.historyImages = historyImages;
        raw = JSON.stringify(row);
      }
    }
    const size = Buffer.byteLength(raw) + 1;
    if (
      data.length >= (options.limit ?? 80) ||
      bytes + size > RECENT_HISTORY_DATA_BYTES
    )
      break;
    data.push({ ...row, uuid: itemId });
    bytes += size;
    truncated ||= row.truncated === true;
  }
  data.reverse();
  return {
    data,
    nextCursor:
      index >= 0 && data.length
        ? historyCursor("cc", sessionId, String(data[0]!.uuid))
        : null,
    revision,
    truncated,
    projection: "cc-messages",
  };
}
