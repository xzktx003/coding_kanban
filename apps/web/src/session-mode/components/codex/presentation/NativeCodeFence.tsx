import { useEffect, useMemo, useRef, useState } from "react";
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
import { useMarkdownSettingsStore } from "@session/stores/settings/useMarkdownSettingsStore";
import { isNativeSvgPreview, nativeSvgPreviewSource } from "./nativeSvgPreview";
import { NativeMarkdownTooltip } from "./NativeMarkdownTooltip";
import { writeNativeMarkdownClipboard } from "./nativeMarkdownClipboard";
import { notifyNativeClipboardError } from "@session/features/native-notifications/nativeClipboardError";

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
}: {
  code: string;
  language: string;
}) {
  const { i18n } = useTranslation();
  const labels = nativeMarkdownLabels(i18n.language ?? "zh");
  const wrap = useMarkdownSettingsStore((state) => state.wordWrap);
  const setWrap = useMarkdownSettingsStore((state) => state.setWordWrap);
  const svgPreview = isNativeSvgPreview(code, language);
  const imageSource = useMemo(
    () => (svgPreview ? nativeSvgPreviewSource(code) : null),
    [code, svgPreview],
  );
  const [highlight, setHighlight] = useState<{
    code: string;
    language: string;
    html: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyPending, setCopyPending] = useState(false);
  const copyLock = useRef(false);
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

    if (svgPreview) {
      setHighlight(null);
      return;
    }
    const apply = (html: string) => {
      if (live) setHighlight({ code, language, html });
    };
    const result = nativeFenceHighlight.highlight({ code, language }, apply);
    if (result !== null) apply(result);
    return () => {
      live = false;
    };
  }, [code, language, svgPreview]);
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
    if (copyLock.current || copied) return;
    copyLock.current = true;
    setCopyPending(true);
    const captured = { code, language };
    try {
      await writeNativeMarkdownClipboard(captured.code);
      if (
        !mounted.current ||
        current.current.code !== captured.code ||
        current.current.language !== captured.language
      )
        return;
      setCopied(true);

      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      notifyNativeClipboardError(i18n.language ?? "zh");
    } finally {
      copyLock.current = false;
      if (mounted.current) setCopyPending(false);
    }
  };
  const suffix = language.replace(/[^a-z0-9_-]/gi, "").slice(0, 30) || "txt";
  return (
    <div
      className="codex-native-code-fence"
      data-streamdown="code-block"
      data-markdown-copy="code-block"
      data-markdown-copy-text={svgPreview ? code : undefined}
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
          {!svgPreview && (
            <NativeMarkdownTooltip
              label={wrap ? labels.wrapOff : labels.wrapOn}
            >
              <button
                type="button"
                aria-label={wrap ? labels.wrapOff : labels.wrapOn}
                aria-pressed={wrap}
                onClick={() => {
                  setWrap(!wrap);
                }}
              >
                <NativeMarkdownIcon name={wrap ? "wrapped" : "wrap"} />
              </button>
            </NativeMarkdownTooltip>
          )}
          <NativeMarkdownTooltip
            label={copied ? labels.copied : labels.copyCode}
          >
            <button
              type="button"
              aria-label={copied ? labels.copied : labels.copyCode}
              aria-busy={copyPending || undefined}
              aria-disabled={copyPending || undefined}
              onClick={
                copied
                  ? undefined
                  : (event) => {
                      event.stopPropagation();
                      void copy();
                    }
              }
            >
              <NativeMarkdownIcon name={copied ? "check" : "copy"} />
            </button>
          </NativeMarkdownTooltip>
        </div>
      </div>
      <pre
        data-streamdown="code-block-body"
        data-wrap={!svgPreview && wrap ? "true" : "false"}
      >
        {svgPreview ? (
          imageSource ? (
            <img
              className="codex-native-svg-preview"
              alt={labels.svgImage}
              src={imageSource}
            />
          ) : null
        ) : result === null ? (
          <code dir="ltr">{code}</code>
        ) : (
          <code dir="ltr" dangerouslySetInnerHTML={{ __html: result }} />
        )}
      </pre>
    </div>
  );
}
