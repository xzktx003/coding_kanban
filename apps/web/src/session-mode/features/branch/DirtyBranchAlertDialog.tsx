import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@session/components/ui/alert-dialog';

export type BranchFileStat = {
  path: string;
  additions: number;
  deletions: number;
  conflict?: boolean;
};

interface DirtyBranchAlertDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  dirtyBranch: string | null;
  files: BranchFileStat[];
  onConfirm: (branch: string) => void;
  onCancel: () => void;
}

export function DirtyBranchAlertDialog({
  isOpen,
  onOpenChange,
  dirtyBranch,
  files,
  onConfirm,
  onCancel,
}: DirtyBranchAlertDialogProps) {
  const conflicts = files.filter((file) => file.conflict);
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>提交更改以切换分支</AlertDialogTitle>
          <AlertDialogDescription>
            提交 {files.length} 个文件中的{" "}
            <span className="text-emerald-400">+{additions}</span>{" "}
            <span className="text-red-400">-{deletions}</span> 更改，以检出{" "}
            <span className="font-mono font-semibold text-foreground">{dirtyBranch}</span>。
            未提交的更改会保留在这次提交里，不会被丢弃。
          </AlertDialogDescription>
          <ul className="max-h-40 space-y-1 overflow-auto px-6 text-xs">
            {files.map((file) => (
              <li key={file.path} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-mono">{file.path}</span>
                <span className="shrink-0">
                  <span className="text-emerald-400">+{file.additions}</span>{" "}
                  <span className="text-red-400">-{file.deletions}</span>
                </span>
              </li>
            ))}
          </ul>
          {conflicts.length > 0 && (
            <p role="alert">
              你对以下文件的更改将被检出操作覆盖：
              {conflicts.map((file) => file.path).join("、")}。请提交更改以继续
            </p>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (dirtyBranch) {
                onConfirm(dirtyBranch);
              }
            }}
          >
            提交并切换分支…
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
