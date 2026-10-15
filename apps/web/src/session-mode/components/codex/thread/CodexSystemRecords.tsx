import { memo, useState } from "react";
import { List, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@session/components/ui/popover";
import "./system-records.css";

type SystemRecordsProps = { threadId: string; count: number };
/** Read-only lifecycle metadata. It never owns protocol events or Agent actions. */
export const CodexSystemRecords = memo(function CodexSystemRecords(
  props: SystemRecordsProps,
) {
  if (!props.threadId || props.count <= 0) return null;
  return <SystemRecordsPanel key={props.threadId} {...props} />;
});

function SystemRecordsPanel({ threadId, count }: SystemRecordsProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="codex-system-records" data-codex-system-records={threadId}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="codex-system-records-trigger"
            aria-label={`系统记录，${count}条`}
            title="查看当前会话已加载的系统记录"
          >
            <List size={14} aria-hidden="true" />
            <span>系统记录</span>
            <span className="codex-system-records-count">· {count}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="codex-system-records-panel"
          aria-label="系统记录"
        >
          <div className="codex-system-records-header">
            <strong>系统记录</strong>
            <span>{count} 条</span>
            <button
              type="button"
              aria-label="关闭系统记录"
              onClick={() => setOpen(false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="codex-system-records-entry">
            <div className="codex-system-records-label">
              <span>会话运行实例已关闭</span>
              <span className="codex-system-records-badge">× {count}</span>
            </div>
            <p>运行关闭记录；聊天历史保留</p>
            <details>
              <summary>查看协议与会话 ID</summary>
              <dl>
                <dt>事件</dt>
                <dd>
                  <code>thread/closed</code>
                </dd>
                <dt>会话</dt>
                <dd>
                  <code>{threadId}</code>
                </dd>
              </dl>
            </details>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
