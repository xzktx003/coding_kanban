import type {
  CodexTabAction,
  CodexTabOperation,
  SharedCodexTabs,
} from "@agent-orchestrator/shared";

export const CODEX_TAB_OPERATION_PREFIX = "kanban.codex.tab-operation.";
export const CODEX_TAB_REVISION_PREFIX = "kanban.codex.tab-snapshot.";

type Entry = { order: number; operation: CodexTabOperation & { id: string } };

export function latestCodexTabSnapshot(): SharedCodexTabs | undefined {
  let latest: SharedCodexTabs | undefined;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(CODEX_TAB_REVISION_PREFIX)) continue;
    const revision = Number(key.slice(CODEX_TAB_REVISION_PREFIX.length));
    if (!Number.isSafeInteger(revision) || revision <= (latest?.revision ?? -1)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const snapshot = JSON.parse(raw) as SharedCodexTabs;
    if (snapshot.revision !== revision || !Array.isArray(snapshot.threads) || typeof snapshot.initialized !== "boolean")
      throw new Error("Codex 关注快照无法读取");
    latest = snapshot;
  }
  return latest;
}

export function latestCodexTabRevision(): number {
  return latestCodexTabSnapshot()?.revision ?? -1;
}

export function observeCodexTabSnapshot(snapshot: SharedCodexTabs) {
  if (snapshot.revision <= latestCodexTabRevision()) return;
  localStorage.setItem(CODEX_TAB_REVISION_PREFIX + snapshot.revision, JSON.stringify({
    initialized: snapshot.initialized, revision: snapshot.revision, threads: snapshot.threads,
  }));
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(CODEX_TAB_REVISION_PREFIX) && Number(key.slice(CODEX_TAB_REVISION_PREFIX.length)) < snapshot.revision)
      localStorage.removeItem(key);
  }
}

function entries(): Entry[] {
  const result: Entry[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(CODEX_TAB_OPERATION_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const entry = JSON.parse(raw) as Entry;
    if (
      !Number.isFinite(entry.order) || !entry.operation?.id || key !== CODEX_TAB_OPERATION_PREFIX + entry.operation.id ||
      !Number.isSafeInteger(entry.operation.seq) || !entry.operation.action
    ) throw new Error("Codex 关注记录无法读取，操作尚未确认保存");
    result.push(entry);
  }
  return result.sort((left, right) => left.order - right.order || left.operation.id.localeCompare(right.operation.id));
}

export function readCodexTabOperations(): CodexTabOperation[] {
  return entries().map((entry) => entry.operation);
}

export function saveCodexTabOperation(action: CodexTabAction, id = crypto.randomUUID()): CodexTabOperation {
  const pending = entries();
  const existing = pending.find((entry) => entry.operation.id === id);
  if (existing) return existing.operation;
  const operation = { id, seq: 1, action };
  const order = Math.max(Date.now(), (pending.at(-1)?.order ?? 0) + 1);
  localStorage.setItem(CODEX_TAB_OPERATION_PREFIX + id, JSON.stringify({ order, operation }));
  return operation;
}

export function acknowledgeCodexTabOperations(ids: string[]) {
  for (const id of ids) localStorage.removeItem(CODEX_TAB_OPERATION_PREFIX + id);
}
