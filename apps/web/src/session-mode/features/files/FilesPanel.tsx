import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
import { FileCloseDialog } from "./FileCloseDialog";
import { FileOperations, type FileOperationTarget } from "./FileOperations";
import { Folders, X } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@session/components/ui/button";
import { useIsMobile } from "@session/hooks/use-mobile";
import { useEditorStore, useWorkspaceStore } from "@session/stores";
import { getFilename } from "@session/utils/getFilename";
import { FileTree, FileViewer } from "./explorer";

export default function FilesPanel() {
  const { openFiles, activeFile, openFile, closeFile, setActiveFile } =
    useEditorStore();
  const { cwd } = useWorkspaceStore();
  const drafts = useFileDocumentStore((s) => s.documents);
  const [closing, setClosing] = useState<string | null>(null);
  const [fileAction, setFileAction] = useState<FileOperationTarget | null>(
    null,
  );
  const requestClose = (path: string) => {
    const doc = useFileDocumentStore.getState().documents[path];
    if (doc && doc.draft !== doc.base) setClosing(path);
    else closeFile(path);
  };
  const isMobile = useIsMobile();
  const [isFileTreeVisible, setIsFileTreeVisible] = useState(!isMobile);

  const fileTabsRef = useRef<HTMLDivElement>(null);
  const treeToggleRef = useRef<HTMLButtonElement>(null);
  const visitedFiles = useRef(new Set<string>());
  if (activeFile) visitedFiles.current.add(activeFile);
  for (const path of visitedFiles.current) {
    if (!openFiles.includes(path)) visitedFiles.current.delete(path);
  }

  // Collapse tree on mobile when cwd changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: cwd is the trigger for reloading the panel
  // biome-ignore lint/correctness/useExhaustiveDependencies: cwd is the trigger for reloading the panel
  useEffect(() => {
    setIsFileTreeVisible(!isMobile);
  }, [cwd, isMobile]);

  // Close tree overlay when a file is selected on mobile
  const handleFileSelect = (path: string) => {
    openFile(path, cwd ?? undefined);
    if (isMobile) setIsFileTreeVisible(false);
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex h-9 shrink-0 items-center border-b border-border bg-sidebar/30 backdrop-blur-sm overflow-hidden">
        {/* Scrollable tabs */}
        <div
          ref={fileTabsRef}
          aria-label="已打开文件"
          className="flex min-w-0 flex-1 overflow-x-auto scrollbar-none"
        >
          {openFiles.map((path) => {
            const isActive = path === activeFile;
            return (
              <div
                key={path}
                className={`group flex h-9 shrink-0 items-center border-r border-border ${isActive ? "bg-background" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => setActiveFile(path)}
                  aria-label={`查看文件 ${getFilename(path)}`}
                  aria-pressed={isActive}
                  className={`flex h-9 min-w-0 items-center pl-3 pr-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                  }`}
                  title={path}
                >
                  <span className="max-w-[120px] truncate font-mono">
                    {getFilename(path)}
                    {drafts[path]?.draft !== drafts[path]?.base && (
                      <span aria-label="未保存修改"> ●</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`关闭文件 ${getFilename(path)}`}
                  title={`关闭文件 ${getFilename(path)}`}
                  onClick={(event) => {
                    const restoreFocus =
                      event.currentTarget === document.activeElement;
                    requestClose(path);
                    if (restoreFocus)
                      requestAnimationFrame(() => {
                        const next =
                          fileTabsRef.current?.querySelector<HTMLButtonElement>(
                            'button[aria-pressed="true"]',
                          );
                        (next ?? treeToggleRef.current)?.focus();
                      });
                  }}
                  className="mr-1 flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground opacity-100 transition-colors lg:opacity-0 lg:group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
        <Button
          ref={treeToggleRef}
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-none border-r border-border text-muted-foreground hover:text-foreground hover:bg-accent/60"
          onClick={() => setIsFileTreeVisible((v) => !v)}
          title={isFileTreeVisible ? "隐藏文件树" : "显示文件树"}
          aria-expanded={isFileTreeVisible}
          aria-label={isFileTreeVisible ? "隐藏文件树" : "显示文件树"}
        >
          <Folders className="h-4 w-4" />
        </Button>
      </div>

      <FileOperations root={cwd} action={fileAction} onAction={setFileAction} />
      <FileCloseDialog
        path={closing}
        onCancel={() => setClosing(null)}
        onClose={(path) => {
          closeFile(path);
          setClosing(null);
        }}
      />
      {/* Content area */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden w-full">
        {/* FileViewer */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {openFiles
            .filter((path) => visitedFiles.current.has(path))
            .map((path) => (
              <div
                key={path}
                className="h-full min-h-0 min-w-0"
                hidden={activeFile !== path}
                inert={activeFile !== path}
              >
                <Suspense
                  fallback={
                    <div
                      role="status"
                      className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground"
                    >
                      正在加载文件…
                    </div>
                  }
                >
                  <FileViewer filePath={path} />
                </Suspense>
              </div>
            ))}
          {!activeFile && (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              选择文件以查看内容
            </div>
          )}
        </div>

        {/* FileTree — desktop inline, right side */}
        {isFileTreeVisible && !isMobile && cwd && (
          <div
            className={`h-full shrink-0 border-l border-border bg-sidebar/20 overflow-hidden ${
              activeFile ? "w-60 min-w-60" : "flex-1"
            }`}
          >
            <FileTree
              folder={cwd}
              onFileSelect={handleFileSelect}
              onFileAction={(action, node) =>
                setFileAction({
                  type: action,
                  root: cwd,
                  path: node.path,
                  isDir: node.kind === "dir",
                })
              }
            />
          </div>
        )}

        {/* FileTree — mobile overlay from right */}
        {isFileTreeVisible && isMobile && cwd && (
          <>
            <button
              type="button"
              className="absolute inset-0 z-10 bg-black/20"
              aria-label="隐藏文件树"
              onClick={() => setIsFileTreeVisible(false)}
            />
            <div className="absolute inset-y-0 right-0 z-20 w-[min(78vw,280px)] border-l border-border bg-sidebar/90 overflow-hidden backdrop-blur">
              <FileTree
                folder={cwd}
                onFileSelect={handleFileSelect}
                onFileAction={(action, node) =>
                  setFileAction({
                    type: action,
                    root: cwd,
                    path: node.path,
                    isDir: node.kind === "dir",
                  })
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
