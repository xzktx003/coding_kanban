import { hash } from "fast-sha256";
import type { AcpEntry } from "../stores/useAcpStore";
import { copyTranscriptText } from "./codexTranscriptMemoryBudget";

const utf8 = new TextEncoder();
const TEXT_PART_BYTES = 64 * 1024;
function* textParts(text: string) {
  let start = 0,
    index = 0,
    bytes = 0;
  for (const point of text) {
    const code = point.charCodeAt(0);
    const width =
      point.length === 2 ? 4 : code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    if (bytes + width > TEXT_PART_BYTES && index > start) {
      yield copyTranscriptText(text.slice(start, index));
      start = index;
      bytes = 0;
    }
    bytes += width;
    index += point.length;
  }
  if (index > start || !text) yield copyTranscriptText(text.slice(start));
}
export const acpToolEntryId = (toolCallId: string) =>
  `acp-tool-${Array.from(hash(utf8.encode(toolCallId)), (v) =>
    v.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 24)}`;

/** Mirrors the application's persistent projection, never native ACP metadata. */
export function foldPersistentAcpUpdate(
  entries: AcpEntry[],
  update: Record<string, any>,
  sourceId: number,
  sealed = false,
): AcpEntry[] {
  if (!Number.isSafeInteger(sourceId) || sourceId < 1) return entries;
  const type = update.sessionUpdate;
  const role =
    type === "agent_message_chunk"
      ? "agent"
      : type === "agent_thought_chunk"
        ? "thought"
        : type === "user_message_chunk"
          ? "user"
          : null;
  if (
    role &&
    update.content?.type === "text" &&
    typeof update.content.text === "string"
  ) {
    const next = [...entries];
    let part = 0;
    for (const text of textParts(update.content.text)) {
      const last = next[next.length - 1];
      if (
        role !== "user" &&
        !sealed &&
        last?.role === role &&
        (last.historySourceId ?? 0) < sourceId &&
        utf8.encode(last.text + text).length <= TEXT_PART_BYTES
      ) {
        next[next.length - 1] = {
          ...last,
          text: last.text + text,
          historySourceId: sourceId,
        };
        part++;
      } else {
        next.push({
          id: `acp-${sourceId}-${part++}`,
          role,
          text,
          historySourceId: sourceId,
          ...(update.truncated === true
            ? {
                truncated: true,
                historyDetail: update.historyDetail,
                historyImages: update.historyImages,
              }
            : {}),
          ...(role === "user" && typeof update.clientMessageId === "string"
            ? {
                clientMessageId: update.clientMessageId,
                partIndex: update.partIndex,
              }
            : {}),
        });
      }
      sealed = false;
    }
    return next;
  }
  if (role === "user" && update.content?.type === "image") {
    const image = update.content;
    const item: AcpEntry = {
      id: `acp-${sourceId}-0`,
      role: "user",
      text: "",
      historySourceId: sourceId,
      ...(typeof update.clientMessageId === "string"
        ? {
            clientMessageId: update.clientMessageId,
            partIndex: update.partIndex,
          }
        : {}),
    };
    if (
      ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        image.mimeType,
      ) &&
      typeof image.data === "string" &&
      image.data.length < 128 * 1024
    )
      item.images = [`data:${image.mimeType};base64,${image.data}`];
    else
      Object.assign(item, {
        text: "[图片附件，完整内容可按需读取]",
        truncated: true,
        historyDetail: { itemId: `source-${sourceId}` },
      });
    return [...entries, item];
  }
  if (
    (type === "tool_call" || type === "tool_call_update") &&
    typeof update.toolCallId === "string"
  ) {
    const index = entries.findIndex(
      (row) => row.role === "tool" && row.toolCallId === update.toolCallId,
    );
    const previous = index >= 0 ? entries[index] : undefined;
    if (previous && (previous.historySourceId ?? 0) >= sourceId) return entries;
    const item: AcpEntry = previous
      ? { ...previous, historySourceId: sourceId }
      : {
          id: acpToolEntryId(update.toolCallId),
          role: "tool",
          toolCallId: update.toolCallId,
          title: "工具调用",
          status: "pending",
          historySourceId: sourceId,
        };
    for (const key of [
      "title",
      "status",
      "kind",
      "content",
      "locations",
      "rawInput",
      "rawOutput",
      "truncated",
      "historyDetail",
      "historyImages",
    ])
      if (update[key] !== undefined)
        (item as unknown as Record<string, unknown>)[key] = update[key];
    if (index < 0) return [...entries, item];
    const next = [...entries];
    next[index] = item;
    return next;
  }
  return entries;
}

export function acknowledgeAcpPrompt(
  entries: AcpEntry[],
  clientMessageId: string,
  sourceRows: Array<{ historySourceId: number; partIndex: number }>,
): AcpEntry[] {
  const optimistic = entries.find(
    (row) =>
      row.role === "user" &&
      row.clientMessageId === clientMessageId &&
      row.historySourceId === undefined,
  );
  if (!optimistic || optimistic.role !== "user") return entries;
  const parts = sourceRows.filter(
    (row) =>
      Number.isSafeInteger(row.historySourceId) &&
      row.historySourceId > 0 &&
      Number.isSafeInteger(row.partIndex) &&
      row.partIndex >= 0,
  );
  if (
    !parts.length ||
    new Set(parts.map((row) => row.partIndex)).size !== parts.length
  )
    return entries;
  const persisted: AcpEntry[] = parts.map((row) => ({
    id: `acp-${row.historySourceId}-0`,
    role: "user",
    text: row.partIndex === 0 ? optimistic.text : "",
    ...(row.partIndex > 0 && optimistic.images?.[row.partIndex - 1]
      ? { images: [optimistic.images[row.partIndex - 1]] }
      : {}),
    clientMessageId,
    partIndex: row.partIndex,
    historySourceId: row.historySourceId,
  }));
  return entries.flatMap((row) => (row === optimistic ? persisted : [row]));
}

/** Source-watermark merge: a read cannot overwrite bytes received after its snapshot. */
export function mergeAcpTranscriptPage(
  current: AcpEntry[],
  incoming: AcpEntry[],
  boundary: number,
  earlier: boolean,
): AcpEntry[] {
  const byId = new Map(current.map((row) => [row.id, row]));
  const source = incoming.map((row) => {
    const live = byId.get(row.id);
    return live &&
      (live.historySourceId ?? 0) > (row.historySourceId ?? boundary)
      ? live
      : row;
  });
  const ids = new Set(source.map((row) => row.id));
  const clientParts = new Set(
    source
      .filter((row) => row.clientMessageId)
      .map((row) => `${row.clientMessageId}:${row.partIndex ?? 0}`),
  );
  const absent = current.filter(
    (row) =>
      !ids.has(row.id) &&
      !(
        row.clientMessageId &&
        clientParts.has(`${row.clientMessageId}:${row.partIndex ?? 0}`)
      ),
  );
  if (earlier) return [...source, ...absent];
  const oldest = incoming.reduce(
    (value, row) => Math.min(value, row.historySourceId ?? Infinity),
    Infinity,
  );
  const older = absent.filter(
    (row) => row.historySourceId !== undefined && row.historySourceId < oldest,
  );
  const live = absent.filter(
    (row) =>
      row.role === "error" ||
      (row.historySourceId ?? 0) > boundary ||
      (row.clientMessageId !== undefined && row.historySourceId === undefined),
  );
  return [...older, ...source, ...live];
}
