import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import {
  boundedAuxiliaryToolPreview,
  safeInlineRasterImage,
} from "@agent-orchestrator/shared";
import type Database from "better-sqlite3";
import { HttpError } from "../core/json.js";
import { historyImage } from "../core/history-image.js";
import {
  historyBefore,
  historyCursor,
  historyDetailText,
  historyTextParts,
  RECENT_HISTORY_DATA_BYTES,
  RECENT_HISTORY_TEXT_BYTES,
  type RecentHistoryOptions,
  type RecentHistoryPage,
} from "../core/recent-history.js";

export interface AcpProjectedEntry extends Record<string, unknown> {
  id: string;
  role: "user" | "agent" | "thought" | "tool" | "error";
  text?: string;
}
interface State {
  last_update: number;
  chunk_id: string | null;
  chunk_role: string | null;
  metadata: string;
}
interface Row {
  entry_id: string;
  sort_key: number;
  part: number;
  payload: string;
}
const syncing = new WeakMap<Database.Database, Map<string, Promise<void>>>();
function tables(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS acp_chat_projection_v1(session_id TEXT NOT NULL,entry_id TEXT NOT NULL,sort_key INTEGER NOT NULL,part INTEGER NOT NULL,payload TEXT NOT NULL,tool_id TEXT,PRIMARY KEY(session_id,entry_id));
    CREATE INDEX IF NOT EXISTS idx_acp_chat_projection_v1_order ON acp_chat_projection_v1(session_id,sort_key,part);
    CREATE INDEX IF NOT EXISTS idx_acp_chat_projection_v1_tool ON acp_chat_projection_v1(session_id,tool_id);
    CREATE TABLE IF NOT EXISTS acp_chat_projection_state_v1(session_id TEXT PRIMARY KEY,last_update INTEGER NOT NULL,chunk_id TEXT,chunk_role TEXT,metadata TEXT NOT NULL);`);
}
export function acpHistoryRevision(
  db: Database.Database,
  sessionId: string,
  through?: number,
): string {
  const row = db
    .prepare(
      "SELECT count(*) AS n,coalesce(max(id),0) AS last FROM acp_session_updates WHERE session_id=? AND id<=?",
    )
    .get(sessionId, through ?? Number.MAX_SAFE_INTEGER) as {
    n: number;
    last: number;
  };
  return `${row.n}:${row.last}`;
}
function clip(
  value: unknown,
  maxBytes = RECENT_HISTORY_TEXT_BYTES,
): { value: unknown; truncated: boolean } {
  // Share the live transport's exact JSON byte budget and nesting/entry bounds.
  // The complete original remains available through the readonly detail reader.
  return boundedAuxiliaryToolPreview(value, maxBytes);
}
async function sync(
  db: Database.Database,
  sessionId: string,
  sourceDb: Database.Database = db,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  tables(db);
  let map = syncing.get(db);
  if (!map) syncing.set(db, (map = new Map()));
  const pending = map.get(sessionId);
  if (pending) return pending;
  const work = (async () => {
    const boundary = (
      sourceDb
        .prepare(
          "SELECT coalesce(max(id),0) AS id FROM acp_session_updates WHERE session_id=?",
        )
        .get(sessionId) as { id: number }
    ).id;
    let state = db
      .prepare("SELECT * FROM acp_chat_projection_state_v1 WHERE session_id=?")
      .get(sessionId) as State | undefined;
    state ??= {
      last_update: 0,
      chunk_id: null,
      chunk_role: null,
      metadata: "{}",
    };
    let metadata = JSON.parse(state.metadata) as Record<string, unknown>;
    const insert = db.prepare(
      "INSERT INTO acp_chat_projection_v1(session_id,entry_id,sort_key,part,payload,tool_id) VALUES(?,?,?,?,?,?) ON CONFLICT(session_id,entry_id) DO UPDATE SET payload=excluded.payload",
    );
    const put = (
      entry: AcpProjectedEntry,
      rowId: number,
      part = 0,
      toolId: string | null = null,
      lastSourceId = rowId,
    ) => {
      entry.historySourceId = lastSourceId;
      return insert.run(
        sessionId,
        entry.id,
        rowId,
        part,
        JSON.stringify(entry),
        toolId,
      );
    };
    while (state.last_update < boundary) {
      signal?.throwIfAborted();
      db.transaction(() => {
        // better-sqlite3 forbids writes while an iterator is open. Keep only a
        // small row-ID batch, then decode one bounded original payload at a time.
        const ids = sourceDb
          .prepare(
            "SELECT id,length(CAST(payload AS BLOB)) AS bytes FROM acp_session_updates WHERE session_id=? AND id>? AND id<=? ORDER BY id ASC LIMIT 128",
          )
          .all(sessionId, state!.last_update, boundary) as {
          id: number;
          bytes: number;
        }[];
        let progressed = false;
        for (const sourceId of ids) {
          signal?.throwIfAborted();
          if (sourceId.bytes > 64 * 1024 * 1024)
            throw new HttpError(
              413,
              "ACP history update exceeds the bounded source budget",
            );
          const source = sourceDb
            .prepare(
              "SELECT id,payload FROM acp_session_updates WHERE session_id=? AND id=?",
            )
            .get(sessionId, sourceId.id) as { id: number; payload: string };
          progressed = true;
          const update = JSON.parse(source.payload) as Record<string, any>;
          state!.last_update = source.id;
          if (!update || typeof update !== "object" || Array.isArray(update))
            continue;
          const type = update.sessionUpdate;
          if (
            type === "config_option_update" ||
            type === "current_mode_update"
          ) {
            const value =
              type === "config_option_update"
                ? { configOptions: update.configOptions ?? [] }
                : { currentModeId: update.currentModeId };
            if (Buffer.byteLength(JSON.stringify(value)) > 128 * 1024)
              throw new HttpError(
                413,
                "ACP history settings exceed the metadata budget",
              );
            metadata = { ...metadata, ...value };
            continue;
          }
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
            let part = 0;
            for (const text of historyTextParts(update.content.text)) {
              const old =
                role !== "user" && state!.chunk_role === role && state!.chunk_id
                  ? (db
                      .prepare(
                        "SELECT payload FROM acp_chat_projection_v1 WHERE session_id=? AND entry_id=?",
                      )
                      .get(sessionId, state!.chunk_id) as
                      | { payload: string }
                      | undefined)
                  : undefined;
              const entry =
                old &&
                (JSON.parse(old.payload) as AcpProjectedEntry | undefined);
              if (
                entry &&
                Buffer.byteLength((entry.text ?? "") + text) <=
                  RECENT_HISTORY_TEXT_BYTES
              ) {
                entry.text = (entry.text ?? "") + text;
                put(entry, source.id, part++);
              } else {
                const id = `acp-${source.id}-${part}`;
                put(
                  {
                    id,
                    role,
                    text,
                    ...(role === "user" &&
                    typeof update.clientMessageId === "string"
                      ? {
                          clientMessageId: update.clientMessageId,
                          partIndex: update.partIndex ?? 0,
                        }
                      : {}),
                  },
                  source.id,
                  part++,
                );
                state!.chunk_id = id;
                state!.chunk_role = role;
              }
            }
          } else if (role === "user" && update.content?.type === "image") {
            const image = update.content;
            const entry: AcpProjectedEntry = {
              id: `acp-${source.id}-0`,
              role: "user",
              text: "",
              ...(typeof update.clientMessageId === "string"
                ? {
                    clientMessageId: update.clientMessageId,
                    partIndex: update.partIndex ?? 0,
                  }
                : {}),
            };
            if (safeInlineRasterImage(image.mimeType, image.data))
              entry.images = [`data:${image.mimeType};base64,${image.data}`];
            else
              Object.assign(entry, {
                text: "[图片附件，完整内容可按需读取]",
                truncated: true,
                historyDetail: { itemId: `source-${source.id}` },
                ...([
                  "image/png",
                  "image/jpeg",
                  "image/gif",
                  "image/webp",
                ].includes(image.mimeType)
                  ? { historyImages: [{ index: 0, mimeType: image.mimeType }] }
                  : {}),
              });
            put(entry, source.id);
            state!.chunk_id = null;
            state!.chunk_role = null;
          } else if (
            (type === "tool_call" || type === "tool_call_update") &&
            typeof update.toolCallId === "string"
          ) {
            const old = db
              .prepare(
                "SELECT payload,sort_key,part FROM acp_chat_projection_v1 WHERE session_id=? AND tool_id=?",
              )
              .get(sessionId, update.toolCallId) as
              | { payload: string; sort_key: number; part: number }
              | undefined;
            const entry: AcpProjectedEntry = old
              ? JSON.parse(old.payload)
              : {
                  id: `acp-tool-${createHash("sha256").update(update.toolCallId).digest("hex").slice(0, 24)}`,
                  role: "tool",
                  toolCallId: update.toolCallId,
                  title: "工具调用",
                  status: "pending",
                };
            for (const key of [
              "title",
              "status",
              "kind",
              "content",
              "locations",
              "rawInput",
              "rawOutput",
            ])
              if (update[key] !== undefined) {
                const reduced = clip(update[key]);
                entry[key] = reduced.value;
                if (reduced.truncated) {
                  entry.truncated = true;
                  entry.historyDetail = { itemId: entry.id };
                }
              }
            put(
              entry,
              old?.sort_key ?? source.id,
              old?.part ?? 0,
              update.toolCallId,
              source.id,
            );
            state!.chunk_id = null;
            state!.chunk_role = null;
          }
        }
        if (!progressed) state!.last_update = boundary;
        state!.metadata = JSON.stringify(metadata);
        db.prepare(
          "INSERT INTO acp_chat_projection_state_v1(session_id,last_update,chunk_id,chunk_role,metadata) VALUES(?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET last_update=excluded.last_update,chunk_id=excluded.chunk_id,chunk_role=excluded.chunk_role,metadata=excluded.metadata",
        ).run(
          sessionId,
          state!.last_update,
          state!.chunk_id,
          state!.chunk_role,
          state!.metadata,
        );
      })();
      await setImmediate();
    }
  })();
  map.set(sessionId, work);
  try {
    await work;
  } finally {
    if (map.get(sessionId) === work) map.delete(sessionId);
  }
}
export async function acpRecentHistory(
  db: Database.Database,
  sessionId: string,
  options: RecentHistoryOptions = {},
  sourceDb: Database.Database = db,
  signal?: AbortSignal,
): Promise<RecentHistoryPage<AcpProjectedEntry>> {
  signal?.throwIfAborted();
  const before = historyBefore("acp", sessionId, options.cursor);
  if (options.metadataOnly)
    return {
      data: [],
      nextCursor: null,
      revision: acpHistoryRevision(sourceDb, sessionId),
      truncated: false,
      projection: "acp-entries",
    };
  await sync(db, sessionId, sourceDb, signal);
  signal?.throwIfAborted();
  const state = db
    .prepare("SELECT * FROM acp_chat_projection_state_v1 WHERE session_id=?")
    .get(sessionId) as State | undefined;
  const anchor = before
    ? (db
        .prepare(
          "SELECT * FROM acp_chat_projection_v1 WHERE session_id=? AND entry_id=?",
        )
        .get(sessionId, before) as Row | undefined)
    : undefined;
  if (before && !anchor)
    throw new HttpError(409, "History cursor expired; reload the recent page");
  const rows = db
    .prepare(
      `SELECT entry_id,sort_key,part,payload FROM acp_chat_projection_v1 WHERE session_id=? ${anchor ? "AND (sort_key<? OR (sort_key=? AND part<?))" : ""} ORDER BY sort_key DESC,part DESC LIMIT ?`,
    )
    .iterate(
      sessionId,
      ...(anchor ? [anchor.sort_key, anchor.sort_key, anchor.part] : []),
      (options.limit ?? 80) + 1,
    ) as IterableIterator<Row>;
  const data: AcpProjectedEntry[] = [];
  let bytes = 0,
    more = false,
    truncated = false;
  for (const row of rows) {
    if (data.length >= (options.limit ?? 80)) {
      more = true;
      break;
    }
    let size = Buffer.byteLength(row.payload) + 1;
    let entry = JSON.parse(row.payload) as AcpProjectedEntry;
    // Revalidate cached v1 rows as well as new source updates. A previous
    // projection may have admitted a tiny compressed image with huge pixels.
    if (Array.isArray(entry.images)) {
      const retained: unknown[] = [];
      let lazy = false,
        lazyMime: string | undefined;
      for (const image of entry.images) {
        const match =
          typeof image === "string"
            ? /^data:([^;]+);base64,(.*)$/s.exec(image)
            : null;
        if (match && safeInlineRasterImage(match[1], match[2]))
          retained.push(image);
        else {
          lazy = true;
          if (
            match &&
            ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
              match[1]!,
            )
          )
            lazyMime ??= match[1];
        }
      }
      if (lazy) {
        entry = { ...entry, truncated: true };
        delete entry.images;
        if (retained.length) entry.images = retained;
        if (
          Number.isSafeInteger(entry.historySourceId) &&
          Number(entry.historySourceId) > 0
        ) {
          entry.historyDetail = { itemId: `source-${entry.historySourceId}` };
          if (lazyMime)
            entry.historyImages = [{ index: 0, mimeType: lazyMime }];
        }
        size = Buffer.byteLength(JSON.stringify(entry)) + 1;
      }
    }
    if (size > RECENT_HISTORY_DATA_BYTES) {
      // Old projection rows may predate the escaped-wire budget. Keep their
      // actual cursor/source identity and a reachable readonly original instead
      // of returning an empty page that incorrectly claims the history ended.
      const detail = entry.historyDetail as { itemId?: unknown } | undefined;
      const itemId =
        typeof detail?.itemId === "string"
          ? detail.itemId
          : entry.role === "tool"
            ? row.entry_id
            : Number.isSafeInteger(entry.historySourceId) &&
                Number(entry.historySourceId) > 0
              ? `source-${entry.historySourceId}`
              : undefined;
      entry = {
        ...(boundedAuxiliaryToolPreview(entry, 128 * 1024)
          .value as AcpProjectedEntry),
        id: row.entry_id,
        role: entry.role,
        historySourceId: entry.historySourceId,
        truncated: true,
        ...(itemId ? { historyDetail: { itemId } } : {}),
      };
      size = Buffer.byteLength(JSON.stringify(entry)) + 1;
    }
    if (bytes + size > RECENT_HISTORY_DATA_BYTES) {
      more = true;
      break;
    }
    data.push(entry);
    bytes += size;
    truncated ||= entry.truncated === true;
  }
  data.reverse();
  return {
    data,
    nextCursor:
      more && data.length ? historyCursor("acp", sessionId, data[0]!.id) : null,
    revision: acpHistoryRevision(sourceDb, sessionId, state?.last_update ?? 0),
    truncated,
    projection: "acp-entries",
    metadata: {
      ...JSON.parse(state?.metadata ?? "{}"),
      historySourceId: state?.last_update ?? 0,
    },
  };
}
export function acpHistoryDetail(
  db: Database.Database,
  sessionId: string,
  itemId: string,
  options: { offset: number; limit: number },
  sourceDb: Database.Database = db,
) {
  let value: unknown;
  if (/^source-\d+$/.test(itemId)) {
    const row = sourceDb
      .prepare(
        "SELECT payload FROM acp_session_updates WHERE session_id=? AND id=?",
      )
      .get(sessionId, Number(itemId.slice(7))) as
      | { payload: string }
      | undefined;
    if (row) value = JSON.parse(row.payload);
  } else {
    tables(db);
    const source = itemId.startsWith("tool:")
      ? { tool_id: itemId.slice(5) }
      : (db
          .prepare(
            "SELECT tool_id FROM acp_chat_projection_v1 WHERE session_id=? AND entry_id=?",
          )
          .get(sessionId, itemId) as { tool_id: string | null } | undefined);
    if (source?.tool_id) {
      const result: Record<string, unknown> = {};
      for (const row of sourceDb
        .prepare(
          "SELECT payload FROM acp_session_updates WHERE session_id=? AND json_extract(payload,'$.toolCallId')=? ORDER BY id ASC",
        )
        .iterate(sessionId, source.tool_id) as IterableIterator<{
        payload: string;
      }>) {
        const update = JSON.parse(row.payload);
        for (const key of [
          "toolCallId",
          "title",
          "status",
          "kind",
          "content",
          "locations",
          "rawInput",
          "rawOutput",
        ])
          if (update[key] !== undefined) result[key] = update[key];
      }
      if (Object.keys(result).length) value = result;
    }
  }
  if (value === undefined)
    throw new HttpError(404, "History item is unavailable");
  return {
    ...historyDetailText(value, options),
    revision: acpHistoryRevision(sourceDb, sessionId),
  };
}
export function acpHistoryImage(
  db: Database.Database,
  sessionId: string,
  itemId: string,
  index: number,
  download = false,
) {
  if (!/^source-[1-9]\d*$/.test(itemId) || index !== 0)
    throw new HttpError(404, "History image source is unavailable");
  const row = db
    .prepare(
      "SELECT payload FROM acp_session_updates WHERE session_id=? AND id=?",
    )
    .get(sessionId, Number(itemId.slice(7))) as { payload: string } | undefined;
  if (!row) throw new HttpError(404, "History image source is unavailable");
  const update = JSON.parse(row.payload);
  if (
    update.sessionUpdate !== "user_message_chunk" ||
    update.content?.type !== "image"
  )
    throw new HttpError(404, "History image source is not a stored image");
  return historyImage(update.content, download);
}
export function deleteAcpHistoryProjection(
  db: Database.Database,
  sessionId: string,
) {
  tables(db);
  db.prepare("DELETE FROM acp_chat_projection_v1 WHERE session_id=?").run(
    sessionId,
  );
  db.prepare("DELETE FROM acp_chat_projection_state_v1 WHERE session_id=?").run(
    sessionId,
  );
}
