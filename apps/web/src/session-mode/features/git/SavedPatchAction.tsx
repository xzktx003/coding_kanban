import { useEffect, useState } from "react";
import type { SavedPatchBatch } from "@agent-orchestrator/shared";
import {
  useSavedPatchStore,
  savedPatchKey,
} from "@session/stores/useSavedPatchStore";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@session/components/ui/alert-dialog";
import { Button } from "@session/components/ui/button";
export function SavedPatchAction({
  threadId,
  turnId,
  cwd,
  batches = [],
  filePath,
  compact = false,
  disabled = false,
}: {
  threadId?: string;
  turnId?: string;
  cwd?: string | null;
  batches?: SavedPatchBatch[];
  filePath?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const input = {
    threadId: threadId ?? "",
    turnId: turnId ?? "",
    expectedChanges: batches,
    filePath,
  };
  const key = savedPatchKey(input);
  const record = useSavedPatchStore((s) => s.records[key]);
  const action = record?.nextAction ?? "undo";
  const uncertain =
    record?.status === "uncertain" || record?.status === "sending";
  const available = Boolean(threadId && turnId && cwd && batches.length);
  useEffect(() => {
    if (record?.status === "uncertain")
      void useSavedPatchStore.getState().check({ ...input, action });
    // The key captures owner, turn and receipts; this is a read-only recovery.
  }, [key]);
  const apply = () => {
    void useSavedPatchStore.getState().apply({ ...input, action });
  };
  const label = action === "undo" ? "撤销" : "重新应用";
  const scope = filePath ? filePath.split("/").at(-1) : "此轮";
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={
          compact
            ? "codex-patch-action codex-patch-action-file"
            : "codex-patch-action"
        }
        aria-label={`${label}${scope}保存的变更`}
        title={
          available
            ? `${label}${scope}保存的变更`
            : "缺少完整原生变更记录，仅支持查看"
        }
        disabled={!available || disabled || uncertain}
        onClick={(event) => {
          event.stopPropagation();
          action === "undo" ? setConfirm(true) : apply();
        }}
      >
        {record?.status === "sending" ? "正在执行…" : label}
      </Button>
      {record?.error && (
        <span className="codex-patch-error" role="status">
          {record.status === "uncertain" ? "执行结果待核对" : record.error}
          {record.status === "uncertain" && (
            <button
              type="button"
              onClick={() =>
                void useSavedPatchStore.getState().check({ ...input, action })
              }
            >
              核对结果
            </button>
          )}
        </span>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="codex-file-preview codex-patch-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>撤销{scope}保存的变更？</AlertDialogTitle>
            <AlertDialogDescription>
              仅撤销这个轮次记录的修改；后续内容冲突时不应用。会话消息和 Git
              暂存区会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="break-all text-xs">
            项目：{cwd}
            <br />
            轮次：{turnId}
            {filePath && (
              <>
                <br />
                文件：{filePath}
              </>
            )}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={apply}>确认撤销</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
