import { X } from "lucide-react";
import { useRef } from "react";
import { Button } from "@session/components/ui/button";
import { Input } from "@session/components/ui/input";
import { FileTreeNode } from "./FileTreeNode";
import type { FileTreeProps } from "./types";
import { useFileTree } from "./useFileTree";

export function FileTree({
  folder,
  onFileSelect,
  onNodeSelect,
  selectedPath,
  onFileAction,
}: FileTreeProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const {
    treeContainerRef,
    root,
    displayRoot,
    activeExpanded,
    loadingNodes,
    loading,
    error,
    filterText,
    setFilterText,
    searching,
    searchError,
    isSearching,
    hasSearchResults,
    toggle,
    loadChildren,
    setRefreshKey,
  } = useFileTree(folder);

  const header = (
    <div className="shrink-0 px-2 pb-1 pt-2">
      <div className="space-y-1">
        <div className="relative">
          <Input
            ref={searchInputRef}
            placeholder="筛选文件或文件夹…"
            aria-label="筛选文件或文件夹"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="h-9 pr-9 text-sm"
          />
          {filterText && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setFilterText("");
                searchInputRef.current?.focus();
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="清除文件筛选"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  if (!folder) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="px-2 pt-2 text-sm text-muted-foreground">
          先选择项目以浏览文件。
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div role="status" className="px-2 pt-2 text-sm text-muted-foreground">
          正在加载文件…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div
          role="alert"
          className="m-2 space-y-2 rounded border border-destructive/30 p-3 text-sm text-destructive"
        >
          <p className="break-words">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((key: number) => key + 1)}
          >
            重新加载文件树
          </Button>
        </div>
      </div>
    );
  }

  const visibleNodes = displayRoot?.children ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div
        ref={treeContainerRef}
        className="min-h-0 flex-1 overflow-x-auto overflow-y-auto px-2 py-1"
      >
        {!displayRoot ? (
          <div className="text-sm text-muted-foreground">暂无文件。</div>
        ) : (
          <>
            {isSearching && searching && (
              <div role="status" className="text-sm text-muted-foreground">
                正在搜索…
              </div>
            )}
            {isSearching && searchError && (
              <div
                role="alert"
                className="break-words text-sm text-destructive"
              >
                {searchError}
              </div>
            )}
            {isSearching && !searching && !searchError && !hasSearchResults && (
              <div className="text-sm text-muted-foreground">
                没有匹配的文件或文件夹。
              </div>
            )}
            {(!isSearching || hasSearchResults) && (
              <div className="space-y-0.5">
                {visibleNodes.map((child) => (
                  <FileTreeNode
                    key={child.path}
                    node={child}
                    depth={0}
                    rootPath={root?.path}
                    activeExpanded={activeExpanded}
                    loadingNodes={loadingNodes}
                    onToggle={toggle}
                    onLoadChildren={loadChildren}
                    onFileSelect={onFileSelect}
                    onNodeSelect={onNodeSelect}
                    selectedPath={selectedPath}
                    onFileAction={onFileAction}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
