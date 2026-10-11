import { createContext, useContext, useMemo, type ReactElement } from "react";
import {
  nativeWebsiteDisplayData,
  nativeWebsitePreviewUrl,
} from "@agent-orchestrator/shared";
import {
  NativeRichLinkPreview,
  type NativeRichPreviewTransport,
} from "./NativeSlackPreview";
import { NativeMarkdownTooltip } from "./NativeMarkdownTooltip";
import { NativeWebsiteIcon } from "./NativeWebsiteIcon";
import { createNativeWebsitePreviewTransport } from "@session/features/native-website/service";
import { useNativeWebsiteCapability } from "@session/features/native-website/capability";
import { useSessionInteractionVisible } from "@session/session-dom";
export const NativeWebsitePreviewHost = createContext<
  NativeRichPreviewTransport<string> | null | undefined
>(undefined);
export function NativeWebsitePreview({
  href,
  children,
}: {
  href: string;
  children: ReactElement;
}) {
  const injected = useContext(NativeWebsitePreviewHost),
    production = useMemo(
      () => createNativeWebsitePreviewTransport(href),
      [href],
    );
  const url = useMemo(() => nativeWebsitePreviewUrl(href), [href]);
  if (url) url.hash = "";
  const visible = useSessionInteractionVisible();
  const available = useNativeWebsiteCapability(
    injected === undefined && !!url && visible,
  );
  if (!url || injected === null || (injected === undefined && !available))
    return (
      <NativeMarkdownTooltip label={href}>{children}</NativeMarkdownTooltip>
    );
  return (
    <NativeRichLinkPreview
      href={href}
      target={url.href}
      host={injected === undefined ? production : injected}
      hostname={url.hostname}
      icon={<NativeWebsiteIcon key={href} href={href} />}
      normalize={nativeWebsiteDisplayData}
      staleTime={(data) =>
        data.status === "ready" && data.image ? 300_000 : 30_000
      }
      className="codex-native-website-preview"
    >
      {children}
    </NativeRichLinkPreview>
  );
}
