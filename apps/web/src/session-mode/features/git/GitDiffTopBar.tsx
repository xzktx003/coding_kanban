import {
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  Folder,
  FolderOpen,
  Menu,
  RefreshCw,
} from "lucide-react";
import { Button } from "@session/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@session/components/ui/select";
import { useLayoutStore } from "@session/stores";
import { GitActions } from "./GitActions";
import { GitStatsIndicator } from "./GitStatsIndicator";
import type { DiffSection, DiffSource } from "./types";

interface GitDiffTopBarProps {
  cwd: string | null;
  gitLoading: boolean;
  diffSource: DiffSource;
  onDiffSourceChange: (value: DiffSource) => void;
  selectedDiffSection: DiffSection;
  onDiffSectionChange: (value: DiffSection) => void;
  unstagedCount: number;
  stagedCount: number;
  showFileTree: boolean;
  onToggleFileTree: () => void;
  onRefresh: () => void;
  /** Omitted by views that don't render the diff list (e.g. latest-turn summary). */
  allDiffsCollapsed?: boolean;
  canToggleAllDiffs?: boolean;
  onToggleAllDiffs?: () => void;
}

export function GitDiffTopBar({
  cwd,
  gitLoading,
  diffSource,
  onDiffSourceChange,
  selectedDiffSection,
  onDiffSectionChange,
  unstagedCount,
  stagedCount,
  showFileTree,
  onToggleFileTree,
  onRefresh,
  allDiffsCollapsed = false,
  canToggleAllDiffs = false,
  onToggleAllDiffs,
}: GitDiffTopBarProps) {
  const { diffWordWrap, setDiffWordWrap, diffSplitMode, setDiffSplitMode } =
    useLayoutStore();

  return (
    <div className="border-b border-border flex flex-wrap items-center gap-1 px-1 py-1">
      <div className="shrink-0">
        <Select
          value={diffSource}
          onValueChange={(value) => {
            const src = value as DiffSource;
            onDiffSourceChange(src);
            if (src === "unstaged" || src === "staged") {
              onDiffSectionChange(src);
            }
          }}
        >
          <SelectTrigger className="h-9 text-xs" aria-label="变更来源">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unstaged">未暂存 ({unstagedCount})</SelectItem>
            <SelectItem value="staged">已暂存 ({stagedCount})</SelectItem>
            <SelectItem value="latest-turn">最近一轮</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {diffSource !== "latest-turn" && (
        <GitStatsIndicator diffSection={selectedDiffSection} />
      )}

      <div className="flex-1" />

      <div className="flex items-center">
        <GitActions />
        {onToggleAllDiffs && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleAllDiffs}
            disabled={!canToggleAllDiffs}
            aria-label={allDiffsCollapsed ? "展开全部变更" : "折叠全部变更"}
            title={allDiffsCollapsed ? "展开全部变更" : "折叠全部变更"}
          >
            {allDiffsCollapsed ? (
              <ChevronsUpDown className="h-4 w-4" />
            ) : (
              <ChevronsDownUp className="h-4 w-4" />
            )}
          </Button>
        )}
        <Button
          variant={diffSplitMode ? "secondary" : "ghost"}
          size="icon"
          className="hidden md:inline-flex"
          onClick={() => setDiffSplitMode(!diffSplitMode)}
          aria-pressed={diffSplitMode}
          aria-label={diffSplitMode ? "切换到统一视图" : "切换到并排视图"}
          title={diffSplitMode ? "切换到统一视图" : "切换到并排视图"}
        >
          <Columns2 className="h-4 w-4" />
        </Button>
        <Button
          variant={showFileTree ? "secondary" : "ghost"}
          size="icon"
          onClick={onToggleFileTree}
          aria-expanded={showFileTree}
          className="hidden md:inline-flex"
          aria-label={showFileTree ? "隐藏变更文件树" : "显示变更文件树"}
          title={showFileTree ? "隐藏变更文件树" : "显示变更文件树"}
        >
          {showFileTree ? (
            <FolderOpen className="h-4 w-4" />
          ) : (
            <Folder className="h-4 w-4" />
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="变更选项"
              title="变更选项"
            >
              <Menu className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onRefresh} disabled={!cwd || gitLoading}>
              <RefreshCw className="h-4 w-4" /> 刷新变更
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDiffWordWrap(!diffWordWrap)}>
              {diffWordWrap ? "关闭自动换行" : "开启自动换行"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
