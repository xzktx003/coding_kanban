import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { bundledLanguagesInfo } from "shiki";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import { nativeFenceHighlight } from "./nativeFenceHighlight";
import { NativeMarkdownIcon } from "./NativeMarkdownIcons";
import { nativeMarkdownLabels } from "./nativeMarkdownLabels";

export function downloadNativeText(
  text: string,
  filename: string,
  mime = "text/plain",
) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function NativeCodeFence({
  code,
  language,
  initialWrap = false,
  onWrapChange,
}: {
  code: string;
  language: string;
  initialWrap?: boolean;
  onWrapChange?: (wrap: boolean) => void;
}) {
  const { i18n } = useTranslation();
  const labels = nativeMarkdownLabels(i18n.language ?? "zh");
  const [wrap, setWrap] = useState(initialWrap);
  const [highlight, setHighlight] = useState<{
    code: string;
    language: string;
    html: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef({ code, language });
  current.current = { code, language };
  const mounted = useRef(true);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(copyTimer.current);
    };
  }, []);
  useEffect(() => {
    let live = true;
    setCopied(false);
    setError(null);
    const apply = (html: string) => {
      if (live) setHighlight({ code, language, html });
    };
    const result = nativeFenceHighlight.highlight({ code, language }, apply);
    if (result !== null) apply(result);
    return () => {
      live = false;
    };
  }, [code, language]);
  const result =
    highlight?.code === code && highlight.language === language
      ? highlight.html
      : null;
  const info = bundledLanguagesInfo.find(
    (info) => info.id === language || info.aliases?.includes(language),
  );
  const title =
    info?.name ?? (language && language !== "text" ? language : "Text");
  const copy = async () => {
    const captured = { code, language };
    try {
      await navigator.clipboard.writeText(captured.code);
      if (
        !mounted.current ||
        current.current.code !== captured.code ||
        current.current.language !== captured.language
      )
        return;
      setCopied(true);
      setError(null);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      if (
        mounted.current &&
        current.current.code === captured.code &&
        current.current.language === captured.language
      )
        setError(error instanceof Error ? error.message : labels.failed);
    }
  };
  const suffix = language.replace(/[^a-z0-9_-]/gi, "").slice(0, 30) || "txt";
  return (
    <div
      className="codex-native-code-fence"
      data-streamdown="code-block"
      data-language={language}
    >
      <div
        className="codex-native-code-header"
        data-streamdown="code-block-header"
        data-markdown-copy="exclude"
      >
        <NativeMarkdownIcon name="code" />
        <span className="codex-native-code-title">{title}</span>
        <div className="codex-native-code-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="codex-native-markdown-more"
                aria-label={labels.moreCode}
                title={labels.moreCode}
              >
                <NativeMarkdownIcon name="more" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="codex-presentation codex-native-markdown-menu">
              <DropdownMenuItem
                onSelect={() => downloadNativeText(code, `code.${suffix}`)}
              >
                {labels.downloadCode}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            aria-label={wrap ? labels.wrapOff : labels.wrapOn}
            title={wrap ? labels.wrapOff : labels.wrapOn}
            aria-pressed={wrap}
            onClick={() => {
              const next = !wrap;
              setWrap(next);
              onWrapChange?.(next);
            }}
          >
            <NativeMarkdownIcon name="wrap" />
          </button>
          <button
            type="button"
            aria-label={copied ? labels.copied : labels.copy}
            title={copied ? labels.copied : labels.copy}
            onClick={() => void copy()}
          >
            <NativeMarkdownIcon name={copied ? "check" : "copy"} />
          </button>
        </div>
      </div>
      <pre
        data-streamdown="code-block-body"
        data-wrap={wrap ? "true" : "false"}
      >
        {result === null ? (
          <code>{code}</code>
        ) : (
          <code dangerouslySetInnerHTML={{ __html: result }} />
        )}
      </pre>
      {error ? (
        <div className="codex-native-markdown-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
