import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { nativeNotifications } from "../native-notifications/service";
import * as Primitive from "@radix-ui/react-dialog";
import {
  Dialog,
  DialogPortal,
  DialogTitle,
} from "@session/components/ui/dialog";
import { useComposerSheetHistory } from "@session/components/codex/composer/v2/useComposerSheetHistory";
import { NativeComposerIcon } from "@session/components/codex/composer/NativeComposerIcon";
import { NativeMarkdownTooltip } from "@session/components/codex/presentation/NativeMarkdownTooltip";
import { writeNativeMarkdownClipboard } from "@session/components/codex/presentation/nativeMarkdownClipboard";
import { activeDraftOwner } from "@session/stores/useInputStore";
import {
  isSessionInteractionVisible,
  useSessionInteractionVisible,
} from "@session/session-dom";
import type { FeedbackReport } from "./controller";
import { feedbackUploads } from "./service";
import { feedbackUploadLabels } from "./messages";
import { ReportIcon } from "./ReportIcons";
import "@session/components/codex/composer/native-feedback.css";
import "./report.css";

function CopyId({ value }: { value: string }) {
  const { i18n } = useTranslation(),
    labels = feedbackUploadLabels(i18n.language ?? "zh");
  const [copied, setCopied] = useState(false),
    [busy, setBusy] = useState(false),
    lock = useRef(false),
    live = useRef(true),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    live.current = true;
    setCopied(false);
    return () => {
      live.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  return (
    <NativeMarkdownTooltip label={copied ? labels.copied : labels.copy}>
      <button
        className="feedback-id-copy"
        data-copied={copied || undefined}
        type="button"
        aria-label={copied ? labels.copied : labels.copy}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        onClick={async (e) => {
          e.stopPropagation();
          if (lock.current || copied) return;
          const captured = value;
          lock.current = true;
          setBusy(true);
          try {
            await writeNativeMarkdownClipboard(captured);
            if (live.current) {
              setCopied(true);
              timer.current = setTimeout(() => setCopied(false), 2000);
            }
          } catch {
            nativeNotifications.danger(labels.copyError, {
              id: "copy-to-clipboard-error",
              description: labels.copyErrorDescription,
            });
          } finally {
            lock.current = false;
            if (live.current) setBusy(false);
          }
        }}
      >
        {copied ? (
          <NativeComposerIcon name="check" width="12" height="12" />
        ) : (
          <ReportIcon name="copy" width="12" height="12" />
        )}
      </button>
    </NativeMarkdownTooltip>
  );
}
export function FeedbackUploadReport({ report }: { report: FeedbackReport }) {
  const { i18n } = useTranslation(),
    labels = feedbackUploadLabels(i18n.language ?? "zh");
  const { status, correlationId } = report;
  const retry = status === "failed";
  const message =
    correlationId === null && status === "uploading"
      ? labels.uploadingNoId
      : correlationId === null && status === "failed"
        ? labels.failedNoId
        : labels.messages[status];
  const issue =
    "https://github.com/openai/codex/issues/new?template=2-extension.yml" +
    (correlationId === null
      ? ""
      : "&steps=" + encodeURIComponent("Feedback ID: " + correlationId));
  const parts = message.split(/(\{openIssueLink\}|\{existingIssueLink\})/);
  const visible = useComposerSheetHistory(() =>
    feedbackUploads.dismiss(report.id),
  );
  if (!visible) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) feedbackUploads.dismiss(report.id);
      }}
    >
      <DialogPortal>
        <Primitive.Content
          className="codex-native-feedback codex-feedback-report"
          aria-describedby={undefined}
          onKeyDownCapture={(e) => {
            // A focused copy tooltip must not consume the dialog's first Escape.
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              feedbackUploads.dismiss(report.id);
            }
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (
              isSessionInteractionVisible() &&
              activeDraftOwner() === report.owner
            )
              document
                .querySelector<HTMLElement>(
                  ".session-codex-composer [contenteditable=true]",
                )
                ?.focus();
          }}
        >
          <div className="feedback-report-body">
            <div className="feedback-report-section feedback-report-header">
              <span className="feedback-report-status-icon">
                {status === "uploading" ? (
                  <span
                    className="feedback-report-spinner"
                    onAnimationStart={(e) => {
                      for (const animation of e.currentTarget.getAnimations())
                        animation.startTime = 0;
                    }}
                  >
                    <NativeComposerIcon name="spinner" width="20" height="20" />
                  </span>
                ) : (
                  <ReportIcon
                    aria-hidden={false}
                    data-feedback-error={
                      status !== "uploaded" && status !== "incomplete"
                        ? ""
                        : undefined
                    }
                    name={
                      status === "uploaded" || status === "incomplete"
                        ? "success"
                        : "failure"
                    }
                    width="20"
                    height="20"
                  />
                )}
              </span>
              <DialogTitle aria-live="polite" aria-atomic="true">
                {labels.titles[status]}
              </DialogTitle>
            </div>
            <div className="feedback-report-section feedback-report-content">
              <p>
                {parts.map((part, index) =>
                  part === "{openIssueLink}" ? (
                    <a
                      key={index}
                      href={issue}
                      onClick={(e) => e.stopPropagation()}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {labels.openIssue}
                    </a>
                  ) : part === "{existingIssueLink}" ? (
                    <a
                      key={index}
                      href="https://github.com/openai/codex/issues"
                      onClick={(e) => e.stopPropagation()}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {labels.existingIssue}
                    </a>
                  ) : (
                    part
                  ),
                )}
              </p>
              <div className="feedback-report-id-container">
                {correlationId !== null && (
                  <div className="feedback-report-id">
                    <div>
                      <div className="feedback-report-id-label">
                        {labels.id}
                      </div>
                      <code>{correlationId}</code>
                    </div>
                    <CopyId value={correlationId} />
                  </div>
                )}
              </div>
            </div>
            <div className="feedback-report-section feedback-report-footer">
              {retry && (
                <button
                  type="button"
                  className="feedback-report-secondary"
                  onClick={() => feedbackUploads.dismiss(report.id)}
                >
                  {labels.dismiss}
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  retry
                    ? feedbackUploads.retry(report.id)
                    : feedbackUploads.dismiss(report.id)
                }
              >
                {retry ? labels.retry : labels.dismiss}
              </button>
            </div>
          </div>
          <Primitive.Close className="feedback-close" aria-label={labels.close}>
            <ReportIcon name="close" width="16" height="16" />
          </Primitive.Close>
        </Primitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
export function NativeFeedbackUploads() {
  const reports = useSyncExternalStore(
      feedbackUploads.subscribe,
      feedbackUploads.getSnapshot,
    ),
    visible = useSessionInteractionVisible(),
    { i18n } = useTranslation(),
    labels = feedbackUploadLabels(i18n.language ?? "zh");
  const notices = useRef(new Map<string, symbol>());
  const handles = useRef(new Map<string, { close: () => void }>());
  useEffect(() => {
    const next = new Map<string, symbol>();
    if (visible)
      for (const report of reports) {
        if (!report.notification) continue;
        const id = "codex-" + report.id;
        const instance = Symbol(id);
        next.set(id, instance);
        const method =
          report.status === "uploading"
            ? nativeNotifications.info
            : report.status === "uploaded"
              ? nativeNotifications.success
              : nativeNotifications.warning;
        notices.current.set(id, instance);
        handles.current.get(id)?.close();
        const handle = method(labels.toasts[report.status], {
          id,
          duration: 0,
          onRemove: () => {
            if (
              notices.current.get(id) === instance &&
              feedbackUploads.getSnapshot().find((r) => r.id === report.id)
                ?.notification
            )
              feedbackUploads.remove(report.id);
          },
          primaryAction: {
            label: labels.view,
            onClick: () => feedbackUploads.reopen(report.id),
          },
        });
        handles.current.set(id, handle);
      }
    const removed = [...notices.current.keys()].filter((id) => !next.has(id));
    notices.current = next;
    for (const id of removed) {
      handles.current.get(id)?.close();
      handles.current.delete(id);
    }
  }, [reports, visible, labels]);
  useEffect(
    () => () => {
      const removed = [...notices.current.keys()];
      notices.current.clear();
      for (const id of removed) handles.current.get(id)?.close();
      handles.current.clear();
    },
    [],
  );
  const active = reports.filter((r) => r.open).at(-1);
  return visible && active ? (
    <FeedbackUploadReport key={active.id} report={active} />
  ) : null;
}
