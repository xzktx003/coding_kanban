import { useEffect, useMemo, useRef, useState } from "react";
import {
  captureThreadModelSelection,
  flushThreadModelSettings,
} from "@session/stores/useThreadModelStore";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "@session/services/codexOperationScope";
import { followupParameters } from "@session/services/followupService";
import { applyQueuedThreadSettings } from "@session/services/queuedThreadSettings";

export function NativeQueueSettingsNotice({ threadId }: { threadId: string }) {
  const identity = useMemo(() => ({}), [threadId]);
  const current = useRef(identity);
  current.current = identity;
  const [pending, setPending] = useState(false),
    [status, setStatus] = useState<string | null>(null);
  useEffect(() => { setPending(false); setStatus(null); }, [identity]);
  async function apply() {
    if (pending) return;
    const scope = captureCodexOperationScope(),
      selected = captureThreadModelSelection(threadId);
    setPending(true);
    try {
      const parameters = followupParameters(threadId, selected.settings);
      await flushThreadModelSettings(threadId, selected);
      if (!isCodexOperationScopeCurrent(scope))
        throw new Error("账号或运行服务已变化，请重新确认");
      const result = await applyQueuedThreadSettings(threadId, parameters);
      if (current.current !== identity || !isCodexOperationScopeCurrent(scope)) return;
      setStatus(
        result.status === "accepted"
          ? "线程模型、推理与权限设置已更新，将影响尚未开始的消息"
          : result.status === "unknown"
            ? "设置结果待核对；再次点击只核对，不重复应用"
            : (result.error ?? "未能更新线程设置"),
      );
    } catch (error) {
      if (current.current !== identity || !isCodexOperationScopeCurrent(scope)) return;
      setStatus(error instanceof Error ? error.message : "无法更新线程设置");
    } finally {
      if (current.current === identity) setPending(false);
    }
  }
  return (
    <div
      className="session-native-queue-settings text-xs text-muted-foreground"
      role="note"
    >
      <p>
        待发消息按原生线程当前设置执行。此处的模型和权限选择先保存为下次发送偏好。
      </p>
      <p>应用操作更新线程的模型、推理与权限；个性仍由原生当前配置决定。</p>
      <button
        type="button"
        className="underline underline-offset-2"
        disabled={pending}
        onClick={() => void apply()}
      >
        {pending ? "正在核对线程设置…" : "应用到待发队列"}
      </button>
      {status && <p role="status">{status}</p>}
    </div>
  );
}
