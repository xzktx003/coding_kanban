import {
  nativeCodexToolPresentation,
  nativeMcpToolLabel,
} from "./nativeToolSemantics";
import { nativeToolLabels } from "./nativeToolLabels";
const nativePageDynamicTools = new Set([
  "read_artifact",
  "read_page_reference",
  "connect_spaces_artifact",
]);
export type NativeDynamicToolPresentationInput = {
  tool: string;
  namespace?: string | null;
  status?: string;
  completed?: boolean;
  arguments?: unknown;
  contentItems?: unknown;
  success?: boolean | null;
  error?: unknown;
};

/** Native cr: routing identity + explicit renderer identity + descriptor state. */
export function nativeDynamicToolCompletedSummaryKey(
  item: NativeDynamicToolPresentationInput,
) {
  let rendererKey = "";
  const args =
    item.arguments &&
    typeof item.arguments === "object" &&
    !Array.isArray(item.arguments)
      ? (item.arguments as Record<string, unknown>)
      : {};
  if (item.namespace === "codex_app") {
    if (
      item.tool === "handoff_thread" &&
      typeof args.threadId === "string" &&
      args.threadId.length > 0 &&
      (args.destinationHostId === undefined ||
        (typeof args.destinationHostId === "string" &&
          args.destinationHostId.length > 0))
    )
      rendererKey = JSON.stringify([
        args.threadId,
        args.destinationHostId ?? null,
      ]);
    else if (
      item.tool === "get_handoff_status" &&
      typeof args.operationId === "string" &&
      args.operationId.length > 0
    )
      rendererKey = args.operationId;
    else if (nativePageDynamicTools.has(item.tool))
      rendererKey = `localConversation.pageToolActivity.${item.tool}.completed`;
  }
  const presentation =
    item.namespace === "codex_app" || item.namespace == null
      ? nativeCodexToolPresentation(item)
      : null;
  return `${item.namespace}:${item.tool}:${rendererKey}:${presentation?.key ?? ""}`;
}
export function nativeDynamicToolLabel(
  item: NativeDynamicToolPresentationInput,
  language = "zh",
  leadingSummary = true,
) {
  if (item.namespace === "codex_app" || item.namespace == null) {
    const args =
      item.arguments &&
      typeof item.arguments === "object" &&
      !Array.isArray(item.arguments)
        ? (item.arguments as Record<string, unknown>)
        : {};
    if (
      item.namespace === "codex_app" &&
      item.tool === "write_settings" &&
      item.status === "inProgress" &&
      args.config &&
      typeof args.config === "object" &&
      !Array.isArray(args.config)
    )
      return language.startsWith("zh") ? "等待批准" : "Waiting for approval";
    if (nativeCodexToolPresentation(item))
      return nativeMcpToolLabel(
        { ...item, namespace: "codex_app" },
        language,
        undefined,
        leadingSummary,
      );
    if (
      item.namespace === "codex_app" &&
      nativePageDynamicTools.has(item.tool)
    ) {
      const state =
        item.status === "inProgress"
          ? "active"
          : leadingSummary
            ? "completed"
            : "completedFollowing";
      const label =
        nativeToolLabels[
          `localConversation.pageToolActivity.${item.tool}.${state}`
        ];
      if (label) return label[language.startsWith("zh") ? 1 : 0];
    }
  }
  if (item.tool === "read_thread_terminal")
    return language.startsWith("zh")
      ? item.status === "inProgress"
        ? "正在读取聊天终端"
        : "已读取聊天终端"
      : item.status === "inProgress"
        ? "Reading chat terminal"
        : leadingSummary
          ? "Read chat terminal"
          : "read chat terminal";
  const aliases: Record<string, string> =
    item.status === "inProgress"
      ? {
          automation_update: "updating scheduled task",
          load_workspace_dependencies: "loading workspace dependencies",
          pia_slackbot_dm: "Pia Slackbot DM",
        }
      : {
          automation_update: "scheduled task updated",
          load_workspace_dependencies: "loaded workspace dependencies",
          pia_slackbot_dm: "Pia Slackbot DM",
        };
  const name =
    aliases[item.tool] ??
    item.tool
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  return name
    ? leadingSummary
      ? name[0].toUpperCase() + name.slice(1)
      : name
    : item.tool;
}
