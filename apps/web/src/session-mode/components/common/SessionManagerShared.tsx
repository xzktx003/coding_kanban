import { useRef } from "react";
import { CheckSquare, Search, Square, Trash2, X } from "lucide-react";
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
import { Input } from "@session/components/ui/input";

export interface ToolbarProps {
  search: string;
  onSearch: (v: string) => void;
  selectedCount: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onDeleteSelected: () => void;
}

export function Toolbar({
  search,
  onSearch,
  selectedCount,
  allSelected,
  onToggleAll,
  onDeleteSelected,
}: ToolbarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={onToggleAll}
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        title={allSelected ? "取消全选" : "全选当前结果"}
        aria-label={allSelected ? "取消全选" : "全选当前结果"}
        aria-pressed={allSelected}
      >
        {allSelected ? (
          <CheckSquare className="h-4 w-4" />
        ) : (
          <Square className="h-4 w-4" />
        )}
      </button>
      <div className="relative flex-1">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          ref={inputRef}
          aria-label="搜索会话"
          placeholder="搜索名称或项目…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="h-9 pl-7 pr-9"
        />
        {search && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-9 w-9"
            aria-label="清空搜索"
            onClick={() => {
              onSearch("");
              inputRef.current?.focus();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {selectedCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
          onClick={onDeleteSelected}
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除所选 ({selectedCount})
        </Button>
      )}
    </div>
  );
}

export interface DeleteConfirmDialogProps {
  open: boolean;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({
  open,
  count,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除 {count} 条会话记录？</AlertDialogTitle>
          <AlertDialogDescription>
            所选会话及其历史记录将被永久删除，此操作无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>取消</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
