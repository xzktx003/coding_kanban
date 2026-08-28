export type AppUpdateBannerState =
  | { kind: "idle" }
  | {
      kind: "update-available";
      branch: string | null;
      shortHead: string | null;
    }
  | {
      kind: "remote-update-available";
      branch: string | null;
      shortHead: string | null;
    }
  | {
      kind: "update-conflict";
      branch: string | null;
      shortHead: string | null;
      message: string;
    }
  | {
      kind: "update-error";
      branch: string | null;
      shortHead: string | null;
      message: string;
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
  onPullUpdate: () => void;
  onRetryUpdate: () => void;
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

interface AppUpdateIndicatorProps {
  ariaLabel: string;
  onClick: () => void;
  testId: string;
  title: string;
  warning?: boolean;
}

function AppUpdateIndicator({
  ariaLabel,
  onClick,
  testId,
  title,
  warning = false,
}: AppUpdateIndicatorProps) {
  return (
    <button
      aria-label={ariaLabel}
      aria-live={warning ? "assertive" : "polite"}
      className={`app-update-indicator${warning ? " app-update-indicator--warning" : ""}`}
      data-testid={testId}
      onClick={onClick}
      title={title}
      type="button"
    >
      <span aria-hidden="true" className="app-update-indicator__light" />
    </button>
  );
}

export function AppUpdateBanner({
  state,
  onApplyUpdate,
  onDismiss,
  onPullUpdate,
  onRetryUpdate,
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
      <AppUpdateIndicator
        ariaLabel="检测到新版本，点击更新并恢复"
        onClick={onApplyUpdate}
        testId="apply-app-update"
        title={`${versionLabel || "本地源码已变化"}。点击更新并恢复当前看板和分屏现场`}
      />
    );
  }

  if (state.kind === "remote-update-available") {
    const versionLabel = [
      state.branch,
      state.shortHead ? `@ ${state.shortHead}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <AppUpdateIndicator
        ariaLabel="远程有新版本，点击拉取并更新"
        onClick={onPullUpdate}
        testId="pull-app-update"
        title={`${versionLabel || "当前上游分支已更新"}。点击拉取、热更新并恢复现场`}
      />
    );
  }

  if (state.kind === "update-conflict" || state.kind === "update-error") {
    const versionLabel = [
      state.branch,
      state.shortHead ? `@ ${state.shortHead}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    const label =
      state.kind === "update-conflict"
        ? "检测到新版本，但存在冲突"
        : "自动检查新版本失败";

    return (
      <AppUpdateIndicator
        ariaLabel={`${label}，点击重试`}
        onClick={onRetryUpdate}
        testId="retry-app-update"
        title={`${label}。${versionLabel ? `${versionLabel}。` : ""}${state.message}。点击重试`}
        warning
      />
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
        <div className="app-update-banner__actions">
          <button
            aria-label="关闭历史会话恢复失败提示"
            className="app-update-banner__dismiss"
            data-testid="dismiss-session-restore"
            onClick={onDismiss}
            type="button"
          >
            ×
          </button>
        </div>
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
      <div className="app-update-banner__actions">
        <button
          aria-label="关闭历史会话恢复提示"
          className="app-update-banner__dismiss"
          data-testid="dismiss-session-restore"
          onClick={onDismiss}
          type="button"
        >
          ×
        </button>
      </div>
    </aside>
  );
}
