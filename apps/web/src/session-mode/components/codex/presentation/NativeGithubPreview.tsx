import { createContext, useContext, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  nativeGithubPullRequest,
  nativeGithubResult,
  nativeGithubDisplayData,
  type NativeGithubPullRequest,
} from "@agent-orchestrator/shared";
import {
  NativeRichLinkPreview,
  type NativeRichPreviewTransport,
} from "./NativeSlackPreview";
import { NativeGithubIcon } from "./NativeGithubIcon";
import { NativeWebsitePreview } from "./NativeWebsitePreview";
import { createNativeMcpPreviewTransport } from "@session/features/native-slack/mcpTransport";
import type { NativeSlackData } from "./nativeSlackPreview";

export type NativeGithubPreviewTransport =
  NativeRichPreviewTransport<NativeGithubPullRequest>;
/** Native ug("1892621033"): unknown/off gates must retain the ordinary URL tooltip. */
export const NativeGithubPreviewHost = createContext<{
  enabled: boolean;
  transport?: NativeGithubPreviewTransport | null;
}>({ enabled: false });
const normalize = (
  value: unknown,
  target: NativeGithubPullRequest,
): NativeSlackData => {
  const data = nativeGithubResult(value, target);
  // The adapter formats lifecycle details; raw MCP fields never enter the rich tooltip.
  return data
    ? { status: "ready", title: data.title, description: data.status }
    : { status: "unavailable" };
};
export function NativeGithubPreview({
  href,
  children,
}: {
  href: string;
  children: ReactElement;
}) {
  const { enabled, transport: injected } = useContext(NativeGithubPreviewHost),
    { i18n } = useTranslation();
  const production = useMemo(
    () =>
      createNativeMcpPreviewTransport(href, {
        target: nativeGithubPullRequest,
        path: "/api/codex/mcp/github-preview",
        label: "GitHub preview identity",
        normalize(value): NativeSlackData {
          const display =
            value && typeof value === "object"
              ? (value as Record<string, unknown>)
              : null;
          const data = nativeGithubDisplayData(
            display?.status === "ready"
              ? { title: display.title, status: display.description }
              : value,
          );
          return data
            ? { status: "ready", title: data.title, description: data.status }
            : { status: "unavailable" };
        },
      }),
    [href],
  );
  const transport = injected === undefined ? production : injected;
  const target = useMemo(() => nativeGithubPullRequest(href), [href]);
  const zh = (i18n.language ?? "zh").startsWith("zh"),
    ja = (i18n.language ?? "").startsWith("ja");
  const details = target
    ? `${target.owner}/${target.repository} · #${target.number}`
    : "";
  const labels: Record<string, string> = zh
    ? { draft: "草稿", open: "已打开", closed: "已关闭", merged: "已合并" }
    : ja
      ? {
          draft: "ドラフト",
          open: "オープン",
          closed: "クローズ",
          merged: "マージ済み",
        }
      : { draft: "Draft", open: "Open", closed: "Closed", merged: "Merged" };
  if (!enabled || !target)
    return <NativeWebsitePreview href={href}>{children}</NativeWebsitePreview>;
  return (
    <NativeRichLinkPreview
      href={href}
      target={target}
      host={transport}
      hostname={target.hostname}
      icon={<NativeGithubIcon />}
      normalize={normalize}
      format={(data) => ({
        ...data,
        description:
          data.description && labels[data.description]
            ? `${details} · ${labels[data.description]}`
            : details,
      })}
      fallback={{ status: "ready", title: null, description: details }}
      className="codex-native-github-preview"
    >
      {children}
    </NativeRichLinkPreview>
  );
}
