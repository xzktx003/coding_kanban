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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@session/components/ui/dialog";

interface GitDiffDialogsProps {
  bulkStageDialogOpen: boolean;
  bulkStagePathsCount: number;
  bulkStageLoading: boolean;
  revertConfirmOpen: boolean;
  revertLoading: boolean;
  onBulkStageDialogOpenChange: (open: boolean) => void;
  onRevertConfirmOpenChange: (open: boolean) => void;
  onBulkStageConfirm: () => void;
  onRevertConfirm: () => void;
}

export function GitDiffDialogs({
  bulkStageDialogOpen,
  bulkStagePathsCount,
  bulkStageLoading,
  revertConfirmOpen,
  revertLoading,
  onBulkStageDialogOpenChange,
  onRevertConfirmOpenChange,
  onBulkStageConfirm,
  onRevertConfirm,
}: GitDiffDialogsProps) {
  return (
    <>
      <Dialog
        open={bulkStageDialogOpen}
        onOpenChange={onBulkStageDialogOpenChange}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>暂存当前列表中的全部文件？</DialogTitle>
            <DialogDescription>
              {bulkStagePathsCount === 0
                ? "当前列表没有可暂存的文件。"
                : `将暂存当前文件树中的 ${bulkStagePathsCount} 个文件。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onBulkStageDialogOpenChange(false)}
              disabled={bulkStageLoading}
            >
              取消
            </Button>
            <Button
              onClick={onBulkStageConfirm}
              disabled={bulkStagePathsCount === 0 || bulkStageLoading}
            >
              {bulkStageLoading ? "正在暂存…" : "全部暂存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={revertConfirmOpen}
        onOpenChange={onRevertConfirmOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认丢弃文件变更？</AlertDialogTitle>
            <AlertDialogDescription>
              这会丢弃该文件的所选变更，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revertLoading}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={revertLoading}
              onClick={onRevertConfirm}
            >
              {revertLoading ? "正在还原…" : "确认还原"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
