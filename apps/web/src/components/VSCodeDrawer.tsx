import { useEffect, useRef, useState } from "react";

import type { OpenVsCodeWebResponse } from "@agent-orchestrator/shared";

import { openVsCodeWeb } from "../lib/api";
import {
  openVsCodeWebOnce,
  primeVsCodeWebOpenResponse,
} from "../lib/vscode-web-open";
import {
  applyVsCodeWebOpenResponse,
  createCachedVsCodeWebEntry,
  shouldEnsureVsCodeWebOnOpen,
  type VsCodeWebEntry,
} from "../lib/vscode-drawer-state";
import {
  loadCachedVsCodeWebState,
  saveCachedVsCodeWebState,
} from "../lib/vscode-web-state";
import {
  probeVsCodeWebServiceWorker,
  VSCODE_HTTPS_CA_DOWNLOAD_PATH,
  type VsCodeServiceWorkerProbeResult,
} from "../lib/vscode-service-worker";

interface VSCodeDrawerProps {
  active: boolean;
  agentSessionId: string;
  displayName: string;
  open: boolean;
}

export function VSCodeDrawer({
  active,
  agentSessionId,
  displayName,
  open,
}: VSCodeDrawerProps) {
  const [editorEntry, setEditorEntry] = useState<VsCodeWebEntry | null>(() => {
    const cachedState = loadCachedVsCodeWebState(agentSessionId);
    return cachedState ? createCachedVsCodeWebEntry(cachedState) : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [securityProbeNonce, setSecurityProbeNonce] = useState(0);
  const [serviceWorkerProbe, setServiceWorkerProbe] = useState<
    VsCodeServiceWorkerProbeResult | { state: "checking" }
  >(() =>
    typeof window === "undefined" ? { state: "ready" } : { state: "checking" },
  );
  const editorEntryRef = useRef(editorEntry);
  const editorState = editorEntry?.response ?? null;

  useEffect(() => {
    editorEntryRef.current = editorEntry;
    if (editorEntry && !editorEntry.needsServerCheck) {
      primeVsCodeWebOpenResponse(agentSessionId, editorEntry.response);
    }
  }, [agentSessionId, editorEntry]);

  useEffect(() => {
    if (open) {
      setEditorEntry((current) => {
        if (current) {
          return current;
        }

        const cachedState = loadCachedVsCodeWebState(agentSessionId);
        return cachedState ? createCachedVsCodeWebEntry(cachedState) : null;
      });
    }
  }, [agentSessionId, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    let heartbeatId: number | null = null;

    async function ensureEditor(showLoading: boolean) {
      if (showLoading) {
        setLoading(true);
      }

      setError(null);

      try {
        const response = await openVsCodeWebOnce(agentSessionId, openVsCodeWeb);
        if (cancelled) {
          return;
        }

        setEditorEntry((current) =>
          applyVsCodeWebOpenResponse(current, response),
        );
        saveCachedVsCodeWebState(agentSessionId, response);
        setError(null);
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        if (!editorEntryRef.current) {
          setEditorEntry(null);
          setError(
            requestError instanceof Error
              ? requestError.message
              : "VS Code Web 打开失败",
          );
        }
      } finally {
        if (!cancelled && showLoading) {
          setLoading(false);
        }
      }
    }

    if (shouldEnsureVsCodeWebOnOpen(editorEntryRef.current)) {
      void ensureEditor(editorEntryRef.current === null);
    }

    heartbeatId = window.setInterval(() => {
      void openVsCodeWebOnce(agentSessionId, openVsCodeWeb)
        .then((response) => {
          if (cancelled) {
            return;
          }

          setEditorEntry((current) =>
            applyVsCodeWebOpenResponse(current, response),
          );
          saveCachedVsCodeWebState(agentSessionId, response);
          setError(null);
        })
        .catch((requestError) => {
          if (cancelled || editorEntryRef.current) {
            return;
          }

          setEditorEntry(null);
          setError(
            requestError instanceof Error
              ? requestError.message
              : "VS Code Web 打开失败",
          );
        });
    }, 60_000);

    return () => {
      cancelled = true;
      if (heartbeatId !== null) {
        window.clearInterval(heartbeatId);
      }
    };
  }, [agentSessionId, open]);

  useEffect(() => {
    if (!open || !editorState) {
      return;
    }

    let cancelled = false;
    setServiceWorkerProbe({ state: "checking" });
    void probeVsCodeWebServiceWorker({
      force: securityProbeNonce > 0,
    }).then((result) => {
      if (!cancelled) {
        setServiceWorkerProbe(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [editorState?.url, open, securityProbeNonce]);

  return (
    <aside
      className="vscode-drawer"
      {...(active ? { "data-testid": "vscode-web-drawer" } : {})}
    >
      <div className="vscode-drawer-body">
        {(loading ||
          (!error &&
            editorState &&
            serviceWorkerProbe.state === "checking")) && (
          <div className="vscode-drawer-state" role="status">
            {loading ? "正在启动 VS Code Web…" : "正在验证 WebView 安全能力…"}
          </div>
        )}
        {!loading && error && (
          <div className="vscode-drawer-state vscode-drawer-state--error">
            <div>{error}</div>
            <div className="vscode-drawer-hint">
              会优先复用本机已有安装；如果缺失，会尝试自动安装官方 `code-server`
              standalone。
            </div>
          </div>
        )}
        {!loading &&
          !error &&
          editorState &&
          serviceWorkerProbe.state === "blocked" && (
            <div className="vscode-drawer-state vscode-drawer-state--certificate">
              <strong>VS Code WebView 需要可信 HTTPS 证书</strong>
              <div className="vscode-drawer-hint">
                当前浏览器拒绝注册 Service Worker：
                {serviceWorkerProbe.detail}
              </div>
              {serviceWorkerProbe.reason === "certificate" ? (
                <ol className="vscode-certificate-steps">
                  <li>下载 Coding Kanban 开发 CA 证书。</li>
                  <li>
                    macOS
                    打开“钥匙串访问”，导入证书并将“使用此证书时”设为“始终信任”。
                  </li>
                  <li>完全退出并重新打开 Safari，然后返回此处重新检测。</li>
                </ol>
              ) : (
                <div className="vscode-drawer-hint">
                  请使用非隐私窗口、启用 Service Worker，并通过 HTTPS 或
                  localhost 访问。
                </div>
              )}
              <div className="vscode-certificate-actions">
                {serviceWorkerProbe.reason === "certificate" && (
                  <a
                    className="vscode-certificate-download"
                    download="coding-kanban-dev-ca.crt"
                    href={VSCODE_HTTPS_CA_DOWNLOAD_PATH}
                  >
                    下载 CA 证书
                  </a>
                )}
                <button
                  className="vscode-certificate-retry"
                  onClick={() =>
                    setSecurityProbeNonce((current) => current + 1)
                  }
                  type="button"
                >
                  重新检测并加载
                </button>
              </div>
            </div>
          )}
        {!loading &&
          !error &&
          editorState &&
          serviceWorkerProbe.state === "ready" && (
            <iframe
              allow="clipboard-read; clipboard-write"
              className="vscode-drawer-frame"
              {...(active ? { "data-testid": "vscode-web-frame" } : {})}
              key={`${editorState.url}::${editorEntry?.reloadKey ?? 0}`}
              src={editorState.url}
              title={`VS Code - ${displayName}`}
            />
          )}
      </div>
    </aside>
  );
}
