import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { WorkbenchModeSwitch } from "./WorkbenchModeSwitch";
import { WorkbenchUpdateNotice } from "./WorkbenchUpdateNotice";
import {
  loadSessionWorkbench,
  preloadSessionApp,
  preloadSessionWorkbench,
} from "../session-mode/sessionWorkbenchLoader";
import {
  readWorkbenchMode,
  WORKBENCH_MODE_KEY,
  workbenchModeUrl,
  type WorkbenchMode,
} from "../lib/workbench-mode";
import "../workbench.css";

const TerminalApp = lazy(() => import("../App"));
const SessionApp = lazy(loadSessionWorkbench);
const CodexApp = lazy(() => import("../codex-mode/CodexWorkbench"));

class WorkbenchBoundary extends Component<
  { children: ReactNode; modeName: string; onTerminal: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="workbench-state" role="alert">
          <h2>{this.props.modeName}界面加载失败</h2>
          <p>终端模式仍然可用。重新加载界面会刷新当前页面。</p>
          <button onClick={this.props.onTerminal}>切换到终端模式</button>
          <button onClick={() => window.location.reload()}>
            重新加载界面
          </button>
        </div>
      );
    return this.props.children;
  }
}

export function WorkbenchShell() {
  const [mode, setMode] = useState<WorkbenchMode>(readWorkbenchMode);
  const [terminalVisited, setTerminalVisited] = useState(mode === "terminal");
  const [sessionVisited, setSessionVisited] = useState(mode === "session");
  const [codexVisited, setCodexVisited] = useState(mode === "codex");
  const restoreModeFocus = useRef(false);
  useEffect(() => {
    if (!restoreModeFocus.current) return;
    const focusSwitch = () => {
      const selector =
        mode === "terminal"
          ? '.workbench-terminal:not([hidden]) .mode-switch-label[data-choice="terminal"]'
          : mode === "session"
            ? '.session-mode:not([hidden]) .mode-switch-label[data-choice="session"]'
            : ".codex-mode:not([hidden]) .mode-switch-codex";
      const target = document.querySelector<HTMLButtonElement>(selector);
      if (!target) return false;
      target.focus({ preventScroll: true });
      restoreModeFocus.current = false;
      return true;
    };
    if (focusSwitch()) return;
    const observer = new MutationObserver(() => {
      if (focusSwitch()) observer.disconnect();
    });
    observer.observe(
      document.querySelector(".workbench-shell") ?? document.body,
      { childList: true, subtree: true },
    );
    return () => observer.disconnect();
  }, [mode]);
  useEffect(() => {
    const sync = () => {
      const next = readWorkbenchMode();
      setMode(next);
      window.dispatchEvent(
        new CustomEvent("workbench-mode-changed", { detail: next }),
      );
      if (next === "session") setSessionVisited(true);
      if (next === "terminal") setTerminalVisited(true);
      if (next === "codex") setCodexVisited(true);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    if (mode === "session") {
      void preloadSessionApp();
      return;
    }
    if (sessionVisited) return;
    let canceled = false;
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const preload = () => {
      if (canceled) return;
      preloadSessionWorkbench();
      void loadSessionWorkbench()
        .then(() => {
          if (!canceled) void preloadSessionApp();
        })
        .catch(() => undefined);
    };
    if (typeof idleWindow.requestIdleCallback === "function") {
      const idle = idleWindow.requestIdleCallback(preload, { timeout: 1200 });
      return () => {
        canceled = true;
        idleWindow.cancelIdleCallback?.(idle);
      };
    }
    const timer = window.setTimeout(preload, 500);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [mode, sessionVisited]);
  function select(next: WorkbenchMode) {
    restoreModeFocus.current =
      next !== mode &&
      Boolean(document.activeElement?.closest(".workbench-mode-switch"));
    setMode(next);
    window.dispatchEvent(
      new CustomEvent("workbench-mode-changed", { detail: next }),
    );
    if (next === "session") setSessionVisited(true);
    if (next === "terminal") setTerminalVisited(true);
    if (next === "codex") setCodexVisited(true);
    try {
      localStorage.setItem(WORKBENCH_MODE_KEY, next);
    } catch {
      /* Keep the current tab usable. */
    }
    history.replaceState(
      null,
      "",
      workbenchModeUrl(
        `${location.pathname}${location.search}${location.hash}`,
        next,
      ),
    );
  }
  return (
    <div className="workbench-shell" data-mode={mode}>
      <WorkbenchUpdateNotice />
      <div
        className="workbench-terminal"
        hidden={mode !== "terminal"}
        inert={mode !== "terminal"}
      >
        {terminalVisited && (
          <Suspense
            fallback={
              <div className="workbench-state" role="status">
                正在加载终端工作台…
              </div>
            }
          >
            <TerminalApp
              active={mode === "terminal"}
              embedded
              navigation={
                <div className="workbench-header">
                  <div className="workbench-brand">
                    <img src="/houmo-logo.png" alt="Houmo" />
                    <span>Coding Kanban</span>
                  </div>
                  <WorkbenchModeSwitch mode="terminal" onChange={select} />
                </div>
              }
            />
          </Suspense>
        )}
      </div>
      {sessionVisited && (
        <div
          className="session-mode dark"
          hidden={mode !== "session"}
          inert={mode !== "session"}
        >
          <WorkbenchBoundary
            modeName="会话"
            onTerminal={() => select("terminal")}
          >
            <Suspense
              fallback={
                <div className="workbench-state" role="status">
                  正在加载会话工作台…
                  <button onClick={() => select("terminal")}>
                    切换到终端模式
                  </button>
                </div>
              }
            >
              <SessionApp active={mode === "session"} onModeChange={select} />
            </Suspense>
          </WorkbenchBoundary>
        </div>
      )}
      {codexVisited && (
        <div
          className="codex-mode dark"
          hidden={mode !== "codex"}
          inert={mode !== "codex"}
        >
          <WorkbenchBoundary
            modeName="Codex"
            onTerminal={() => select("terminal")}
          >
            <Suspense
              fallback={
                <div className="workbench-state" role="status">
                  正在加载 Codex 工作台…
                  <button onClick={() => select("terminal")}>
                    切换到终端模式
                  </button>
                </div>
              }
            >
              <CodexApp active={mode === "codex"} onModeChange={select} />
            </Suspense>
          </WorkbenchBoundary>
        </div>
      )}
    </div>
  );
}
