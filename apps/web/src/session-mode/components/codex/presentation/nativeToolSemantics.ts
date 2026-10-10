import { nativeToolLabels } from "./nativeToolLabels";
import type { ServerNotification } from "@session/bindings";
import { nativeMcpActivityDescriptor } from "./nativeMcpActivityRegistry.js";
import { formatNativeToolMessage } from "./nativeToolMessage";
import { z } from "zod";

type ToolRecord = Record<string, unknown>;
const record = (value: unknown): ToolRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as ToolRecord)
    : {};
const words = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
const text = (value: unknown) => (typeof value === "string" ? value : "");
export type NativeMcpSummaryResolvedApp = {
  id: string;
  name: string;
  pluginDisplayNames?: readonly string[];
  logoUrl?: string | null;
  logoUrlDark?: string | null;
};
export type NativeMcpSummarySource = {
  key: string;
  name: string;
  preferred: boolean;
};
export type NativeMcpCompletedSummaryClassification =
  | { kind: "source"; source: NativeMcpSummarySource }
  | {
      kind: "native";
      key: string;
      presentation: NonNullable<ReturnType<typeof nativeCodexToolPresentation>>;
    }
  | { kind: "command" }
  | { kind: "unnamed" };
const sourceAcronyms = new Set([
  "GH",
  "IA",
  "MCP",
  "API",
  "CI",
  "CLI",
  "LLM",
  "PDF",
  "PR",
  "RCS",
  "UI",
  "URL",
  "SQL",
  "TW",
  "GPU",
  "CPU",
]);
const sourceBrands = new Map([
  ["openai", "OpenAI"],
  ["openaideveloperdocs", "OpenAI Developer Docs"],
  ["openapi", "OpenAPI"],
  ["github", "GitHub"],
  ["imessage", "iMessage"],
  ["pagerduty", "PagerDuty"],
  ["datadog", "DataDog"],
  ["sharepoint", "SharePoint"],
  ["sqlite", "SQLite"],
  ["fastapi", "FastAPI"],
]);
/** Native Ss/P9t title casing, including source brand and acronym preservation. */
function nativeMcpSourceName(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const upper = word.toUpperCase(),
        lower = word.toLowerCase();
      if (sourceAcronyms.has(upper)) return upper;
      if (
        lower.endsWith("s") &&
        sourceAcronyms.has(word.slice(0, -1).toUpperCase())
      )
        return `${word.slice(0, -1).toUpperCase()}s`;
      return (
        sourceBrands.get(lower) ??
        (index > 0 && ["and", "or", "to", "up", "with"].includes(lower)
          ? lower
          : lower[0].toUpperCase() + lower.slice(1))
      );
    })
    .join(" ");
}
function nativeMcpResolvedApp(
  value: unknown,
  apps: readonly NativeMcpSummaryResolvedApp[],
) {
  const item = record(value),
    app = record(item.appContext);
  if (item.appContext != null)
    return apps.find((candidate) => candidate.id === app.connectorId);
  const server = words(text(item.server)),
    tool = words(text(item.tool));
  const segments = text(item.functionName).split("__").map(words);
  return apps.find((candidate) => {
    const prefixes = [
      candidate.name,
      candidate.id,
      candidate.id.replace(/^connector[_-]/i, ""),
      ...(candidate.pluginDisplayNames ?? []),
    ]
      .map(words)
      .filter((tokens) => tokens.length > 0);
    return prefixes.some(
      (prefix) =>
        (prefix.length === server.length &&
          prefix.every((token, index) => token === server[index])) ||
        prefix.every((token, index) => token === tool[index]) ||
        segments.some((segment) =>
          prefix.every((token, index) => token === segment[index]),
        ),
    );
  });
}
/** Native Ue/Me/Ae split descriptor calls, REPL commands and actual MCP sources. */
export function nativeMcpCompletedSummaryClassification(
  value: unknown,
  resolvedApps: readonly NativeMcpSummaryResolvedApp[] = [],
): NativeMcpCompletedSummaryClassification {
  const item = record(value),
    app = record(item.appContext),
    server = text(item.server);
  const presentation = nativeMcpCodexPresentation(
    item,
    undefined,
    true,
    resolvedApps,
  );
  if (presentation)
    return { kind: "native", key: presentation.key, presentation };
  const resolved = nativeMcpResolvedApp(item, resolvedApps);
  const trimmedServer = server.trim();
  const source = resolved
    ? { key: `app:${resolved.id}`, name: resolved.name }
    : item.appContext != null
      ? {
          key: `app:${text(app.connectorId)}`,
          name:
            typeof app.appName === "string"
              ? app.appName
              : text(app.connectorId),
        }
      : trimmedServer
        ? {
            key: `server:${trimmedServer}`,
            name: nativeMcpSourceName(trimmedServer),
          }
        : null;
  if (!source) return { kind: "unnamed" };
  if (source.key === "server:node_repl" || source.key === "server:cua_repl")
    return { kind: "command" };
  return {
    kind: "source",
    source: {
      ...source,
      preferred:
        (item.pluginId != null && server !== "codex_apps") ||
        resolved?.logoUrl != null ||
        resolved?.logoUrlDark != null,
    },
  };
}
/** Native u_: names deduplicate after source identity aggregation; call counts are omitted. */
export function nativeMcpSourcesSummaryLabel(
  sources: readonly Pick<NativeMcpSummarySource, "key" | "name">[],
  language = "zh",
  leadingSummary = true,
) {
  if (!sources.length) return "";
  const chinese = language.startsWith("zh");
  const names = [
    ...new Set(
      sources.map((source) =>
        source.key === "browser-use"
          ? chinese
            ? "浏览器"
            : "the browser"
          : source.name,
      ),
    ),
  ];
  let list: string;
  try {
    list = new Intl.ListFormat(language || "en", {
      type: "conjunction",
    }).format(names);
  } catch {
    list = new Intl.ListFormat("en", { type: "conjunction" }).format(names);
  }
  const integration = sources.every((source) => source.key !== "browser-use");
  const template = chinese
    ? integration
      ? "已使用 {sources} {sourceCount, plural, one {集成} other {集成}}"
      : "已使用 {sources}"
    : `${leadingSummary ? "Used" : "used"} {sources}${integration ? " {sourceCount, plural, one {integration} other {integrations}}" : ""}`;
  return formatNativeToolMessage(
    template,
    { sources: list, sourceCount: names.length },
    language,
  );
}
/** The original excludes disabled MCP Apps from standalone widget rendering. */
export function nativeToolActivityMetadata(value: unknown): {
  grouping: "hidden" | "standalone" | "groupable";
  summaryKey?: string;
  summaryOnly?: boolean;
  continues?: boolean;
} {
  const item = record(value);
  switch (item.type) {
    case "sleep":
    case "enteredReviewMode":
    case "exitedReviewMode":
    case "reasoning":
    case "modelRerouted":
      return { grouping: "hidden" };
    case "webSearch":
      return {
        grouping:
          text(item.query).trim() || item.action ? "groupable" : "hidden",
      };
    case "mcpToolCall":
      return {
        grouping: "groupable",
        summaryKey: `${item.server}:${item.tool}`,
      };
    case "dynamicToolCall":
      if (
        (item.namespace === "codex_app" || item.namespace == null) &&
        item.tool === "update_up_next"
      )
        return { grouping: "hidden" };
      if (
        (item.namespace === "codex_app" && item.tool === "handoff_thread") ||
        ((item.namespace === "codex_app" || item.namespace == null) &&
          item.tool === "finalize_environment")
      )
        return { grouping: "standalone" };
      return {
        grouping: "groupable",
        summaryKey: `${item.namespace}:${item.tool}`,
        ...(item.namespace === "codex_app" && item.tool === "get_handoff_status"
          ? { summaryOnly: true }
          : {}),
        ...(item.namespace === "codex_app" &&
        (item.tool === "read_thread" || item.tool === "list_threads")
          ? { continues: true }
          : {}),
      };
    case "automaticApprovalReview":
      return {
        grouping:
          item.status === "approved"
            ? "hidden"
            : item.status === "inProgress"
              ? "groupable"
              : "standalone",
      };
    default:
      return { grouping: "standalone" };
  }
}
export function nativeAutomaticReviewMetadata(event: ServerNotification) {
  if (
    event.method !== "item/autoApprovalReview/started" &&
    event.method !== "item/autoApprovalReview/completed"
  )
    return null;
  const value = event.params;
  return {
    key: JSON.stringify([
      value.threadId,
      value.turnId,
      value.reviewId,
      value.targetItemId,
    ]),
    threadId: value.threadId,
    turnId: value.turnId,
    reviewId: value.reviewId,
    targetItemId: value.targetItemId,
    pending: value.review.status === "inProgress",
    grouping: nativeToolActivityMetadata({
      type: "automaticApprovalReview",
      status: value.review.status,
    }).grouping,
    value,
  };
}

/** Match native Na/Fa prefix removal; retain unknown names as readable diagnostics. */
export function nativeToolName(value: unknown) {
  const item = record(value),
    app = record(item.appContext);
  const original = text(app.actionName) || text(item.tool),
    tokens = words(original);
  const prefixes = [
    text(app.appName),
    text(app.connectorId),
    text(app.connectorId).replace(/^connector[_-]/i, ""),
  ]
    .filter(Boolean)
    .flatMap((name) => {
      const p = words(name);
      return [p, [...p, "mcp"], [...p, "mcp", "server"]];
    })
    .sort((a, b) => b.length - a.length);
  let rest = tokens;
  for (;;) {
    const prefix = prefixes.find((p) => p.every((v, i) => rest[i] === v));
    if (!prefix) break;
    rest = rest.slice(prefix.length);
  }
  return (rest.length ? rest : tokens).join("_") || original;
}
const descriptor = (key: string, language: string) =>
  nativeToolLabels[key]?.[language.startsWith("zh") ? 1 : 0];
// Actual native Pt/Mt registration; Pages descriptors have a separate server gate.
const nativeCodexToolNames = new Set([
  "create_thread",
  "create_worktree",
  "get_worktree_creation_status",
  "fork_thread",
  "list_threads",
  "list_archived_threads",
  "read_thread",
  "send_message_to_thread",
  "wait_threads",
  "handoff_thread",
  "get_handoff_status",
  "set_thread_archived",
  "set_thread_title",
  "list_projects",
  "create_sidebar_section",
  "rename_sidebar_section",
  "delete_sidebar_section",
  "move_thread_to_sidebar_section",
  "move_project_to_sidebar_section",
  "reorder_section",
  "reorder_sidebar_projects",
  "reorder_sidebar_sections",
  "share_thread",
  "automation_update",
  "automation_mode_update",
  "navigate_to_codex_page",
  "open_in_codex",
  "read_thread_terminal",
  "attach_artifact",
  "list_artifacts",
  "remove_artifact",
  "read_settings",
  "write_settings",
  "uninstall_plugin",
  "get_usage_limits",
  "consume_usage_reset",
  "capture_screen_context",
  "end_realtime_voice_call",
  "fire_confetti",
  "load_workspace_dependencies",
  "create_project",
  "list_hosts",
  "set_thread_pinned",
  "transfer_voice_call",
  "get_screen_annotations",
  "draw_screen_stroke",
  "erase_screen_strokes",
  "request_option_picker",
  "request_onboarding_input",
  "setup_codex_step",
  "complete_conversational_onboarding_task",
  "complete_sidebar_onboarding_checklist_task",
  "cloud_threads.list",
  "cloud_threads.read",
  "cloud_threads.create",
  "cloud_threads.attach",
  "cloud_threads.send_message",
  "restore_chat",
  "pin_chat",
  "unpin_chat",
  "pin_project",
  "unpin_project",
  "automation_view",
  "automation_delete",
  "automation_suggested_create",
  "open_browser",
  "open_terminal",
  "open_review",
]);
// Native Pt/Et is consulted only for a recognized Pages MCP invocation.
const nativePageCodexToolNames = new Set([
  "open_page",
  "list_spaces",
  "create_space",
  "list_pages",
  "find_pages",
  "create_page",
  "move_page",
  "read_page",
  "read_page_changes",
  "edit_page",
  "create_page_visualization",
  "list_page_comments",
  "manage_page_comment",
  "search_sharing_recipients",
  "get_page_sharing",
  "get_space_sharing",
  "update_page_sharing",
  "update_space_sharing",
  "replace_visualization",
  "comment_reply",
  "comment_resolve",
  "comment_reopen",
  "comment_edit",
  "comment_delete_message",
  "comment_react",
  "comment_remove_reaction",
  "comment_delete_thread",
]);
// Native Pt/Rt validate the complete optional argument schema before aliasing.
const nativeCodexArguments = z.object({
  action: z.string().optional(),
  active: z.boolean().optional(),
  archived: z.boolean().optional(),
  pinned: z.boolean().optional(),
  sectionId: z.string().nullable().optional(),
  mode: z.string().optional(),
  replace_block: z.object({}).optional(),
  target: z.object({ type: z.string() }).optional(),
});
/** Original Pt descriptor identity, also used by cr to deduplicate summaries. */
export function nativeCodexToolPresentation(
  value: unknown,
  completedOverride?: boolean,
  leadingSummary = true,
  mcpServerName?: string,
) {
  const item = record(value);
  const args = nativeCodexArguments.safeParse(item.arguments).data;
  let tool = text(item.tool);
  if (tool === "set_thread_archived" && args?.archived === false)
    tool = "restore_chat";
  else if (tool === "set_thread_pinned" && args?.pinned === false)
    tool = "unpin_chat";
  else if (
    tool === "move_thread_to_sidebar_section" ||
    tool === "move_project_to_sidebar_section"
  ) {
    const kind = tool === "move_thread_to_sidebar_section" ? "chat" : "project";
    if (args?.sectionId === "pinned") tool = `pin_${kind}`;
    else if (
      args &&
      ((args.sectionId == null && Object.hasOwn(args, "sectionId")) ||
        args.sectionId === "threads" ||
        args.sectionId === "chats")
    )
      tool = `unpin_${kind}`;
  } else if (
    tool === "automation_update" &&
    args?.mode != null &&
    args.mode !== "create"
  )
    tool =
      args.mode === "update"
        ? "automation_mode_update"
        : `automation_${args.mode}`;
  else if (
    tool === "open_in_codex" &&
    args?.target &&
    args.target.type !== "file"
  )
    tool = `open_${args.target.type}`;
  const pageServer =
    mcpServerName === "codex_apps" || mcpServerName === "pages";
  if (!nativeCodexToolNames.has(tool) && pageServer) {
    if (
      tool === "manage_page_comment" &&
      args?.action != null &&
      args.action !== "add"
    )
      tool =
        args.action === "react" && args.active === false
          ? "comment_remove_reaction"
          : `comment_${args.action}`;
    else if (
      tool === "create_page_visualization" &&
      args?.replace_block != null
    )
      tool = "replace_visualization";
  }
  const descriptorId = `localConversation.codexTool.${tool}.${tool === "create_worktree" ? "creationState" : "state"}`;
  if (
    (!nativeCodexToolNames.has(tool) &&
      !(pageServer && nativePageCodexToolNames.has(tool))) ||
    !nativeToolLabels[descriptorId]
  )
    return null;
  const completed =
    completedOverride ??
    (typeof item.completed === "boolean"
      ? item.completed
      : item.status !== "inProgress");
  const failed =
    item.status === "failed" || !!item.error || item.success === false;
  let state = completed
    ? failed
      ? leadingSummary
        ? "failed"
        : "failedFollowing"
      : leadingSummary
        ? "completed"
        : "following"
    : "active";
  if (tool === "create_worktree" && completed && !failed) {
    const output = Array.isArray(item.contentItems)
      ? item.contentItems
          .map(record)
          .find((block) => block.type === "inputText")?.text
      : undefined;
    if (typeof output === "string") {
      try {
        if (record(JSON.parse(output)).type === "pending")
          state = leadingSummary ? "pending" : "pendingFollowing";
      } catch {
        /* Literal or partial output is not a pending state. */
      }
    }
  }
  return { descriptorId, state, key: `${tool}:${state}` };
}
function nativeMcpCodexPresentation(
  value: unknown,
  completedOverride?: boolean,
  leadingSummary = true,
  resolvedApps: readonly NativeMcpSummaryResolvedApp[] = [],
) {
  const item = record(value),
    app = record(item.appContext),
    server = text(item.server);
  let tool = text(item.tool);
  if (server !== "codex_app") {
    const connector =
      text(app.connectorId) || nativeMcpResolvedApp(item, resolvedApps)?.id;
    const action = text(app.actionName) || tool;
    if (
      (server === "pages" || server === "codex_apps") &&
      (connector == null || connector === "connector_openai_pages")
    ) {
      const pageTool = action.replace(/^(?:chatgpt_space[._]|pages_)/, "");
      if (connector != null || server === "pages" || pageTool !== action)
        tool = pageTool;
      else if (server === "codex_apps" && /^cloud_threads[._]/.test(action))
        tool = `cloud_threads.${action.replace(/^cloud_threads[._]/, "")}`;
      else return null;
    } else if (
      server === "codex_apps" &&
      connector === "connector_openai_threads"
    ) {
      tool = `cloud_threads.${action.replace(/^cloud_threads[._]/, "")}`;
    } else return null;
    if (
      tool.startsWith("cloud_threads.") &&
      !["list", "read", "create", "attach", "send_message"].includes(
        tool.slice("cloud_threads.".length),
      )
    )
      return null;
  }
  const result = record(item.result),
    blocks = Array.isArray(result.content) ? result.content.map(record) : [];
  return nativeCodexToolPresentation(
    {
      ...item,
      tool,
      contentItems: blocks.map((block) =>
        block.type === "text" ? { ...block, type: "inputText" } : block,
      ),
    },
    completedOverride,
    leadingSummary,
    server,
  );
}
export function nativeMcpToolLabel(
  value: unknown,
  language = "zh",
  completedOverride?: boolean,
  leadingSummary = true,
) {
  const item = record(value),
    app = record(item.appContext),
    args = record(item.arguments);
  const completed = completedOverride ?? item.status !== "inProgress",
    failed = item.status === "failed" || !!item.error || item.success === false;
  let key = nativeToolName(item);
  if (key === "js" && text(args.title).trim()) {
    const title = text(args.title).trim().replace(/\s+/g, " ");
    return title.length <= 80 ? title : `${title.slice(0, 79).trimEnd()}…`;
  }
  {
    const presentation =
      item.namespace === "codex_app" && item.server == null
        ? nativeCodexToolPresentation(item, completed, leadingSummary)
        : nativeMcpCodexPresentation(item, completed, leadingSummary);
    const template =
      presentation && descriptor(presentation.descriptorId, language);
    if (template && presentation)
      return formatNativeToolMessage(
        template,
        { state: presentation.state },
        language,
      );
  }
  const connector = (
    text(app.connectorId).replace(/^connector[_-]/i, "") ||
    text(app.appName) ||
    text(item.server)
  )
    .toLowerCase()
    .replace(/[_-]mcp[_-]server$/i, "");
  const state = completed ? "completed" : "active";
  const registered = nativeMcpActivityDescriptor(
    {
      id: text(app.connectorId) || `connector_${connector}`,
      name: text(app.appName) || connector.replaceAll("_", " "),
      pluginDisplayNames: [],
    },
    key,
    item.arguments,
    item.result
      ? {
          ...record(item.result),
          type: failed ? "error" : "success",
          raw: item.result,
        }
      : null,
    completed,
  );
  if (registered) {
    const message =
      descriptor(registered.descriptor.id, language) ??
      registered.descriptor.defaultMessage;
    if (typeof message === "string" && message)
      return formatNativeToolMessage(message, registered.values, language);
  }
  const template =
    descriptor(
      `localConversation.mcpToolActivity.${connector}.${key}.${state}`,
      language,
    ) ??
    (connector === "openai_pages" ||
    item.server === "pages" ||
    key.startsWith("pages_")
      ? descriptor(
          `localConversation.pageToolActivity.${key.replace(/^pages_/, "")}.${state}`,
          language,
        )
      : undefined);
  if (template && !/[{}]/.test(template)) return template;
  const normalized = key.replaceAll("_", " ");
  return normalized
    ? leadingSummary
      ? normalized[0].toUpperCase() + normalized.slice(1)
      : normalized
    : text(item.tool);
}
export function nativePublicReasoning(summary: string[], _running: boolean) {
  const joined = summary.filter(Boolean).join("\n\n");
  const trimmed = joined.trimStart(),
    title = trimmed.match(/^\*\*([^\n]*?)\*\*/);
  return (
    title
      ? trimmed.slice(title[0].length)
      : trimmed.startsWith("**")
        ? ""
        : trimmed
  ).trimStart();
}
/** Native MCP promotes one unannotated JSON text block into the structured result view. */
export function nativeMcpResultPresentation(
  content: unknown,
  structured: unknown,
) {
  const blocks = Array.isArray(content) ? content : [];
  if (blocks.length === 1) {
    const block = record(blocks[0]),
      body = text(block.text).trim();
    if (
      block.type === "text" &&
      block.annotations == null &&
      (body.startsWith("{") || body.startsWith("["))
    ) {
      try {
        const parsed = JSON.parse(body);
        if (
          structured == null ||
          nativeToolJson(parsed) === nativeToolJson(structured)
        )
          return { content: [], structured: structured ?? parsed };
      } catch {
        /* Preserve incomplete JSON as literal text. */
      }
    }
  }
  return { content: blocks, structured };
}
/** JSON diagnostics remain readable when hook protocol fields contain bigint timestamps. */
export function nativeToolJson(value: unknown) {
  return JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}
