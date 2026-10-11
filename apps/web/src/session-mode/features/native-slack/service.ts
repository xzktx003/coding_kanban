import {
  nativeSlackDisplayData,
  nativeSlackTarget,
} from "@agent-orchestrator/shared";
import type { NativeSlackPreviewTransport } from "@session/components/codex/presentation/NativeSlackPreview";
import { createNativeMcpPreviewTransport } from "./mcpTransport";
export function createNativeSlackPreviewTransport(
  href: string,
): NativeSlackPreviewTransport {
  return createNativeMcpPreviewTransport(href, {
    target: nativeSlackTarget,
    normalize: nativeSlackDisplayData,
    path: "/api/codex/mcp/slack-preview",
    label: "Slack preview identity",
  });
}
