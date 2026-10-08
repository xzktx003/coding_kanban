import type {
  ProjectAction,
  ProjectOperation,
  SharedProjects,
} from "@agent-orchestrator/shared";

// Separate immutable keys prevent one page's Zustand snapshot from erasing
// another page's unsent action. Acknowledgement removes only the exact action.
export const PROJECT_OPERATION_PREFIX = "kanban.session.project-operation.";
export const PROJECT_REVISION_PREFIX = "kanban.session.project-snapshot.";
export function latestProjectSnapshot(): SharedProjects | undefined {
  let latest: SharedProjects | undefined;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PROJECT_REVISION_PREFIX)) continue;
    const revision = Number(key.slice(PROJECT_REVISION_PREFIX.length));
    if (!Number.isSafeInteger(revision) || revision <= (latest?.revision ?? -1))
      continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const snapshot = JSON.parse(raw) as SharedProjects;
    if (
      snapshot.revision !== revision ||
      !Array.isArray(snapshot.projects) ||
      typeof snapshot.initialized !== "boolean"
    )
      throw new Error("项目同步快照无法读取");
    latest = snapshot;
  }
  return latest;
}
export function latestProjectRevision(): number {
  return latestProjectSnapshot()?.revision ?? 0;
}
export function observeProjectSnapshot(snapshot: SharedProjects) {
  const revision = snapshot.revision;
  if (revision <= latestProjectRevision()) return;
  // Independent revision keys make this watermark monotonic across pages:
  // a slow writer can never overwrite a newer revision with an older number.
  localStorage.setItem(
    PROJECT_REVISION_PREFIX + revision,
    JSON.stringify({
      initialized: snapshot.initialized,
      revision,
      projects: snapshot.projects,
    }),
  );
  for (const key of Object.keys(localStorage)) {
    if (
      key.startsWith(PROJECT_REVISION_PREFIX) &&
      Number(key.slice(PROJECT_REVISION_PREFIX.length)) < revision
    )
      localStorage.removeItem(key);
  }
}
export type PendingProjectOperation = ProjectOperation & { id?: string };

type Entry = { order: number; operation: ProjectOperation & { id: string } };
function entries(): Entry[] {
  const result: Entry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PROJECT_OPERATION_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const entry = JSON.parse(raw) as Entry;
    if (
      !Number.isFinite(entry.order) ||
      !entry.operation?.id ||
      key !== PROJECT_OPERATION_PREFIX + entry.operation.id ||
      !Number.isSafeInteger(entry.operation.seq) ||
      !entry.operation.action
    )
      throw new Error("项目同步记录无法读取，项目修改尚未确认保存");
    result.push(entry);
  }
  return result.sort(
    (a, b) => a.order - b.order || a.operation.id.localeCompare(b.operation.id),
  );
}
export function readProjectOperations(): PendingProjectOperation[] {
  return entries().map((e) => e.operation);
}
export function saveProjectOperation(
  action: ProjectAction,
  seq: number,
  id: string = crypto.randomUUID(),
): PendingProjectOperation {
  const pending = entries();
  const existing = pending.find((entry) => entry.operation.id === id);
  if (existing) return existing.operation;
  const operation = { id, seq, action };
  const order = Math.max(Date.now(), (pending.at(-1)?.order ?? 0) + 1);
  // Save before updating the visible project list, including during offline edits.
  localStorage.setItem(
    PROJECT_OPERATION_PREFIX + operation.id,
    JSON.stringify({ order, operation }),
  );
  return operation;
}
export function acknowledgeProjectOperations(ids: string[]) {
  for (const id of ids) localStorage.removeItem(PROJECT_OPERATION_PREFIX + id);
}
