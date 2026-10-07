import { useEffect, useMemo, useRef, useState } from "react";
import { useThemeContext } from "@session/contexts/ThemeContext";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { readWorkspaceVisualization } from "@session/services/workspaceFiles";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@session/components/ui/dialog";
import { buildVisualizationDocument } from "./visualization-document";
import { visualizationIcons } from "./visualization-icons";
import type { VisualizationReference } from "./visualize-markers";

const themeKeys = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "border",
  "ring",
  "destructive",
];
const contains = (root: string, path: string) =>
  path.startsWith(root.replace(/\/+$/, "") + "/");
// Multiple visible copies and React's development remount share only in-flight reads.
// Settled contents are not cached: retry always rereads the project file.
const pendingReads = new Map<
  string,
  ReturnType<typeof readWorkspaceVisualization>
>();
function readPreview(root: string, path: string) {
  const key = JSON.stringify([root, path]);
  const existing = pendingReads.get(key);
  if (existing) return existing;
  const promise = readWorkspaceVisualization(root, path);
  pendingReads.set(key, promise);
  const clear = () => {
    if (pendingReads.get(key) === promise) pendingReads.delete(key);
  };
  void promise.then(clear, clear);
  return promise;
}

export default function VisualizationPreview({
  reference,
  projectRoot,
}: {
  reference: VisualizationReference;
  projectRoot?: string;
}) {
  const { resolvedTheme, accent } = useThemeContext();
  const cwd = useWorkspaceStore((state) => state.cwd);
  const projects = useWorkspaceStore((state) => state.projects);
  const root =
    projectRoot ??
    [...new Set([...projects, ...(cwd ? [cwd] : [])])]
      .filter((candidate) => contains(candidate, reference.path))
      .sort((a, b) => b.length - a.length)[0];
  const title =
    reference.title ||
    reference.path
      .split("/")
      .pop()
      ?.replace(/[.]html?$/i, "") ||
    "可视化";
  const container = useRef<HTMLDivElement>(null);
  const inlineFrame = useRef<HTMLIFrameElement>(null),
    expandedFrame = useRef<HTMLIFrameElement>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0),
    [expanded, setExpanded] = useState(false);
  const [height, setHeight] = useState(460),
    [theme, setTheme] = useState<Record<string, string>>({});
  const nonce = useMemo(
    () =>
      Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
        value.toString(16),
      ).join("-"),
    [reference.path, root, attempt],
  );
  useEffect(() => {
    let active = true;
    setContent(null);
    setError(null);
    setHeight(460);
    if (!root) {
      setError("此 HTML 文件不属于已登记的项目目录");
      return;
    }
    readPreview(root, reference.path)
      .then((result) => {
        if (active) setContent(result.content);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "无法读取 HTML 文件",
          );
      });
    return () => {
      active = false;
    };
  }, [root, reference.path, attempt]);
  useEffect(() => {
    const styles = getComputedStyle(
      container.current?.closest(".session-mode") ?? document.documentElement,
    );
    const values: Record<string, string> = { "color-scheme": resolvedTheme };
    for (const key of themeKeys)
      values[`--${key}`] = styles.getPropertyValue(`--${key}`).trim();
    setTheme(values);
  }, [resolvedTheme, accent]);
  const srcDoc = useMemo(
    () =>
      content === null
        ? ""
        : buildVisualizationDocument(content, {
            nonce,
            theme,
            icons: visualizationIcons(content),
          }),
    [content, nonce, theme],
  );
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        !event.source ||
        (event.source !== inlineFrame.current?.contentWindow &&
          event.source !== expandedFrame.current?.contentWindow)
      )
        return;
      const message = event.data;
      if (!message || message.nonce !== nonce) return;
      if (
        message.type === "session-visualization-size" &&
        typeof message.height === "number" &&
        Number.isFinite(message.height)
      )
        setHeight(Math.max(200, Math.min(1600, message.height)));
      if (
        message.type === "session-visualization-error" &&
        typeof message.message === "string"
      )
        setError(`预览脚本出错：${message.message.slice(0, 300)}`);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [nonce]);
  return (
    <div
      ref={container}
      className="not-prose my-2 w-full min-w-0 rounded-md border"
      data-visualization-preview
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm">
        <span className="truncate">{title}</span>
        {content !== null && (
          <button
            type="button"
            className="shrink-0 text-primary underline"
            onClick={() => setExpanded(true)}
          >
            展开可视化
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="p-3 text-sm">
          {error}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            重试
          </button>
        </div>
      )}
      {content === null && !error && (
        <div role="status" className="p-3 text-sm text-muted-foreground">
          正在加载可视化预览…
        </div>
      )}
      {content !== null && (
        <iframe
          ref={inlineFrame}
          title={`可视化预览：${title}`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
          className="block w-full border-0"
          style={{ height }}
        />
      )}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          size="xl"
          className={`flex h-[90dvh] max-w-[calc(100vw-2rem)] flex-col sm:max-w-none ${reference.mode === "wide" ? "sm:w-[min(1400px,94vw)]" : "sm:w-[min(1024px,94vw)]"}`}
        >
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            交互式 HTML 可视化预览
          </DialogDescription>
          {content !== null && (
            <iframe
              ref={expandedFrame}
              title={`展开的可视化预览：${title}`}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={srcDoc}
              className="min-h-0 w-full flex-1 border-0"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
