import { useMemo } from "react";
import type { ServerNotification } from "@session/bindings";
import { transcriptDiagnostics } from "./transcriptDiagnostics";
export function CodexProtocolRecords({
  events,
  threadId,
}: {
  events: readonly ServerNotification[];
  threadId: string;
}) {
  const records = useMemo(
    () => transcriptDiagnostics(events, threadId),
    [events, threadId],
  );
  if (!records.length) return null;
  return (
    <details className="text-xs text-muted-foreground max-w-full rounded border p-2">
      <summary className="cursor-pointer">
        其他活动记录（{records.length}）
      </summary>
      <p className="py-1">
        这些活动尚无对应聊天界面。原始状态仍保留，以下仅显示最近记录的身份。
      </p>
      <ol className="space-y-1 break-all">
        {records.map((record, index) => (
          <li key={index}>
            <code>{record.itemType ?? record.method}</code>
            {record.turnId && <span> · {record.turnId}</span>}
            {record.itemId && <span> · {record.itemId}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}
