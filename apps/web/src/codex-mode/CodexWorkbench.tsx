import { useEffect, useRef, useState } from "react";
import type { WorkbenchMode } from "../lib/workbench-mode";
import { WorkbenchModeSwitch } from "../components/WorkbenchModeSwitch";
import { mountNativeSurface, nativeIframeUrl } from "./native-surface";
import "./codex-mode.css";

type NativeStatus = {
  available: boolean;
  reason?: string;
  iframeUrl?: string;
  extensionVersion?: string;
  fixtures?: Array<{ id: string; label: string }>;
};

export default function CodexWorkbench({
  active,
  onModeChange,
}: {
  active: boolean;
  onModeChange: (mode: WorkbenchMode) => void;
}) {
  const [status, setStatus] = useState<NativeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [panels, setPanels] = useState(0);
  const [readyPanels, setReadyPanels] = useState(0);
  const [hostUrl, setHostUrl] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const surface = useRef<ReturnType<typeof mountNativeSurface> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!active || status) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/native-codex/status", {
          signal: abort.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Codex 服务暂时不可用");
        const value: unknown = await response.json();
        if (abort.signal.aborted) return;
        if (
          !value ||
          typeof value !== "object" ||
          typeof (value as NativeStatus).available !== "boolean"
        )
          throw new Error("Codex 服务返回了无效状态");
        const next = value as NativeStatus;
        const nextUrl = next.available
          ? nativeIframeUrl(next.iframeUrl, location.origin)
          : null;
        if (next.available && !nextUrl) throw new Error("Codex 界面地址不可用");
        if (nextUrl) setHostUrl((current) => current ?? nextUrl);
        setStatus(next);
        setError(null);
      } catch (cause) {
        if (!abort.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Codex 连接失败");
      }
    })();
    return () => abort.abort();
  }, [active, status, retry]);
  useEffect(() => {
    if (active) surface.current?.start();
    else surface.current?.pause();
  }, [active]);
  useEffect(
    () => () => {
      surface.current?.dispose();
      surface.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!active || !status?.available || (panels > 0 && readyPanels === panels)) return;
    const timer = window.setTimeout(
      () => setLoadError("原生 Codex 界面未能加载，请重试连接"),
      60_000,
    );
    return () => window.clearTimeout(timer);
  }, [active, status, panels, readyPanels]);
  const url = hostUrl;
  const retryConnection = () => {
    setStatus(null);
    setError(null);
    setLoadError(null);
    setRetry((value) => value + 1);
  };
  return (
    <section className="codex-workbench" aria-label="Codex 工作台">
      <header className="codex-mode-header">
        <div className="codex-mode-brand">
          <img src="/houmo-logo.png" alt="Houmo" />
          <span>Coding Kanban</span>
        </div>
        <WorkbenchModeSwitch mode="codex" onChange={onModeChange} />
        <span className="codex-mode-native-label">原生 Codex</span>
        {status?.extensionVersion && (
          <span className="codex-mode-version">{status.extensionVersion}</span>
        )}
      </header>
      <div className="codex-mode-toolbar">
        <strong>Codex</strong>
        <span>独立开发会话</span>
        {panels > 0 && <span>{panels} 个窗口</span>}
        {panels > readyPanels && <span role="status">正在加载窗口（{readyPanels}/{panels}）</span>}
        <button type="button" onClick={retryConnection}>
          重试连接
        </button>
      </div>
      <main className="codex-mode-canvas">
        {url && (
          <iframe
            key={url}
            ref={frame}
            title="原生 Codex 会话窗口"
            src={url}
            allow="clipboard-read; clipboard-write; fullscreen"
            tabIndex={active ? 0 : -1}
            className="codex-mode-frame"
            style={{ opacity: readyPanels ? 1 : 0 }}
            onLoad={() => {
              surface.current?.dispose();
              surface.current = null;
              try {
                const document = frame.current?.contentDocument;
                if (!document) throw new Error("原生 Codex 界面暂时无法连接");
                const next = mountNativeSurface(document, (count) => {
                  setPanels(count);
                }, (count) => {
                  setReadyPanels(count);
                  if (count > 0) setLoadError(null);
                });
                surface.current = next;
                if (activeRef.current) next.start();
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "原生 Codex 界面无法访问",
                );
              }
            }}
          />
        )}
        {(!status || !status.available || !readyPanels || error || loadError) && (
          <div
            className="codex-mode-state"
            role={
              error || loadError || status?.available === false
                ? "alert"
                : "status"
            }
          >
            <h1>
              {error ||
                loadError ||
                (status?.available === false
                  ? status.reason || "Codex 服务尚未准备好"
                  : "正在加载原生 Codex…")}
            </h1>
            {status?.available === false && <p>会话和终端模式仍可继续使用。</p>}
          </div>
        )}
      </main>
    </section>
  );
}
