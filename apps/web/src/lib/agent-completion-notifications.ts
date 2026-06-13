import type {
  AgentSessionRecord,
  InteractionState,
} from "@agent-orchestrator/shared";

export const AGENT_COMPLETION_NOTIFICATIONS_STORAGE_KEY =
  "agent-completion-notifications";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type AgentCompletionNotificationPermission =
  | NotificationPermission
  | "unsupported";

export interface AgentCompletionNotificationEvent {
  id: string;
  displayName: string;
  agentKind: string;
  interactionState: InteractionState;
}

interface NotificationConstructorLike {
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  new (title: string, options?: NotificationOptions): Notification;
}

function getNotificationConstructor(): NotificationConstructorLike | null {
  if (typeof globalThis.Notification === "undefined") {
    return null;
  }

  return globalThis.Notification;
}

export function parseAgentCompletionNotificationsEnabled(
  value: string | null,
): boolean {
  return value === "enabled";
}

export function formatAgentCompletionNotificationsEnabled(
  enabled: boolean,
): string {
  return enabled ? "enabled" : "disabled";
}

export function loadAgentCompletionNotificationsEnabled(
  storage: StorageLike | undefined = globalThis.localStorage,
): boolean {
  try {
    return parseAgentCompletionNotificationsEnabled(
      storage?.getItem(AGENT_COMPLETION_NOTIFICATIONS_STORAGE_KEY) ?? null,
    );
  } catch {
    return false;
  }
}

export function saveAgentCompletionNotificationsEnabled(
  enabled: boolean,
  storage: StorageLike | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(
      AGENT_COMPLETION_NOTIFICATIONS_STORAGE_KEY,
      formatAgentCompletionNotificationsEnabled(enabled),
    );
  } catch {
    // ignore storage failures
  }
}

export function getAgentCompletionNotificationPermission(): AgentCompletionNotificationPermission {
  const notificationApi = getNotificationConstructor();
  return notificationApi?.permission ?? "unsupported";
}

export async function requestAgentCompletionNotificationPermission(): Promise<AgentCompletionNotificationPermission> {
  const notificationApi = getNotificationConstructor();
  if (!notificationApi) {
    return "unsupported";
  }

  return notificationApi.requestPermission();
}

export function isAgentCompletionState(state: InteractionState): boolean {
  return state === "idle" || state === "exited" || state === "detached";
}

export function collectAgentCompletionNotificationEvents(
  previousSessions: AgentSessionRecord[],
  currentSessions: AgentSessionRecord[],
): AgentCompletionNotificationEvent[] {
  const previousById = new Map(
    previousSessions.map((session) => [session.id, session]),
  );

  return currentSessions
    .filter((session) => {
      const previous = previousById.get(session.id);
      return (
        previous?.interactionState === "running" &&
        isAgentCompletionState(session.interactionState)
      );
    })
    .map((session) => ({
      id: session.id,
      displayName: session.displayName,
      agentKind: session.agentKind,
      interactionState: session.interactionState,
    }));
}

export function buildAgentCompletionNotificationBody(
  event: AgentCompletionNotificationEvent,
): string {
  const stateLabel = event.interactionState === "exited" ? "已退出" : "已空闲";
  return `「${event.displayName}」任务已经完成（${stateLabel}），请及时查看。`;
}

export function dispatchAgentCompletionNotification(
  event: AgentCompletionNotificationEvent,
): boolean {
  const notificationApi = getNotificationConstructor();
  if (!notificationApi || notificationApi.permission !== "granted") {
    return false;
  }

  new notificationApi("Coding Kanban 任务完成", {
    body: buildAgentCompletionNotificationBody(event),
    tag: `agent-completion-${event.id}`,
  });
  return true;
}

interface VisibilityTarget {
  hidden: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export function createVisibilityNotificationTracker(
  getEnabled: () => boolean,
  getPermission: () => AgentCompletionNotificationPermission,
  getCurrentSessions: () => AgentSessionRecord[] | null,
  target: VisibilityTarget = document,
) {
  let hiddenSnapshot: AgentSessionRecord[] | null = null;

  function handleVisibilityChange() {
    if (target.hidden) {
      hiddenSnapshot = getCurrentSessions();
      return;
    }

    if (
      !hiddenSnapshot ||
      !getEnabled() ||
      getPermission() !== "granted"
    ) {
      hiddenSnapshot = null;
      return;
    }

    const currentSessions = getCurrentSessions();
    if (currentSessions) {
      collectAgentCompletionNotificationEvents(
        hiddenSnapshot,
        currentSessions,
      ).forEach(dispatchAgentCompletionNotification);
    }
    hiddenSnapshot = null;
  }

  target.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    target.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
