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
  readWorkbenchMode,
  WORKBENCH_MODE_KEY,
  workbenchModeUrl,
  type WorkbenchMode,
} from "../lib/workbench-mode";
import "../workbench.css";

const TerminalApp = lazy(() => import("../App"));
const SessionApp = lazy(() => import("../session-mode/SessionWorkbench"));
const CodexApp = lazy(() => import("../codex-mode/CodexWorkbench"));

export class WorkbenchBoundary extends Component<
  {
    children: ReactNode;
    modeName: string;
    onTerminal: () => void;
    reloadPage?: () => void;
  },
  { failed: boolean; errorMessage: string }
> {
  state = { failed: false, errorMessage: "" };
  static getDerivedStateFromError(error: unknown) {
    // Retain only a small diagnostic, never an Error/stack or component payload.
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "未知界面错误";
    return { failed: true, errorMessage: message.slice(0, 1000) };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="workbench-state" role="alert">
          <h2>{this.props.modeName}界面加载失败</h2>
          <p>可以重新加载本页，或切换到终端模式。</p>
          <details className="workbench-error-details">
            <summary>错误详情</summary>
            <pre>{this.state.errorMessage}</pre>
          </details>
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
