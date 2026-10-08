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
  { children: ReactNode; onTerminal: () => void },
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
          <button onClick={this.props.onTerminal}>切换到终端模式</button>
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
  const restoreModeFocus = useRef(false);
  useEffect(() => {
    if (!restoreModeFocus.current) return;
    const focusSwitch = () => {
      const selector =
        mode === "terminal"
          ? ".workbench-header .mode-switch-rail"
          : ".session-mode:not([hidden]) .mode-switch-rail";
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
      <div className="workbench-terminal" hidden={mode !== "terminal"}>
        <TerminalApp
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
      </div>
      {sessionVisited && (
        <div className="session-mode dark" hidden={mode !== "session"}>
          <SessionBoundary onTerminal={() => select("terminal")}>
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
              <SessionApp onModeChange={select} />
            </Suspense>
          </SessionBoundary>
        </div>
      )}
    </div>
  );
}
