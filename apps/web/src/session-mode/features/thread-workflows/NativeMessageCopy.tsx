import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  NativeMessageCopy as CopyIcon,
  NativeMessageCopied,
} from "./NativeMessageIcons";
import { NativeMarkdownTooltip } from "../../components/codex/presentation/NativeMarkdownTooltip";
import { cleanMarkdown } from "./model";
import { useNativeCopyFeedback } from "../../components/codex/presentation/useNativeCopyFeedback";
import { nativeMessageClipboard } from "../../components/codex/presentation/nativeMessageClipboard";
export function NativeMessageCopy({
  text,
  kind = "user",
  contentRef,
}: {
  text: string;
  kind?: "user" | "assistant";
  contentRef?: RefObject<HTMLElement | null>;
}) {
  const { i18n } = useTranslation();
  const zh = i18n?.language?.startsWith("zh") ?? true;
  const { copied, copyPending, copy } = useNativeCopyFeedback(
    [text, kind, contentRef],
    {
      feedbackMs: kind === "assistant" ? 2000 : 1500,
      language: i18n?.language ?? "zh",
    },
  );
  const label = copied
    ? zh
      ? "已复制"
      : "Copied"
    : zh
      ? kind === "assistant"
        ? "复制回复"
        : "复制消息"
      : kind === "assistant"
        ? "Copy response"
        : "Copy message";
  return (
    <NativeMarkdownTooltip label={label}>
      <button
        type="button"
        className="codex-native-copy"
        aria-label={label}
        disabled={!text.trim()}
        aria-busy={(kind === "assistant" && copyPending) || undefined}
        aria-disabled={(kind === "assistant" && copyPending) || undefined}
        onClick={() => {
          if (copyPending || copied) return;
          const body = contentRef?.current;
          const rendered = body
            ? nativeMessageClipboard(
                body.querySelector<HTMLElement>(".codex-markdown") ?? body,
                { kind, includeCollapsedContent: kind === "user" },
              )
            : null;
          copy(
            kind === "assistant"
              ? cleanMarkdown(text, i18n?.language ?? "zh")
              : (rendered?.text ?? cleanMarkdown(text, i18n?.language ?? "zh")),
            true,
            rendered?.html,
          );
        }}
      >
        {copied ? (
          <NativeMessageCopied width={16} height={16} />
        ) : (
          <CopyIcon width={16} height={16} />
        )}
      </button>
    </NativeMarkdownTooltip>
  );
}
