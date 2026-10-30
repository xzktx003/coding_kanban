import { captureHistorySourceScope } from "../components/history/historySourceScope";
import { confirmProviderHistoryRows } from "./providerHistorySourceConfirmation";
import { useAcpStore, type AcpEntry } from "../stores/useAcpStore";
import { acpReadSessionTranscript } from "./apiAdapt/acp";
import { authHeaders, buildUrl } from "../hooks/runtime";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
  startCodexOperationScopeSync,
} from "./codexOperationScope";
import { admitProviderTranscriptRows } from "./providerTranscriptBudget";
import { mergeAcpTranscriptPage } from "./acpTranscriptIdentity";
import {
  enqueueSessionRead,
  readWithDeadline,
  promoteSessionRead,
  type SessionReadPriority,
} from "./sessionReadQueue";
import { historyReadConsumer } from "./sharedHistoryRead";
import {
  providerTranscriptKey,
  trackProviderTranscript,
  providerTranscriptGeneration,
  canPublishProviderTranscript,
  isProviderTranscriptDormant,
  updateProviderTranscript,
  useProviderTranscriptStore,
} from "./sessionProviderTranscriptState";

export type AcpTranscriptTarget = {
  agentId: string;
  connectionId: string;
  sessionId: string;
  historySessionId?: string;
};
const pending = new Map<
  string,
  {
    key: string;
    controller: AbortController;
    consume(signal?: AbortSignal): Promise<void>;
  }
>();
export function disposeAcpTranscriptReads() {
  for (const read of pending.values()) read.controller.abort();
  pending.clear();
}
import.meta.hot?.dispose(disposeAcpTranscriptReads);
export function currentAcpTranscriptTarget(): AcpTranscriptTarget | null {
  const state = useAcpStore.getState();
  return state.connectionId && state.sessionId
    ? {
        agentId: state.agentId,
        connectionId: state.connectionId,
        sessionId: state.sessionId,
        ...(state.historySessionId
          ? { historySessionId: state.historySessionId }
          : {}),
      }
    : null;
}
export const acpTranscriptOwner = (target: AcpTranscriptTarget) =>
  providerTranscriptKey(
    "acp",
    target.sessionId,
    target.agentId,
    target.connectionId,
  );
function stillTarget(target: AcpTranscriptTarget) {
  const current = currentAcpTranscriptTarget();
  return (
    !!current &&
    acpTranscriptOwner(current) === acpTranscriptOwner(target) &&
    (!target.historySessionId ||
      current.historySessionId === target.historySessionId)
  );
}
export function cancelAcpTranscriptRead(owner: string) {
  pending.get(owner)?.controller.abort();
  pending.delete(owner);
}
export async function refreshAcpTranscript(
  target: AcpTranscriptTarget,
  signal?: AbortSignal,
  priority: SessionReadPriority = "interactive",
  cursor?: string,
) {
  if (signal?.aborted) throw signal.reason;
  if (!stillTarget(target)) return;
  const owner = acpTranscriptOwner(target);
  trackProviderTranscript(owner, "acp", target.sessionId);
  if (priority === "background" && isProviderTranscriptDormant(owner)) return;
  const historyId =
    target.historySessionId ??
    useAcpStore.getState().historySessionId ??
    (!useAcpStore.getState().runtimeInstance ? target.sessionId : null);
  if (!historyId)
    throw new Error("无法唯一定位此Agent的历史来源，请只读重新核验连接。");
  const endpoint = buildUrl("/api/acp/session");
  const key = JSON.stringify([endpoint, owner, historyId, cursor ?? null]);
  for (;;) {
    const existing = pending.get(owner);
    if (!existing) break;
    if (priority === "interactive") promoteSessionRead("history", existing.key);
    if (existing.key === key) return existing.consume(signal);
    await existing.consume(signal).catch((error) => {
      if (signal?.aborted) throw error;
    });
  }
  const controller = new AbortController();
  const sourceScope = captureHistorySourceScope("/api/acp/session");
  const scope = captureCodexOperationScope(),
    authorization = authHeaders().Authorization,
    stopScope = startCodexOperationScopeSync();
  const scopeCurrent = () =>
    isCodexOperationScopeCurrent(scope) &&
    authorization === authHeaders().Authorization;
  const generation = providerTranscriptGeneration(owner);
  const baseline = useAcpStore.getState();
  const baselineEntries = new WeakRef(baseline.entries);
  const baselineRows = new WeakSet(baseline.entries);
  const configOptions = baseline.configOptions;
  const modes = baseline.modes;
  updateProviderTranscript(owner, { loading: true, error: null });
  const operation = enqueueSessionRead(
    "history",
    key,
    () =>
      readWithDeadline(
        (s) =>
          acpReadSessionTranscript(historyId, {
            signal: s,
            suppressToast: true,
            ...(cursor ? { cursor } : {}),
          }),
        10_000,
        controller.signal,
      ),
    controller.signal,
    priority,
  )
    .then((page) => {
      if (
        controller.signal.aborted ||
        !scopeCurrent() ||
        endpoint !== buildUrl("/api/acp/session") ||
        !stillTarget(target) ||
        !canPublishProviderTranscript(owner, generation)
      )
        return;
      if (
        page.projection !== "acp-entries" ||
        !Array.isArray(page.data) ||
        typeof page.revision !== "string" ||
        page.data.some((entry) => !entry || typeof entry.id !== "string") ||
        (page.nextCursor !== null && typeof page.nextCursor !== "string")
      )
        throw new Error("ACP 近期历史协议不可用，请更新会话服务后重试。");
      const current = useAcpStore.getState();
      const boundary = page.metadata?.historySourceId;
      // Legacy sources without an exact persistence watermark cannot safely be
      // merged by text. Keep their live view rather than fabricating identity.
      if (
        current.entries !== baselineEntries.deref() &&
        (!Number.isSafeInteger(boundary) ||
          Number(boundary) < 0 ||
          current.entries.some(
            (row) =>
              !baselineRows.has(row) &&
              row.historySourceId === undefined &&
              !row.clientMessageId &&
              row.role !== "error",
          ))
      )
        throw new Error(
          "读取期间收到新内容，已保留实时消息；任务结束后可只读刷新近期历史。",
        );
      const rows: AcpEntry[] = Number.isSafeInteger(boundary)
        ? mergeAcpTranscriptPage(
            current.entries,
            page.data,
            Number(boundary),
            !!cursor,
          )
        : cursor
          ? [
              ...page.data,
              ...current.entries.filter(
                (row) => !page.data.some((item) => item.id === row.id),
              ),
            ]
          : page.data;
      const admitted = admitProviderTranscriptRows(rows, {
        edge: cursor ? "earlier" : "latest",
      });
      const incomingById = new Map(page.data.map((row) => [row.id, row]));
      confirmProviderHistoryRows(
        admitted.rows.flatMap((row) => {
          const source = incomingById.get(row.id);
          return source?.historyDetail?.itemId &&
            row.historyDetail?.itemId === source.historyDetail.itemId &&
            row.historySourceId === source.historySourceId
            ? [
                {
                  row,
                  provider: "acp" as const,
                  sourceId: historyId,
                  itemId: source.historyDetail.itemId,
                  owner,
                },
              ]
            : [];
        }),
        sourceScope,
        cursor,
      );
      useAcpStore.setState({
        entries: admitted.rows,
        ...(current.configOptions === configOptions &&
        page.metadata?.configOptions
          ? { configOptions: page.metadata.configOptions }
          : {}),
        ...(current.modes === modes &&
        current.modes &&
        page.metadata?.currentModeId
          ? {
              modes: {
                ...current.modes,
                currentModeId: page.metadata.currentModeId,
              },
            }
          : {}),
      });
      updateProviderTranscript(owner, {
        restoreNeeded: false,
        nextCursor: page.nextCursor,
        revision: page.revision,
        truncated: page.truncated || admitted.trimmed,
        error: null,
        ...(Number.isSafeInteger(boundary)
          ? {
              historySourceId: Math.max(
                Number(boundary),
                useProviderTranscriptStore.getState().entries[owner]
                  ?.historySourceId ?? 0,
              ),
            }
          : {}),
      });
    })
    .catch((error) => {
      if (
        !controller.signal.aborted &&
        scopeCurrent() &&
        stillTarget(target) &&
        canPublishProviderTranscript(owner, generation)
      )
        updateProviderTranscript(owner, {
          error: error instanceof Error ? error.message : String(error),
        });
      throw error;
    })
    .finally(() => {
      stopScope();
      if (pending.get(owner)?.controller === controller) pending.delete(owner);
      if (canPublishProviderTranscript(owner, generation))
        updateProviderTranscript(owner, { loading: false });
    });
  const consume = historyReadConsumer(operation, controller, () => {
    if (pending.get(owner)?.controller === controller) pending.delete(owner);
  });
  pending.set(owner, { key, controller, consume });
  return consume(signal);
}
