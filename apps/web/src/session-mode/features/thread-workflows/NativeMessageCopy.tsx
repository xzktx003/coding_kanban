import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { NativeMessageCopy as CopyIcon } from "./NativeMessageIcons";
import { cleanMarkdown } from "./model";
export function NativeMessageCopy({ text }: { text: string }) {
  const { i18n } = useTranslation();
  const zh = i18n?.language?.startsWith("zh") ?? true;
  const [copied, setCopied] = useState(false);
  const pending = useRef(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const label = copied
    ? zh
      ? "已复制"
      : "Copied"
    : zh
      ? "复制消息"
      : "Copy message";
  return (
    <button
      type="button"
      className="codex-native-copy"
      aria-label={label}
      title={label}
      disabled={!text.trim()}
      onClick={() => {
        if (pending.current || copied) return;
        pending.current = true;
        void navigator.clipboard
          .writeText(cleanMarkdown(text, i18n?.language ?? "en"))
          .then(
            () => {
              setCopied(true);
              timer.current = window.setTimeout(() => setCopied(false), 1500);
            },
            () => toast.error(zh ? "未能复制消息" : "Could not copy message"),
          )
          .finally(() => (pending.current = false));
      }}
    >
      {copied ? (
        <Check size={16} aria-hidden />
      ) : (
        <CopyIcon width={16} height={16} />
      )}
    </button>
  );
}
