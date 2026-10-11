import {
  nativeGithubPullRequest,
  nativeGithubResult,
  type NativeGithubData,
  type NativeGithubPullRequest,
} from "@agent-orchestrator/shared";
import { object, type Json, type JsonObject } from "../core/json.js";
import type { Rpc } from "./ownership.js";
import {
  ReadOnlyMcpPreviewService,
  type McpPreviewTool,
} from "./mcp-preview.js";
const short = (v: unknown, limit = 4096): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= limit &&
  !/[\x00-\x1f]/u.test(v);
function target(value: Json, mode: "info" | "fetch"): McpPreviewTool | null {
  const tool = object(value),
    meta = object(tool._meta),
    apps = object(meta._codex_apps),
    connector = meta.connectorId ?? meta.connector_id;
  if (
    meta.connector_name !== "GitHub" ||
    !short(tool.name, 512) ||
    !short(connector, 512) ||
    !short(apps.resource_uri) ||
    (meta.connectorId !== undefined && typeof meta.connectorId !== "string") ||
    (meta.connector_id !== undefined &&
      typeof meta.connector_id !== "string") ||
    (meta.link_id !== undefined && typeof meta.link_id !== "string")
  )
    return null;
  if (
    (apps.synthetic_link !== undefined &&
      typeof apps.synthetic_link !== "boolean") ||
    (mode === "info" && apps.synthetic_link === true)
  )
    return null;
  const [root, cid, tid, action, extra] = apps.resource_uri.split("/");
  if (
    root !== "" ||
    cid !== connector.trim() ||
    !tid ||
    !action ||
    extra !== undefined
  )
    return null;
  const serialized = JSON.stringify(apps);
  if (serialized.length > 16_384) return null;
  const metadata: JsonObject = JSON.parse(serialized);
  return {
    server: "codex_apps",
    tool: tool.name,
    connectorId: cid,
    targetId: tid,
    mode,
    explicitLink: apps.requires_explicit_link_id === true,
    metadata: { connector_name: "GitHub", _codex_apps: metadata },
  };
}
/** Native BRt/ZD/nO: first detail server; fetch is preferred only for the selected info link. */
export function selectGithubPreviewTool(
  statuses: Json[],
): McpPreviewTool | null {
  for (const entry of statuses) {
    const server = object(entry),
      tools = object(server.tools),
      infoMeta = object(object(tools["github.get_pr_info"])._meta);
    if (server.name !== "codex_apps" || infoMeta.connector_name !== "GitHub")
      continue;
    const info = target(tools["github.get_pr_info"], "info");
    if (!info) return null;
    const fetch = target(tools["github.fetch"], "fetch");
    if (!fetch || fetch.connectorId !== info.connectorId) return info;
    if (fetch.targetId === info.targetId) return fetch;
    // Native link_accounts permits selecting the same linked account on the fetch tool.
    const links = object(object(tools["github.fetch"])._meta).link_accounts;
    if (
      Array.isArray(links) &&
      links.every((v) => short(object(v).link_id)) &&
      links.some((v) => object(v).link_id === info.targetId)
    )
      return { ...fetch, targetId: info.targetId, explicitLink: true };
    return info;
  }
  return null;
}
export class GithubPreviewService extends ReadOnlyMcpPreviewService<
  NativeGithubPullRequest,
  NativeGithubData | null
> {
  constructor(raw: Rpc, instance: string, now = Date.now) {
    super(
      raw,
      instance,
      {
        target: nativeGithubPullRequest,
        select: selectGithubPreviewTool,
        unavailable: null,
        decode: (value, request, tool) =>
          nativeGithubResult(value, request, tool.mode),
        arguments(request, tool): JsonObject {
          const repository = `${request.owner.toLowerCase()}/${request.repository.toLowerCase()}`;
          return {
            ...(tool.mode === "fetch"
              ? {
                  url: `https://api.github.com/repos/${repository}/pulls/${request.number}`,
                }
              : {
                  pr_number: request.number,
                  repository_full_name: repository,
                }),
            ...(tool.explicitLink ? { link_id: tool.targetId } : {}),
          };
        },
      },
      now,
    );
  }
}
