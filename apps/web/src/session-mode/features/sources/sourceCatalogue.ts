import type { ServerNotification } from "@session/bindings";
import type { ThreadItem } from "@session/bindings/v2";
import {
  parseFileReference,
  resolveLiteralFilePath,
} from "@session/components/codex/presentation/fileReference";
import { parseNativeFileCitations } from "@session/features/native-citations/nativeFileCitations";

export type SourceUse = "provided" | "read" | "created" | "updated";
export type SourceOrigin = { threadId: string; turnId: string; itemId: string };
export type SourceCall = SourceOrigin & { tool: string; status: string };
export type SourceCatalogue = {
  web: Array<{ host: string; urls: string[]; origins: SourceOrigin[] }>;
  files: Array<{
    path: string;
    line?: number;
    column?: number;
    roles: SourceUse[];
    origins: SourceOrigin[];
  }>;
  mcp: Array<{
    server: string;
    name: string;
    count: number;
    calls: SourceCall[];
  }>;
  truncated: boolean;
};
const MAX_SOURCES = 512,
  MAX_ORIGINS = 32,
  MAX_TEXT = 4096;
const safeText = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_TEXT &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
export function safeSourceUrl(value: unknown): string | null {
  if (!safeText(value)) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Derive metadata only. Never retain tool arguments/results, diffs, or full messages. */
export function buildSourceCatalogue(
  events: readonly ServerNotification[],
  threadId: string,
  cwd?: string | null,
): SourceCatalogue {
  const web = new Map<string, SourceCatalogue["web"][number]>();
  const files = new Map<string, SourceCatalogue["files"][number]>();
  const mcp = new Map<string, SourceCatalogue["mcp"][number]>();
  const items = new Map<string, { item: ThreadItem; origin: SourceOrigin }>();
  let truncated = false;
  const originFor = (
    event: Extract<
      ServerNotification,
      { method: "item/started" | "item/completed" }
    >,
  ) => ({
    threadId,
    turnId: event.params.turnId,
    itemId: event.params.item.id,
  });
  for (const event of events) {
    if (
      (event.method !== "item/started" && event.method !== "item/completed") ||
      event.params.threadId !== threadId
    )
      continue;
    const origin = originFor(event),
      key = JSON.stringify([origin.turnId, origin.itemId]);
    // Only the loaded, budgeted transcript is scanned. A completion replaces its
    // corresponding start, so an MCP call is counted once and uses final state.
    items.set(key, { item: event.params.item, origin });
  }
  const addOrigin = (list: SourceOrigin[], origin: SourceOrigin) => {
    if (list.length < MAX_ORIGINS) list.push(origin);
    else truncated = true;
  };
  const addFile = (
    path: unknown,
    role: SourceUse,
    origin: SourceOrigin,
    location?: { line?: number; column?: number },
  ) => {
    if (!safeText(path)) return;
    path = resolveLiteralFilePath(path, cwd) ?? path;
    if (typeof path !== "string") return;
    let source = files.get(path);
    if (!source) {
      if (files.size >= MAX_SOURCES) {
        truncated = true;
        return;
      }
      source = { path, ...location, roles: [], origins: [] };
      files.set(path, source);
    }
    if (!source.roles.includes(role)) source.roles.push(role);
    addOrigin(source.origins, origin);
  };
  const addWeb = (value: unknown, origin: SourceOrigin) => {
    const href = safeSourceUrl(value);
    if (!href) return;
    const host = new URL(href).hostname;
    let source = web.get(host);
    if (!source) {
      if (web.size >= MAX_SOURCES) {
        truncated = true;
        return;
      }
      source = { host, urls: [], origins: [] };
      web.set(host, source);
    }
    if (!source.urls.includes(href)) {
      if (source.urls.length < MAX_ORIGINS) source.urls.push(href);
      else truncated = true;
    }
    addOrigin(source.origins, origin);
  };
  const messageSources = (
    text: string,
    role: SourceUse,
    origin: SourceOrigin,
  ) => {
    // Source URLs and file directives are display metadata; no message body is
    // retained by this catalogue. Actual code/HTML remains in the transcript.
    for (const match of text.matchAll(
      /\[[^\]\n]{0,2048}\]\((?:<([^>\n]+)>|([^\s)]{1,4096}))(?:\s+"[^"]*")?\)/g,
    )) {
      const href = match[1] ?? match[2];
      if (safeSourceUrl(href)) addWeb(href, origin);
      else {
        const file = parseFileReference(href, cwd);
        if (file) addFile(file.path, role, origin, file);
      }
    }
    for (const match of parseNativeFileCitations(text).slice(0, MAX_SOURCES)) {
      const citation = match.citation;
      if (citation.kind === "file")
        addFile(citation.path, role, origin, { line: citation.lineStart });
      else addWeb(citation.path, origin);
    }
  };
  for (const { item, origin } of items.values()) {
    if (item.type === "userMessage") {
      for (const content of item.content) {
        if (
          ["mention", "skill", "localImage", "localAudio"].includes(
            content.type,
          ) &&
          "path" in content
        )
          addFile(content.path, "provided", origin);
        else if (content.type === "image") addWeb(content.url, origin);
        else if (content.type === "text")
          messageSources(content.text, "provided", origin);
      }
    } else if (item.type === "agentMessage") {
      messageSources(item.text, "read", origin);
    } else if (item.type === "commandExecution") {
      for (const action of item.commandActions ?? [])
        if (action.type === "read") addFile(action.path, "read", origin);
    } else if (item.type === "fileChange" && item.status === "completed") {
      for (const change of item.changes)
        if (change.kind.type !== "delete")
          addFile(
            change.kind.type === "update" && change.kind.move_path
              ? change.kind.move_path
              : change.path,
            change.kind.type === "add" ? "created" : "updated",
            origin,
          );
    } else if (item.type === "webSearch") {
      if (item.action && "url" in item.action) addWeb(item.action.url, origin);
      for (const result of (item.results ?? []).slice(0, MAX_ORIGINS))
        if (
          result &&
          typeof result === "object" &&
          !Array.isArray(result) &&
          "url" in result
        )
          addWeb(result.url, origin);
    } else if (item.type === "mcpToolCall" && safeText(item.server)) {
      let source = mcp.get(item.server);
      if (!source) {
        if (mcp.size >= MAX_SOURCES) {
          truncated = true;
          continue;
        }
        source = {
          server: item.server,
          name: safeText(item.appContext?.appName)
            ? item.appContext.appName
            : item.server,
          count: 0,
          calls: [],
        };
        mcp.set(item.server, source);
      }
      source.count++;
      if (source.calls.length < MAX_ORIGINS)
        source.calls.push({
          ...origin,
          tool: safeText(item.tool) ? item.tool : "未命名工具",
          status: item.status,
        });
      else truncated = true;
    }
  }
  return {
    web: [...web.values()],
    files: [...files.values()],
    mcp: [...mcp.values()],
    truncated,
  };
}
