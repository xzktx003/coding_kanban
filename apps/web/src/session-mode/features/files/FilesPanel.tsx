import { openWorkspaceFileReference } from "@session/services/openWorkspaceFileReference";
import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
import { FileCloseDialog } from "./FileCloseDialog";
import { FileOperations, type FileOperationTarget } from "./FileOperations";
import { ArrowUp, Folders, X } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@session/components/ui/button";
import { Input } from "@session/components/ui/input";
import {
  canonicalizePath,
  readDirectory,
} from "@session/services/apiAdapt/filesystem";
import { useIsMobile } from "@session/hooks/use-mobile";
import { useEditorStore, useWorkspaceStore } from "@session/stores";
import { getFilename } from "@session/utils/getFilename";
import { FileTree, FileViewer } from "./explorer";
import type { FileNode } from "./explorer/types";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@session/components/ui/resizable";

const TREE_SIZE_KEY = "kanban.session.files-tree-size";
const isCanonicalLocalPath = (path: unknown): path is string =>
  typeof path === "string" &&
  path.startsWith("/") &&
  !/[\\\x00-\x1f]/.test(path) &&
  !path.split("/").some((part) => part === "." || part === "..");
function readTreeSize() {
  try {
    const value = Number(localStorage.getItem(TREE_SIZE_KEY));
    if (Number.isFinite(value) && value >= 20 && value <= 65) return value;
  } catch {
    /* Storage can be unavailable; resizing still works in this tab. */
  }
  return 35;
}

export default function FilesPanel() {
  const { openFiles, activeFile, closeFile, setActiveFile, revealLocation } =
    useEditorStore();
  const { cwd, projects } = useWorkspaceStore();
  const [location, setLocation] = useState<{
    owner: string | null;
    path: string;
  }>({ owner: cwd, path: cwd ?? "" });
  const browsePath = location.owner === cwd ? location.path : (cwd ?? "");
  const revealRevision =
    revealLocation?.path === activeFile ? revealLocation.revision : 0;
  const [fileOrigin, setFileOrigin] = useState({
    path: activeFile,
    revision: revealRevision,
    owner: cwd,
    directory: browsePath,
  });
  const currentFileOrigin =
    fileOrigin.path === activeFile && fileOrigin.revision === revealRevision
      ? fileOrigin
      : {
          path: activeFile,
          revision: revealRevision,
          owner: cwd,
          directory: browsePath,
        };
  if (currentFileOrigin !== fileOrigin) setFileOrigin(currentFileOrigin);
  const [pathInput, setPathInput] = useState(cwd ?? "");
  const [pathError, setPathError] = useState("");
  const [navigationPending, setNavigationPending] = useState(false);
  const navigationRevision = useRef(0);
  const currentOwner = useRef(cwd);
  currentOwner.current = cwd;
  const currentDirectory = useRef(browsePath);
  currentDirectory.current = browsePath;
  const selectionRevision = useRef(0);
  const actionRevision = useRef(0);
  const [selectionPending, setSelectionPending] = useState(false);
  const [selectionError, setSelectionError] = useState(false);
  const treeRoot =
    cwd &&
    (browsePath === cwd || browsePath.startsWith(cwd.replace(/\/+$/, "") + "/"))
      ? cwd
      : "/";
  useEffect(() => {
    navigationRevision.current++;
    setPathInput(cwd ?? "");
    setPathError("");
    setNavigationPending(false);
    return () => {
      navigationRevision.current++;
    };
  }, [cwd]);
  const navigate = async (path: string) => {
    const input = path.trim(),
      owner = cwd,
      own = ++navigationRevision.current;
    if (!input.startsWith("/") || /[\\\x00-\x1f]/.test(input)) {
      setNavigationPending(false);
      setPathError("请输入有效的本机绝对路径");
      return;
    }
    actionRevision.current++;
    setNavigationPending(true);
    try {
      const canonical = await canonicalizePath(input);
      if (!isCanonicalLocalPath(canonical))
        throw new Error("服务未返回有效的本机目录");
      if (own !== navigationRevision.current || currentOwner.current !== owner)
        return;
      await readDirectory(canonical);
      if (own !== navigationRevision.current || currentOwner.current !== owner)
        return;
      setLocation({ owner, path: canonical });
      setPathInput(canonical);
      setPathError("");
    } catch (error) {
      if (own === navigationRevision.current && currentOwner.current === owner)
        setPathError(error instanceof Error ? error.message : String(error));
    } finally {
      if (own === navigationRevision.current && currentOwner.current === owner)
        setNavigationPending(false);
    }
  };
  const drafts = useFileDocumentStore((s) => s.documents);
  const [closing, setClosing] = useState<string | null>(null);
  const [fileAction, setFileAction] = useState<FileOperationTarget | null>(
    null,
  );
  const [selectedNode, setSelectedNode] = useState<{
    owner: string | null;
    root: string;
    node: FileNode;
    displayPath?: string;
    activeFile: string | null;
    revealRevision: number;
  } | null>(null);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [dropError, setDropError] = useState("");
  const selected =
    selectedNode &&
    selectedNode.owner === cwd &&
    selectedNode.root === browsePath &&
    selectedNode.activeFile === activeFile &&
    selectedNode.revealRevision === revealRevision
      ? selectedNode.node
      : null;
  const currentFile =
    activeFile &&
    browsePath &&
    (activeFile.startsWith(browsePath.replace(/\/$/, "") + "/") ||
      (currentFileOrigin.owner === cwd &&
        currentFileOrigin.directory === browsePath &&
        currentFileOrigin.path === activeFile))
      ? activeFile
      : null;
  const rootForPath = (path: string) =>
    path === treeRoot || path.startsWith(treeRoot.replace(/\/$/, "") + "/")
      ? treeRoot
      : "/";
  const operationRoot = selected
    ? rootForPath(selected.path)
    : currentFile
      ? rootForPath(currentFile)
      : treeRoot;
  const operationTarget = selected
    ? { path: selected.path, isDir: selected.kind === "dir" }
    : currentFile
      ? { path: currentFile, isDir: false }
      : operationRoot === "/" && browsePath
        ? { path: browsePath, isDir: true }
        : null;
  const selectNode = (node: FileNode) => {
    if (navigationPending) return;
    actionRevision.current++;
    const own = ++selectionRevision.current;
    const owner = cwd,
      directory = browsePath;
    if (!directory) return;
    setPathError("");
    setSelectionError(false);
    setSelectedNode({
      owner,
      root: directory,
      node,
      displayPath: node.path,
      activeFile,
      revealRevision,
    });
    setSelectionPending(node.kind === "dir");
    if (node.kind !== "dir") return;
    void canonicalizePath(node.path)
      .then((path) => {
        if (!isCanonicalLocalPath(path))
          throw new Error("服务未返回有效的本机目录");
        if (
          own !== selectionRevision.current ||
          currentOwner.current !== owner ||
          currentDirectory.current !== directory
        )
          return;
        setSelectedNode({
          owner,
          root: directory,
          node: { ...node, path },
          displayPath: node.path,
          activeFile,
          revealRevision,
        });
      })
      .catch((error) => {
        if (
          own === selectionRevision.current &&
          currentOwner.current === owner &&
          currentDirectory.current === directory
        ) {
          setSelectionError(true);
          setPathError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (
          own === selectionRevision.current &&
          currentOwner.current === owner &&
          currentDirectory.current === directory
        )
          setSelectionPending(false);
      });
  };
  useEffect(() => {
    selectionRevision.current++;
    actionRevision.current++;
    setSelectionPending(false);
    setSelectionError(false);
    setSelectedNode(null);
    setDropError("");
    setDraggingFiles(false);
    return () => {
      selectionRevision.current++;
      actionRevision.current++;
    };
  }, [cwd, browsePath, activeFile, revealRevision]);
  const handleNodeAction = async (
    type: FileOperationTarget["type"],
    node: FileNode,
  ) => {
    if (navigationPending) {
      setPathError("正在切换目录，请稍后操作");
      return;
    }
    const owner = cwd,
      directory = browsePath,
      own = ++actionRevision.current;
    let path = node.path;
    if (
      node.kind === "dir" &&
      ["new-file", "new-folder", "upload", "download"].includes(type)
    ) {
      try {
        path = await canonicalizePath(path);
        if (!isCanonicalLocalPath(path))
          throw new Error("服务未返回有效的本机目录");
      } catch (error) {
        if (
          own === actionRevision.current &&
          currentOwner.current === owner &&
          currentDirectory.current === directory
        )
          setPathError(error instanceof Error ? error.message : String(error));
        return;
      }
      if (
        own !== actionRevision.current ||
        currentOwner.current !== owner ||
        currentDirectory.current !== directory
      )
        return;
    }
    setFileAction({
      type,
      root: rootForPath(path),
      path,
      isDir: node.kind === "dir",
    });
  };
  const requestClose = (path: string) => {
    const doc = useFileDocumentStore.getState().documents[path];
    if (doc && doc.draft !== doc.base) setClosing(path);
    else closeFile(path);
  };
  const isMobile = useIsMobile();
  const [isFileTreeVisible, setIsFileTreeVisible] = useState(!isMobile);

  const [initialTreeSize] = useState(readTreeSize);
  const treeSize = useRef(initialTreeSize);
  const rememberLayout = (sizes: number[]) => {
    // A hidden tree/mobile layout has just one panel: never replace the saved split.
    if (sizes.length !== 2 || sizes[1] === treeSize.current) return;
    treeSize.current = sizes[1];
    try {
      localStorage.setItem(TREE_SIZE_KEY, String(sizes[1]));
    } catch {
      /* Optional preference. */
    }
  };

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
  const handleFileSelect = async (path: string) => {
    if (navigationPending) {
      setPathError("正在切换目录，请稍后操作");
      return;
    }
    // Directory listings can return canonical paths beneath linked project folders.
    const ownerRoot =
      [cwd, ...(projects ?? [])]
        .filter(
          (root): root is string =>
            !!root &&
            (path === root || path.startsWith(root.replace(/\/+$/, "") + "/")),
        )
        .sort((left, right) => right.length - left.length)[0] ??
      rootForPath(path);
    if (await openWorkspaceFileReference({ path }, ownerRoot)) {
      if (isMobile) setIsFileTreeVisible(false);
    }
  };

  return (
    <div
      className="relative flex flex-col h-full min-h-0 w-full overflow-hidden"
      role="region"
      aria-label="会话文件管理"
      onDragOver={(event) => {
        if (!cwd || !Array.from(event.dataTransfer.types).includes("Files"))
          return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        setDraggingFiles(true);
      }}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setDraggingFiles(false);
      }}
      onDrop={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        setDraggingFiles(false);
        if (selectionPending || selectionError || navigationPending) {
          setDropError(
            navigationPending
              ? "正在切换目录，请稍后上传"
              : selectionError
                ? "所选目录无法确认，请重新选择后上传"
                : "正在解析所选目录，请稍后上传",
          );
          return;
        }
        if (!cwd) return;
        if (
          Array.from(event.dataTransfer.items ?? []).some(
            (item) => item.webkitGetAsEntry?.()?.isDirectory,
          )
        ) {
          setDropError("请展开文件夹后选择文件上传；当前拖入上传仅支持文件。");
          return;
        }
        const files = Array.from(event.dataTransfer.files);
        if (!files.length) return;
        setDropError("");
        const dir = operationTarget
          ? operationTarget.isDir
            ? operationTarget.path
            : operationTarget.path.slice(
                0,
                operationTarget.path.lastIndexOf("/"),
              )
          : browsePath;
        window.dispatchEvent(
          new CustomEvent("workspace-files-upload", {
            detail: { root: operationRoot, dir, files },
          }),
        );
      }}
    >
      {draggingFiles && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-primary bg-background/90 text-sm">
          松开文件，上传到
          {operationTarget?.isDir ? operationTarget.path : "当前目录"}
        </div>
      )}
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
                  onClick={() => {
                    setSelectedNode(null);
                    setFileOrigin({
                      path,
                      revision:
                        revealLocation?.path === path
                          ? revealLocation.revision
                          : 0,
                      owner: cwd,
                      directory: browsePath,
                    });
                    setActiveFile(path);
                  }}
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

      {cwd && (
        <form
          className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void navigate(pathInput);
          }}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="返回上级目录"
            title="返回上级目录"
            disabled={browsePath === "/"}
            onClick={() =>
              void navigate(
                browsePath
                  .replace(/\/+$/, "")
                  .slice(0, browsePath.replace(/\/+$/, "").lastIndexOf("/")) ||
                  "/",
              )
            }
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Input
            aria-label="文件浏览路径"
            className="h-8 min-w-0 flex-1 text-xs"
            value={pathInput}
            onChange={(event) => {
              navigationRevision.current++;
              setNavigationPending(false);
              setPathInput(event.target.value);
            }}
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
          >
            前往
          </Button>
        </form>
      )}
      {pathError && (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          {pathError}
        </p>
      )}
      <FileOperations
        root={
          cwd && !selectionPending && !selectionError && !navigationPending
            ? operationRoot
            : null
        }
        displayRoot={operationRoot === "/" ? browsePath : operationRoot}
        target={operationTarget}
        action={fileAction}
        onAction={setFileAction}
      />
      {dropError && (
        <p role="alert" className="p-2 text-xs text-destructive">
          {dropError}
        </p>
      )}
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
        <ResizablePanelGroup direction="horizontal" onLayout={rememberLayout}>
          {/* Keep this panel mounted when the tree is hidden or becomes a mobile overlay. */}
          <ResizablePanel
            id="file-preview"
            order={1}
            defaultSize={100 - treeSize.current}
            minSize={35}
            className="flex min-h-0 min-w-0 flex-col overflow-hidden"
          >
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
          </ResizablePanel>

          {/* FileTree — desktop inline, right side */}
          {isFileTreeVisible && !isMobile && cwd && (
            <>
              <ResizableHandle
                aria-label="调整文件树与预览宽度"
                withHandle
                className="shrink-0 hover:bg-primary/50"
              />
              <ResizablePanel
                id="file-tree"
                order={2}
                defaultSize={treeSize.current}
                minSize={20}
                maxSize={65}
                className="h-full min-w-0 bg-sidebar/20 overflow-hidden"
              >
                <FileTree
                  folder={browsePath}
                  onFileSelect={handleFileSelect}
                  onNodeSelect={selectNode}
                  selectedPath={
                    selected ? selectedNode?.displayPath : operationTarget?.path
                  }
                  onFileAction={(action, node) =>
                    void handleNodeAction(action, node)
                  }
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>

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
                folder={browsePath}
                onFileSelect={handleFileSelect}
                onNodeSelect={selectNode}
                selectedPath={
                  selected ? selectedNode?.displayPath : operationTarget?.path
                }
                onFileAction={(action, node) =>
                  void handleNodeAction(action, node)
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
