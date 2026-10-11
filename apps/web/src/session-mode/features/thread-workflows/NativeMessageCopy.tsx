import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { notifyNativeClipboardError } from "../native-notifications/nativeClipboardError";
import {
  NativeMessageCopy as CopyIcon,
  NativeMessageCopied,
} from "./NativeMessageIcons";
import { NativeMarkdownTooltip } from "../../components/codex/presentation/NativeMarkdownTooltip";
import { cleanMarkdown } from "./model";
import { writeNativeMarkdownClipboard } from "../../components/codex/presentation/nativeMarkdownClipboard";
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
  const [copied, setCopied] = useState(false);
  const [copyPending, setCopyPending] = useState(false);
  const pending = useRef(false);
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);
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
          if (pending.current || copied) return;
          pending.current = true;
          if (kind === "assistant") setCopyPending(true);
          const body = contentRef?.current;
          const rendered = body
            ? nativeMessageClipboard(
                body.querySelector<HTMLElement>(".codex-markdown") ?? body,
                { kind },
              )
            : null;
          void writeNativeMarkdownClipboard(
            kind === "assistant"
              ? cleanMarkdown(text, i18n?.language ?? "zh")
              : (rendered?.text ?? cleanMarkdown(text, i18n?.language ?? "zh")),
            rendered?.html,
          )
            .then(
              () => {
                if (!mounted.current) return;
                setCopied(true);
                timer.current = window.setTimeout(
                  () => setCopied(false),
                  kind === "assistant" ? 2000 : 1500,
                );
              },
              () => notifyNativeClipboardError(i18n?.language ?? "zh"),
            )
            .finally(() => {
              pending.current = false;
              if (mounted.current) setCopyPending(false);
            });
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
