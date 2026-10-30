import { useEffect, useId, useRef, useState } from "react";
import {
  isHistorySourceScopeCurrent,
  watchHistorySourceScope,
} from "./historySourceScope";
import { retainExternalTranscriptBody } from "@session/services/sessionProviderTranscriptState";
import type { ProviderHistoryReaderProps } from "./ProviderHistoryDetail";

const DETAIL_WIRE_BYTES = 64 * 1024;
type DetailPart = {
  text: string;
  nextOffset: number | null;
  itemRevision: string;
};
class SourceChanged extends Error {}
async function readBoundedPart(response: Response): Promise<unknown> {
  if (!response.ok)
    throw new Error(`暂时无法读取完整内容（HTTP ${response.status}）。`);
  if (!response.body) throw new Error("完整内容响应为空。");
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > DETAIL_WIRE_BYTES) {
    await response.body.cancel();
    throw new Error("完整内容响应超过单次读取预算。");
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > DETAIL_WIRE_BYTES) {
        await reader.cancel();
        throw new Error("完整内容响应超过单次读取预算。");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}
function validatePart(value: unknown, offset: number): DetailPart {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("完整内容响应格式无效。");
  const row = value as Record<string, unknown>;
  if (
    row.format !== "json" ||
    typeof row.text !== "string" ||
    typeof row.itemRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.itemRevision) ||
    !(
      row.nextOffset === null ||
      (Number.isSafeInteger(row.nextOffset) && Number(row.nextOffset) > offset)
    )
  )
    throw new Error("完整内容响应格式无效。");
  return {
    text: row.text,
    nextOffset: row.nextOffset as number | null,
    itemRevision: row.itemRevision,
  };
}

export default function ProviderHistoryDetailReader({
  provider,
  sessionId,
  itemId,
  onClose,
  sourceScope,
}: ProviderHistoryReaderProps) {
  const owner = useId();
  const budget = useRef<ReturnType<typeof retainExternalTranscriptBody> | null>(
    null,
  );
  useEffect(() => {
    const retained = retainExternalTranscriptBody(
      `provider-detail:${owner}`,
      JSON.stringify([provider, sessionId, itemId]),
    );
    budget.current = retained;
    return () => {
      page.current = null;
      retained.dispose();
      budget.current = null;
    };
  }, [owner, provider, sessionId, itemId]);
  const [request, setRequest] = useState({ offset: 0, part: 1, attempt: 0 });
  const [phase, setPhase] = useState<
    "loading" | "ready" | "failed" | "changed"
  >("loading");
  const [error, setError] = useState<string | null>(null);
  const page = useRef<DetailPart | null>(null),
    sourceRevision = useRef<string | null>(null);
  const endpoint =
    provider === "cc"
      ? "/api/cc/session-message-detail"
      : "/api/acp/session-detail";
  useEffect(() => {
    const stop = watchHistorySourceScope(sourceScope, onClose);
    return () => {
      page.current = null;
      sourceRevision.current = null;
      stop();
    };
  }, [sourceScope, onClose]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const scope = sourceScope;
    const current = () =>
      active &&
      !controller.signal.aborted &&
      isHistorySourceScopeCurrent(scope);
    page.current = null;
    budget.current?.report(0);
    setPhase("loading");
    setError(null);
    const timer = setTimeout(
      () => controller.abort(new Error("完整内容读取超时，请重试。")),
      10_000,
    );
    // StrictMode's cancelled first mount must not issue a second read.
    queueMicrotask(() => {
      if (!current()) {
        if (active && !isHistorySourceScopeCurrent(scope)) onClose();
        return;
      }
      void fetch(scope.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...scope.headers },
        body: JSON.stringify({
          session_id: sessionId,
          item_id: itemId,
          offset: request.offset,
          limit: DETAIL_WIRE_BYTES,
        }),
        signal: controller.signal,
        redirect: "error",
      })
        .then(readBoundedPart)
        .then((value) => {
          if (!current()) {
            if (active && !isHistorySourceScopeCurrent(scope)) onClose();
            return;
          }
          const part = validatePart(value, request.offset);
          if (
            sourceRevision.current &&
            sourceRevision.current !== part.itemRevision
          )
            throw new SourceChanged("内容已更新，请从头重新读取。");
          sourceRevision.current = part.itemRevision;
          page.current = part;
          budget.current?.report(part.text.length * 2);
          setPhase("ready");
        })
        .catch((reason) => {
          if (!active) return;
          page.current = null;
          budget.current?.report(0);
          setError(
            reason instanceof Error ? reason.message : "完整内容读取失败。",
          );
          setPhase(reason instanceof SourceChanged ? "changed" : "failed");
        })
        .finally(() => clearTimeout(timer));
    });
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
      page.current = null;
    };
  }, [endpoint, sessionId, itemId, request, sourceScope, onClose]);
  return (
    <section
      role="region"
      aria-label="完整原始内容"
      className="mt-2 space-y-2 border-t border-border/60 pt-2"
    >
      <p>原始内容 · 第 {request.part} 部分（仅保留当前部分）</p>
      {phase === "loading" && <p role="status">正在读取完整内容…</p>}
      {error && <p role="alert">{error}</p>}
      {phase === "ready" && page.current && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-xs">
          {page.current.text}
        </pre>
      )}
      <div className="flex flex-wrap gap-2">
        {phase === "ready" &&
          page.current &&
          page.current.nextOffset !== null && (
            <button
              type="button"
              className="min-h-11 rounded border px-3"
              onClick={() => {
                const offset = page.current?.nextOffset;
                if (offset == null) return;
                setRequest((value) => ({
                  offset,
                  part: value.part + 1,
                  attempt: 0,
                }));
              }}
            >
              下一部分
            </button>
          )}
        {phase === "failed" && (
          <button
            type="button"
            className="min-h-11 rounded border px-3"
            onClick={() =>
              setRequest((value) => ({ ...value, attempt: value.attempt + 1 }))
            }
          >
            重试读取
          </button>
        )}
        {(request.offset > 0 || phase === "changed") && (
          <button
            type="button"
            className="min-h-11 rounded border px-3"
            onClick={() => {
              sourceRevision.current = null;
              setRequest((value) => ({
                offset: 0,
                part: 1,
                attempt: value.attempt + 1,
              }));
            }}
          >
            从头重新读取
          </button>
        )}
        {phase === "ready" && page.current?.nextOffset === null && (
          <span>已到内容结尾</span>
        )}
      </div>
    </section>
  );
}
