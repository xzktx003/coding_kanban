import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AppUpdateBanner,
  RESTORE_COMPLETE_AUTO_DISMISS_MS,
  RESTORE_FAILED_AUTO_DISMISS_MS,
  getRestoreBannerAutoDismissMs,
  shouldAutoDismissRestoreBanner,
} from "./AppUpdateBanner.js";

test("renders an explicit update action without applying it automatically", () => {
  const markup = renderToStaticMarkup(
    createElement(AppUpdateBanner, {
      state: {
        kind: "update-available",
        branch: "feature/hot-update",
        shortHead: "01234567",
      },
      onApplyUpdate: () => {},
      onDismiss: () => {},
      onPullUpdate: () => {},
      onRetryUpdate: () => {},
    }),
  );

  assert.match(markup, /检测到新版本/);
  assert.match(markup, /feature\/hot-update/);
  assert.match(markup, /更新并恢复/);
  assert.match(markup, /data-testid="apply-app-update"/);
  assert.match(markup, /data-testid="dismiss-app-update"/);
  assert.match(markup, /aria-label="关闭版本更新提示"/);
});

test("offers a user-confirmed pull when the remote branch advances", () => {
  const markup = renderToStaticMarkup(
    createElement(AppUpdateBanner, {
      state: {
        kind: "remote-update-available",
        branch: "v1.3.0",
        shortHead: "89abcdef",
      },
      onApplyUpdate: () => {},
      onDismiss: () => {},
      onPullUpdate: () => {},
      onRetryUpdate: () => {},
    }),
  );

  assert.match(markup, /远程有新版本/);
  assert.match(markup, /确认后才会拉取/);
  assert.match(markup, /拉取并更新/);
  assert.match(markup, /data-testid="pull-app-update"/);
  assert.doesNotMatch(markup, /data-testid="apply-app-update"/);
});

test("requires explicit confirmation before retrying a conflicted pull", () => {
  const markup = renderToStaticMarkup(
    createElement(AppUpdateBanner, {
      state: {
        kind: "update-conflict",
        branch: "v1.3.0",
        shortHead: "89abcdef",
        message: "本地未提交修改会被远程版本覆盖",
      },
      onApplyUpdate: () => {},
      onDismiss: () => {},
      onPullUpdate: () => {},
      onRetryUpdate: () => {},
    }),
  );

  assert.match(markup, /检测到新版本，但存在冲突/);
  assert.match(markup, /本地未提交修改会被远程版本覆盖/);
  assert.match(markup, /重新拉取并更新/);
  assert.match(markup, /data-testid="retry-app-update"/);
  assert.doesNotMatch(markup, /data-testid="apply-app-update"/);
});

test("renders visible managed-session restore progress and failures", () => {
  const restoring = renderToStaticMarkup(
    createElement(AppUpdateBanner, {
      state: {
        kind: "restoring",
        total: 3,
      },
      onApplyUpdate: () => {},
      onDismiss: () => {},
      onPullUpdate: () => {},
      onRetryUpdate: () => {},
    }),
  );
  assert.match(restoring, /正在恢复 3 个受管 tmux 会话/);

  const failed = renderToStaticMarkup(
    createElement(AppUpdateBanner, {
      state: {
        kind: "restore-failed",
        restored: 2,
        failures: ["agent-3: tmux 会话不存在"],
      },
      onApplyUpdate: () => {},
      onDismiss: () => {},
      onPullUpdate: () => {},
      onRetryUpdate: () => {},
    }),
  );
  assert.match(failed, /已恢复 2 个会话/);
  assert.match(failed, /agent-3: tmux 会话不存在/);
  assert.match(failed, /data-testid="dismiss-session-restore"/);
  assert.match(failed, /aria-label="关闭历史会话恢复失败提示"/);
  assert.match(
    failed,
    /app-update-banner__actions[\s\S]*dismiss-session-restore/,
  );
});

test("assigns close actions and state-specific auto-dismiss delays to restore results", () => {
  const restoredState = {
    kind: "restore-complete" as const,
    restored: 2,
    manualRecovery: 0,
  };
  const markup = renderToStaticMarkup(
    createElement(AppUpdateBanner, {
      state: restoredState,
      onApplyUpdate: () => {},
      onDismiss: () => {},
      onPullUpdate: () => {},
      onRetryUpdate: () => {},
    }),
  );

  assert.match(markup, /历史会话已恢复/);
  assert.match(markup, /data-testid="dismiss-session-restore"/);
  assert.match(markup, /aria-label="关闭历史会话恢复提示"/);
  assert.match(
    markup,
    /app-update-banner__actions[\s\S]*dismiss-session-restore/,
  );
  assert.equal(RESTORE_COMPLETE_AUTO_DISMISS_MS, 5_000);
  assert.equal(RESTORE_FAILED_AUTO_DISMISS_MS, 10_000);
  assert.equal(getRestoreBannerAutoDismissMs(restoredState), 5_000);
  assert.equal(shouldAutoDismissRestoreBanner(restoredState), true);
  assert.equal(
    shouldAutoDismissRestoreBanner({ kind: "restoring", total: 2 }),
    false,
  );
  assert.equal(
    shouldAutoDismissRestoreBanner({
      kind: "restore-failed",
      restored: 1,
      failures: ["failed"],
    }),
    true,
  );
  assert.equal(
    getRestoreBannerAutoDismissMs({
      kind: "restore-failed",
      restored: 1,
      failures: ["failed"],
    }),
    10_000,
  );
  assert.equal(
    getRestoreBannerAutoDismissMs({ kind: "restoring", total: 2 }),
    null,
  );
});
