import {
  nativeSlackResult,
  nativeSlackTarget,
  type NativeSlackData,
  type NativeSlackTarget,
} from "@agent-orchestrator/shared";
import { object, type Json, type JsonObject } from "../core/json.js";
import type { Rpc } from "./ownership.js";
import {
  ReadOnlyMcpPreviewService,
  type McpPreviewTool,
} from "./mcp-preview.js";
const short = (value: unknown, limit = 1024): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  !/[\x00-\x1f]/u.test(value);
const copy = (value: string) => Array.from(value).join("");
/** Native state-5eb F: accept exactly one Slack action with a trusted target URI. */
export function selectSlackPreviewTool(
  statuses: Json[],
  target: NativeSlackTarget,
): McpPreviewTool | null {
  const action =
    target.kind === "profile" ? "slack_read_user_profile" : "slack_read_thread";
  const found: McpPreviewTool[] = [];
  for (const value of statuses) {
    const server = object(value);
    if (server.name !== "codex_apps") continue;
    for (const value of Object.values(object(server.tools))) {
      const tool = object(value),
        meta = object(tool._meta),
        apps = object(meta._codex_apps);
      const connector = meta.connectorId ?? meta.connector_id;
      if (
        (meta.connectorId !== undefined &&
          typeof meta.connectorId !== "string") ||
        (meta.connector_id !== undefined &&
          typeof meta.connector_id !== "string") ||
        (meta.link_id !== undefined && typeof meta.link_id !== "string")
      )
        continue;
      if (
        meta.connector_name !== "Slack" ||
        !short(tool.name, 512) ||
        !short(connector, 512) ||
        !short(apps.resource_uri, 4096) ||
        (apps.synthetic_link !== undefined && apps.synthetic_link !== false)
      )
        continue;
      const [root, id, scope, operation, extra] = apps.resource_uri.split("/");
      if (
        root !== "" ||
        !id ||
        id !== connector.trim() ||
        !scope ||
        operation !== action ||
        extra !== undefined
      )
        continue;
      // The native Slack schema intentionally forwards only these metadata fields.
      found.push({
        server: "codex_apps",
        tool: copy(tool.name),
        connectorId: copy(id),
        targetId: copy(scope),
        metadata: {
          connector_name: "Slack",
          _codex_apps: {
            resource_uri: copy(apps.resource_uri),
            ...(apps.synthetic_link === false ? { synthetic_link: false } : {}),
          },
        },
      });
    }
  }
  return found.length === 1 ? found[0] : null;
}

export class SlackPreviewService extends ReadOnlyMcpPreviewService<
  NativeSlackTarget,
  NativeSlackData
> {
  constructor(raw: Rpc, instance: string, now = Date.now) {
    super(
      raw,
      instance,
      {
        target: nativeSlackTarget,
        select: selectSlackPreviewTool,
        unavailable: { status: "unavailable" },
        decode: nativeSlackResult,
        arguments: (target): JsonObject =>
          target.kind === "profile"
            ? { user_id: target.userId, response_format: "detailed" }
            : {
                channel_id: target.channelId,
                message_ts: target.threadTs,
                limit: target.messageTs === target.threadTs ? 1 : 100,
                response_format: "concise",
                include_structured_content: true,
              },
      },
      now,
    );
  }
}
