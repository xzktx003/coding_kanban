import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { NoticeLevel, NoticeOptions, NoticeAction } from "./service";
import { NativeNoticeIcon } from "./NativeNoticeIcons";
export function NativeNotificationCard({
  title,
  level,
  description,
  leading,
  primaryAction,
  secondaryAction,
  actionPlacement,
  onClose,
  testId,
}: NoticeOptions & {
  title: ReactNode;
  level: NoticeLevel;
  onClose?: () => void;
}) {
  const { i18n } = useTranslation();
  const inline = actionPlacement === "inline" || description == null;
  const actions = [secondaryAction, primaryAction].map(
    (action, index) =>
      action && <Action key={index} action={action} primary={index === 1} />,
  );
  return (
    <div
      className="codex-native-alert"
      data-level={level}
      data-inline-center={actionPlacement === "inline" || undefined}
      data-testid={testId}
    >
      <div className="codex-native-alert-row">
        {leading !== null && (
          <div className="codex-native-alert-leading">
            {leading === undefined ? (
              <NativeNoticeIcon name={level} />
            ) : (
              leading
            )}
          </div>
        )}
        <div className="codex-native-alert-body">
          <div className="codex-native-alert-content">
            <div className="codex-native-alert-title">{title}</div>
            {description != null && (
              <div className="codex-native-alert-description">
                {description}
              </div>
            )}
          </div>
          {inline && (primaryAction || secondaryAction) && (
            <div className="codex-native-alert-actions">{actions}</div>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            className="codex-native-alert-close"
            aria-label={
              i18n.language?.startsWith("zh")
                ? "关闭"
                : i18n.language?.startsWith("fr")
                  ? "Fermer"
                  : i18n.language?.startsWith("ja")
                    ? "閉じる"
                    : "Close"
            }
            onClick={onClose}
          >
            <NativeNoticeIcon name="close" />
          </button>
        )}
      </div>
      {!inline && (primaryAction || secondaryAction) && (
        <div className="codex-native-alert-actions codex-native-alert-actions-block">
          {actions}
        </div>
      )}
    </div>
  );
}
function Action({
  action,
  primary,
}: {
  action: NoticeAction;
  primary: boolean;
}) {
  return (
    <button
      type="button"
      className="codex-native-alert-action"
      data-primary={primary || undefined}
      disabled={action.loading}
      onClick={action.onClick}
    >
      {action.loading && (
        <span
          className="codex-native-alert-spinner"
          onAnimationStart={(event) => {
            for (const animation of event.currentTarget.getAnimations())
              animation.startTime = 0;
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12ZM20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12Z"
              fill="currentColor"
              opacity="0.3"
            />
            <path
              d="M12 4C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12H6C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6V4Z"
              fill="currentColor"
            />
          </svg>
        </span>
      )}
      {action.label}
    </button>
  );
}
