export interface AgentCompletionChime {
  sessionId: string;
  completionId: string;
  agentKind: string;
}

export type TaskCompleteBeepMode = "always" | "unfocused" | "never";

const SETTINGS_KEY = "kanban.session.settings-storage";
const HEARD_CHIMES = 256;
const heardChimes = new Set<string>();

type StorageLike = Pick<Storage, "getItem">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseAgentCompletionChime(
  text: string,
): AgentCompletionChime | null {
  let event: unknown;
  try {
    event = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(event) || event.type !== "completion-chime" || !isRecord(event.payload)) {
    return null;
  }
  const { sessionId, completionId, agentKind } = event.payload;
  if (
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    typeof completionId !== "string" ||
    completionId.length === 0 ||
    typeof agentKind !== "string" ||
    agentKind.length === 0
  ) {
    return null;
  }
  return { sessionId, completionId, agentKind };
}

export function readTaskCompleteBeepMode(
  storage: StorageLike | undefined = globalThis.localStorage,
): TaskCompleteBeepMode {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    const mode = raw
      ? (JSON.parse(raw) as { state?: { enableTaskCompleteBeep?: unknown } })
          .state?.enableTaskCompleteBeep
      : undefined;
    if (mode === "always" || mode === "unfocused" || mode === "never") {
      return mode;
    }
  } catch {
    // Ignore unreadable settings and use the session store default.
  }
  return "always";
}

export function shouldPlayTerminalCompletionChime(
  mode: TaskCompleteBeepMode,
  terminalActive: boolean,
  focus: { hidden: boolean; focused: boolean },
): boolean {
  if (!terminalActive || mode === "never") return false;
  if (mode === "always") return true;
  return focus.hidden || !focus.focused;
}

export function claimTerminalCompletionChime(
  sessionId: string,
  completionId: string,
): boolean {
  const key = `${sessionId}\0${completionId}`;
  if (heardChimes.has(key)) return false;
  heardChimes.add(key);
  while (heardChimes.size > HEARD_CHIMES) {
    const oldest = heardChimes.values().next().value;
    if (oldest === undefined) break;
    heardChimes.delete(oldest);
  }
  return true;
}

export function resetTerminalCompletionChimeClaims(): void {
  heardChimes.clear();
}
