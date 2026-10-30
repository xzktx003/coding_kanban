import { safeInlineRasterImage } from "./raster-image-header.js";
import { projectClaudeImageContent } from "./auxiliary-inline-images.js";
/** Browser-facing tool previews for Claude and ACP. Permissions and ordinary
 * conversation content retain their original protocol identity and sequence. */
export const AUXILIARY_TOOL_PREVIEW_BYTES = 64 * 1024;
type ObjectValue = Record<string, unknown>;
const record = (value: unknown): value is ObjectValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
function textPrefix(
  text: string,
  maxBytes: number,
): { value: string; size: number } {
  let end = 0,
    size = 2;
  for (const point of text) {
    const code = point.codePointAt(0)!;
    const length =
      code === 34 || code === 92
        ? 2
        : code < 32
          ? [8, 9, 10, 12, 13].includes(code)
            ? 2
            : 6
          : code < 128
            ? 1
            : code < 2048
              ? 2
              : code >= 0xd800 && code <= 0xdfff
                ? 6
                : code < 65536
                  ? 3
                  : 4;
    if (size + length > maxBytes) break;
    size += length;
    end += point.length;
  }
  // Detach a preview from a potentially much larger protocol string.
  return { value: Array.from(text.slice(0, end)).join(""), size };
}
export function boundedAuxiliaryToolPreview(
  value: unknown,
  maxBytes = AUXILIARY_TOOL_PREVIEW_BYTES,
): { value: unknown; truncated: boolean } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4)
    throw new RangeError("Tool preview budget must contain at least JSON null");
  let entries = 0,
    truncated = false;
  const visit = (
    item: unknown,
    depth: number,
    available: number,
  ): { value: unknown; size: number } => {
    if (++entries > 512 || depth > 12) {
      truncated = true;
      return { value: null, size: 4 };
    }
    if (typeof item === "string") {
      const prefix = textPrefix(item, available);
      truncated ||= prefix.value.length !== item.length;
      return prefix;
    }
    if (!item || typeof item !== "object") {
      const serialized =
        typeof item === "number" || typeof item === "boolean" || item === null
          ? JSON.stringify(item)
          : undefined;
      if (serialized === undefined || bytes(serialized) > available) {
        truncated = true;
        return { value: null, size: 4 };
      }
      return { value: item, size: bytes(serialized) };
    }
    let size = 2;
    if (Array.isArray(item)) {
      const output: unknown[] = [];
      for (const child of item) {
        const separator = output.length ? 1 : 0;
        if (available - size - separator < 4 || entries >= 512) {
          truncated = true;
          break;
        }
        const next = visit(child, depth + 1, available - size - separator);
        output.push(next.value);
        size += separator + next.size;
      }
      return { value: output, size };
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      truncated = true;
      return { value: null, size: 4 };
    }
    const output: ObjectValue = Object.create(null);
    let count = 0;
    for (const key in item) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
      if (++entries > 512) {
        truncated = true;
        break;
      }
      const separator = count ? 1 : 0;
      const keySize =
        key.length <= 1024 ? bytes(JSON.stringify(key)) + 1 : Infinity;
      if (keySize + separator + 4 > available - size) {
        truncated = true;
        continue;
      }
      const next = visit(
        (item as ObjectValue)[key],
        depth + 1,
        available - size - keySize - separator,
      );
      output[key] = next.value;
      size += separator + keySize + next.size;
      count++;
    }
    return { value: output, size };
  };
  const projected = visit(value, 0, maxBytes);
  return { value: truncated ? projected.value : value, truncated };
}
function projectAcp(payload: ObjectValue): ObjectValue {
  if (payload.kind !== "update" || !record(payload.update)) return payload;
  const update = payload.update;
  if (
    update.sessionUpdate === "user_message_chunk" &&
    record(update.content) &&
    update.content.type === "image"
  ) {
    const image = update.content;
    if (safeInlineRasterImage(image.mimeType, image.data)) return payload;
    const hasSource =
      Number.isSafeInteger(payload.historySourceId) &&
      Number(payload.historySourceId) > 0;
    return {
      ...payload,
      update: {
        ...update,
        content: { type: "text", text: "[图片附件，完整内容可按需读取]" },
        truncated: true,
        ...(hasSource
          ? { historyDetail: { itemId: `source-${payload.historySourceId}` } }
          : {}),
        ...(hasSource &&
        ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
          String(image.mimeType),
        )
          ? { historyImages: [{ index: 0, mimeType: image.mimeType }] }
          : {}),
      },
    };
  }
  if (
    update.sessionUpdate !== "tool_call" &&
    update.sessionUpdate !== "tool_call_update"
  )
    return payload;
  let changed = false;
  const next = { ...update };
  for (const key of [
    "rawInput",
    "rawOutput",
    "content",
    "locations",
    "title",
    "kind",
    "status",
  ]) {
    if (update[key] === undefined) continue;
    const preview = boundedAuxiliaryToolPreview(
      update[key],
      ["title", "kind", "status"].includes(key)
        ? 4096
        : AUXILIARY_TOOL_PREVIEW_BYTES,
    );
    if (preview.truncated) {
      next[key] = preview.value;
      changed = true;
    }
  }
  if (!changed) return payload;
  next.truncated = true;
  if (
    typeof update.toolCallId === "string" &&
    update.toolCallId.length <= 480 &&
    !/[\x00-\x1f]/.test(update.toolCallId)
  )
    next.historyDetail = { itemId: `tool:${update.toolCallId}` };
  return { ...payload, update: next };
}
function ccContent(value: unknown): {
  value: unknown;
  changed: boolean;
  images?: { index: number; mimeType: string }[];
} {
  if (!Array.isArray(value)) return { value, changed: false };
  const images = projectClaudeImageContent(value);
  let changed = images.truncated;
  const next = (images.content as unknown[]).map((block) => {
    if (!record(block)) return block;
    const key =
      block.type === "tool_use"
        ? "input"
        : block.type === "tool_result"
          ? "content"
          : null;
    if (!key || block[key] === undefined) return block;
    const preview = boundedAuxiliaryToolPreview(block[key]);
    if (!preview.truncated) return block;
    changed = true;
    return { ...block, [key]: preview.value, truncated: true };
  });
  return {
    value: changed ? next : value,
    changed,
    images: images.historyImages,
  };
}
function projectCc(payload: ObjectValue): ObjectValue {
  let changed = false,
    next = payload;
  const content = ccContent(payload.content);
  if (content.changed) {
    next = {
      ...next,
      content: content.value,
      ...(content.images?.length ? { historyImages: content.images } : {}),
    };
    changed = true;
  }
  if (record(payload.message)) {
    const inner = ccContent(payload.message.content);
    if (inner.changed) {
      next = {
        ...next,
        message: { ...payload.message, content: inner.value },
        ...(inner.images?.length ? { historyImages: inner.images } : {}),
      };
      changed = true;
    }
  }
  if (payload.type === "stream_event" && record(payload.event)) {
    const event = payload.event;
    if (
      record(event.delta) &&
      event.delta.type === "input_json_delta" &&
      typeof event.delta.partial_json === "string" &&
      bytes(event.delta.partial_json) > AUXILIARY_TOOL_PREVIEW_BYTES
    ) {
      next = {
        ...next,
        event: { ...event, delta: { ...event.delta, partial_json: "" } },
      };
      changed = true;
    } else if (record(event.content_block)) {
      const block = ccContent([event.content_block]);
      if (block.changed) {
        next = {
          ...next,
          event: { ...event, content_block: (block.value as unknown[])[0] },
        };
        changed = true;
      }
    }
  }
  if (!changed) return payload;
  next = { ...next, truncated: true };
  if (typeof payload.uuid === "string" && payload.uuid.length <= 512)
    next.historyDetail = { itemId: payload.uuid };
  return next;
}
export function projectAuxiliaryChatEnvelope(value: unknown): unknown {
  if (!record(value) || !record(value.payload)) return value;
  const payload =
    value.event === "acp-message"
      ? projectAcp(value.payload)
      : value.event === "cc-message"
        ? projectCc(value.payload)
        : value.payload;
  return payload === value.payload ? value : { ...value, payload };
}
