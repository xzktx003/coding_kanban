import type { ThemeContextType } from "@session/contexts/ThemeContext";
export const PLAN_WINDOW_STORAGE_PREFIX = "kanban.session.plan-window:";
export const planWindowChannel = (id: string) => "kanban.plan-window." + id;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_AGE = 30 * 60_000;
export interface StoredPlanSnapshot {
  version: 1;
  createdAt: number;
  text: string;
  threadId?: string;
  turnId?: string;
  cwd?: string | null;
  language: string;
  rootClassName: string;
  cssVariables: Record<string, string>;
  theme: Pick<
    ThemeContextType,
    "theme" | "resolvedTheme" | "accent" | "starfield" | "backgroundImage"
  >;
}
type SnapshotInput = Omit<StoredPlanSnapshot, "version" | "createdAt">;
function validate(value: unknown, now: number): StoredPlanSnapshot {
  if (!value || typeof value !== "object")
    throw new Error("计划窗口快照无效，请从原会话重新打开。");
  const snapshot = value as StoredPlanSnapshot;
  const bounded = (text: unknown, size: number) =>
    typeof text === "string" &&
    text.length <= size &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
  if (typeof snapshot.text !== "string" || snapshot.text.length > 1_000_000)
    throw new Error("计划内容过长或无效，请在原会话展开查看。");
  if (
    snapshot.version !== 1 ||
    !Number.isFinite(snapshot.createdAt) ||
    snapshot.createdAt > now + 5000 ||
    !bounded(snapshot.text, 1_000_000) ||
    !bounded(snapshot.language, 40) ||
    !bounded(snapshot.rootClassName, 4096) ||
    !snapshot.rootClassName.split(/\s+/).includes("session-mode") ||
    (snapshot.threadId !== undefined && !bounded(snapshot.threadId, 500)) ||
    (snapshot.turnId !== undefined && !bounded(snapshot.turnId, 500)) ||
    (snapshot.cwd != null && !bounded(snapshot.cwd, 4096)) ||
    !snapshot.theme ||
    !["dark", "light", "system"].includes(snapshot.theme.theme) ||
    !["dark", "light"].includes(snapshot.theme.resolvedTheme) ||
    !bounded(snapshot.theme.accent, 40) ||
    typeof snapshot.theme.starfield !== "boolean" ||
    (snapshot.theme.backgroundImage != null &&
      !bounded(snapshot.theme.backgroundImage, 16_384)) ||
    !snapshot.cssVariables ||
    typeof snapshot.cssVariables !== "object" ||
    Array.isArray(snapshot.cssVariables) ||
    Object.entries(snapshot.cssVariables).some(
      ([key, entry]) =>
        !/^--[a-zA-Z0-9_-]+$/.test(key) || !bounded(entry, 16_384),
    ) ||
    JSON.stringify(snapshot.cssVariables).length > 256_000
  )
    throw new Error("计划窗口快照无效，请从原会话重新打开。");
  if (now - snapshot.createdAt > MAX_AGE)
    throw new Error("计划窗口快照已过期，请从原会话重新打开。");
  return Object.freeze({
    ...snapshot,
    theme: Object.freeze({ ...snapshot.theme }),
    cssVariables: Object.freeze({ ...snapshot.cssVariables }),
  });
}
export function savePlanWindowSnapshot(
  input: SnapshotInput,
  storage: Storage = sessionStorage,
  now = Date.now(),
): string {
  const snapshot = validate(
    structuredClone({ ...input, version: 1, createdAt: now }),
    now,
  );
  const id = crypto.randomUUID();
  const old = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  ).filter(
    (key): key is string => !!key?.startsWith(PLAN_WINDOW_STORAGE_PREFIX),
  );
  for (const key of old.slice(0, Math.max(0, old.length - 7)))
    storage.removeItem(key);
  storage.setItem(PLAN_WINDOW_STORAGE_PREFIX + id, JSON.stringify(snapshot));
  return id;
}
export function readPlanWindowSnapshot(
  id: string,
  storage: Storage = sessionStorage,
  now = Date.now(),
): StoredPlanSnapshot {
  if (!ID.test(id)) throw new Error("计划窗口标识无效，请从原会话重新打开。");
  const text = storage.getItem(PLAN_WINDOW_STORAGE_PREFIX + id);
  if (text == null) throw new Error("计划窗口快照不存在，请从原会话重新打开。");
  if (text.length > 1_300_000)
    throw new Error("计划窗口快照无效，请从原会话重新打开。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("计划窗口快照无效，请从原会话重新打开。");
  }
  return validate(parsed, now);
}
export function planWindowUrl(currentUrl: string, id: string): string {
  if (!ID.test(id)) throw new Error("计划窗口标识无效。");
  const url = new URL(currentUrl);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.searchParams.set("mode", "session");
  url.searchParams.set("planWindow", id);
  return url.href;
}
export function isPlanWindowRoute(url = location.href): boolean {
  return new URL(url).searchParams.has("planWindow");
}
