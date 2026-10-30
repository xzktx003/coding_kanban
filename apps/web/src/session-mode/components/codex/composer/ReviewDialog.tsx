import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ReviewTarget } from "@session/bindings/v2";
import { useCodexStore } from "../stores";
import { useFollowups } from "@session/hooks/useFollowups";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
import { runConversationReview } from "@session/services/conversationActions";
import { hasPendingLifecycleMutation, LifecycleMutationUnknownError } from "@session/services/lifecycleMutation";
import { captureCodexOperationScope, isCodexOperationScopeCurrent, type CodexOperationScope } from "@session/services/codexOperationScope";
import { isSessionInteractionVisible } from "@session/session-dom";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../ui/dialog";
export function ReviewDialog({
  threadId,
  onClose,
  targetScope,
}: {
  threadId: string | null;
  onClose: () => void;
  targetScope?: CodexOperationScope;
}) {
  const { reviewDelivery, setReviewDelivery } = useFollowupSettingsStore();
  const [target, setTarget] = useState("changes"),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false), [error, setError] = useState<string | null>(null);
  const [scope] = useState(() => targetScope ?? captureCodexOperationScope());
  useEffect(() => {
    if (!threadId) return;
    let live = true;
    void hasPendingLifecycleMutation("review", threadId).then(value => { if (live) setUnknown(value); }).catch(reason => { if (live) setError(String(reason)); });
    return () => { live = false; };
  }, [threadId]);
  const running = useCodexStore(
    (s) =>
      !!threadId &&
      (codexRuntimeState(s, threadId).running),
  );
  const { state } = useFollowups(threadId);
  const inlineBlocked =
    running ||
    (!state.paused &&
      state.items.some((m) => m.status === "queued" || m.status === "sending"));
  const submit = async () => {
    if (!threadId || busy) return;
    if (!isSessionInteractionVisible() || !isCodexOperationScopeCurrent(scope)) { setError("账号或运行服务已变化，尚未执行操作，请重新打开面板。"); return; }
    setBusy(true);
    try {
      if (!unknown && reviewDelivery === "inline" && inlineBlocked)
        throw new Error("请先停止任务并暂停队列，或选择独立审查");
      const request: ReviewTarget =
        target === "changes"
          ? { type: "uncommittedChanges" }
          : target === "branch"
            ? { type: "baseBranch", branch: value.trim() }
            : target === "commit"
              ? { type: "commit", sha: value.trim(), title: null }
              : { type: "custom", instructions: value.trim() };
      await runConversationReview(threadId, reviewDelivery, request);
      if (!isCodexOperationScopeCurrent(scope)) throw new Error("账号或运行服务已变化，原审查回执已保留。");
      onClose();
      toast.success(
        unknown ? "审查结果已核对" : reviewDelivery === "detached" ? "独立审查已启动" : "当前会话审查已启动",
      );
    } catch (e) {
      if (e instanceof LifecycleMutationUnknownError) setUnknown(true);
      setError(e instanceof Error ? e.message : String(e));
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>代码审查</DialogTitle>
        <DialogDescription>选择审查范围与结果所在会话。</DialogDescription>
        <label>
          审查方式
          <select
            aria-label="审查方式"
            value={reviewDelivery}
            onChange={(e) =>
              setReviewDelivery(e.target.value as "inline" | "detached")
            }
          >
            <option value="inline">当前会话</option>
            <option value="detached">独立会话</option>
          </select>
        </label>
        {reviewDelivery === "inline" && inlineBlocked && (
          <p role="status">当前任务或队列仍在运行，可选择独立会话审查。</p>
        )}
        <label>
          审查范围
          <select
            aria-label="审查范围"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setValue("");
            }}
          >
            <option value="changes">未提交的改动</option>
            <option value="branch">相对分支</option>
            <option value="commit">指定提交</option>
            <option value="custom">自定义要求</option>
          </select>
        </label>
        {target !== "changes" && (
          <textarea
            aria-label="审查目标"
            placeholder={
              target === "branch"
                ? "分支名称"
                : target === "commit"
                  ? "提交 SHA"
                  : "描述审查要求"
            }
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        {unknown && <p role="status">审查结果待核对；再次点击只读取原操作回执，不启动另一场审查。</p>}
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={
              busy ||
              !threadId ||
              (!unknown && reviewDelivery === "inline" && inlineBlocked) ||
              (!unknown && target !== "changes" && !value.trim())
            }
            onClick={() => void submit()}
          >
            {busy ? unknown ? "正在核对…" : "正在启动…" : unknown ? "核对审查结果" : "开始审查"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
