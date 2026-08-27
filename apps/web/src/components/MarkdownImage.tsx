import { useEffect, useRef, useState } from "react";

import type { MarkdownImageInput } from "@agent-orchestrator/shared";

import { fetchMarkdownImage } from "../lib/api";

export type MarkdownResourceContext = Omit<MarkdownImageInput, "source">;

interface MarkdownImageProps {
  alt?: string;
  resourceContext?: MarkdownResourceContext;
  source?: string;
  title?: string;
}

function isDirectImageSource(source: string): boolean {
  return /^(?:https?:|data:image\/|blob:)/i.test(source);
}

export function MarkdownImage({
  alt = "",
  resourceContext,
  source,
  title,
}: MarkdownImageProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [loadRequested, setLoadRequested] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const direct = Boolean(source && isDirectImageSource(source));
  const needsResource = Boolean(source && resourceContext && !direct);

  useEffect(() => {
    if (!needsResource || loadRequested) return;
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") {
      setLoadRequested(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setLoadRequested(true);
        observer.disconnect();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [loadRequested, needsResource]);

  useEffect(() => {
    if (!loadRequested || !source || !resourceContext) return;

    const controller = new AbortController();
    let nextObjectUrl: string | null = null;
    setError(null);
    setObjectUrl(null);
    void fetchMarkdownImage(
      {
        documentPath: resourceContext.documentPath,
        rootPath: resourceContext.rootPath,
        source,
        sshTarget: resourceContext.sshTarget,
      },
      controller.signal,
    )
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
    loadRequested,
    resourceContext?.documentPath,
    resourceContext?.rootPath,
    resourceContext?.sshTarget?.host,
    resourceContext?.sshTarget?.identityFile,
    resourceContext?.sshTarget?.port,
    resourceContext?.sshTarget?.username,
    retryCount,
    source,
  ]);

  if (!source) return null;
  if (direct || !resourceContext) {
    return (
      <img
        alt={alt}
        decoding="async"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={source}
        title={title}
      />
    );
  }

  return (
    <span
      className={`markdown-resource-image${error ? " markdown-resource-image--error" : ""}`}
      data-markdown-image-source={source}
      ref={containerRef}
    >
      {objectUrl ? (
        <img
          alt={alt}
          decoding="async"
          loading="lazy"
          src={objectUrl}
          title={title}
        />
      ) : error ? (
        <span className="markdown-resource-image-status" role="alert">
          <span>图片加载失败：{alt || source}</span>
          <button
            onClick={() => {
              setLoadRequested(true);
              setRetryCount((count) => count + 1);
            }}
            title={error}
            type="button"
          >
            重试
          </button>
        </span>
      ) : (
        <span className="markdown-resource-image-status">
          {loadRequested ? "正在加载图片..." : "图片将在滚动到附近时加载"}
        </span>
      )}
    </span>
  );
}
