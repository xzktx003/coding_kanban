import { LoaderCircle, CircleAlert, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { VSCODE_HTTPS_CA_DOWNLOAD_PATH } from "../lib/vscode-service-worker";

export function CodexConnectionState({
  available,
  instanceReady,
  error,
  detail,
  certificate,
  active,
  onRetry,
}: {
  available: boolean;
  instanceReady: boolean;
  error: string | null;
  detail?: string;
  certificate?: boolean;
  active: boolean;
  onRetry: () => void;
}) {
  const [started] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active || error) return;
    const update = () => setSeconds(Math.floor((Date.now() - started) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [active, error, started]);
  return (
    <div className="codex-mode-state" role={error ? "alert" : "status"}>
      <div className="codex-connection-card">
        {error ? (
          <CircleAlert size={22} className="codex-state-icon" />
        ) : (
          <LoaderCircle size={22} className="codex-state-spinner" />
        )}
        <h1>{error || "正在打开 Codex"}</h1>
        <p>
          {certificate
            ? "原生聊天需要浏览器信任当前 HTTPS 证书。请完成证书信任后重新检查连接。"
            : error
              ? "会话和终端模式仍可继续使用。已有窗口和草稿会保留。"
              : "工作台已准备好，正在等待原生聊天界面。"}
        </p>
        {!error && (
          <ol className="codex-loading-steps">
            <li data-complete={available}>
              {available ? (
                <Check size={14} />
              ) : (
                <span className="codex-step-dot" />
              )}
              <span>{available ? "已连接宿主" : "正在连接宿主"}</span>
            </li>
            <li data-complete={instanceReady}>
              {instanceReady ? (
                <Check size={14} />
              ) : (
                <span className="codex-step-dot" />
              )}
              <span>
                {instanceReady ? "已识别当前窗口" : "正在打开原生窗口"}
              </span>
            </li>
            <li>
              <span className="codex-step-dot" />
              <span>正在加载原生聊天</span>
              <span className="codex-loading-time" aria-hidden="true">
                {seconds} 秒
              </span>
            </li>
          </ol>
        )}
        {error && (
          <div className="codex-connection-actions">
            <button type="button" onClick={onRetry}>
              重新检查连接
            </button>
            {certificate && (
              <a
                className="codex-certificate-download"
                download="coding-kanban-dev-ca.crt"
                href={VSCODE_HTTPS_CA_DOWNLOAD_PATH}
              >
                下载 CA 证书
              </a>
            )}
          </div>
        )}
        {certificate && (
          <ol className="codex-certificate-steps">
            <li>下载 Coding Kanban 开发 CA 证书。</li>
            <li>
              在手机系统设置中安装并信任该证书（Android：设置 → 安全 →
              加密与凭据 → 安装证书；iOS：设置 → 通用 → VPN 与设备管理 →
              安装描述文件，再到“证书信任设置”中启用完全信任）。
            </li>
            <li>返回此处点击“重新检查连接”。</li>
          </ol>
        )}
        {detail && (
          <details className="codex-connection-details">
            <summary>查看连接详情</summary>
            <p>{detail}</p>
          </details>
        )}
      </div>
    </div>
  );
}
