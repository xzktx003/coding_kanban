import { acpReadConnectionSnapshot } from "./apiAdapt/acp";
import { enqueueSessionRead, readWithDeadline } from "./sessionReadQueue";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "./codexOperationScope";
import { create } from "zustand";
import { buildUrl } from "../hooks/runtime";
import { useAcpStore } from "../stores/useAcpStore";
import {
  ACP_CONNECTION_POINTER_KEY,
  requestAcpConnectionRecovery,
} from "./acpConnectionRecoveryPointer";
import { invalidateAcpSessionOperation } from "../components/acp/sessionOperations";
import { usePairingStore } from "../stores/usePairingStore";

const STORAGE = "kanban.session.acp.runtime-owners.v1",
  MAX_OWNERS = 128,
  MAX_BYTES = 1024 * 1024;
export interface AcpRuntimeOwner {
  key: string;
  endpoint: string;
  runtimeInstance: string;
  agentId: string;
  connectionId: string;
  sessionId: string;
  historySessionId?: string;
  cwd: string;
  title: string;
  closed?: boolean;
  running: boolean;
  pendingCount: number;
  eventRevision?: number;
  permissionTitles: string[];
  permissionIds: string[];
  lastUsed: number;
  verified: boolean;
  error: string | null;
}
const createOwnerStore = () =>
  create<{ owners: Record<string, AcpRuntimeOwner> }>(() => ({ owners: {} }));
export const useAcpRuntimeOwnersStore: ReturnType<typeof createOwnerStore> =
  import.meta.hot?.data?.acpRuntimeOwnersStore ?? createOwnerStore();
if (import.meta.hot?.data)
  import.meta.hot.data.acpRuntimeOwnersStore = useAcpRuntimeOwnersStore;
const keyOf = (
  p: Pick<
    AcpRuntimeOwner,
    "endpoint" | "runtimeInstance" | "connectionId" | "agentId" | "sessionId"
  >,
) =>
  JSON.stringify([
    p.endpoint,
    p.runtimeInstance,
    p.agentId,
    p.connectionId,
    p.sessionId,
  ]);
const short = (value: unknown, max = 512) =>
  typeof value === "string" ? value.slice(0, max) : "";
function persist() {
  const rows = Object.values(useAcpRuntimeOwnersStore.getState().owners).map(
    ({
      key,
      endpoint,
      runtimeInstance,
      agentId,
      connectionId,
      sessionId,
      historySessionId,
      cwd,
      title,
      lastUsed,
    }) => ({
      key,
      endpoint,
      runtimeInstance,
      agentId,
      connectionId,
      sessionId,
      historySessionId,
      cwd,
      title,
      lastUsed,
    }),
  );
  try {
    sessionStorage.setItem(STORAGE, JSON.stringify(rows));
  } catch {
    /* In-memory ownership still remains available. */
  }
}
function publish(owner: AcpRuntimeOwner) {
  const state = useAcpRuntimeOwnersStore.getState(),
    before = state.owners[owner.key];
  if (before && JSON.stringify(before) === JSON.stringify(owner)) return owner;
  const owners = { ...state.owners, [owner.key]: owner };
  if (
    Object.keys(owners).length > MAX_OWNERS ||
    new TextEncoder().encode(JSON.stringify(owners)).length > MAX_BYTES
  ) {
    const idle = Object.values(owners)
      .filter(
        (row) =>
          row.key !== owner.key &&
          (row.closed || (row.verified && !row.running && !row.pendingCount)),
      )
      .sort((a, b) => a.lastUsed - b.lastUsed);
    while (
      (Object.keys(owners).length > MAX_OWNERS ||
        new TextEncoder().encode(JSON.stringify(owners)).length > MAX_BYTES) &&
      idle.length
    )
      delete owners[idle.shift()!.key];
    if (
      Object.keys(owners).length > MAX_OWNERS ||
      new TextEncoder().encode(JSON.stringify(owners)).length > MAX_BYTES
    )
      throw new Error(
        "已有ACP任务元数据达到本页资源预算。请先显式结束不再需要的连接，当前任务保持运行。",
      );
  }
  useAcpRuntimeOwnersStore.setState({ owners });
  persist();
  return owner;
}
export function rememberCurrentAcpOwner(state = useAcpStore.getState()) {
  if (!state.connectionId || !state.sessionId) return null;
  if (
    !state.runtimeInstance ||
    !state.connectionEndpoint ||
    state.connectionEndpoint !== buildUrl("/api/acp/connection-snapshot")
  )
    throw new Error(
      "当前Agent连接缺少可核验运行身份，无法安全保留后切换；请更新会话服务后重试。",
    );
  const pointer = {
    endpoint: state.connectionEndpoint,
    runtimeInstance: state.runtimeInstance,
    agentId: state.agentId,
    connectionId: state.connectionId,
    sessionId: state.sessionId,
  };
  const key = keyOf(pointer),
    before = useAcpRuntimeOwnersStore.getState().owners[key];
  if (before?.closed) return before;
  const permissions =
    state.pendingPermissions[
      JSON.stringify([state.connectionId, state.sessionId])
    ] ?? (state.permission ? [state.permission] : []);
  const owner: AcpRuntimeOwner = {
    ...pointer,
    historySessionId: state.historySessionId ?? before?.historySessionId,
    key,
    eventRevision: before?.eventRevision ?? 0,
    cwd: short(state.sessionCwd ?? before?.cwd, 4096),
    title: short(state.agentTitle ?? before?.title ?? state.agentId, 256),
    running: state.running,
    pendingCount: permissions.length,
    permissionIds: permissions.slice(0, 64).map((p) => short(p.requestId, 128)),
    permissionTitles: permissions.slice(0, 4).map((p) => short(p.title, 200)),
    lastUsed: before?.lastUsed ?? Date.now(),
    verified: true,
    error: state.sessionTransitionError,
  };
  return publish(owner);
}
export function assertAcpRuntimeOwnerCapacity() {
  const rows = Object.values(useAcpRuntimeOwnersStore.getState().owners);
  if (
    (rows.length >= MAX_OWNERS ||
      new TextEncoder().encode(JSON.stringify(rows)).length + 16 * 1024 >
        MAX_BYTES) &&
    !rows.some(
      (owner) => owner.verified && !owner.running && !owner.pendingCount,
    )
  )
    throw new Error(
      "已有ACP任务元数据达到本页资源预算，当前任务保持运行。请先显式结束不再需要的连接。",
    );
}
export function findAcpRuntimeOwner(agentId: string, sessionId?: string) {
  return Object.values(useAcpRuntimeOwnersStore.getState().owners)
    .filter(
      (owner) =>
        !owner.closed &&
        owner.agentId === agentId &&
        (!sessionId || owner.sessionId === sessionId) &&
        owner.endpoint === buildUrl("/api/acp/connection-snapshot"),
    )
    .sort((a, b) => b.lastUsed - a.lastUsed)[0];
}
/** Stored history is scoped to a runtime connection. A native session id alone
 * can repeat in independent ACP processes, so it cannot identify this owner. */
export function findAcpRuntimeOwnerByHistory(
  agentId: string,
  historySessionId: string,
) {
  if (!historySessionId) return undefined;
  const matches = Object.values(
    useAcpRuntimeOwnersStore.getState().owners,
  ).filter(
    (owner) =>
      !owner.closed &&
      owner.agentId === agentId &&
      owner.historySessionId === historySessionId &&
      owner.endpoint === buildUrl("/api/acp/connection-snapshot"),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
export function openAcpRuntimeOwner(key: string) {
  const owner = useAcpRuntimeOwnersStore.getState().owners[key];
  if (!owner || owner.endpoint !== buildUrl("/api/acp/connection-snapshot"))
    throw new Error("已有连接不属于当前设备，请先切回原设备。");
  rememberCurrentAcpOwner();
  invalidateAcpSessionOperation();
  sessionStorage.setItem(
    ACP_CONNECTION_POINTER_KEY,
    JSON.stringify({
      version: 1,
      endpoint: owner.endpoint,
      runtimeInstance: owner.runtimeInstance,
      agentId: owner.agentId,
      connectionId: owner.connectionId,
      sessionId: owner.sessionId,
      historySessionId: owner.historySessionId,
      active: true,
    }),
  );
  useAcpStore.getState().reset();
  useAcpStore.setState({
    active: true,
    agentId: owner.agentId,
    historySessionId: owner.historySessionId ?? null,
    connectionRecovery: "recovering",
    sessionTransition: { version: -1, label: "正在只读核对已有Agent会话…" },
    sessionTransitionError: null,
    connecting: false,
  });
  publish({ ...owner, lastUsed: Date.now() });
  requestAcpConnectionRecovery();
}
export function noteAcpOwnerEvent(payload: Record<string, any>) {
  const owners = Object.values(
    useAcpRuntimeOwnersStore.getState().owners,
  ).filter(
    (owner) =>
      owner.endpoint === buildUrl("/api/acp/connection-snapshot") &&
      owner.connectionId === payload.connectionId &&
      owner.agentId === payload.agentId &&
      (!payload.runtimeInstance ||
        payload.runtimeInstance === owner.runtimeInstance) &&
      (!payload.sessionId || owner.sessionId === payload.sessionId),
  );
  if (!owners.length) return false;
  for (const owner of owners) {
    if (!["permission", "execution-state", "exited"].includes(payload.kind))
      continue;
    if (!owner.verified && payload.kind !== "exited") {
      publish({ ...owner, eventRevision: (owner.eventRevision ?? 0) + 1 });
      continue;
    }
    if (
      payload.kind === "permission" &&
      typeof payload.requestId === "string"
    ) {
      if (owner.permissionIds.includes(payload.requestId)) continue;
      publish({
        ...owner,
        eventRevision: (owner.eventRevision ?? 0) + 1,
        pendingCount: owner.pendingCount + 1,
        permissionIds: [
          ...owner.permissionIds,
          short(payload.requestId, 128),
        ].slice(-64),
        permissionTitles: [
          ...owner.permissionTitles,
          short(payload.toolCall?.title ?? "等待批准", 200),
        ].slice(0, 4),
      });
    } else if (payload.kind === "execution-state")
      publish({
        ...owner,
        eventRevision: (owner.eventRevision ?? 0) + 1,
        ...(Array.isArray(payload.pendingRequestIds)
          ? {
              pendingCount: payload.pendingRequestIds.length,
              permissionIds: payload.pendingRequestIds
                .slice(0, 64)
                .map((id: unknown) => short(id, 128)),
            }
          : {}),
        running: payload.running === true || payload.deliveryUnknown === true,
        error:
          payload.deliveryUnknown || payload.lifecycleUnknown
            ? "原生操作回执尚未确认"
            : null,
        ...(!Array.isArray(payload.pendingRequestIds) &&
        !payload.running &&
        !payload.deliveryUnknown
          ? { pendingCount: 0, permissionIds: [], permissionTitles: [] }
          : {}),
      });
    else if (payload.kind === "exited")
      publish({
        ...owner,
        closed: true,
        running: false,
        pendingCount: 0,
        permissionIds: [],
        permissionTitles: [],
        verified: false,
        error: "Agent服务已退出；原记录仍可只读查看。",
      });
  }
  return true;
}
export function markAcpRuntimeOwnerFailed(
  connectionId: string,
  sessionId: string,
  error: string,
) {
  for (const owner of Object.values(useAcpRuntimeOwnersStore.getState().owners))
    if (owner.connectionId === connectionId && owner.sessionId === sessionId)
      publish({ ...owner, error: short(error, 500), verified: false });
}
const metadataReads = new Map<string, AbortController>();
export async function refreshKnownAcpRuntimeOwners(keys?: string[]) {
  await Promise.allSettled(
    Object.values(useAcpRuntimeOwnersStore.getState().owners)
      .filter(
        (owner) =>
          !owner.closed &&
          (!keys || keys.includes(owner.key)) &&
          owner.endpoint === buildUrl("/api/acp/connection-snapshot"),
      )
      .map(async (owner) => {
        if (metadataReads.has(owner.key)) return;
        const controller = new AbortController(),
          scope = captureCodexOperationScope();
        metadataReads.set(owner.key, controller);
        const current = () =>
          !controller.signal.aborted &&
          isCodexOperationScopeCurrent(scope) &&
          owner.endpoint === buildUrl("/api/acp/connection-snapshot") &&
          useAcpRuntimeOwnersStore.getState().owners[owner.key]
            ?.eventRevision === owner.eventRevision;
        try {
          const snapshot = await enqueueSessionRead(
            "status",
            "acp-owner:" + owner.key,
            () =>
              readWithDeadline(
                (signal) =>
                  acpReadConnectionSnapshot(
                    owner.connectionId,
                    owner.sessionId,
                    owner.runtimeInstance,
                    { signal, suppressToast: true },
                  ),
                10_000,
                controller.signal,
              ),
            controller.signal,
            "background",
          );
          if (!current()) return;
          if (
            snapshot.runtimeInstance !== owner.runtimeInstance ||
            snapshot.connectionId !== owner.connectionId ||
            snapshot.agentId !== owner.agentId ||
            snapshot.sessionId !== owner.sessionId ||
            !snapshot.historySessionId ||
            snapshot.historySessionId === snapshot.sessionId ||
            (owner.historySessionId !== undefined &&
              snapshot.historySessionId !== owner.historySessionId)
          )
            throw new Error("已有Agent连接身份已变化");
          publish({
            ...owner,
            historySessionId: snapshot.historySessionId,
            cwd: short(snapshot.cwd, 4096),
            running: snapshot.running || snapshot.deliveryUnknown,
            pendingCount: snapshot.permissions.length,
            permissionIds: snapshot.permissions
              .slice(0, 64)
              .map((p) => short(p.requestId, 128)),
            permissionTitles: snapshot.permissions
              .slice(0, 4)
              .map((p) => short(p.toolCall?.title ?? "等待批准", 200)),
            verified: true,
            error:
              snapshot.deliveryUnknown || snapshot.lifecycleUnknown
                ? "原生操作回执尚未确认"
                : null,
          });
        } catch (error) {
          if (current())
            publish({
              ...owner,
              verified: false,
              error: short(String(error), 500),
            });
        } finally {
          if (metadataReads.get(owner.key) === controller)
            metadataReads.delete(owner.key);
          if (
            !controller.signal.aborted &&
            isCodexOperationScopeCurrent(scope) &&
            owner.endpoint === buildUrl("/api/acp/connection-snapshot") &&
            useAcpRuntimeOwnersStore.getState().owners[owner.key]
              ?.eventRevision !== owner.eventRevision
          )
            queueMicrotask(
              () => void refreshKnownAcpRuntimeOwners([owner.key]),
            );
        }
      }),
  );
}
export function startAcpRuntimeOwners() {
  let stopped = false;
  try {
    const data = JSON.parse(sessionStorage.getItem(STORAGE) ?? "[]");
    if (
      Array.isArray(data) &&
      data.length <= MAX_OWNERS &&
      new TextEncoder().encode(JSON.stringify(data)).length <= MAX_BYTES
    )
      for (const row of data) {
        if (
          !row ||
          [
            "endpoint",
            "runtimeInstance",
            "agentId",
            "connectionId",
            "sessionId",
          ].some(
            (k) =>
              typeof row[k] !== "string" || !row[k] || row[k].length > 1024,
          )
        )
          continue;
        const owner = {
          endpoint: row.endpoint,
          runtimeInstance: row.runtimeInstance,
          agentId: row.agentId,
          connectionId: row.connectionId,
          sessionId: row.sessionId,
          historySessionId:
            typeof row.historySessionId === "string"
              ? row.historySessionId
              : undefined,
          key: keyOf(row),
          cwd: short(row.cwd, 4096),
          title: short(row.title, 256),
          lastUsed: Number.isFinite(row.lastUsed) ? row.lastUsed : 0,
          running: false,
          pendingCount: 0,
          permissionIds: [],
          permissionTitles: [],
          verified: false,
          error: "已有连接尚未核验，返回后只读检查任务和审批。",
        };
        publish(owner);
      }
  } catch {
    /* Malformed device metadata cannot create a native owner. */
  }
  const observe = () => {
    try {
      rememberCurrentAcpOwner();
    } catch {
      /* Keep the exact current owner selected when metadata admission is unavailable. */
    }
  };
  observe();
  const unverified = Object.values(useAcpRuntimeOwnersStore.getState().owners)
    .filter((owner) => !owner.verified && !owner.closed)
    .map((owner) => owner.key);
  if (unverified.length)
    queueMicrotask(() => {
      if (!stopped) void refreshKnownAcpRuntimeOwners(unverified);
    });
  const stop = useAcpStore.subscribe(observe);
  const invalidate = () => {
    for (const owner of Object.values(
      useAcpRuntimeOwnersStore.getState().owners,
    ))
      publish({
        ...owner,
        verified: false,
        error: "连接范围已变化，请返回后只读核对。",
      });
  };
  const stopPairing = usePairingStore.subscribe(invalidate);
  window.addEventListener("session-runtime-restarted", invalidate);
  return () => {
    stopped = true;
    stop();
    stopPairing();
    for (const controller of metadataReads.values()) controller.abort();
    metadataReads.clear();
    window.removeEventListener("session-runtime-restarted", invalidate);
  };
}

import.meta.hot?.dispose(() => {
  for (const controller of metadataReads.values()) controller.abort();
  metadataReads.clear();
});
