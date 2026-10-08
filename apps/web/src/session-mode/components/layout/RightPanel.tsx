import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useIsMobile } from "@session/hooks/use-mobile";
import { useGitWatch } from "@session/hooks/useGitWatch";
import { useLayoutStore, useWorkspaceStore } from "@session/stores";
import { useGitStatsStore } from "@session/stores/useGitStatsStore";
import { detectWebFramework } from "../../features/web-preview/webFrameworkDetection";
import { RightPanelHeader } from "./RightPanelHeader";

const VsCodePanel = lazy(() =>
  import("@session/features/vscode/VsCodePanel").then((m) => ({
    default: m.VsCodePanel,
  })),
);
const SubagentPanel = lazy(() => import("@session/features/subagents/SubagentPanel").then(m => ({ default: m.SubagentPanel })));
const TodoView = lazy(() => import("@session/features/todos/TodoView"));
const FilesPanel = lazy(() => import("@session/features/files/FilesPanel"));
const GitDiffPanel = lazy(() => import("@session/features/git/GitDiffPanel"));
const WebPreview = lazy(() =>
  import("../../features/web-preview/WebPreview").then((m) => ({
    default: m.WebPreview,
  })),
);
const TasksPanel = lazy(() => import("@session/components/agent/TasksPanel"));
const TerminalPanel = lazy(() =>
  import("@session/features/terminal/TerminalPanel").then((m) => ({
    default: m.TerminalPanel,
  })),
);

function ToolLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex h-full min-h-24 items-center justify-center gap-2 p-6 text-sm text-muted-foreground"
    >
      <span className="size-2 rounded-full bg-primary/60" aria-hidden="true" />
      正在加载{label}…
    </div>
  );
}

export function RightPanel({ visible = true }: { visible?: boolean }) {
  const { activeRightPanelTab, openRightPanelTabs } = useLayoutStore();
  const { cwd } = useWorkspaceStore();
  const { refreshStats } = useGitStatsStore();
  const isMobile = useIsMobile();
  const hasOpenedFiles = useRef(false);
  const hasOpenedVsCode = useRef(false);
  if (openRightPanelTabs.includes("vscode")) hasOpenedVsCode.current = true;
  const hasOpenedTerminal = useRef(false);
  if (openRightPanelTabs.includes("terminal")) hasOpenedTerminal.current = true;
  if (activeRightPanelTab === "files") hasOpenedFiles.current = true;
  const [webPreviewUrl, setWebPreviewUrl] = useState("");

  // Use refs to avoid stale closures without adding them to effect deps.
  const cwdRef = useRef(cwd);
  const refreshStatsRef = useRef(refreshStats);
  cwdRef.current = cwd;
  refreshStatsRef.current = refreshStats;

  // Eagerly refresh (with loading state) whenever cwd changes.
  useEffect(() => {
    if (!cwd) return;
    void refreshStats(cwd, false);
  }, [cwd, refreshStats]);

  // Stable silent refresher for git watch — never changes identity so useGitWatch
  // doesn't teardown/recreate its fs watcher on every render.
  const silentRefresher = useCallback(() => {
    const currentCwd = cwdRef.current;
    if (currentCwd) void refreshStatsRef.current(currentCwd, true);
  }, []);

  useGitWatch(cwd, silentRefresher, Boolean(cwd));

  useEffect(() => {
    let cancelled = false;

    const loadWebPreviewUrl = async () => {
      if (!cwd) {
        if (!cancelled) setWebPreviewUrl("");
        return;
      }

      const framework = await detectWebFramework(cwd);
      if (!cancelled) {
        setWebPreviewUrl(framework?.devUrl ?? "");
      }
    };

    void loadWebPreviewUrl();

    return () => {
      cancelled = true;
    };
  }, [cwd]);

  return (
    <div
      className={`h-full w-full min-h-0 border-l border-border flex flex-col overflow-hidden ${isMobile ? "bg-sidebar" : "bg-sidebar/30"}`}
    >
      <RightPanelHeader />
      <div
        hidden={openRightPanelTabs.length === 0}
        className={
          openRightPanelTabs.length === 0
            ? "hidden"
            : "flex-1 min-h-0 flex overflow-hidden"
        }
      >
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
          <Suspense
            fallback={
              activeRightPanelTab === "diff" ? (
                <ToolLoading label="变更" />
              ) : null
            }
          >
            <div
              className={
                activeRightPanelTab === "diff"
                  ? "h-full min-h-0 overflow-hidden"
                  : "hidden"
              }
            >
              <GitDiffPanel
                cwd={cwd}
                isActive={visible && activeRightPanelTab === "diff"}
              />
            </div>
          </Suspense>

          {activeRightPanelTab === "subagents" && <Suspense fallback={<ToolLoading label="子任务" />}><SubagentPanel /></Suspense>}
          {activeRightPanelTab === "tasks" && (
            <div className="h-full min-h-0 overflow-hidden">
              <Suspense fallback={<ToolLoading label="看板" />}>
                <TasksPanel />
              </Suspense>
            </div>
          )}

          {activeRightPanelTab === "todo" && (
            <div className="h-full min-h-0 overflow-hidden">
              <Suspense fallback={<ToolLoading label="待办" />}>
                <TodoView />
              </Suspense>
            </div>
          )}

          {hasOpenedFiles.current && (
            <div
              className="h-full min-h-0 overflow-hidden"
              hidden={activeRightPanelTab !== "files"}
              inert={activeRightPanelTab !== "files" || !visible}
            >
              <Suspense fallback={<ToolLoading label="文件" />}>
                <FilesPanel />
              </Suspense>
            </div>
          )}

          {hasOpenedTerminal.current && (
            <div
              className={
                activeRightPanelTab === "terminal"
                  ? "h-full min-h-0 overflow-hidden"
                  : "hidden"
              }
            >
              <Suspense fallback={<ToolLoading label="终端" />}>
                <TerminalPanel
                  isActive={visible && activeRightPanelTab === "terminal"}
                />
              </Suspense>
            </div>
          )}

          {hasOpenedVsCode.current && (
            <div
              className="h-full min-h-0 overflow-hidden"
              hidden={activeRightPanelTab !== "vscode"}
              inert={!visible || activeRightPanelTab !== "vscode"}
            >
              <Suspense fallback={<ToolLoading label="VS Code" />}>
                <VsCodePanel
                  active={visible && activeRightPanelTab === "vscode"}
                />
              </Suspense>
            </div>
          )}

          {activeRightPanelTab === "webpreview" && (
            <div className="h-full min-h-0 overflow-hidden">
              <Suspense fallback={<ToolLoading label="浏览器" />}>
                <WebPreview
                  url={webPreviewUrl}
                  onUrlChange={setWebPreviewUrl}
                />
              </Suspense>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
