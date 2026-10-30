import { useEffect, useId, useRef, useState } from "react";
import {
  captureHistorySourceScope,
  isHistorySourceScopeCurrent,
  watchHistorySourceScope,
} from "./historySourceScope";
import { retainExternalTranscriptBody } from "@session/services/sessionProviderTranscriptState";
import type {
  HistoryImageReference,
  ProviderHistoryReaderProps,
} from "./ProviderHistoryDetail";

const IMAGE_BYTES = 10 * 1024 * 1024;
const PREVIEW_PIXELS = 40_000_000;
const MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
class ImageReadError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
async function bodyChunks(response: Response, maxBytes: number) {
  if (!response.body) throw new Error("图片响应为空。");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await response.body.cancel();
    throw new Error("图片超过单次读取大小限制。");
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("图片超过单次读取大小限制。");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!bytes) throw new Error("图片响应为空。");
  return chunks;
}
async function imageBlob(
  response: Response,
  expectedMime: string,
  download: boolean,
) {
  if (!response.ok) {
    let code: unknown;
    try {
      const chunks = await bodyChunks(response, 8 * 1024);
      const value = JSON.parse(await new Blob(chunks as BlobPart[]).text());
      code = value.code;
    } catch {}
    if (code === "HISTORY_IMAGE_PREVIEW_PIXEL_LIMIT")
      throw new ImageReadError(
        "图片像素超过安全预览上限，可下载原图查看。",
        String(code),
      );
    if (code === "HISTORY_IMAGE_BYTE_LIMIT")
      throw new ImageReadError(
        "图片超过历史附件大小限制，无法在此读取。",
        String(code),
      );
    throw new Error(`图片读取失败（HTTP ${response.status}）。`);
  }
  const mime = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const width = Number(response.headers.get("x-history-image-width")),
    height = Number(response.headers.get("x-history-image-height"));
  const revision = response.headers.get("x-history-image-revision");
  if (
    !MIME.has(mime) ||
    mime !== expectedMime ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !revision ||
    !/^[a-f0-9]{64}$/.test(revision)
  ) {
    await response.body?.cancel();
    throw new Error("图片来源或格式尚未核实，请重新打开。");
  }
  if (!download && width * height > PREVIEW_PIXELS) {
    await response.body?.cancel();
    throw new ImageReadError(
      "图片像素超过安全预览上限，可下载原图查看。",
      "HISTORY_IMAGE_PREVIEW_PIXEL_LIMIT",
    );
  }
  return {
    blob: new Blob((await bodyChunks(response, IMAGE_BYTES)) as BlobPart[], {
      type: mime,
    }),
    revision,
    width,
    height,
  };
}

export default function ProviderHistoryImageReader({
  provider,
  sessionId,
  itemId,
  images,
  onClose,
  sourceScope,
}: ProviderHistoryReaderProps & {
  images: readonly HistoryImageReference[];
  onClose(): void;
}) {
  const owner = useId(),
    budget = useRef<ReturnType<typeof retainExternalTranscriptBody> | null>(
      null,
    );
  useEffect(() => {
    const retained = retainExternalTranscriptBody(
      `provider-image:${owner}`,
      JSON.stringify([provider, sessionId, itemId]),
    );
    budget.current = retained;
    return () => {
      for (const url of urls.current.keys()) release(url);
      retained.dispose();
      budget.current = null;
    };
  }, [owner, provider, sessionId, itemId]);
  const [index, setIndex] = useState(0),
    [attempt, retry] = useState(0);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading"),
    [error, setError] = useState<string | null>(null),
    [downloadBusy, setDownloadBusy] = useState(false),
    [downloaded, setDownloaded] = useState(false);
  const asset = useRef<{
      url: string;
      revision: string;
      scope: ReturnType<typeof captureHistorySourceScope>;
    } | null>(null),
    urls = useRef(new Map<string, number>()),
    downloadController = useRef<AbortController | null>(null),
    mounted = useRef(true);
  const image = images[index],
    endpoint =
      provider === "cc"
        ? "/api/cc/session-message-image"
        : "/api/acp/session-image";
  const report = () =>
    budget.current?.report(
      [...urls.current.values()].reduce((sum, bytes) => sum + bytes, 0),
    );
  const release = (url: string) => {
    if (urls.current.delete(url)) {
      URL.revokeObjectURL(url);
      report();
    }
  };
  const clearAsset = () => {
    if (asset.current) release(asset.current.url);
    asset.current = null;
  };
  useEffect(() => {
    mounted.current = true;
    const stop = watchHistorySourceScope(sourceScope, onClose);
    return () => {
      mounted.current = false;
      downloadController.current?.abort();
      clearAsset();
      for (const url of urls.current.keys()) release(url);
      stop();
    };
  }, [sourceScope, onClose]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(),
      scope = sourceScope;
    clearAsset();
    setPhase("loading");
    setError(null);
    setDownloaded(false);
    const timer = setTimeout(
      () => controller.abort(new Error("图片读取超时，请重试。")),
      15_000,
    );
    const current = () =>
      active &&
      !controller.signal.aborted &&
      isHistorySourceScopeCurrent(scope);
    queueMicrotask(() => {
      if (!current() || !image) {
        if (active && !isHistorySourceScopeCurrent(scope)) onClose();
        return;
      }
      void fetch(scope.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...scope.headers },
        body: JSON.stringify({
          session_id: sessionId,
          item_id: itemId,
          image_index: image.index,
        }),
        signal: controller.signal,
        redirect: "error",
      })
        .then((response) => imageBlob(response, image.mimeType, false))
        .then((value) => {
          if (!current()) return;
          const url = URL.createObjectURL(value.blob);
          urls.current.set(
            url,
            value.blob.size + value.width * value.height * 4,
          );
          report();
          asset.current = { url, revision: value.revision, scope };
          setPhase("ready");
        })
        .catch((reason) => {
          if (!active) return;
          clearAsset();
          setError(reason instanceof Error ? reason.message : "图片读取失败。");
          setPhase("failed");
        })
        .finally(() => clearTimeout(timer));
    });
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
      downloadController.current?.abort();
      downloadController.current = null;
      if (mounted.current) setDownloadBusy(false);
      clearAsset();
    };
  }, [
    endpoint,
    sessionId,
    itemId,
    image?.index,
    image?.mimeType,
    attempt,
    sourceScope,
    onClose,
  ]);
  async function download() {
    if (downloadBusy || !image) return;
    if (!isHistorySourceScopeCurrent(sourceScope)) {
      onClose();
      return;
    }
    const controller = new AbortController(),
      scope = sourceScope;
    downloadController.current = controller;
    setDownloadBusy(true);
    setDownloaded(false);
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(scope.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...scope.headers },
        body: JSON.stringify({
          session_id: sessionId,
          item_id: itemId,
          image_index: image.index,
          download: true,
        }),
        signal: controller.signal,
        redirect: "error",
      });
      const value = await imageBlob(response, image.mimeType, true);
      if (
        !mounted.current ||
        controller.signal.aborted ||
        !isHistorySourceScopeCurrent(scope)
      )
        return;
      const url = URL.createObjectURL(value.blob);
      urls.current.set(url, value.blob.size);
      report();
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName(image.mimeType);
      link.click();
      setTimeout(() => release(url), 0);
      setDownloaded(true);
    } catch (reason) {
      if (mounted.current && downloadController.current === controller)
        setError(
          controller.signal.aborted
            ? "图片下载超时，请重试。"
            : reason instanceof Error
              ? reason.message
              : "图片下载失败。",
        );
    } finally {
      clearTimeout(timer);
      if (downloadController.current === controller) {
        downloadController.current = null;
        if (mounted.current) setDownloadBusy(false);
      }
    }
  }
  function fileName(mime: string) {
    return `${provider}-${itemId.replace(/[^\w.-]/g, "_").slice(0, 100)}-${image?.index ?? 0}.${mime === "image/jpeg" ? "jpg" : mime.slice(6)}`;
  }
  return (
    <section
      role="region"
      aria-label="历史原图"
      className="mt-2 space-y-2 border-t border-border/60 pt-2"
    >
      <p>
        图片 {index + 1} / {images.length}
      </p>
      {phase === "loading" && <p role="status">正在读取图片…</p>}
      {error && <p role="alert">{error}</p>}
      {phase === "ready" && asset.current && (
        <img
          src={asset.current.url}
          alt={`历史图片 ${index + 1}`}
          decoding="async"
          className="max-h-96 max-w-full rounded-md object-contain"
          onError={() => {
            setError("图片无法解码，可下载原图查看。");
            setPhase("failed");
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {index > 0 && (
          <button
            type="button"
            className="min-h-11 rounded border px-3"
            disabled={downloadBusy}
            onClick={() => setIndex((value) => value - 1)}
          >
            上一张
          </button>
        )}
        {index < images.length - 1 && (
          <button
            type="button"
            className="min-h-11 rounded border px-3"
            disabled={downloadBusy}
            onClick={() => setIndex((value) => value + 1)}
          >
            下一张
          </button>
        )}
        {asset.current ? (
          <a
            className="inline-flex min-h-11 items-center rounded border px-3"
            href={asset.current.url}
            download={fileName(image?.mimeType ?? "image/png")}
            onClick={(event) => {
              if (
                !asset.current ||
                !isHistorySourceScopeCurrent(asset.current.scope)
              ) {
                event.preventDefault();
                onClose();
              }
            }}
          >
            下载原图
          </a>
        ) : (
          phase === "failed" && (
            <button
              type="button"
              className="min-h-11 rounded border px-3"
              disabled={downloadBusy}
              onClick={() => void download()}
            >
              {downloadBusy ? "正在下载…" : "下载原图"}
            </button>
          )
        )}
        {phase === "failed" && (
          <button
            type="button"
            className="min-h-11 rounded border px-3"
            disabled={downloadBusy}
            onClick={() => retry((value) => value + 1)}
          >
            重试预览
          </button>
        )}
        {downloaded && <span role="status">原图下载已启动</span>}
      </div>
    </section>
  );
}
