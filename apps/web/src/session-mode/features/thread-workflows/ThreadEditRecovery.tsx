import { useThreadWorkflowStore, mutationKey } from "./delivery";
import type { WorkflowMessage } from "./model";
import { toast } from "sonner";
/** A rollback or newer user turn can remove the original native editable row.
 * Keep that dedicated edit buffer reachable without moving it into the detached draft. */
export function ThreadEditRecovery({
  threadId,
  rows,
}: {
  threadId: string;
  rows: readonly WorkflowMessage[];
}) {
  const buffers = useThreadWorkflowStore((state) => state.inlineEdits);
  const mutations = useThreadWorkflowStore((state) => state.mutations);
  const lastUser = [...rows].reverse().find((row) => row.role === "user");
  const orphaned = Object.values(buffers).filter(
    (buffer) =>
      buffer.source.threadId === threadId &&
      (lastUser?.itemId !== buffer.source.itemId ||
        lastUser?.turnId !== buffer.source.turnId),
  );
  if (!orphaned.length) return null;
  return (
    <div className="codex-thread-edit-recovery" role="status">
      {orphaned.map((buffer) => {
        const record =
          mutations[mutationKey("editSend", buffer.source)] ??
          mutations[mutationKey("editRollback", buffer.source)];
        return (
          <details key={buffer.source.itemId}>
            <summary>
              {record?.status === "uncertain"
                ? "编辑结果待确认，内容已保留"
                : "未完成的消息编辑已保留"}
            </summary>
            <p>请先刷新并核对会话历史。确认执行结果前不会重复回滚或发送。</p>
            <pre>{buffer.text}</pre>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(buffer.text).then(
                  () => toast.success("编辑内容已复制"),
                  () => toast.error("未能复制编辑内容"),
                )
              }
            >
              复制保留的编辑内容
            </button>
            <button
              type="button"
              disabled={record?.status === "pending"}
              onClick={() =>
                useThreadWorkflowStore.getState().clearInlineEdit(buffer.source)
              }
            >
              丢弃编辑缓冲
            </button>
          </details>
        );
      })}
    </div>
  );
}
