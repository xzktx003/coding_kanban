import { Plus } from "lucide-react";
import { Button } from "@session/components/ui/button";
import { Input } from "@session/components/ui/input";
import { GitFileTree } from "./GitFileTree";
import type { DiffSection, TreeNode } from "./types";

interface GitFileTreePanelProps {
  cwd: string | null;
  selectedDiffSection: DiffSection;
  bulkStagePaths: string[];
  bulkStageLoading: boolean;
  filterText: string;
  gitError: string | null;
  filteredEntriesCount: number;
  fileTree: TreeNode[];
  selectedDiffPath: string | null;
  collapsedFolders: Set<string>;
  onOpenBulkStageDialog: () => void;
  onFilterTextChange: (value: string) => void;
  onToggleFolder: (path: string) => void;
  onSelectPath: (section: DiffSection, path: string) => void;
  onStage: (paths: string[]) => Promise<void>;
  onUnstage: (paths: string[]) => Promise<void>;
}

export function GitFileTreePanel({
  cwd,
  selectedDiffSection,
  bulkStagePaths,
  bulkStageLoading,
  filterText,
  gitError,
  filteredEntriesCount,
  fileTree,
  selectedDiffPath,
  collapsedFolders,
  onOpenBulkStageDialog,
  onFilterTextChange,
  onToggleFolder,
  onSelectPath,
  onStage,
  onUnstage,
}: GitFileTreePanelProps) {
  return (
    <div className="w-64 min-w-[220px] min-h-0 border-l border-border flex flex-col">
      <div className="px-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">文件树</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onOpenBulkStageDialog}
            disabled={bulkStagePaths.length === 0 || bulkStageLoading}
            title={
              selectedDiffSection === "staged"
                ? "切换到未暂存变更以批量暂存"
                : "暂存当前列表中的全部文件"
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            全部暂存
          </Button>
        </div>
        <Input
          value={filterText}
          onChange={(event) => onFilterTextChange(event.target.value)}
          aria-label="筛选变更文件"
          placeholder="筛选文件名或文件夹…"
          className="h-8 text-xs"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="p-2 space-y-1">
          {gitError && (
            <div
              role="alert"
              className="text-xs text-destructive rounded border border-destructive/30 p-2"
            >
              {gitError}
            </div>
          )}
          {filteredEntriesCount === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              没有符合筛选条件的文件。
            </div>
          )}
          {cwd ? (
            <GitFileTree
              fileTree={fileTree}
              selectedDiffPath={selectedDiffPath}
              selectedDiffSection={selectedDiffSection}
              collapsedFolders={collapsedFolders}
              onToggleFolder={onToggleFolder}
              onSelectPath={onSelectPath}
              onStage={onStage}
              onUnstage={onUnstage}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
