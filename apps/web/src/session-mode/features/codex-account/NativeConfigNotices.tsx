import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@session/components/ui/dialog";
import { readTextFile } from "@session/services/apiAdapt/filesystem";
import {
  useNativeConfigNoticeStore,
  type NativeConfigNotice,
} from "./config-notices";
import "./account-native.css";
// Exact agent-settings ie = app-initial-e98 c5/Bd (16px notice glyph).
function NativeConfigWarningIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 9.8a.767.767 0 1 1 0 1.533A.767.767 0 0 1 8 9.8Zm0-5.134c.368 0 .667.299.667.667V8a.667.667 0 0 1-1.334 0V5.333c0-.368.299-.667.667-.667Z" />
      <path
        fillRule="evenodd"
        d="M8 1.333a6.667 6.667 0 1 1 0 13.334A6.667 6.667 0 0 1 8 1.333Zm0 1.334a5.333 5.333 0 1 0 0 10.666A5.333 5.333 0 0 0 8 2.667Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
const readablePath = (path: string | undefined): path is string =>
  Boolean(
    path &&
    path.length <= 4096 &&
    path.startsWith("/") &&
    !/[\x00-\x1f]/.test(path),
  );
function NoticeMarkdown({ value }: { value: string }) {
  return (
    <ReactMarkdown
      components={{
        a: ({ href, children }) =>
          href && /^https?:\/\//i.test(href) ? (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ) : (
            <code>{children}</code>
          ),
      }}
    >
      {value}
    </ReactMarkdown>
  );
}
function ConfigFilePreview({ notice }: { notice: NativeConfigNotice }) {
  const { t } = useTranslation("thread");
  const [content, setContent] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    let active = true;
    setContent(null);
    setError(null);
    if (readablePath(notice.path))
      void readTextFile(notice.path, { suppressToast: true }).then(
        (value) => {
          if (active) setContent(value);
        },
        (reason) => {
          if (active)
            setError(reason instanceof Error ? reason.message : String(reason));
        },
      );
    return () => {
      active = false;
    };
  }, [notice.id]);
  useEffect(() => {
    if (content !== null && notice.range)
      pre.current
        ?.querySelector(`[data-config-line="${notice.range.start.line}"]`)
        ?.scrollIntoView?.({ block: "center" });
  }, [content, notice.range]);
  const range = notice.range;
  return (
    <>
      <DialogTitle>{notice.path}</DialogTitle>
      {error ? (
        <p role="status">{error}</p>
      ) : content === null ? (
        <p role="status">{t("accountUsage.loadingFile")}</p>
      ) : (
        <pre
          ref={pre}
          className="codex-native-config-source"
          aria-label={t("accountUsage.readOnlyFile")}
        >
          {content.split("\n").map((text, index) => {
            const line = index + 1,
              chars = Array.from(text);
            const selected =
              range && line >= range.start.line && line <= range.end.line;
            const start = selected
              ? line === range.start.line
                ? range.start.column - 1
                : 0
              : 0;
            const end = selected
              ? line === range.end.line
                ? range.end.column - 1
                : chars.length
              : 0;
            return (
              <span
                className="codex-native-config-source__line"
                data-config-line={line}
                key={line}
              >
                <span
                  aria-hidden="true"
                  className="codex-native-config-source__number"
                >
                  {line}
                </span>
                <code>
                  {selected ? (
                    <>
                      {chars.slice(0, start).join("")}
                      <mark>{chars.slice(start, end).join("")}</mark>
                      {chars.slice(end).join("")}
                    </>
                  ) : (
                    text || " "
                  )}
                </code>
              </span>
            );
          })}
        </pre>
      )}
    </>
  );
}
export function NativeConfigNotices() {
  const { t } = useTranslation("thread");
  const notices = useNativeConfigNoticeStore((state) => state.notices);
  const [selected, setSelected] = useState<NativeConfigNotice | null>(null);
  if (!notices.length) return null;
  return (
    <section
      className="codex-presentation codex-native-config-notices"
      aria-label={t("accountUsage.configNotices")}
    >
      {notices.map((notice) => (
        <aside
          key={notice.id}
          role="alert"
          className="codex-native-config-notice"
          data-notice-kind={notice.kind}
        >
          <NativeConfigWarningIcon />
          <div className="codex-native-config-notice__layout">
            <div className="codex-native-config-notice__content">
              <NoticeMarkdown value={notice.summary} />
              {notice.details && <NoticeMarkdown value={notice.details} />}
              {notice.path && (
                <p>
                  {t("accountUsage.file")}:{" "}
                  <code>
                    {notice.path}
                    {notice.range
                      ? `:${notice.range.start.line}:${notice.range.start.column}`
                      : ""}
                  </code>
                </p>
              )}
            </div>
            {readablePath(notice.path) && (
              <button
                type="button"
                onClick={() => setSelected(structuredClone(notice))}
              >
                {t("accountUsage.openFile")}
              </button>
            )}
          </div>
        </aside>
      ))}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent
          className="codex-presentation codex-native-config-preview"
          size="xl"
        >
          {selected && <ConfigFilePreview notice={selected} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
