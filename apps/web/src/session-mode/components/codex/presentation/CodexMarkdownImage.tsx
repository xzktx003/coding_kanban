import { useEffect, useRef, useState } from "react";
import { fetchMarkdownImage } from "../../../../lib/api";
import { CodexImage } from "./CodexImage";
import { isLocalChatImage, resolveChatImageSource } from "./chatImageSource";

export function CodexMarkdownImage({
  source,
  alt = "",
  cwd,
}: {
  source: string;
  alt?: string;
  cwd?: string | null;
}) {
  return (
    <ImageResource
      key={`${cwd ?? ""}\0${source}`}
      source={source}
      alt={alt}
      cwd={cwd}
    />
  );
}

function ImageResource({
  source,
  alt,
  cwd,
}: {
  source: string;
  alt: string;
  cwd?: string | null;
}) {
  const local = isLocalChatImage(source);
  let path = "",
    pathError: string | null = null;
  if (local) {
    try {
      path = resolveChatImageSource(source, cwd);
    } catch (error) {
      pathError = error instanceof Error ? error.message : "图片路径不可用";
    }
  }
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!local || pathError || visible) return;
    if (!ref.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [local, pathError, visible]);
  useEffect(() => {
    if (!local || !visible || pathError || !cwd) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setError(null);
    setUrl(null);
    void fetchMarkdownImage(
      {
        rootPath: cwd,
        documentPath: `${cwd.replace(/\/+$/, "")}/_chat.md`,
        source: encodeURI(path).replace(/#/g, "%23").replace(/\?/g, "%3F"),
      },
      controller.signal,
    )
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "图片读取失败");
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [local, visible, pathError, cwd, path, retry]);
  const failed = pathError ?? error;
  return (
    <div ref={ref} className="codex-markdown-image">
      {failed ? (
        <div className="codex-markdown-image-status" role="alert">
          <span title={failed}>图片加载失败：{alt || "图片"}</span>
          {!pathError && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setRetry((value) => value + 1);
              }}
            >
              重试
            </button>
          )}
        </div>
      ) : !local || url ? (
        <CodexImage
          src={local ? url! : source}
          alt={alt || "图片"}
          onError={() => setError("图片解码失败")}
        />
      ) : (
        <div className="codex-markdown-image-status" aria-busy={visible}>
          {" "}
          {visible ? "正在加载图片…" : "图片将在滚动到附近时加载"}{" "}
        </div>
      )}
    </div>
  );
}
