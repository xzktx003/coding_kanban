import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ErrorInfo,
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
import { recordWorkbenchCrash } from "../session-mode/services/workbenchCrashDiagnostic";

const TerminalApp = lazy(() => import("../App"));
const SessionApp = lazy(loadSessionWorkbench);
const CodexApp = lazy(() => import("../codex-mode/CodexWorkbench"));
const ChatgptApp = lazy(() => import("../chatgpt-mode/ChatgptModeApp"));

export class WorkbenchBoundary extends Component<
  {
    children: ReactNode;
    modeName: string;
    onTerminal: () => void;
    reloadPage?: () => void;
  },
  { failed: boolean; errorMessage: string; componentStack: string }
> {
  state = { failed: false, errorMessage: "", componentStack: "" };
  static getDerivedStateFromError(error: unknown) {
    // Retain only a small diagnostic, never an Error/stack or component payload.
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "未知界面错误";
    return { failed: true, errorMessage: message.slice(0, 1000), componentStack: "" };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    recordWorkbenchCrash(this.props.modeName, error, info);
    // Keep this available even when browser storage is disabled. Never retain
    // the Error object, component props, or unbounded transcript data.
    this.setState({ componentStack: (info.componentStack ?? "").slice(0, 3000) });
  }

  render() {
    if (this.state.failed)
      return (
        <div className="workbench-state" role="alert">
          <h2>{this.props.modeName}界面加载失败</h2>
          <p>可以重试恢复界面，草稿会保留；反复失败时可重新加载本页。</p>
          <details className="workbench-error-details">
            <summary>错误详情</summary>
            <pre>{this.state.errorMessage}</pre>
            {this.state.componentStack && (
              <pre>组件调用栈{this.state.componentStack}</pre>
            )}
          </details>
          {!/(?:Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk .* failed)/i.test(this.state.errorMessage) && (
            <button onClick={() => this.setState({ failed: false, errorMessage: "", componentStack: "" })}>
              重试{this.props.modeName}界面
            </button>
          )}
          <button onClick={this.props.onTerminal}>切换到终端模式</button>
          <button
            onClick={() => {
              // React.lazy caches import rejection; clearing boundary state cannot
              // recover an outdated/failed module. Reload only on this explicit click.
              if (this.props.reloadPage) this.props.reloadPage();
              else window.location.reload();
            }}
          >
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
  const [chatgptVisited, setChatgptVisited] = useState(mode === "chatgpt");
  const restoreModeFocus = useRef(false);
  useEffect(() => {
    if (!restoreModeFocus.current) return;
    const focusSwitch = () => {
      const selector =
        mode === "terminal"
          ? '.workbench-terminal:not([hidden]) .mode-switch-label[data-choice="terminal"]'
          : mode === "session"
            ? '.session-mode:not([hidden]) .mode-switch-label[data-choice="session"]'
            : mode === "codex"
              ? ".codex-mode:not([hidden]) .mode-switch-codex"
              : ".chatgpt-mode:not([hidden]) .mode-switch-chatgpt";
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
      if (next === "chatgpt") setChatgptVisited(true);
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
    if (next === "chatgpt") setChatgptVisited(true);
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
      {chatgptVisited && (
        <div
          className="chatgpt-mode"
          hidden={mode !== "chatgpt"}
          inert={mode !== "chatgpt"}
        >
          <WorkbenchBoundary
            modeName="ChatGPT"
            onTerminal={() => select("terminal")}
          >
            <Suspense
              fallback={
                <div className="workbench-state" role="status">
                  正在加载 ChatGPT 工作台…
                  <button onClick={() => select("terminal")}>
                    切换到终端模式
                  </button>
                </div>
              }
            >
              <ChatgptApp active={mode === "chatgpt"} onModeChange={select} />
            </Suspense>
          </WorkbenchBoundary>
        </div>
      )}
    </div>
  );
}
