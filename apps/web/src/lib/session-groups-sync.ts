import {
  addSessionGroup,
  assignSessionToGroup,
  deleteSessionGroup,
  loadSessionGroups,
  renameSessionGroup,
  saveSessionGroups,
  type SessionGroup,
  type SessionGroupState,
} from "./session-groups";

export type GroupAction =
  | { type: "add"; group: SessionGroup; sessionKeys?: string[] }
  | { type: "rename"; groupId: string; name: string }
  | { type: "remove"; groupId: string }
  | { type: "assign"; sessionKeys: string[]; groupId: string | null }
  | { type: "setCollapsed"; key: string; collapsed: boolean };

type Snapshot = SessionGroupState & { initialized: boolean; revision: number };
type Pending = { id: string; order: number; action: GroupAction };
const OP_PREFIX = "coding-kanban-session-group-operation.";
const SNAPSHOT_PREFIX = "coding-kanban-session-group-snapshot.";
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export function applyGroupAction(state: SessionGroupState, action: GroupAction): SessionGroupState {
  if (action.type === "add") {
    const next = addSessionGroup(state, action.group);
    return next.groups.some((group) => group.id === action.group.id) && action.sessionKeys?.length
      ? assignSessionToGroup(next, action.sessionKeys, action.group.id)
      : next;
  }
  if (action.type === "rename") return renameSessionGroup(state, action.groupId, action.name);
  if (action.type === "remove") return deleteSessionGroup(state, action.groupId);
  if (action.type === "assign") {
    if (action.groupId !== null && !state.groups.some((group) => group.id === action.groupId)) return state;
    return assignSessionToGroup(state, action.sessionKeys, action.groupId);
  }
  const collapsedGroupIds = state.collapsedGroupIds.filter((key) => key !== action.key);
  if (action.collapsed) collapsedGroupIds.push(action.key);
  return { ...state, collapsedGroupIds };
}

function pendingOperations(): Pending[] {
  const result: Pending[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(OP_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const entry = JSON.parse(raw) as Pending;
    if (!entry.id || key !== OP_PREFIX + entry.id || !Number.isFinite(entry.order) || !entry.action?.type)
      throw new Error("分组待同步记录无法读取");
    result.push(entry);
  }
  return result.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function latestSnapshot(): Snapshot | undefined {
  let latest: Snapshot | undefined;
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(SNAPSHOT_PREFIX)) continue;
    const revision = Number(key.slice(SNAPSHOT_PREFIX.length));
    if (!Number.isSafeInteger(revision) || revision <= (latest?.revision ?? -1)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const snapshot = JSON.parse(raw) as Snapshot;
    if (snapshot.revision !== revision || typeof snapshot.initialized !== "boolean" || !Array.isArray(snapshot.groups) || !snapshot.assignments || !Array.isArray(snapshot.collapsedGroupIds))
      throw new Error("分组同步快照无法读取");
    latest = snapshot;
  }
  return latest;
}

/** Persist each intent before displaying it; server acknowledgements remove only that intent. */
export function startSessionGroupsSync(
  onState: (state: SessionGroupState) => void,
  onError: (message: string | null) => void,
  fetcher: typeof fetch = fetch,
) {
  const seed = loadSessionGroups();
  let base: Snapshot = { ...seed, initialized: false, revision: -1 };
  let stopped = false;
  let busy = false;
  let requested = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let view = seed;
  const syncId = `group_${newId()}`;

  function publish() {
    const latest = latestSnapshot();
    if (latest && latest.revision >= base.revision) base = latest;
    view = pendingOperations().reduce<SessionGroupState>((state, entry) => applyGroupAction(state, entry.action), base);
    saveSessionGroups(view);
    onState(view);
  }
  function schedule(delay: number) {
    if (stopped) return;
    if (busy) { requested = true; return; }
    clearTimeout(timer);
    timer = setTimeout(() => void sync(), delay);
  }
  async function sync() {
    if (stopped || busy) return;
    busy = true;
    requested = false;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 10_000);
    let failed = false;
    try {
      publish();
      const operation = pendingOperations()[0];
      const post = !base.initialized || Boolean(operation);
      const response = await fetcher("/api/session-groups", {
        method: post ? "POST" : "GET",
        cache: "no-store",
        signal: controller.signal,
        ...(post ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clientId: operation ? `group_${operation.id}` : syncId,
            operations: operation ? [{ seq: 1, action: operation.action }] : [],
            ...(!base.initialized ? { seed } : {}),
          }),
        } : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = await response.json() as Snapshot & { sequence?: number };
      if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || typeof snapshot.initialized !== "boolean" || !Array.isArray(snapshot.groups) || !snapshot.assignments || !Array.isArray(snapshot.collapsedGroupIds) || (operation && snapshot.sequence !== 1))
        throw new Error("分组同步响应无效");
      if (stopped) return;
      localStorage.setItem(SNAPSHOT_PREFIX + snapshot.revision, JSON.stringify(snapshot));
      for (const key of Object.keys(localStorage))
        if (key.startsWith(SNAPSHOT_PREFIX) && Number(key.slice(SNAPSHOT_PREFIX.length)) < snapshot.revision) localStorage.removeItem(key);
      if (operation) localStorage.removeItem(OP_PREFIX + operation.id);
      publish();
      onError(null);
    } catch {
      failed = true;
      if (!stopped) onError("会话分组同步暂不可用，请检查网络与本机存储；系统会重试");
    } finally {
      clearTimeout(timeout);
      busy = false;
      if (!stopped) {
        let hasPending = false;
        try { hasPending = pendingOperations().length > 0; } catch { failed = true; }
        schedule(requested ? 0 : failed ? 5000 : hasPending ? 50 : 2000);
      }
    }
  }
  const wake = () => schedule(0);
  const storage = (event: StorageEvent) => {
    if (event.key?.startsWith(OP_PREFIX) || event.key?.startsWith(SNAPSHOT_PREFIX)) wake();
  };
  window.addEventListener("online", wake);
  window.addEventListener("storage", storage);
  document.addEventListener("visibilitychange", wake);
  schedule(0);
  return {
    getState: () => view,
    dispatch(action: GroupAction) {
      try {
        const pending = pendingOperations();
        const id = newId();
        const entry: Pending = { id, order: Math.max(Date.now(), (pending.at(-1)?.order ?? 0) + 1), action };
        localStorage.setItem(OP_PREFIX + id, JSON.stringify(entry));
        publish();
        schedule(0);
      } catch {
        onError("会话分组修改未能保存到本机，请重试");
      }
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("online", wake);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", wake);
    },
  };
}
