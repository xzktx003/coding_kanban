import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  ChartNoAxesCombined,
  MessageSquare,
  Plug,
  Settings2,
  RefreshCw,
} from "lucide-react";
import App from "./App";
import { useLayoutStore, type viewType } from "./stores/useLayoutStore";
import "./session-theme.css";
import { DataImportDialog } from "./DataImportDialog";

const sections: Array<{
  view: viewType;
  label: string;
  icon: typeof MessageSquare;
}> = [
  { view: "agent", label: "会话", icon: MessageSquare },
  { view: "automations", label: "定时任务", icon: CalendarClock },
  { view: "plugins", label: "工具与技能", icon: Plug },
  { view: "insights", label: "用量", icon: ChartNoAxesCombined },
  { view: "settings", label: "设置", icon: Settings2 },
];

export default function SessionWorkbench() {
  const [status, setStatus] = useState<"checking" | "ready" | "offline">(
    "checking",
  );
  const instance = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { view, setView } = useLayoutStore();
  const retry = useCallback(() => {
    setStatus("checking");
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    async function check() {
      try {
        const response = await fetch("/api/session/health", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(5000),
          ]),
        });
        if (!response.ok) throw new Error("unavailable");
        const body = await response.json();
        if (body.status !== "ok") throw new Error("not ready");
        if (typeof body.instance === "string") {
          if (instance.current && instance.current !== body.instance)
            window.dispatchEvent(new Event("session-runtime-restarted"));
          instance.current = body.instance;
        }
        tries = 0;
        setLoaded(true);
        setStatus("ready");
        timer = setTimeout(check, 10_000);
      } catch {
        if (controller.signal.aborted) return;
        if (++tries < 5) timer = setTimeout(check, 1500);
        else {
          setStatus("offline");
          timer = setTimeout(check, 10_000);
        }
      }
    }
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt]);
  if (!loaded && status !== "ready")
    return (
      <div
        className="session-connection-state"
        role={status === "offline" ? "alert" : "status"}
      >
        <div className="session-connection-icon">
          <MessageSquare size={26} />
        </div>
        <h1>
          {status === "checking" ? "正在连接会话工作台" : "会话服务暂时不可用"}
        </h1>
        <p>
          {status === "checking"
            ? "准备项目、历史记录和 Agent 连接…"
            : "请重试连接；终端模式可以继续使用。"}
        </p>
        {status === "offline" && (
          <button onClick={retry}>
            <RefreshCw size={15} />
            重试连接
          </button>
        )}
      </div>
    );
  return (
    <div className="session-workbench">
      <nav className="session-section-nav" aria-label="会话功能">
        {sections.map(({ view: target, label, icon: Icon }) => (
          <button
            key={target}
            aria-pressed={view === target}
            onClick={() => setView(target)}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
        <div className="session-nav-end">
          <DataImportDialog />
          <span className="session-ready" data-state={status}>
            <span />
            {status === "ready" ? "已连接" : "正在重连"}
          </span>
        </div>
      </nav>
      {loaded && status === "offline" && (
        <div className="session-outage" role="alert">
          会话服务连接中断，正在自动重连。草稿已保留。
          <button onClick={retry}>立即重试</button>
        </div>
      )}
      <div className="session-content">
        <App />
      </div>
    </div>
  );
}
