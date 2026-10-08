import { X } from "lucide-react";
import {
  dismissModelNotice,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import { Button } from "@session/components/ui/button";

export function ModelChangeNotice({ threadId }: { threadId: string }) {
  const entry = useThreadModelStore((s) => s.threads[threadId]);
  const notice = entry?.notice;
  if (!notice || notice.dismissed) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="session-model-change-notice"
    >
      <span>
        本会话模型：<span>{notice.from}</span> → <strong>{notice.to}</strong>
        <small>
          {entry.pending
            ? "下次发送生效；当前任务和已排队消息保留原配置"
            : "后续发送使用当前模型"}
        </small>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="收起模型切换提示"
        onClick={() => dismissModelNotice(threadId, notice.id)}
      >
        <X size={14} />
      </Button>
    </div>
  );
}
