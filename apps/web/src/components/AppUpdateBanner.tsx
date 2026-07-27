export type AppUpdateBannerState =
  | { kind: "idle" }
  | {
      kind: "update-available";
      branch: string | null;
      shortHead: string | null;
    }
  | { kind: "restoring"; total: number }
  | {
      kind: "restore-complete";
      restored: number;
      manualRecovery: number;
    }
  | {
      kind: "restore-failed";
      restored: number;
      failures: string[];
    };

interface AppUpdateBannerProps {
  state: AppUpdateBannerState;
  onApplyUpdate: () => void;
  onDismiss: () => void;
}

export const RESTORE_COMPLETE_AUTO_DISMISS_MS = 5_000;
export const RESTORE_FAILED_AUTO_DISMISS_MS = 10_000;

export function getRestoreBannerAutoDismissMs(
  state: AppUpdateBannerState,
): number | null {
  if (state.kind === "restore-complete") {
    return RESTORE_COMPLETE_AUTO_DISMISS_MS;
  }

  if (state.kind === "restore-failed") {
    return RESTORE_FAILED_AUTO_DISMISS_MS;
  }

  return null;
}

export function shouldAutoDismissRestoreBanner(
  state: AppUpdateBannerState,
): boolean {
  return getRestoreBannerAutoDismissMs(state) !== null;
}

export function AppUpdateBanner({
  state,
  onApplyUpdate,
  onDismiss,
}: AppUpdateBannerProps) {
  if (state.kind === "idle") {
    return null;
  }

  if (state.kind === "update-available") {
    const versionLabel = [
      state.branch,
      state.shortHead ? `@ ${state.shortHead}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <aside
        aria-live="polite"
        className="app-update-banner app-update-banner--available"
        data-testid="app-update-banner"
      >
        <div className="app-update-banner__copy">
          <strong>检测到新版本</strong>
          <span>
            {versionLabel || "本地源码已变化"}。更新前会保存当前看板和分屏现场。
          </span>
        </div>
        <div className="app-update-banner__actions">
          <button
            data-testid="apply-app-update"
            onClick={onApplyUpdate}
            type="button"
          >
            更新并恢复
          </button>
          <button
            aria-label="关闭版本更新提示"
            className="app-update-banner__dismiss"
            data-testid="dismiss-app-update"
            onClick={onDismiss}
            type="button"
          >
            ×
          </button>
        </div>
      </aside>
    );
  }

  if (state.kind === "restoring") {
    return (
      <aside
        aria-live="polite"
        className="app-update-banner app-update-banner--restoring"
        data-testid="session-restore-banner"
      >
        <div className="app-update-banner__copy">
          <strong>正在恢复历史会话</strong>
          <span>
            {state.total > 0
              ? `正在恢复 ${state.total} 个受管 tmux 会话`
              : "正在读取更新前保存的看板现场"}
          </span>
        </div>
      </aside>
    );
  }

  if (state.kind === "restore-failed") {
    return (
      <aside
        aria-live="polite"
        className="app-update-banner app-update-banner--warning"
        data-testid="session-restore-banner"
      >
        <div className="app-update-banner__copy">
          <strong>历史会话部分恢复失败</strong>
          <span>已恢复 {state.restored} 个会话</span>
          <ul>
            {state.failures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        </div>
        <button
          aria-label="关闭历史会话恢复失败提示"
          className="app-update-banner__dismiss"
          data-testid="dismiss-session-restore"
          onClick={onDismiss}
          type="button"
        >
          ×
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-live="polite"
      className="app-update-banner app-update-banner--restored"
      data-testid="session-restore-banner"
    >
      <div className="app-update-banner__copy">
        <strong>历史会话已恢复</strong>
        <span>
          已恢复 {state.restored} 个受管 tmux 会话
          {state.manualRecovery > 0
            ? `；${state.manualRecovery} 个 direct 会话需要手动恢复`
            : ""}
        </span>
      </div>
      <button
        aria-label="关闭历史会话恢复提示"
        className="app-update-banner__dismiss"
        data-testid="dismiss-session-restore"
        onClick={onDismiss}
        type="button"
      >
        ×
      </button>
    </aside>
  );
}
