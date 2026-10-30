import type { AgentCenterCard } from "@session/stores/useAgentCenterStore";
export const SESSION_WINDOW_INTENTS = "kanban.session.window-intent.v1.";
export const SESSION_WINDOW_ACCEPTED = "kanban.session.window-accepted.v1.";
export type WindowTarget = Pick<AgentCenterCard, "kind" | "id" | "cwd">;
export type WindowAuthority = {
  runtimeInstance: string;
  codexNamespace?: string;
  daemonIdentity?: string;
};
export type SessionWindowRecord = {
  version: 1;
  id: string;
  createdAt: number;
  endpoint: string;
  target: WindowTarget;
  status: "verifying" | "ready" | "failed";
  authority?: WindowAuthority;
};
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= max &&
  !/[\x00-\x1f\x7f]/.test(value);
export function validateWindowTarget(target: WindowTarget) {
  if (
    !target ||
    !["codex", "cc"].includes(target.kind) ||
    !text(target.id, 512) ||
    !text(target.cwd, 4096) ||
    !(target.cwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(target.cwd))
  )
    throw new Error("会话身份或原项目目录尚未确认，未打开其他目标。");
}
export function parseSessionWindowRecord(
  raw: string | null,
  id: string,
): SessionWindowRecord | null {
  if (raw === null) return null;
  if (raw.length > 8192) throw new Error("新窗口会话记录超过读取预算。");
  const value = JSON.parse(raw) as SessionWindowRecord;
  if (
    !value ||
    value.version !== 1 ||
    value.id !== id ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    value.createdAt > Date.now() + 5000 ||
    !text(value.endpoint, 4096) ||
    !["verifying", "ready", "failed"].includes(value.status)
  )
    throw new Error("新窗口会话记录无效，未选择任何输入目标。");
  validateWindowTarget(value.target);
  if (
    value.status === "ready" &&
    (!value.authority ||
      !text(value.authority.runtimeInstance, 512) ||
      (value.target.kind === "codex" &&
        !text(value.authority.codexNamespace, 512)) ||
      (value.authority.daemonIdentity !== undefined &&
        !text(value.authority.daemonIdentity, 512)))
  )
    throw new Error("新窗口来源尚未核实，未选择任何输入目标。");
  return {
    version: 1,
    id: value.id,
    createdAt: value.createdAt,
    endpoint: value.endpoint,
    target: {
      kind: value.target.kind,
      id: value.target.id,
      cwd: value.target.cwd,
    },
    status: value.status,
    ...(value.status === "ready" && value.authority
      ? {
          authority: {
            runtimeInstance: value.authority.runtimeInstance,
            ...(typeof value.authority.codexNamespace === "string"
              ? { codexNamespace: value.authority.codexNamespace }
              : {}),
            ...(typeof value.authority.daemonIdentity === "string"
              ? { daemonIdentity: value.authority.daemonIdentity }
              : {}),
          },
        }
      : {}),
  };
}
export function writeSessionWindowIntent(record: SessionWindowRecord) {
  const serialized = JSON.stringify(record);
  if (serialized.length > 8192) throw new Error("新窗口会话记录超过保存预算。");
  const now = Date.now(),
    keys = Object.keys(localStorage).filter((key) =>
      key.startsWith(SESSION_WINDOW_INTENTS),
    );
  for (const key of keys) {
    try {
      const value = parseSessionWindowRecord(
        localStorage.getItem(key),
        key.slice(SESSION_WINDOW_INTENTS.length),
      );
      if (value && now - value.createdAt > 120_000)
        localStorage.removeItem(key);
    } catch {
      /* A damaged foreign record is preserved for explicit inspection. */
    }
  }
  if (
    !localStorage.getItem(SESSION_WINDOW_INTENTS + record.id) &&
    Object.keys(localStorage).filter((key) =>
      key.startsWith(SESSION_WINDOW_INTENTS),
    ).length >= 16
  )
    throw new Error("已有多个新窗口正在核对，请稍后重试。");
  localStorage.setItem(SESSION_WINDOW_INTENTS + record.id, serialized);
}
