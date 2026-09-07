import { useEffect, useState } from "react";

import type { SshTarget } from "@agent-orchestrator/shared";

import { fetchPdfPreview } from "../lib/pdf-preview";

interface PdfFilePreviewProps {
  path: string;
  sshTarget?: SshTarget;
}

type PdfPreviewState =
  | { path: string; status: "loading"; url: null; error: null }
  | { path: string; status: "ready"; url: string; error: null }
  | { path: string; status: "error"; url: null; error: string };

function createLoadingState(path: string): PdfPreviewState {
  return {
    path,
    status: "loading",
    url: null,
    error: null,
  };
}

export function PdfFilePreview({ path, sshTarget }: PdfFilePreviewProps) {
  const resourceKey = JSON.stringify([path, sshTarget ?? null]);
  const [state, setState] = useState<PdfPreviewState>(() =>
    createLoadingState(resourceKey),
  );
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let active = true;

    setState(createLoadingState(resourceKey));

    void fetchPdfPreview({ path, sshTarget }, controller.signal)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setState({
          path: resourceKey,
          status: "ready",
          url: objectUrl,
          error: null,
        });
      })
      .catch((caughtError) => {
        if (!active || controller.signal.aborted) return;
        setState({
          path: resourceKey,
          status: "error",
          url: null,
          error:
            caughtError instanceof Error
              ? caughtError.message
              : "PDF 预览加载失败",
        });
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [path, retryToken, sshTarget, resourceKey]);

  const visibleState =
    state.path === resourceKey ? state : createLoadingState(resourceKey);

  return (
    <div className="pdf-file-preview" data-testid="pdf-file-preview">
      {visibleState.status === "loading" && (
        <div className="file-browser-preview-empty">正在加载 PDF 预览...</div>
      )}
      {visibleState.status === "error" && (
        <div className="file-browser-preview-empty" role="alert">
          <div>{visibleState.error}</div>
          <button
            className="file-browser-pill"
            onClick={() => setRetryToken((current) => current + 1)}
            type="button"
          >
            重试
          </button>
        </div>
      )}
      {visibleState.status === "ready" && (
        <>
          <div className="file-browser-preview-actions">
            <a
              className="file-browser-pill"
              href={visibleState.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              新标签打开
            </a>
          </div>
          <iframe
            className="pdf-file-preview-frame"
            src={visibleState.url}
            title="PDF 预览"
          />
        </>
      )}
    </div>
  );
}
