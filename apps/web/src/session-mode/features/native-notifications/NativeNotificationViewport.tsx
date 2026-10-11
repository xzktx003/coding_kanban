import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Toaster } from "sonner";
import { nativeNotifications } from "./service";
import {
  notificationViewportBounds,
  observeNotificationBoundary,
} from "./viewportBounds";
import "./notifications.css";
/** Kept mounted inside the session root: hidden mode neither owns shortcuts nor disposes work. */
export function NativeNotificationViewport() {
  const { i18n } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const { bounds } = useSyncExternalStore(
    notificationViewportBounds.subscribe,
    notificationViewportBounds.getSnapshot,
    notificationViewportBounds.getSnapshot,
  );
  useEffect(() => nativeNotifications.registerViewport(), []);
  useEffect(() => {
    const session = root.current?.closest<HTMLElement>(".session-mode");
    if (session) return observeNotificationBoundary("session-root", session);
  }, []);
  return (
    <div
      ref={root}
      className="codex-native-toast-area"
      style={bounds ?? { inset: 0 }}
    >
      <span
        className="codex-native-toast-position"
        style={{ insetInlineEnd: 0 }}
      >
        <span className="codex-native-toast-width">
          <Toaster
            id="codex-native"
            className="codex-native-sonner-toaster"
            containerAriaLabel={
              i18n.language?.startsWith("zh") ? "通知" : "Notifications"
            }
            gap={8}
            mobileOffset={0}
            offset={0}
            position="top-center"
            swipeDirections={["right"]}
            visibleToasts={3}
            toastOptions={{
              unstyled: true,
              className: "codex-native-toast",
              classNames: {
                content: "codex-native-toast-contents",
                title: "codex-native-toast-contents",
              },
            }}
          />
        </span>
      </span>
    </div>
  );
}
