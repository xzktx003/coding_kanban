import { useSessionSyncStore } from "@session/stores/useSessionSyncStore";
import { useEffect, useMemo, useRef } from "react";
import type { ServerNotification } from "@session/bindings";
import { codexService } from "@session/services/codexService";
import {
  acknowledgeDeliveryEchoes,
  deliveredClientIds,
  useCodexDeliveryStore,
} from "@session/stores/useCodexDeliveryStore";
import { UserMessageItem } from "../items/UserMessageItem";
import { CodexSteerReceipts } from "./CodexSteerReceipts";
import { useFollowupStore } from "@session/services/followupService";

export function CodexDeliveryEchoes({
  threadId,
  events,
}: {
  threadId: string;
  events: ServerNotification[];
}) {
  const recovering = useSessionSyncStore((s) => s.recovering[threadId]);
  const entries = useCodexDeliveryStore((s) => s.entries);
  const receiptRevision = useFollowupStore((s) => s.threads[threadId]?.revision ?? 0);
  const acknowledged = useMemo(() => deliveredClientIds(events), [events]);
  const terminalTurns = useMemo(() => {
    const statuses = new Map<string, string>();
    for (const event of events) {
      if (
        event.method === "turn/completed" &&
        event.params.threadId === threadId &&
        event.params.turn.status !== "inProgress"
      ) {
        statuses.set(event.params.turn.id, event.params.turn.status);
      }
    }
    for (const event of events) {
      if (
        event.method === "error" &&
        event.params.threadId === threadId &&
        !event.params.willRetry &&
        !statuses.has(event.params.turnId)
      ) {
        statuses.set(event.params.turnId, "failed");
      }
    }
    return statuses;
  }, [events, threadId]);
  const refreshed = useRef(new Set<string>());
  useEffect(() => {
    // A failed turn may finish before its userMessage event reaches this client.
    // Read history once to recover the persisted clientId; never resume or resubmit.
    const missing = Object.values(entries).filter(
      (e) =>
        e.threadId === threadId &&
        e.status === "sent" &&
        e.turnId &&
        terminalTurns.has(e.turnId) &&
        !acknowledged.has(e.id) &&
        !refreshed.current.has(`${threadId}:${e.turnId}`),
    );
    if (!missing.length) return;
    for (const e of missing) refreshed.current.add(`${threadId}:${e.turnId}`);
    void codexService
      .loadThreadHistory(threadId, undefined, { background: true })
      .catch(() => {
        // Keep the message and accurate terminal status visible if refresh fails.
      });
  }, [entries, threadId, acknowledged, terminalTurns]);
  useEffect(() => {
    acknowledgeDeliveryEchoes(threadId, [...acknowledged]);
  }, [threadId, acknowledged, entries]);
  const echoes = Object.values(entries).filter(
    (e) =>
      e.threadId === threadId &&
      e.status !== "queued" &&
      e.status !== "cancelled" &&
      e.status !== "failed" &&
      !acknowledged.has(e.id),
  );
  return (
    <>
      <CodexSteerReceipts threadId={threadId} events={events} pendingClientIds={echoes.map(e => e.id)} revision={receiptRevision} />
      {echoes.map((e) => (
        <div key={e.id} data-delivery-echo={e.id} className="pb-2">
          <UserMessageItem
            content={[
              ...(e.text
                ? [{ type: "text" as const, text: e.text, text_elements: [] }]
                : []),
              ...e.images.map((path) => ({
                type: "localImage" as const,
                path,
              })),
            ]}
          />
          <p
            role="status"
            className="text-right text-xs text-muted-foreground pt-1"
          >
            {e.status === "sent"
              ? e.turnId && terminalTurns.get(e.turnId) === "failed"
                ? "消息已送达，本轮执行失败"
                : e.turnId && terminalTurns.get(e.turnId) === "interrupted"
                  ? "消息已送达，本轮已停止"
                  : e.turnId && terminalTurns.get(e.turnId) === "completed"
                    ? "消息已送达，本轮已结束"
                    : recovering
                      ? "消息已送达，正在同步回复…"
                      : "已接收，等待消息同步"
              : e.status === "submitting"
                ? "正在提交"
                : e.status === "sending"
                  ? "正在发送"
                  : e.status === "failed"
                    ? "发送失败，内容已保留"
                    : "送达待确认，请核对会话或队列"}
          </p>
        </div>
      ))}
    </>
  );
}
