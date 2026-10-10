import { nativeDiffLines } from "./nativeDiffLines";
import { NativeDiffContent } from "./NativeDiffContent";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NativeDiffSelection } from "./nativeDiffSelection";
import { Button } from "@session/components/ui/button";
import { cn } from "@session/lib/utils";
import { getDiffCounts, normalizeUnifiedDiff } from "@session/utils/diff";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@session/components/ui/dropdown-menu";
import { NativeReviewChevron, NativeReviewEllipsis, NativeReviewFileIcon } from "./git/NativeReviewIcons";
import { NativeCommandCopy } from "@session/components/codex/presentation/NativeCommandIcons";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@session/components/ui/context-menu";

interface DiffViewerProps {
  original?: string;
  current?: string;
  unifiedDiff?: string;
  displayPath?: string;
  isCollapsed?: boolean;
  /** Bump to force-reset the collapsed state back to `isCollapsed` (e.g. "collapse/expand all"). */
  resetKey?: number;
  className?: string;
  native?: boolean;
  split?: boolean;
  onOpenFile?: () => void;
  presentation?: "inline" | "preview" | "review";
  onSelectLines?: (selection: NativeDiffSelection) => void;
  onOpenLine?: (location: { side: "old" | "new"; line: number }) => void;
  selection?: NativeDiffSelection | null;
  renderAnnotation?: (location: { side: "old" | "new"; line: number }) => ReactNode;
  renderHunkActions?: (hunkIndex: number) => ReactNode;
  wrap?: boolean;
}

const shouldSkipUnifiedLine = (line: string) =>
  /^\s*(new file|deleted file)\b/i.test(line) ||
  /^\s*mode \d+/i.test(line) ||
  /^\s*(new mode|old mode)\b/i.test(line) ||
  /^\s*similarity index\b/i.test(line) ||
  /^\s*rename (from|to)\b/i.test(line) ||
  /\*\*\* (Begin Patch|End Patch|Update File:)/i.test(line);

const getFilename = (path: string) => {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
};

const VIEW_MODES: Array<"old" | "new" | "diff"> = ["old", "new", "diff"];

export function DiffViewer({
  original = "",
  current = "",
  unifiedDiff,
  displayPath,
  isCollapsed = true,
  resetKey,
  className,
  native = false,
  split = false,
  onOpenFile,
  presentation = "preview",
  onSelectLines,
  onOpenLine,
  selection,
  renderAnnotation,
  renderHunkActions,
  wrap = false,
}: DiffViewerProps) {
  const inline = native && presentation === "inline";
  const review = native && presentation === "review";
  const preview = native && presentation === "preview";
  const [viewMode, setViewMode] = useState<"old" | "new" | "diff">("diff");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyRequest = useRef(0);
  const [collapsed, setCollapsed] = useState(isCollapsed);
  const [localWrap, setLocalWrap] = useState(wrap);
  const copyTimeoutRef = useRef<number | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is a trigger dependency, used for its identity change alone
  useEffect(() => {
    return () => {
      copyRequest.current++;
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is a trigger dependency, used for its identity change alone
  useEffect(() => {
    setCollapsed(isCollapsed);
  }, [isCollapsed, resetKey]);
  useEffect(() => { setLocalWrap(wrap); }, [wrap, displayPath, resetKey]);

  const normalizedUnified = useMemo(
    () => normalizeUnifiedDiff(unifiedDiff),
    [unifiedDiff],
  );

  // If unifiedDiff is provided, approximate split to left/right
  const { left, right } = useMemo(() => {
    if (!normalizedUnified) return { left: original, right: current };
    const lines = normalizedUnified.split("\n");
    const orig: string[] = [];
    const curr: string[] = [];
    for (const line of lines) {
      const skipLine = shouldSkipUnifiedLine(line);
      if (
        skipLine ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("@@") ||
        line.startsWith("diff --git") ||
        line.startsWith("index ")
      )
        continue;
      if (line.startsWith("-")) {
        orig.push(line.slice(1));
      } else if (line.startsWith("+")) {
        curr.push(line.slice(1));
      } else {
        if (line === "" || line.startsWith("\\ No newline")) continue;
        const content = line.startsWith(" ") ? line.slice(1) : line;
        orig.push(content);
        curr.push(content);
      }
    }
    return { left: orig.join("\n"), right: curr.join("\n") };
  }, [normalizedUnified, original, current]);

  const diffLines = useMemo(() => {
    if (native && normalizedUnified && !/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(normalizedUnified) && /^(?:diff --git |Binary files |GIT binary patch|old mode |new file mode |deleted file mode |rename from )/m.test(normalizedUnified)) return [];
    const rows = nativeDiffLines(left, right, normalizedUnified);
    if (viewMode === "diff") return rows;
    return rows
      .filter(
        (row) =>
          row.separator ||
          (viewMode === "old" ? row.type !== "add" : row.type !== "remove"),
      )
      .map((row) => ({
        ...row,
        type: "normal" as const,
        lineNumber:
          viewMode === "old"
            ? { old: row.lineNumber.old }
            : { new: row.lineNumber.new },
      }));
  }, [left, right, normalizedUnified, viewMode, native]);

  const { addedCount, removedCount } = useMemo(
    () => getDiffCounts({ unifiedDiff: normalizedUnified, diffLines }),
    [diffLines, normalizedUnified],
  );

  const handleCopy = async () => {
    const request = ++copyRequest.current;
    setCopyError(null);
    const text =
      viewMode === "diff"
        ? normalizedUnified ||
          diffLines
            .map((l) => {
              const prefix =
                l.type === "add" ? "+" : l.type === "remove" ? "-" : " ";
              return `${prefix} ${l.content}`;
            })
            .join("\n")
        : viewMode === "old"
          ? left
          : right;
    try {
      await navigator.clipboard.writeText(text);
      if (request !== copyRequest.current) return;
      setCopied(true);
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      if (request === copyRequest.current) { setCopied(false); setCopyError("复制失败，请允许剪贴板访问后重试。"); }
    }
  };

  const fileName = displayPath ? getFilename(displayPath) : "diff";

  const body = (
    <div
      className={cn(
        "rounded-lg border bg-card overflow-hidden flex flex-col min-w-0",
        native && "codex-native-diff",
        inline && "codex-inline-diff",
        native && review && "codex-full-native-diff",
        native && preview && "codex-preview-native-diff",
        className,
      )}
    >
      {copyError && <p role="alert" className="codex-review-selection-summary">{copyError}</p>}
      {preview && <header className="codex-hover-diff-header">
        <div className="codex-hover-diff-label">{onOpenFile ? <button type="button" title={displayPath} aria-label={`打开 ${displayPath ?? fileName}`} onClick={onOpenFile}>{fileName}</button> : <span title={displayPath}>{fileName}</span>}<span className="codex-change-added">+{addedCount}</span><span className="codex-change-removed">−{removedCount}</span></div>
        <button type="button" className="codex-hover-diff-copy" aria-label="Copy" title={copied ? "Copied!" : "Copy"} onClick={handleCopy} disabled={copied}><NativeCommandCopy width="16" height="16"/></button>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="预览文件操作" className="codex-hover-diff-menu"><NativeReviewEllipsis/></button></DropdownMenuTrigger><DropdownMenuContent className="codex-review-menu" align="end"><DropdownMenuItem onSelect={handleCopy}>复制补丁</DropdownMenuItem>{VIEW_MODES.map(mode => <DropdownMenuItem key={mode} onSelect={() => setViewMode(mode)}>{mode === "old" ? "查看旧文件片段" : mode === "new" ? "查看新文件片段" : "查看差异"}</DropdownMenuItem>)}<DropdownMenuItem onSelect={() => setCollapsed(value => !value)}>{collapsed ? "展开文件" : "折叠文件"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </header>}
      {review && <header className="codex-review-file-header">
        <NativeReviewFileIcon path={displayPath}/>
        {onOpenFile ? <button type="button" className="codex-review-file-name" title={displayPath} aria-label={`打开 ${displayPath ?? fileName}`} onClick={onOpenFile}>{fileName}</button> : <span className="codex-review-file-name" title={displayPath}>{fileName}</span>}
        <button type="button" aria-label={collapsed ? `Expand ${fileName} diff` : `Collapse ${fileName} diff`} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)} className="codex-review-file-toggle"><NativeReviewChevron style={{ transform: collapsed ? undefined : "rotate(90deg)" }}/></button>
        {displayPath?.includes("/") && <span className="codex-review-file-directory">{displayPath.slice(0, displayPath.lastIndexOf("/"))}</span>}
        <span className="codex-review-file-stats"><span className="codex-change-added">+{addedCount}</span><span className="codex-change-removed">−{removedCount}</span></span>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="文件操作" className="codex-review-file-menu"><NativeReviewEllipsis/></button></DropdownMenuTrigger><DropdownMenuContent className="codex-review-menu" align="end">
          <DropdownMenuItem onSelect={handleCopy}>复制补丁</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { if (displayPath) void navigator.clipboard.writeText(displayPath); }}>复制路径</DropdownMenuItem>
          {onOpenFile && <DropdownMenuItem onSelect={onOpenFile}>在编辑器中打开</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => setCollapsed(value => !value)}>{collapsed ? "展开文件" : "折叠文件"}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setLocalWrap(value => !value)}>{localWrap ? "关闭自动换行" : "自动换行"}</DropdownMenuItem>
          {VIEW_MODES.map(mode => <DropdownMenuItem key={mode} onSelect={() => setViewMode(mode)}>{mode === "old" ? "查看旧文件片段" : mode === "new" ? "查看新文件片段" : "查看差异"}</DropdownMenuItem>)}
        </DropdownMenuContent></DropdownMenu>
      </header>}
      {!inline && !review && !preview && (
        <div
          data-diff-toolbar
          className={cn(
            "flex items-center justify-between px-3 py-2 shrink-0",
            !collapsed && "border-b",
          )}
        >
          <div
            className="flex items-center gap-2 min-w-0"
            data-diff-toolbar-main
          >
            <button
              type="button"
              aria-label={
                collapsed
                  ? `Expand ${fileName} diff`
                  : `Collapse ${fileName} diff`
              }
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((prev) => !prev)}
              className="flex items-center gap-1 shrink-0 text-muted-foreground hover:text-foreground"
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            <h4 className="font-mono text-sm truncate max-w-[200px]">
              {onOpenFile ? (
                <button
                  type="button"
                  className="codex-diff-open-file"
                  onClick={onOpenFile}
                  aria-label={`打开 ${displayPath ?? fileName}`}
                  title={displayPath}
                >
                  {fileName}
                </button>
              ) : (
                fileName
              )}
            </h4>
            <div className="flex items-center gap-1" data-diff-toolbar-actions>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 gap-1"
                onClick={handleCopy}
                disabled={copied}
                type="button"
              >
                <Copy className="h-3 w-3" />
                {copied ? "Copied!" : "Copy"}
              </Button>
              <div className="flex rounded-md border bg-muted p-1">
                {VIEW_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      "px-2 py-0.5 text-xs rounded transition-colors",
                      viewMode === mode
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {mode === "old" ? "Old" : mode === "new" ? "New" : "Diff"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {viewMode === "diff" && addedCount > 0 && (
              <span className="text-green-500">+{addedCount}</span>
            )}
            {viewMode === "diff" && removedCount > 0 && (
              <span className="text-red-500">-{removedCount}</span>
            )}
          </div>
        </div>
      )}
      {inline && (
        <button
          type="button"
          className="codex-inline-diff-copy"
          aria-label="Copy"
          title="Copy"
          onClick={handleCopy}
        >
          <Copy size={14} />
        </button>
      )}
      {!collapsed && (
        <div className="font-mono text-sm overflow-auto max-h-[500px] min-w-0">
          {native ? (
            diffLines.length ? <NativeDiffContent
              split={split && viewMode === "diff"}
              lines={diffLines}
              path={displayPath}
              hunkHeaders={!inline && !preview}
              hunkPresentation={review ? "line-info" : "raw"}
              onSelectLines={onSelectLines}
              onOpenLine={onOpenLine}
              selection={selection}
              renderAnnotation={renderAnnotation}
              renderHunkActions={renderHunkActions}
              wrap={localWrap}
            />
            : <p className="codex-review-selection-summary">{/^(?:Binary files |GIT binary patch)/m.test(normalizedUnified) ? "二进制文件不显示文本变更块" : /^old mode (\d+)/m.test(normalizedUnified) && /^new mode (\d+)/m.test(normalizedUnified) ? `文件模式：${normalizedUnified.match(/^old mode (\d+)/m)?.[1]} → ${normalizedUnified.match(/^new mode (\d+)/m)?.[1]}` : /^rename from /m.test(normalizedUnified) ? `重命名：${normalizedUnified.match(/^rename from (.+)/m)?.[1]} → ${normalizedUnified.match(/^rename to (.+)/m)?.[1]}` : /^new file mode /m.test(normalizedUnified) ? "新增空文件" : /^deleted file mode /m.test(normalizedUnified) ? "空文件已删除" : "没有文本变更块"}</p>
          ) : (
            diffLines.map((line, i) =>
              line.separator ? (
                <div
                  key={i}
                  className="codex-diff-hunk text-xs text-muted-foreground"
                >
                  {line.content}
                </div>
              ) : (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional by definition
                  key={i}
                  data-old-line={line.lineNumber.old}
                  data-new-line={line.lineNumber.new}
                  className={cn(
                    "flex border-b last:border-0",
                    native && "codex-diff-line",
                    line.type === "add" && "bg-green-500/10",
                    line.type === "remove" && "bg-red-500/10",
                  )}
                >
                  <div className="flex-shrink-0 w-10 px-2 text-right text-muted-foreground/60 select-none">
                    {line.lineNumber.new ?? line.lineNumber.old ?? ""}
                  </div>
                  <div className="flex-1 min-w-0 px-3 py-0.5 select-none">
                    <span
                      className={cn(
                        "whitespace-pre",
                        line.type === "add" && "text-green-600",
                        line.type === "remove" && "text-red-600",
                      )}
                    >
                      {line.content || " "}
                    </span>
                  </div>
                </div>
              ),
            )
          )}
        </div>
      )}
    </div>
  );
  return preview ? <ContextMenu><ContextMenuTrigger asChild>{body}</ContextMenuTrigger><ContextMenuContent className="codex-review-menu"><ContextMenuItem onSelect={handleCopy}>复制补丁</ContextMenuItem>{VIEW_MODES.map(mode => <ContextMenuItem key={mode} onSelect={() => setViewMode(mode)}>{mode === "old" ? "查看旧文件片段" : mode === "new" ? "查看新文件片段" : "查看差异"}</ContextMenuItem>)}</ContextMenuContent></ContextMenu> : body;
}
