import { lazy, useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useSessionInteractionVisible } from "@session/session-dom";
import { DeferredComposerPanel } from "@session/components/codex/composer/DeferredComposerPanel";
import { nativeNotifications } from "../native-notifications/service";
import { feedbackUploads } from "./service";
import { feedbackUploadLabels } from "./messages";
const FeedbackUploadReport = lazy(() =>
  import("./FeedbackUploadReport").then((module) => ({
    default: module.FeedbackUploadReport,
  })),
);
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
    <DeferredComposerPanel
      key={active.id}
      label="反馈上传状态"
      onClose={() => feedbackUploads.dismiss(active.id)}
    >
      <FeedbackUploadReport report={active} />
    </DeferredComposerPanel>
  ) : null;
}
