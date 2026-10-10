import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import {
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderPlus,
  Plus,
} from "lucide-react";
import { defaultStyles, FileIcon } from "react-file-icon";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@session/components/ui/context-menu";
import { Button } from "@session/components/ui/button";
import { isTauri } from "@session/hooks/runtime";
import {
  useEditorStore,
  useInputStore,
  useLayoutStore,
  useWorkspaceStore,
} from "@session/stores";
import type { FileAction, FileNode } from "./types";
import { getExtension, isLatexFile, isOfficeFile, isPdfFile } from "./utils";

type FileTreeNodeProps = {
  node: FileNode;
  depth: number;
  rootPath: string | undefined;
  activeExpanded: Set<string>;
  loadingNodes: Set<string>;
  onToggle: (path: string) => void;
  onLoadChildren: (node: FileNode) => void;
  onFileSelect?: (path: string) => void;
  onNodeSelect?: (node: FileNode) => void;
  selectedPath?: string;
  onFileAction?: (action: FileAction, node: FileNode) => void;
};

export function FileTreeNode({
  node,
  depth,
  rootPath,
  activeExpanded,
  loadingNodes,
  onToggle,
  onLoadChildren,
  onFileSelect,
  onNodeSelect,
  selectedPath,
  onFileAction,
}: FileTreeNodeProps) {
  const { selectedFilePath, setSelectedFilePath } = useEditorStore();
  const { addProject } = useWorkspaceStore();
  const { setRightPanelOpen, setActiveRightPanelTab } = useLayoutStore();
  const { appendInputValue } = useInputStore();
  const shouldUseSvgFileIcon = isTauri();

  const isDir = node.kind === "dir";
  const isRoot = rootPath === node.path;
  const isExpanded = activeExpanded.has(node.path);
  const isLoadingChildren = loadingNodes.has(node.path);
  const extension = getExtension(node.name);
  const isSelectedFile = !isDir && selectedFilePath === node.path;

  const relativePath =
    rootPath && node.path.startsWith(rootPath)
      ? node.path.slice(rootPath.length).replace(/^[/\\]/, "") || "."
      : node.path;

  const iconStyle =
    extension && extension in defaultStyles
      ? defaultStyles[extension as keyof typeof defaultStyles]
      : defaultStyles.txt;

  const handleClick = () => {
    onNodeSelect?.(node);
    if (isDir) {
      if (!isExpanded && !node.children) onLoadChildren(node);
      onToggle(node.path);
      return;
    }
    setSelectedFilePath(node.path);
    if (onFileSelect) {
      onFileSelect(node.path);
      return;
    }
    if (
      isLatexFile(extension) ||
      isPdfFile(extension) ||
      isOfficeFile(extension)
    ) {
      setRightPanelOpen(true);
      setActiveRightPanelTab("files");
    } else {
      setRightPanelOpen(true);
      setActiveRightPanelTab("files");
    }
  };

  const handleInsert = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    appendInputValue(`\`${relativePath}\``);
  };
  const actions: [FileAction, string][] = [
    ...(isDir
      ? ([
          ["new-file", "新建文件"],
          ["new-folder", "新建文件夹"],
          ["upload", "上传文件到此目录"],
        ] as [FileAction, string][])
      : []),
    ["download", isDir ? "下载文件夹（ZIP）" : "下载文件"],
    ["copy-path", "复制绝对路径"],
    ["copy-relative", "复制相对路径"],
    ["rename", "重命名"],
    ["move", "移动"],
    ["delete", "移入回收站"],
  ];

  return (
    <div>
      <ContextMenu
        onOpenChange={(open) => {
          if (open) onNodeSelect?.(node);
        }}
      >
        <ContextMenuTrigger asChild disabled={!onFileAction}>
          <div
            role="button"
            tabIndex={0}
            data-file-path={node.path}
            onClick={handleClick}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            }}
            aria-label={`${isDir ? "文件夹" : "文件"} ${node.name}`}
            aria-expanded={isDir ? isExpanded : undefined}
            aria-pressed={!isDir ? isSelectedFile : undefined}
            title={node.path}
            className={`group/file-row flex w-full items-center gap-2 rounded-md px-2 py-1 pr-3 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              isSelectedFile || selectedPath === node.path
                ? "bg-accent text-accent-foreground"
                : ""
            }`}
            style={{ paddingLeft: depth * 12 }}
          >
            {/* Directory disclosure has its own hit target; path insertion stays separate. */}
            {isDir ? (
              <button
                type="button"
                aria-label={`${isExpanded ? "收起" : "展开"}文件夹 ${node.name}`}
                aria-expanded={isExpanded}
                onClick={(e) => {
                  e.stopPropagation();
                  handleClick();
                }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            ) : (
              <span className="w-4" />
            )}

            {/* File icon / insert-file button */}
            {!isDir && (
              <span className="relative h-4 w-4 shrink-0">
                {shouldUseSvgFileIcon ? (
                  <FileIcon extension={extension} {...iconStyle} />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                )}
                {!isRoot && (
                  <Button
                    onClick={handleInsert}
                    variant="ghost"
                    size="icon"
                    title={`插入路径 ${node.name}`}
                    aria-label={`插入路径 ${node.name}`}
                    className="absolute inset-0 h-4 w-4 min-h-0 min-w-0 rounded-none p-0 text-muted-foreground opacity-100 lg:opacity-0 transition-opacity lg:group-hover/file-row:opacity-100 group-focus-within/file-row:opacity-100 focus-visible:opacity-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </span>
            )}

            <span className="whitespace-nowrap">{node.name}</span>

            {isDir && !isRoot && (
              <Button
                onClick={handleInsert}
                variant="ghost"
                size="icon"
                title={`插入路径 ${node.name}`}
                aria-label={`插入路径 ${node.name}`}
                className="ml-auto h-6 w-6 shrink-0 opacity-100 lg:opacity-0 transition-opacity lg:group-hover/file-row:opacity-100 group-focus-within/file-row:opacity-100 focus-visible:opacity-100"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}

            {/* Add-as-project button (dirs only, hover) */}
            {isDir && !isRoot && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 opacity-100 lg:opacity-0 transition-opacity lg:group-hover/file-row:opacity-100 group-focus-within/file-row:opacity-100 focus-visible:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  addProject(node.path);
                }}
                title="添加为项目"
                aria-label={`添加为项目 ${node.name}`}
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            )}

            {isLoadingChildren && (
              <span
                className="ml-auto text-xs text-muted-foreground"
                role="status"
              >
                正在加载…
              </span>
            )}
            {onFileAction && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`文件操作：${node.name}`}
                    className="session-file-row-menu"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onClick={(e) => e.stopPropagation()}
                >
                  {actions.map(([action, label]) => (
                    <DropdownMenuItem
                      key={action}
                      onSelect={() => onFileAction(action, node)}
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </ContextMenuTrigger>
        {onFileAction && (
          <ContextMenuContent onClick={(event) => event.stopPropagation()}>
            {actions.map(([action, label]) => (
              <ContextMenuItem
                key={action}
                onSelect={() => onFileAction(action, node)}
              >
                {label}
              </ContextMenuItem>
            ))}
          </ContextMenuContent>
        )}
      </ContextMenu>

      {/* Recursive children */}
      {isDir &&
        isExpanded &&
        node.children?.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            rootPath={rootPath}
            activeExpanded={activeExpanded}
            loadingNodes={loadingNodes}
            onToggle={onToggle}
            onLoadChildren={onLoadChildren}
            onFileSelect={onFileSelect}
            onNodeSelect={onNodeSelect}
            selectedPath={selectedPath}
            onFileAction={onFileAction}
          />
        ))}
    </div>
  );
}
