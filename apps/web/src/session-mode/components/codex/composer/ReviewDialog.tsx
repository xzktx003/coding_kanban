import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { useState } from "react";
import { toast } from "sonner";
import type { ReviewTarget } from "@session/bindings/v2";
import { useCodexStore } from "../stores";
import { useFollowups } from "@session/hooks/useFollowups";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
import { runConversationReview } from "@session/services/conversationActions";
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
}: {
  threadId: string | null;
  onClose: () => void;
}) {
  const { reviewDelivery, setReviewDelivery } = useFollowupSettingsStore();
  const [target, setTarget] = useState("changes"),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      if (reviewDelivery === "inline" && inlineBlocked)
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
      onClose();
      toast.success(
        reviewDelivery === "detached" ? "独立审查已启动" : "当前会话审查已启动",
      );
    } catch (e) {
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
              (reviewDelivery === "inline" && inlineBlocked) ||
              (target !== "changes" && !value.trim())
            }
            onClick={() => void submit()}
          >
            {busy ? "正在启动…" : "开始审查"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
