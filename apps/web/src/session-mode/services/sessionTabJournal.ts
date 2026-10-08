import type {
  SessionTabAction,
  SessionTabOperation,
  SharedSessionTabs,
} from "@agent-orchestrator/shared";

// Separate immutable keys prevent one page's Zustand snapshot from erasing
// another page's unsent action. Acknowledgement removes only the exact action.
export const TAB_OPERATION_PREFIX = "kanban.session.tab-operation.";
export const TAB_REVISION_PREFIX = "kanban.session.tab-snapshot.";
export function latestTabSnapshot(): SharedSessionTabs | undefined {
  let latest: SharedSessionTabs | undefined;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(TAB_REVISION_PREFIX)) continue;
    const revision = Number(key.slice(TAB_REVISION_PREFIX.length));
    if (!Number.isSafeInteger(revision) || revision <= (latest?.revision ?? -1))
      continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const snapshot = JSON.parse(raw) as SharedSessionTabs;
    if (
      snapshot.revision !== revision ||
      !Array.isArray(snapshot.cards) ||
      typeof snapshot.initialized !== "boolean"
    )
      throw new Error("标签同步快照无法读取");
    latest = snapshot;
  }
  return latest;
}
export function latestTabRevision(): number {
  return latestTabSnapshot()?.revision ?? 0;
}
export function observeTabSnapshot(snapshot: SharedSessionTabs) {
  const revision = snapshot.revision;
  if (revision <= latestTabRevision()) return;
  // Independent revision keys make this watermark monotonic across pages:
  // a slow writer can never overwrite a newer revision with an older number.
  localStorage.setItem(
    TAB_REVISION_PREFIX + revision,
    JSON.stringify({
      initialized: snapshot.initialized,
      revision,
      cards: snapshot.cards,
    }),
  );
  for (const key of Object.keys(localStorage)) {
    if (
      key.startsWith(TAB_REVISION_PREFIX) &&
      Number(key.slice(TAB_REVISION_PREFIX.length)) < revision
    )
      localStorage.removeItem(key);
  }
}
type Entry = { order: number; operation: SessionTabOperation & { id: string } };
function entries(): Entry[] {
  const result: Entry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(TAB_OPERATION_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const entry = JSON.parse(raw) as Entry;
    if (
      !Number.isFinite(entry.order) ||
      !entry.operation?.id ||
      key !== TAB_OPERATION_PREFIX + entry.operation.id ||
      !Number.isSafeInteger(entry.operation.seq) ||
      !entry.operation.action
    )
      throw new Error("标签同步记录无法读取，关闭操作尚未确认保存");
    result.push(entry);
  }
  return result.sort(
    (a, b) => a.order - b.order || a.operation.id.localeCompare(b.operation.id),
  );
}
export function readTabOperations(): SessionTabOperation[] {
  return entries().map((e) => e.operation);
}
export function saveTabOperation(
  action: SessionTabAction,
  seq: number,
  id: string = crypto.randomUUID(),
): SessionTabOperation {
  const pending = entries();
  const existing = pending.find((entry) => entry.operation.id === id);
  if (existing) return existing.operation;
  const operation = { id, seq, action };
  const order = Math.max(Date.now(), (pending.at(-1)?.order ?? 0) + 1);
  // Save before updating the visible tab list, including during offline closes.
  localStorage.setItem(
    TAB_OPERATION_PREFIX + operation.id,
    JSON.stringify({ order, operation }),
  );
  return operation;
}
export function acknowledgeTabOperations(ids: string[]) {
  for (const id of ids) localStorage.removeItem(TAB_OPERATION_PREFIX + id);
}
