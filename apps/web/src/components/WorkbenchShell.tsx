import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { MessageSquare, TerminalSquare } from "lucide-react";
import TerminalApp from "../App";
import {
  readWorkbenchMode,
  WORKBENCH_MODE_KEY,
  workbenchModeUrl,
  type WorkbenchMode,
} from "../lib/workbench-mode";
import "../workbench.css";

const SessionApp = lazy(() => import("../session-mode/SessionWorkbench"));

class SessionBoundary extends Component<
  { children: ReactNode },
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
          <h2>会话界面加载失败</h2>
          <p>终端模式仍然可用。</p>
          <button onClick={() => this.setState({ failed: false })}>
            重新加载界面
          </button>
        </div>
      );
    return this.props.children;
  }
}

export function WorkbenchShell() {
  const [mode, setMode] = useState<WorkbenchMode>(readWorkbenchMode);
  const [sessionVisited, setSessionVisited] = useState(mode === "session");
  useEffect(() => {
    const sync = () => {
      const next = readWorkbenchMode();
      setMode(next);
    window.dispatchEvent(new CustomEvent("workbench-mode-changed", { detail: next }));
      if (next === "session") setSessionVisited(true);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function select(next: WorkbenchMode) {
    setMode(next);
    window.dispatchEvent(new CustomEvent("workbench-mode-changed", { detail: next }));
    if (next === "session") setSessionVisited(true);
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
    <div className="workbench-shell">
      <header className="workbench-header">
        <div className="workbench-brand">
          <img src="/houmo-logo.png" alt="Houmo" />
          <span>Coding Kanban</span>
        </div>
        <nav className="workbench-modes" aria-label="工作模式">
          <button
            aria-pressed={mode === "terminal"}
            onClick={() => select("terminal")}
          >
            <TerminalSquare size={16} />
            <span>终端模式</span>
          </button>
          <button
            aria-pressed={mode === "session"}
            onClick={() => select("session")}
          >
            <MessageSquare size={16} />
            <span>会话模式</span>
          </button>
        </nav>
        <span className="workbench-context">
          {mode === "terminal" ? "多终端工作台" : "Agent 会话工作台"}
        </span>
      </header>
      <div className="workbench-terminal" hidden={mode !== "terminal"}>
        <TerminalApp />
      </div>
      {sessionVisited && (
        <div className="session-mode dark" hidden={mode !== "session"}>
          <SessionBoundary>
            <Suspense
              fallback={
                <div className="workbench-state" role="status">
                  正在加载会话工作台…
                </div>
              }
            >
              <SessionApp />
            </Suspense>
          </SessionBoundary>
        </div>
      )}
    </div>
  );
}
