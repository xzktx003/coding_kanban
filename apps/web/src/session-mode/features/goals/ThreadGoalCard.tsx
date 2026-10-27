import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ThreadGoal } from "@session/bindings/v2";
import { useCodexStore } from "@session/components/codex/stores";
import { ComposerTooltip } from "@session/components/codex/composer/ComposerTooltip";
import { useComposerRailPresent } from "@session/components/codex/composer/ComposerRail";
import { NativeComposerIcon } from "@session/components/codex/composer/NativeComposerIcon";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@session/components/ui/dialog";
import { codexService } from "@session/services/codexService";
import { threadGoalVersions } from "@session/services/threadGoalState";
import { useSessionInteractionVisible } from "@session/session-dom";
import { GoalIcon } from "./GoalIcon";
import { goalCounter, goalNextStatus, goalStrings } from "./goalPresentation";
import {
  isGoalSubmissionUncertain,
  materializeGoalDraft,
  readGoalObjective,
} from "./goalMaterialization";
import { cleanupRejectedGoal } from "./goalCleanup";
import "./goals.css";

export function GoalDialog({
  title,
  description,
  children,
  onClose,
  busy = false,
  closeButton = false,
  icon,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  closeButton?: boolean;
  icon?: ReactNode;
}) {
  const { i18n } = useTranslation();
  const body = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    // The native animated-height wrapper measures offsetHeight, which rounds
    // its natural fractional content height to a CSS pixel.
    const measure = () => {
      if (element.offsetHeight) setHeight(element.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="session-goal-dialog"
        overlayClassName="session-goal-dialog-overlay"
        showCloseButton={false}
        style={{ height }}
        {...(!description ? { "aria-describedby": undefined } : {})}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <div ref={body} className="session-goal-dialog-body">
          <header
            className="session-goal-dialog-header"
            data-has-icon={!!icon || undefined}
          >
            {icon && <span className="session-goal-dialog-icon">{icon}</span>}
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </header>
          {closeButton && (
            <button
              type="button"
              className="session-goal-dialog-close"
              aria-label={goalStrings(i18n.language).close}
              onClick={() => {
                // Keep the same pending guard as controlled onOpenChange.
                if (!busy) onClose();
              }}
            >
              <GoalIcon name="close" />
            </button>
          )}
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GoalConfirmation({
  kind,
  goal,
  objective,
  onCancel,
  onConfirm,
  busy = false,
}: {
  kind: "replace" | "resume";
  goal: ThreadGoal;
  objective?: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const { i18n } = useTranslation();
  const text = goalStrings(i18n.language);
  const title =
    kind === "replace"
      ? text.replaceTitle
      : goal.status === "paused"
        ? text.resumePausedTitle
        : text.resumeTitle;
  return (
    <GoalDialog
      title={title}
      description={
        kind === "replace" ? text.replaceSubtitle : text.resumeSubtitle
      }
      onClose={onCancel}
      busy={busy}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) onConfirm();
        }}
      >
        <div className="session-goal-confirm-objective">
          {objective ?? goal.objective}
        </div>
        <footer className="session-goal-dialog-footer">
          <button
            type="button"
            className="session-goal-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {kind === "replace"
              ? text.cancel
              : goal.status === "paused"
                ? text.keepPaused
                : text.notNow}
          </button>
          <button
            type="submit"
            className="session-goal-primary"
            disabled={busy}
          >
            {busy && (
              <NativeComposerIcon
                name="spinner"
                className="session-goal-spinner"
              />
            )}
            {kind === "replace" ? text.replace : text.resumeConfirm}
          </button>
        </footer>
      </form>
    </GoalDialog>
  );
}

export function ThreadGoalCard({
  goal,
  disabled = false,
  blockedReason,
}: {
  goal: ThreadGoal;
  disabled?: boolean;
  blockedReason?: string;
}) {
  const { i18n } = useTranslation();
  const labels = goalStrings(i18n.language);
  const railPresent = useComposerRailPresent();
  const railPresentRef = useRef(railPresent);
  railPresentRef.current = railPresent;
  const interactionVisible = useSessionInteractionVisible();
  const visible = interactionVisible && railPresent;
  const [now, setNow] = useState(Date.now);
  const [pending, setPending] = useState<
    "status" | "clear" | "load" | "save" | null
  >(null);
  const lock = useRef(false);
  const load = useRef<AbortController | null>(null);
  const [editor, setEditor] = useState<{
    draft: string;
    saved: string;
    source: string;
    createdAt: number;
  } | null>(null);
  const nextStatus = goalNextStatus(goal.status);
  useEffect(() => {
    if (railPresent) return;
    // A portaled editor does not inherit the exiting rail item's DOM inert.
    // Cancel only our objective read; an already submitted save keeps its
    // existing receipt and cleanup lifecycle.
    const controller = load.current;
    load.current = null;
    controller?.abort();
    if (controller) {
      lock.current = false;
      setPending((current) => (current === "load" ? null : current));
    }
    setEditor(null);
  }, [railPresent]);
  useEffect(() => {
    if (goal.status !== "active" || !visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [goal.status, goal.updatedAt, visible]);
  useEffect(
    () => () => {
      load.current?.abort();
    },
    [goal.threadId, goal.objective, goal.status, goal.createdAt],
  );

  const currentGoal = () => {
    const current = useCodexStore.getState().goalMap[goal.threadId];
    if (
      !current ||
      current.objective !== goal.objective ||
      current.status !== goal.status ||
      current.createdAt !== goal.createdAt
    )
      throw new Error("目标状态已更新，请核对后重试");
    return current;
  };
  const mutate = async (action: "status" | "clear") => {
    if (lock.current || disabled) return;
    lock.current = true;
    setPending(action);
    try {
      currentGoal();
      if (action === "clear")
        await codexService.threadGoalClear({ threadId: goal.threadId });
      else if (nextStatus)
        await codexService.threadGoalSet({
          threadId: goal.threadId,
          status: nextStatus,
        });
    } catch (error) {
      toast.error(action === "clear" ? labels.clearError : labels.statusError, {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      lock.current = false;
      setPending(null);
    }
  };
  const openEditor = async () => {
    if (lock.current || !railPresentRef.current) return;
    lock.current = true;
    setPending("load");
    const controller = new AbortController();
    load.current = controller;
    let objective = goal.objective;
    try {
      objective = await readGoalObjective(goal.objective, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted)
        toast.error(labels.loadError, {
          description: error instanceof Error ? error.message : undefined,
        });
    } finally {
      if (load.current === controller) {
        load.current = null;
        lock.current = false;
        setPending(null);
        if (!controller.signal.aborted && railPresentRef.current)
          setEditor({
            draft: objective,
            saved: objective,
            source: goal.objective,
            createdAt: goal.createdAt,
          });
      }
    }
  };
  const save = async () => {
    if (
      !editor ||
      lock.current ||
      disabled ||
      !editor.draft.trim() ||
      editor.draft.trim() === editor.saved
    )
      return;
    const snapshot = editor;
    const runtime = threadGoalVersions.capture(goal.threadId);
    lock.current = true;
    setPending("save");
    let materialized: Awaited<ReturnType<typeof materializeGoalDraft>> | null =
      null;
    let submitting = false;
    try {
      codexService.assertThreadGoalReady(goal.threadId);
      currentGoal();
      if (
        snapshot.source !== goal.objective ||
        snapshot.createdAt !== goal.createdAt
      )
        throw new Error("目标内容已更新，请重新打开编辑器");
      materialized = await materializeGoalDraft({
        objective: snapshot.draft.trim(),
        images: [],
        mentions: [],
      });
      if (!threadGoalVersions.sameRuntime(runtime))
        throw new Error("连接目标已切换，请核对目标草稿后重试");
      currentGoal();
      submitting = true;
      await codexService.threadGoalSet({
        threadId: goal.threadId,
        objective: materialized.objective,
        status: "active",
      });
      materialized = null;
      setEditor(null);
    } catch (error) {
      if (materialized && (!submitting || !isGoalSubmissionUncertain(error)))
        await cleanupRejectedGoal(materialized, labels);
      toast.error(labels.saveError, {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      lock.current = false;
      setPending(null);
    }
  };
  const action = (
    kind: "clear" | "status" | "edit",
    label: string,
    icon: "trash" | "pause-circle" | "play-circle" | "edit-expand",
  ) => (
    <ComposerTooltip label={label} popupOpen={!!editor} key={kind}>
      <button
        type="button"
        className="session-goal-action"
        aria-label={label}
        disabled={!!pending || (kind !== "edit" && disabled)}
        title={kind !== "edit" ? blockedReason : undefined}
        onClick={() => void (kind === "edit" ? openEditor() : mutate(kind))}
      >
        {(kind === "status" && pending === "status") ||
        (kind === "clear" && pending === "clear") ||
        (kind === "edit" && pending === "load") ? (
          <NativeComposerIcon name="spinner" className="session-goal-spinner" />
        ) : (
          <GoalIcon name={icon} />
        )}
      </button>
    </ComposerTooltip>
  );
  return (
    <>
      <div
        className="session-thread-goal"
        data-goal-status={goal.status}
        data-goal-thread={goal.threadId}
      >
        <div className="session-goal-row">
          <button
            type="button"
            className="session-goal-open"
            disabled={!!pending}
            onClick={() => void openEditor()}
          >
            <span className="session-goal-leading">
              <GoalIcon name="goal" />
            </span>
            <span className="session-goal-summary">
              <span className="session-goal-status">
                {labels.status[goal.status]}
              </span>
              <span className="session-goal-objective">
                {goal.objective}
                <span aria-hidden="true"> •</span>
              </span>
              <span className="session-goal-counter">
                {goalCounter(goal, now, i18n.language)}
              </span>
            </span>
          </button>
          <div className="session-goal-actions">
            {action("clear", labels.clear, "trash")}
            {nextStatus &&
              action(
                "status",
                nextStatus === "paused" ? labels.pause : labels.resume,
                nextStatus === "paused" ? "pause-circle" : "play-circle",
              )}
            {action("edit", labels.edit, "edit-expand")}
          </div>
        </div>
      </div>
      {railPresent && editor && (
        <GoalDialog
          title={labels.edit}
          onClose={() => setEditor(null)}
          busy={pending === "save"}
          closeButton
          icon={<GoalIcon name="goal" />}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void save();
            }}
            onKeyDown={(event) => {
              if (
                (event.key === "Enter" || event.key.toLowerCase() === "s") &&
                (event.metaKey || event.ctrlKey) &&
                !event.defaultPrevented &&
                !event.repeat &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.stopPropagation();
                void save();
              }
            }}
          >
            <textarea
              aria-label={labels.goal}
              rows={12}
              autoFocus
              value={editor.draft}
              disabled={pending === "save"}
              onChange={(event) =>
                setEditor({ ...editor, draft: event.target.value })
              }
            />
            {blockedReason && (
              <p role="status" className="session-goal-error">
                {blockedReason}
              </p>
            )}
            <footer className="session-goal-dialog-footer">
              <button
                type="button"
                className="session-goal-secondary"
                disabled={pending === "save"}
                onClick={() => setEditor(null)}
              >
                {labels.cancel}
              </button>
              <button
                type="submit"
                className="session-goal-primary"
                disabled={
                  disabled ||
                  !!pending ||
                  !editor.draft.trim() ||
                  editor.draft.trim() === editor.saved
                }
              >
                {pending === "save" && (
                  <NativeComposerIcon
                    name="spinner"
                    className="session-goal-spinner"
                  />
                )}
                {labels.save}
              </button>
            </footer>
          </form>
        </GoalDialog>
      )}
    </>
  );
}
