import { useEffect, useMemo } from "react";
import type { ServerNotification } from "@session/bindings";
import {
  acknowledgeDeliveryEchoes,
  deliveredClientIds,
  useCodexDeliveryStore,
} from "@session/stores/useCodexDeliveryStore";
import { UserMessageItem } from "../items/UserMessageItem";

export function CodexDeliveryEchoes({
  threadId,
  events,
}: {
  threadId: string;
  events: ServerNotification[];
}) {
  const entries = useCodexDeliveryStore((s) => s.entries);
  const acknowledged = useMemo(() => deliveredClientIds(events), [events]);
  useEffect(() => {
    acknowledgeDeliveryEchoes(threadId, [...acknowledged]);
  }, [threadId, acknowledged, entries]);
  const echoes = Object.values(entries).filter(
    (e) =>
      e.threadId === threadId &&
      e.status !== "queued" &&
      e.status !== "cancelled" &&
      !acknowledged.has(e.id),
  );
  return (
    <>
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
              ? "已接收，等待消息同步"
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
