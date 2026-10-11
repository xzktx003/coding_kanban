import { GitBranchPlus, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@session/components/ui/button';
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@session/components/ui/dropdown-menu';
import { Input } from '@session/components/ui/input';
import { gitCreateBranch } from '@session/services/apiAdapt/git';

interface NewBranchSubMenuProps {
  cwd: string | null;
  disabled?: boolean;
  onBranchCreated: (name: string) => void;
  onCloseMenu: () => void;
}

export function NewBranchSubMenu({
  cwd,
  disabled = false,
  onBranchCreated,
  onCloseMenu,
}: NewBranchSubMenuProps) {
  const [open, setOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setNewBranchName('');
    setError(null);
  };

  async function handleCreateBranch() {
    if (!cwd || disabled) return;
    const name = newBranchName.trim();
    if (!name || creating) return;
    if (name.endsWith("/")) {
      setError("分支名不能以“/”结尾。");
      return;
    }
    setError(null);
    setCreating(true);
    try {
      await gitCreateBranch(cwd, name);
      onBranchCreated(name);
      setOpen(false);
      resetForm();
      onCloseMenu();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  if (disabled) {
    return (
      <DropdownMenuItem
        disabled
        title="提交更改以创建并检出新分支"
        className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground"
        onSelect={(event) => event.preventDefault()}
      >
        <GitBranchPlus className="h-3 w-3 shrink-0" />
        <span>创建并检出新分支…</span>
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuSub
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) resetForm();
      }}
    >
      <DropdownMenuSubTrigger
        disabled={disabled}
        title={disabled ? "提交更改以创建并检出新分支" : "创建并检出新分支…"}
        className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground cursor-pointer"
      >
        <GitBranchPlus className="h-3 w-3 shrink-0" />
        <span>创建并检出新分支…</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56 p-2 ml-1">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: not a control — it only stops the row's click from reaching the parent */}
        <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Input
            autoFocus
            aria-label="分支名称"
            placeholder="新分支"
            value={newBranchName}
            onChange={(e) => {
              setNewBranchName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCreateBranch();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
              }
            }}
            className="h-7 text-xs font-mono"
          />
          {error && <p className="text-[10px] text-destructive px-1">{error}</p>}
          <div className="flex gap-1">
            <Button
              size="sm"
              className="h-6 flex-1 text-xs"
              onClick={handleCreateBranch}
              disabled={!newBranchName.trim() || creating}
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : "创建并检出"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => setOpen(false)}
            >
              关闭
            </Button>
          </div>
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
