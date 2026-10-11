import { useLayoutEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { NativeNotificationCard } from "./NativeNotificationCard";
export type NoticeLevel = "info" | "success" | "warning" | "danger";
export interface NoticeAction {
  label: ReactNode;
  onClick: () => void;
  loading?: boolean;
}
export interface NoticeOptions {
  id?: string;
  /** Original notification API uses seconds; zero keeps a notice open. */
  duration?: number;
  description?: ReactNode;
  leading?: ReactNode;
  primaryAction?: NoticeAction;
  secondaryAction?: NoticeAction;
  actionPlacement?: "inline" | "block";
  hasCloseButton?: boolean;
  onRemove?: () => void;
  testId?: string;
  position?: "top-center" | "top-right";
}
export interface CustomNoticeOptions extends NoticeOptions {
  level?: NoticeLevel;
  content: (context: { close: () => void; level: NoticeLevel }) => ReactNode;
  onUserDismiss?: () => void;
}
function NoticeLifetime({
  content,
  removed,
  mount,
}: {
  content: ReactNode;
  removed: () => boolean;
  mount: () => () => void;
}) {
  useLayoutEffect(mount, [mount]);
  return removed() ? null : content;
}
let sequence = 0;
/** GAt/KAt contract: queued viewport, logical ID replacement, one removal, captured lifetime. */
export function createNativeNotifications(toasterId: string) {
  let registered = false;
  const pending = new Map<string, () => void>(),
    handles = new Map<string, () => void>(),
    logical = new Map<string, string>();
  function show(
    title: ReactNode,
    options: NoticeOptions | CustomNoticeOptions = {},
    level: NoticeLevel,
  ) {
    const id = `${toasterId}-toast-${++sequence}`;
    let removed = false,
      rendered = false,
      mounted = false;
    const custom = "content" in options;
    if (options.id !== undefined) {
      const previous = logical.get(options.id);
      if (previous) handles.get(previous)?.();
      logical.set(options.id, id);
    }
    function finish() {
      if (removed) return;
      removed = true;
      if (
        handles.size === 1 &&
        document.activeElement instanceof HTMLElement &&
        document.activeElement.closest("[data-sonner-toaster]")
      )
        document.activeElement.blur();
      pending.delete(id);
      handles.delete(id);
      if (options.id !== undefined && logical.get(options.id) === id)
        logical.delete(options.id);
      try {
        options.onRemove?.();
      } catch {
        /* Notice cleanup must continue. */
      }
    }
    function close() {
      if (removed) return;
      if (rendered) toast.dismiss(id);
      finish();
    }
    handles.set(id, close);
    const mount = () => {
      mounted = true;
      const timer =
        level === "success" &&
        options.duration !== 0 &&
        Number.isFinite(options.duration ?? 5) &&
        !custom &&
        !options.primaryAction &&
        !options.secondaryAction
          ? setTimeout(close, (options.duration ?? 5) * 1000)
          : undefined;
      return () => {
        clearTimeout(timer);
        mounted = false;
        queueMicrotask(() => {
          if (!mounted) finish();
        });
      };
    };
    const content = custom ? (
      <div className="codex-native-custom-notice" data-testid={options.testId}>
        {options.content({ close, level })}
      </div>
    ) : (
      <NativeNotificationCard
        title={title}
        level={level}
        {...options}
        onClose={options.hasCloseButton === false ? undefined : close}
      />
    );
    const render = () => {
      if (removed) return;
      rendered = true;
      toast.custom(
        () => (
          <NoticeLifetime
            content={content}
            removed={() => removed}
            mount={mount}
          />
        ),
        {
          id,
          toasterId,
          unstyled: true,
          dismissible: options.hasCloseButton ?? true,
          duration:
            options.duration === 0 ? Infinity : (options.duration ?? 5) * 1000,
          position: options.position,
          onAutoClose: finish,
          onDismiss: () => {
            if (!removed && custom) {
              try {
                options.onUserDismiss?.();
              } catch {
                /* Still finalize the notice. */
              }
            }
            finish();
          },
        },
      );
    };
    pending.set(id, render);
    if (registered) render();
    return { close };
  }
  return {
    registerViewport() {
      registered = true;
      for (const render of pending.values()) render();
      return () => {
        registered = false;
      };
    },
    info: (title: ReactNode, options?: NoticeOptions) =>
      show(title, options, "info"),
    success: (title: ReactNode, options?: NoticeOptions) =>
      show(title, options, "success"),
    warning: (title: ReactNode, options?: NoticeOptions) =>
      show(title, options, "warning"),
    danger: (title: ReactNode, options?: NoticeOptions) =>
      show(title, options, "danger"),
    custom: (options: CustomNoticeOptions) =>
      show(null, options, options.level ?? "info"),
    closeAll() {
      for (const close of [...handles.values()]) close();
    },
  };
}
export const nativeNotifications = createNativeNotifications("codex-native");
if (import.meta.hot)
  import.meta.hot.dispose(() => nativeNotifications.closeAll());
