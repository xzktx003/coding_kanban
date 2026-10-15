import { mcpAuthChallenge } from "./codex-mcp-auth.js";
/** The browser chat view carries tool metadata, never the tool transcript. */
export const CODEX_CHAT_METADATA_TEXT_LIMIT = 1024;
export const CODEX_CHAT_METADATA_TOTAL_TEXT_LIMIT = 4096;
export const CODEX_CHAT_METADATA_ARRAY_LIMIT = 16;
/** Bounded unified diff kept so the chat can show line counts and a hover preview. */
export const CODEX_CHAT_FILE_DIFF_LIMIT = 24_000;
const cache = new WeakMap<object, unknown>();
type RecordValue = Record<string, unknown>;
type TextBudget = { remaining: number };
const tools = new Set([
  "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall",
  "collabAgentToolCall", "subAgentActivity", "webSearch", "imageView", "imageGeneration",
]);
export const CODEX_CHAT_PRIVATE_BODY_METHODS: ReadonlySet<string> = new Set([
  "command/exec/outputDelta", "process/outputDelta", "rawResponseItem/completed",
  "item/commandExecution/outputDelta", "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta", "turn/diff/updated", "item/reasoning/textDelta",
  "item/tool/textDelta",
]);
const cursorFields = [
  "threadId", "turnId", "itemId", "processId", "processHandle", "requestId",
  "reviewId", "targetItemId", "startedAtMs", "completedAtMs", "exitCode",
  "decisionSource", "status", "type", "stream", "capReached", "stderrCapReached", "stdoutCapReached",
];
const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const copy = (value: string) => value.split("").join("");
function short(value: unknown, budget: TextBudget, floor = 0): string | null {
  if (typeof value !== "string") return null;
  const limit = Math.min(CODEX_CHAT_METADATA_TEXT_LIMIT, Math.max(budget.remaining, floor));
  if (limit <= 0) return "";
  const text = value.length > limit
    ? copy(value.slice(0, Math.max(0, limit - 1))) + "…"
    : copy(value);
  budget.remaining -= text.length;
  return text;
}
function identity(value: unknown, limit = 256): string | null {
  return typeof value === "string" && value.length <= limit && !/[\x00-\x1f]/.test(value)
    ? copy(value) : null;
}
function scalar(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value;
  return identity(value);
}
function fields(source: RecordValue, names: readonly string[]): RecordValue {
  const next: RecordValue = {};
  for (const name of names) if (name in source) next[name] = scalar(source[name]);
  return next;
}
function reuse<T>(original: unknown, projected: T): T {
  if (Array.isArray(original) && Array.isArray(projected))
    return (original.length === projected.length && original.every((value, index) => value === projected[index]) ? original : projected) as T;
  if (isRecord(original) && isRecord(projected)) {
    const keys = Object.keys(projected);
    if (keys.length === Object.keys(original).length && keys.every((key) => original[key] === projected[key])) return original as T;
  }
  return projected;
}
function list(value: unknown, project: (value: unknown) => unknown, limit = CODEX_CHAT_METADATA_ARRAY_LIMIT): unknown[] {
  if (!Array.isArray(value)) return [];
  return reuse(value, value.slice(0, limit).map(project).filter((value) => value !== undefined));
}
function strings(value: unknown, budget: TextBudget): unknown[] {
  return list(value, (entry) => typeof entry === "string" ? short(entry, budget) : undefined);
}
function action(value: unknown, budget: TextBudget): unknown {
  if (!isRecord(value)) return undefined;
  const next = fields(value, ["type"]);
  for (const name of ["command", "query", "pattern", "name"])
    if (name in value) next[name] = short(value[name], budget);
  for (const name of ["path", "url"])
    if (name in value) next[name] = identity(value[name], 1024);
  if ("queries" in value) next.queries = value.queries === null ? null : strings(value.queries, budget);
  return reuse(value, next);
}
function fileDiff(value: unknown): { diff: string; transcriptMetadataOnly?: true } {
  if (typeof value !== "string" || value.length > CODEX_CHAT_FILE_DIFF_LIMIT) return { diff: "", transcriptMetadataOnly: true };
  return { diff: copy(value) };
}
/** Native FileChange stores the patch on `unified_diff` / `content`, not `diff`. */
function nativeChangeBody(value: RecordValue): unknown {
  if (typeof value.diff === "string" && value.diff.length > 0) return value.diff;
  if (typeof value.unified_diff === "string") return value.unified_diff;
  if (typeof value.content === "string") return value.content;
  return value.diff;
}
function nativeChangeKind(value: RecordValue): unknown {
  if (typeof value.kind === "string" || isRecord(value.kind)) return value.kind;
  if (value.type === "update") return { type: "update", move_path: value.move_path ?? null };
  if (value.type === "add" || value.type === "delete") return { type: value.type };
  return undefined;
}
function change(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  const path = identity(value.path, 1024);
  const kindSource = nativeChangeKind(value);
  if (!path || !(typeof kindSource === "string" || isRecord(kindSource))) return undefined;
  const kind = isRecord(kindSource) ? reuse(kindSource, fields(kindSource, ["type", "move_path"])) : scalar(kindSource);
  return reuse(value, { path, kind, ...fileDiff(nativeChangeBody(value)) });
}
function changes(value: unknown): unknown[] {
  if (Array.isArray(value)) return list(value, change);
  if (!isRecord(value)) return [];
  const projected = Object.entries(value).slice(0, CODEX_CHAT_METADATA_ARRAY_LIMIT).flatMap(([path, entry]) => {
    if (!isRecord(entry) || ["__proto__", "constructor", "prototype"].includes(path)) return [];
    const projectedChange = change({ ...entry, path });
    return projectedChange === undefined ? [] : [projectedChange];
  });
  return reuse(value, projected);
}
function states(value: unknown, budget: TextBudget): unknown {
  if (!isRecord(value)) return {};
  const next: RecordValue = {};
  for (const key of Object.keys(value).slice(0, CODEX_CHAT_METADATA_ARRAY_LIMIT)) {
    if (!identity(key) || ["__proto__", "constructor", "prototype"].includes(key)) continue;
    const entry = value[key];
    if (!isRecord(entry)) continue;
    next[key] = reuse(entry, {
      ...fields(entry, ["status"]),
      ...("message" in entry ? { message: short(entry.message, budget) } : {}),
    });
  }
  return reuse(value, next);
}
/** Public MCP argument labels only. Nested objects and result bodies stay out. */
function publicArguments(value: unknown, budget: TextBudget): RecordValue | null {
  if (!isRecord(value)) return null;
  const next: RecordValue = {};
  for (const key of Object.keys(value).slice(0, CODEX_CHAT_METADATA_ARRAY_LIMIT)) {
    if (!identity(key) || ["__proto__", "constructor", "prototype"].includes(key)) continue;
    if (/^(?:secret|token|accessToken|refreshToken|password|authorization|apiKey|credentials|clientSecret|bearerToken)$/i.test(key.replace(/[-_]/g, ""))) continue;
    const entry = value[key];
    if (typeof entry === "boolean" || (typeof entry === "number" && Number.isFinite(entry)))
      next[key] = entry;
    else if (typeof entry === "string") next[key] = short(entry, budget, 240);
  }
  return Object.keys(next).length ? next : null;
}
function nativeArguments(value: RecordValue): unknown {
  if ((value.namespace !== "codex_app" && value.namespace != null) || !isRecord(value.arguments)) return null;
  const args = value.arguments;
  const next: RecordValue = {};
  const names = new Set<string>();
  if (["read_thread", "send_message_to_thread", "handoff_thread", "set_thread_archived", "set_thread_pinned"].includes(String(value.tool))) names.add("threadId");
  if (value.tool === "handoff_thread") names.add("destinationHostId");
  if (value.tool === "get_handoff_status") names.add("operationId");
  for (const name of names) {
    const id = identity(args[name]);
    if (id) next[name] = id;
  }
  for (const [name, tool] of [["archived", "set_thread_archived"], ["pinned", "set_thread_pinned"]])
    if (value.tool === tool && typeof args[name!] === "boolean") next[name!] = args[name!];
  if (["move_thread_to_sidebar_section", "move_project_to_sidebar_section"].includes(String(value.tool)) && Object.hasOwn(args, "sectionId")) {
    const section = args.sectionId === null ? null : identity(args.sectionId);
    if (section !== null || args.sectionId === null) next.sectionId = section;
  }
  if (value.tool === "automation_update" && ["create", "update", "pause", "resume", "delete"].includes(String(args.mode))) next.mode = args.mode;
  if (value.tool === "open_in_codex" && isRecord(args.target) && ["file", "thread", "project", "settings"].includes(String(args.target.type))) next.target = reuse(args.target, { type: args.target.type });
  if (value.tool === "write_settings" && isRecord(args.config)) next.config = reuse(args.config, {});
  return Object.keys(next).length ? reuse(args, next) : null;
}
function creationTarget(value: RecordValue): unknown {
  if (value.namespace !== "codex_app" || value.tool !== "create_thread" || value.status !== "completed" || value.success !== true) return undefined;
  let result: unknown;
  if (value.transcriptMetadataOnly === true && isRecord(value.nativeTarget)) result = value.nativeTarget;
  else {
    const first = Array.isArray(value.contentItems) ? value.contentItems.find((entry) => isRecord(entry) && entry.type === "inputText") : undefined;
    if (!isRecord(first) || typeof first.text !== "string" || first.text.length > 65536) return undefined;
    try { result = JSON.parse(first.text); } catch { return undefined; }
  }
  if (!isRecord(result)) return undefined;
  const kind = result.kind ?? "codex";
  if (kind !== "codex" && kind !== "chatgpt") return undefined;
  const id = (entry: unknown) => typeof entry === "string" ? identity(entry.trim()) : null;
  const threadId = id(result.threadId), clientThreadId = id(result.clientThreadId);
  const target = threadId ? { threadId } : clientThreadId && (kind === "chatgpt" || clientThreadId.startsWith("client-new-thread:")) ? { clientThreadId } : null;
  if (!target) return undefined;
  const hostId = result.hostId === undefined ? undefined : id(result.hostId);
  if (hostId === null || hostId === "") return undefined;
  return reuse(result, { kind, ...target, ...(kind === "codex" && hostId ? { hostId } : {}) });
}
function tool(value: RecordValue): RecordValue {
  const budget = { remaining: CODEX_CHAT_METADATA_TOTAL_TEXT_LIMIT };
  const next: RecordValue = {
    ...fields(value, ["type", "id", "status", "pluginId", "processId", "source", "exitCode", "durationMs", "tool", "namespace", "model", "reasoningEffort", "senderThreadId", "agentThreadId", "agentPath", "kind", "success"]),
    transcriptMetadataOnly: true,
  };
  for (const name of ["cwd", "scriptPath", "path"])
    if (name in value) next[name] = identity(value[name], 1024);
  switch (value.type) {
    case "commandExecution":
      next.command = short(value.command, budget, 240) ?? "";
      next.commandActions = list(value.commandActions, (entry) => action(entry, budget));
      next.aggregatedOutput = null;
      break;
    case "fileChange":
      next.changes = changes(value.changes);
      break;
    case "mcpToolCall":
      next.server = identity(value.server) ?? "";
      next.arguments = publicArguments(value.arguments, budget);
      next.result = null;
      {
        const raw=isRecord(value.result) && isRecord(value.result._meta) ? mcpAuthChallenge(value.result._meta["mcp/www_authenticate"]) : undefined;
        const existing=value.nativeMcpAuthChallenge;
        const retained=isRecord(existing) && Array.isArray(existing.scopes) && existing.scopes.every(v=>typeof v==="string" && v.length<=256) && existing.scopes.length<=32 && existing.scopes.join(" ").length<=2048 ? {scopes:reuse(existing.scopes,[...existing.scopes]),...(existing.truncated===true?{truncated:true as const}:{})} : undefined;
        const challenge=raw??retained;
        if(challenge)next.nativeMcpAuthChallenge=reuse(existing,challenge);
      }
      next.error = isRecord(value.error) ? reuse(value.error, { message: short(value.error.message, budget) }) : null;
      next.appContext = isRecord(value.appContext) ? reuse(value.appContext, fields(value.appContext, ["connectorId", "appName"])) : null;
      if ("progressMessage" in value) next.progressMessage = short(value.progressMessage, budget);
      break;
    case "dynamicToolCall":
      next.arguments = nativeArguments(value);
      next.contentItems = reuse(value.contentItems, []);
      {
        const target = creationTarget(value);
        if (target) next.nativeTarget = target;
      }
      break;
    case "collabAgentToolCall":
      next.receiverThreadIds = list(value.receiverThreadIds, (entry) => identity(entry) ?? undefined);
      next.prompt = short(value.prompt, budget);
      next.agentsStates = states(value.agentsStates, budget);
      break;
    case "webSearch":
      next.query = short(value.query, budget) ?? "";
      next.action = value.action === null ? null : action(value.action, budget) ?? null;
      break;
    case "imageGeneration":
      if ("prompt" in value) next.prompt = short(value.prompt, budget);
      // Generated bytes and result text are never carried in chat snapshots.
      break;
  }
  return reuse(value, next);
}
function hook(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  const budget = { remaining: CODEX_CHAT_METADATA_TEXT_LIMIT };
  const next: RecordValue = {
    ...fields(value, ["id", "eventName", "handlerType", "executionMode", "scope", "source", "displayOrder", "status", "startedAt", "completedAt", "durationMs"]),
    sourcePath: identity(value.sourcePath, 1024),
    statusMessage: short(value.statusMessage, budget),
    entries: list(value.entries, (entry) => {
      if (!isRecord(entry) || !["warning", "feedback", "error", "stop"].includes(String(entry.kind))) return undefined;
      return reuse(entry, { kind: entry.kind, text: short(entry.text, budget) ?? "" });
    }, 8),
  };
  return reuse(value, next);
}
function cursor(params: RecordValue): RecordValue {
  const next = fields(params, cursorFields);
  if (isRecord(params.item)) next.item = reuse(params.item, fields(params.item, ["type", "id", "name", "namespace", "status", "call_id"]));
  return reuse(params, next);
}
/** Public auto-review action label. Commands stay bounded; bodies stay out. */
function reviewAction(action: RecordValue): RecordValue {
  const budget = { remaining: CODEX_CHAT_METADATA_TEXT_LIMIT };
  const next = fields(action, [
    "type", "source", "cwd", "processId", "server", "toolName", "connectorId",
    "connectorName", "toolTitle", "target", "host", "protocol", "port",
  ]);
  for (const name of ["command", "program", "stdin", "reason"]) {
    if (name in action) {
      // An incomplete executable command can misrepresent the reviewed action.
      // Keep short public labels; oversized command bodies stay out of chat.
      if (name === "command" && typeof action[name] === "string" && action[name].length > CODEX_CHAT_METADATA_TEXT_LIMIT)
        continue;
      next[name] = short(action[name], budget);
    }
  }
  if (Array.isArray(action.argv))
    next.argv = strings(action.argv, budget);
  if (Array.isArray(action.files))
    next.files = strings(action.files, budget);
  return next;
}
function notification(value: RecordValue): RecordValue {
  const params = isRecord(value.params) ? value.params : {};
  const method = String(value.method);
  let next: unknown;
  if (CODEX_CHAT_PRIVATE_BODY_METHODS.has(method)) next = cursor(params);
  else if (method === "hook/started" || method === "hook/completed")
    next = reuse(params, { ...fields(params, cursorFields), run: hook(params.run) });
  else if (method === "item/fileChange/patchUpdated")
    next = reuse(params, { ...fields(params, cursorFields), changes: changes(params.changes) });
  else if (method === "item/mcpToolCall/progress")
    next = reuse(params, { ...fields(params, cursorFields), message: short(params.message, { remaining: CODEX_CHAT_METADATA_TEXT_LIMIT }) });
  else if (method === "item/autoApprovalReview/started" || method === "item/autoApprovalReview/completed") {
    const projected = fields(params, cursorFields);
    if (isRecord(params.review)) projected.review = reuse(params.review, {
      ...fields(params.review, ["status", "riskLevel", "userAuthorization"]),
      rationale: short(params.review.rationale, { remaining: CODEX_CHAT_METADATA_TEXT_LIMIT }),
    });
    if (isRecord(params.action)) projected.action = reuse(params.action, reviewAction(params.action));
    next = reuse(params, projected);
  } else next = projectCodexChatValue(params);
  return reuse(value, { ...value, params: next });
}

/** Idempotent projection shared by the gateway, ingress, history and old caches. */
export function projectCodexChatValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (cache.has(value)) return cache.get(value);
  let next: unknown;
  if (Array.isArray(value)) next = reuse(value, value.map(projectCodexChatValue));
  else {
    const record = value as RecordValue;
    if (tools.has(String(record.type))) next = tool(record);
    else if (record.type === "reasoning") next = reuse(record, {
      ...fields(record, ["type", "id"]),
      summary: strings(record.summary, { remaining: CODEX_CHAT_METADATA_TOTAL_TEXT_LIMIT }),
      content: reuse(record.content, []),
    });
    else if (typeof record.method === "string" && isRecord(record.params)) next = notification(record);
    else {
      const result: RecordValue = {};
      for (const [key, entry] of Object.entries(record)) {
        if (key === "hookRuns") result[key] = list(entry, hook);
        else result[key] = projectCodexChatValue(entry);
      }
      next = reuse(record, result);
    }
  }
  cache.set(value, next);
  if (next !== null && typeof next === "object") cache.set(next, next);
  return next;
}
