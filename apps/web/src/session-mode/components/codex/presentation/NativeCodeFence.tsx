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

const STREAMING_HIGHLIGHT_DELAY_MS = 120;

function SourceLines({ code }: { code: string }) {
  const lines = code.split("\n");
  return lines.map((line, index) => (
    <span key={index}>
      {index > 0 ? "\n" : null}
      {line}
    </span>
  ));
}

export function NativeCodeFence({
  code,
  language,
  streaming = false,
}: {
  code: string;
  language: string;
  streaming?: boolean;
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
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const fenceRoot = useRef<HTMLDivElement>(null);
  const visible = useRef(true);
  const sawVisible = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(copyTimer.current);
      clearTimeout(highlightTimer.current);
    };
  }, []);
  useEffect(() => {
    setCopied(false);

    if (svgPreview) {
      setHighlight(null);
      return;
    }
    const requested = { code, language };
    const apply = (html: string) => {
      if (!mounted.current || !visible.current) return;
      setHighlight({
        code: requested.code,
        language: requested.language,
        html,
      });
    };
    const start = () => {
      if (!visible.current) return;
      const result = nativeFenceHighlight.highlight(
        requested,
        apply,
        streaming ? { cache: false } : undefined,
      );
      if (result !== null) apply(result);
    };
    const arm = () => {
      clearTimeout(highlightTimer.current);
      if (!visible.current) return;
      if (streaming) highlightTimer.current = setTimeout(start, STREAMING_HIGHLIGHT_DELAY_MS);
      else start();
    };
    arm();
    const node = fenceRoot.current;
    let observer: IntersectionObserver | undefined;
    if (streaming && node && typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver((entries) => {
        const intersecting = entries.at(-1)?.isIntersecting !== false;
        if (intersecting) {
          sawVisible.current = true;
          if (!visible.current) {
            visible.current = true;
            arm();
          }
          return;
        }
        if (!sawVisible.current) return;
        visible.current = false;
        clearTimeout(highlightTimer.current);
      });
      observer.observe(node);
    }
    return () => {
      clearTimeout(highlightTimer.current);
      observer?.disconnect();
    };
  }, [code, language, svgPreview, streaming]);
  const matched =
    highlight &&
    highlight.language === language &&
    (streaming ? code.startsWith(highlight.code) : highlight.code === code)
      ? highlight
      : null;
  const highlightedPrefix =
    matched && streaming && code !== matched.code ? matched.html : null;
  const highlightedSuffix = highlightedPrefix && matched
    ? code.slice(matched.code.length)
    : "";
  const result = highlightedPrefix ? null : (matched?.html ?? null);
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
      ref={fenceRoot}
      className="codex-native-code-fence"
      data-streamdown={streaming ? undefined : "code-block"}
      data-markdown-copy="code-block"
      data-markdown-copy-text={svgPreview ? code : undefined}
      data-language={language}
    >
      <div
        className="codex-native-code-header"
        data-streamdown={streaming ? undefined : "code-block-header"}
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
        data-streamdown={streaming ? undefined : "code-block-body"}
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
        ) : highlightedPrefix ? (
          <code dir="ltr">
            <span dangerouslySetInnerHTML={{ __html: highlightedPrefix }} />
            <span>{highlightedSuffix}</span>
          </code>
        ) : result === null ? (
          <code dir="ltr">{streaming ? <SourceLines code={code} /> : code}</code>
        ) : (
          <code dir="ltr" dangerouslySetInnerHTML={{ __html: result }} />
        )}
      </pre>
    </div>
  );
}
