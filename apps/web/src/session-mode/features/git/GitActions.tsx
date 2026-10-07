import { CloudUpload, GitCommit, ListTodo } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@session/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import { useToast } from "@session/components/ui/use-toast";
import { gitCommit, gitPush } from "@session/services/apiAdapt/git";
import { useGitStatsStore } from "@session/stores/useGitStatsStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { GitCommitDialog } from "./GitCommitDialog";

export function GitActions() {
  const { cwd } = useWorkspaceStore();
  const { refreshStats } = useGitStatsStore();
  const { toast } = useToast();

  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);

  const refreshGitStats = useCallback(() => {
    if (!cwd) return;
    void refreshStats(cwd);
  }, [cwd, refreshStats]);

  const confirmGitCommit = async (message: string) => {
    if (!cwd) return;
    try {
      await gitCommit(cwd, message);
      refreshGitStats();
      toast.success("提交成功", {
        description: `已提交： "${message}"`,
      });
    } catch (err) {
      toast.error("提交失败", { description: String(err) });
      throw err;
    }
  };

  const handleGitPush = async () => {
    if (!cwd) return;
    try {
      await gitPush(cwd);
      toast.success("推送成功", { description: "已推送到远程仓库" });
    } catch (err) {
      console.error("Push failed:", err);
      toast.error("推送失败", { description: String(err) });
    }
  };

  if (!cwd) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg hover:bg-accent"
            title="Git 操作"
            aria-label="Git 操作"
          >
            <ListTodo className="size-4 text-muted-foreground hover:text-foreground transition-colors" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-44 p-1">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground px-2 py-1.5">
            Git 操作
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="gap-2 text-xs cursor-pointer"
            onClick={() => setIsCommitDialogOpen(true)}
          >
            <GitCommit className="size-3.5 text-primary" />
            <span>提交更改…</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            className="gap-2 text-xs cursor-pointer"
            onClick={handleGitPush}
          >
            <CloudUpload className="size-3.5 text-primary" />
            <span>推送到远程仓库</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <GitCommitDialog
        isOpen={isCommitDialogOpen}
        onClose={() => setIsCommitDialogOpen(false)}
        onConfirm={confirmGitCommit}
      />
    </>
  );
}
