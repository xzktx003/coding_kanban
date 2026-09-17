import { useEffect, useState } from "react";

import type { SshTarget } from "@agent-orchestrator/shared";

import { fetchFileImage } from "../lib/api";

interface FileImagePreviewProps {
  alt: string;
  path: string;
  sshTarget?: SshTarget;
}

export function FileImagePreview({
  alt,
  path,
  sshTarget,
}: FileImagePreviewProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let nextObjectUrl: string | null = null;
    setObjectUrl(null);
    setError(null);

    void fetchFileImage({ path, sshTarget }, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "图片读取失败");
      });

    return () => {
      controller.abort();
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [
    path,
    retryCount,
    sshTarget?.host,
    sshTarget?.identityFile,
    sshTarget?.port,
    sshTarget?.username,
  ]);

  return (
    <div className="file-image-preview">
      {objectUrl ? (
        <img
          alt={alt}
          className="file-browser-preview-image"
          decoding="async"
          src={objectUrl}
        />
      ) : error ? (
        <div className="file-image-preview-status" role="alert">
          <strong>图片预览失败</strong>
          <span>{error}</span>
          <button
            onClick={() => setRetryCount((count) => count + 1)}
            type="button"
          >
            重试
          </button>
        </div>
      ) : (
        <div aria-busy="true" className="file-image-preview-status">
          正在加载完整图片...
        </div>
      )}
    </div>
  );
}
