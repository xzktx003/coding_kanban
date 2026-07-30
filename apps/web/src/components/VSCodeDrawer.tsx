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

  return (
    <aside
      className="vscode-drawer"
      {...(active ? { "data-testid": "vscode-web-drawer" } : {})}
    >
      <div className="vscode-drawer-body">
        {loading && (
          <div className="vscode-drawer-state" role="status">
            正在启动 VS Code Web…
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
        {!loading && !error && editorState && (
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
