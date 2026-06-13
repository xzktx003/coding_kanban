import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  AGENT_COMPLETION_NOTIFICATIONS_STORAGE_KEY,
  buildAgentCompletionNotificationBody,
  collectAgentCompletionNotificationEvents,
  createVisibilityNotificationTracker,
  formatAgentCompletionNotificationsEnabled,
  getAgentCompletionNotificationPermission,
  loadAgentCompletionNotificationsEnabled,
  parseAgentCompletionNotificationsEnabled,
  saveAgentCompletionNotificationsEnabled,
} from "./agent-completion-notifications.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function makeSession(
  id: string,
  interactionState: AgentSessionRecord["interactionState"],
): AgentSessionRecord {
  return {
    id,
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: id,
    connectionState: "online",
    interactionState,
  };
}

describe("agent completion notifications", () => {
  it("persists notification preference with a disabled default", () => {
    const storage = new MemoryStorage();

    assert.equal(parseAgentCompletionNotificationsEnabled(null), false);
    assert.equal(parseAgentCompletionNotificationsEnabled("disabled"), false);
    assert.equal(parseAgentCompletionNotificationsEnabled("enabled"), true);
    assert.equal(formatAgentCompletionNotificationsEnabled(true), "enabled");
    assert.equal(formatAgentCompletionNotificationsEnabled(false), "disabled");
    assert.equal(loadAgentCompletionNotificationsEnabled(storage), false);

    saveAgentCompletionNotificationsEnabled(true, storage);
    assert.equal(
      storage.getItem(AGENT_COMPLETION_NOTIFICATIONS_STORAGE_KEY),
      "enabled",
    );
    assert.equal(loadAgentCompletionNotificationsEnabled(storage), true);

    saveAgentCompletionNotificationsEnabled(false, storage);
    assert.equal(
      storage.getItem(AGENT_COMPLETION_NOTIFICATIONS_STORAGE_KEY),
      "disabled",
    );
    assert.equal(loadAgentCompletionNotificationsEnabled(storage), false);
  });

  it("reports unsupported notification permission when the browser API is absent", () => {
    const previousNotification = globalThis.Notification;
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: undefined,
    });

    try {
      assert.equal(getAgentCompletionNotificationPermission(), "unsupported");
    } finally {
      Object.defineProperty(globalThis, "Notification", {
        configurable: true,
        value: previousNotification,
      });
    }
  });

  it("emits completion events only for known running sessions that become idle or exited", () => {
    const previous = [
      makeSession("alpha", "running"),
      makeSession("beta", "running"),
      makeSession("gamma", "idle"),
      makeSession("delta", "running"),
    ];
    const current = [
      makeSession("alpha", "idle"),
      makeSession("beta", "exited"),
      makeSession("gamma", "idle"),
      makeSession("delta", "detached"),
      makeSession("new-session", "idle"),
    ];

    assert.deepEqual(
      collectAgentCompletionNotificationEvents(previous, current),
      [
        {
          id: "alpha",
          displayName: "alpha",
          agentKind: "codex",
          interactionState: "idle",
        },
        {
          id: "beta",
          displayName: "beta",
          agentKind: "codex",
          interactionState: "exited",
        },
        {
          id: "delta",
          displayName: "delta",
          agentKind: "codex",
          interactionState: "detached",
        },
      ],
    );
  });

  it("builds a user-facing completion notification body", () => {
    assert.equal(
      buildAgentCompletionNotificationBody({
        id: "alpha",
        displayName: "Claude 修复任务",
        agentKind: "claude",
        interactionState: "idle",
      }),
      "「Claude 修复任务」任务已经完成（已空闲），请及时查看。",
    );
  });

  it("dispatches notifications on visibility change from hidden to visible", () => {
    const dispatched: string[] = [];
    const previousNotification = globalThis.Notification;

    function FakeNotification(_title: string, options?: NotificationOptions) {
      dispatched.push(options?.tag ?? "");
    }
    Object.defineProperty(FakeNotification, "permission", {
      configurable: true,
      value: "granted",
    });
    FakeNotification.requestPermission = async () =>
      "granted" as NotificationPermission;

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: FakeNotification,
    });

    let sessions = [makeSession("s1", "running")];
    const target = new EventTarget() as EventTarget & { hidden: boolean };
    target.hidden = false;

    const cleanup = createVisibilityNotificationTracker(
      () => true,
      () => "granted",
      () => sessions,
      target,
    );

    try {
      target.hidden = true;
      target.dispatchEvent(new Event("visibilitychange"));

      sessions = [makeSession("s1", "idle")];

      target.hidden = false;
      target.dispatchEvent(new Event("visibilitychange"));

      assert.equal(dispatched.length, 1);
      assert.equal(dispatched[0], "agent-completion-s1");
    } finally {
      cleanup();
      Object.defineProperty(globalThis, "Notification", {
        configurable: true,
        value: previousNotification,
      });
    }
  });

  it("does not dispatch visibility notifications when feature is disabled", () => {
    const dispatched: string[] = [];
    const previousNotification = globalThis.Notification;

    function FakeNotification(_title: string, options?: NotificationOptions) {
      dispatched.push(options?.tag ?? "");
    }
    Object.defineProperty(FakeNotification, "permission", {
      configurable: true,
      value: "granted",
    });
    FakeNotification.requestPermission = async () =>
      "granted" as NotificationPermission;

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: FakeNotification,
    });

    let sessions = [makeSession("s1", "running")];
    const target = new EventTarget() as EventTarget & { hidden: boolean };
    target.hidden = false;

    const cleanup = createVisibilityNotificationTracker(
      () => false,
      () => "granted",
      () => sessions,
      target,
    );

    try {
      target.hidden = true;
      target.dispatchEvent(new Event("visibilitychange"));

      sessions = [makeSession("s1", "idle")];

      target.hidden = false;
      target.dispatchEvent(new Event("visibilitychange"));

      assert.equal(dispatched.length, 0);
    } finally {
      cleanup();
      Object.defineProperty(globalThis, "Notification", {
        configurable: true,
        value: previousNotification,
      });
    }
  });
});
