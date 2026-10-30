import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  composeContextText,
  type NativeSteerReceipt,
  type NativeSteerReceiptPage,
} from "@agent-orchestrator/shared";
import type { ServerNotification } from "@session/bindings";
import {
  captureHistorySourceScope,
  isHistorySourceScopeCurrent,
  watchHistorySourceScope,
} from "@session/components/history/historySourceScope";
import { readNativeOperationContext } from "@session/services/nativeOperationContext";
import { retainExternalTranscriptBody } from "@session/services/sessionProviderTranscriptState";
import { enqueueSessionRead } from "@session/services/sessionReadQueue";
import { TranscriptDetailVisibility } from "../hooks/transcriptDetailVisibility";
import { UserMessageItem } from "../items/UserMessageItem";

const PAGE_BYTES = 1024 * 1024;
const endpoint = "/followups/steer-receipts";
/** Read-only provenance. These entries never become native items or pending sends. */
async function readPage(
  response: Response,
  threadId: string,
  namespace: string,
): Promise<NativeSteerReceiptPage & { bodyBytes: number }> {
  if (!response.ok)
    throw new Error(`补充说明暂时无法读取（HTTP ${response.status}）。`);
  if (!response.body) throw new Error("补充说明响应为空。");
  const length = response.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > PAGE_BYTES)
  ) {
    await response.body.cancel();
    throw new Error("补充说明响应超过单页读取预算。");
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > PAGE_BYTES) {
        await reader.cancel();
        throw new Error("补充说明响应超过单页读取预算。");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  const value = JSON.parse(text) as NativeSteerReceiptPage;
  if (
    !value ||
    !Array.isArray(value.data) ||
    value.data.length > 30 ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" && value.nextCursor.length <= 2048)
    )
  )
    throw new Error("补充说明响应格式无效。");
  const sources = new Set<string>();
  for (const row of value.data) {
    if (
      !row ||
      row.threadId !== threadId ||
      row.namespace !== namespace ||
      row.status !== "accepted" ||
      ![row.sourceId, row.operationId, row.clientId, row.turnId].every(
        (id) => typeof id === "string" && id.length > 0 && id.length <= 512,
      ) ||
      row.sourceId !== row.operationId ||
      typeof row.text !== "string" ||
      !Array.isArray(row.images) ||
      row.images.length > 32 ||
      !row.images.every(
        (path) => typeof path === "string" && path.length <= 8192,
      ) ||
      !Number.isFinite(row.createdAt) ||
      sources.has(row.sourceId)
    )
      throw new Error("补充说明来源尚未核实，请重新读取。");
    if (
      row.contexts !== undefined &&
      (!Array.isArray(row.contexts) ||
        row.contexts.length > 64 ||
        !row.contexts.every(
          (context) =>
            context &&
            typeof context.id === "string" &&
            typeof context.name === "string" &&
            typeof context.text === "string" &&
            ["paste", "quote", "file"].includes(context.kind),
        ))
    )
      throw new Error("补充说明上下文格式无效。");
    if (
      row.nativeReferences !== undefined &&
      (!Array.isArray(row.nativeReferences) ||
        row.nativeReferences.length > 64 ||
        !row.nativeReferences.every((reference) => {
          if (
            !reference ||
            ![
              "image",
              "audio",
              "localImage",
              "localAudio",
              "mention",
              "skill",
            ].includes(reference.type)
          )
            return false;
          const value = "url" in reference ? reference.url : reference.path;
          return (
            typeof value === "string" &&
            value.length <= PAGE_BYTES &&
            (!("name" in reference) || typeof reference.name === "string")
          );
        }))
    )
      throw new Error("补充说明的附件引用格式无效。");
    if (
      row.mentions !== undefined &&
      (!Array.isArray(row.mentions) ||
        row.mentions.length > 64 ||
        !row.mentions.every(
          (mention) =>
            mention &&
            typeof mention.name === "string" &&
            typeof mention.path === "string",
        ))
    )
      throw new Error("补充说明的提及格式无效。");
    sources.add(row.sourceId);
  }
  return { ...value, bodyBytes: bytes * 2 };
}
function nativeInputKeys(events: ServerNotification[], threadId: string) {
  const keys = new Set<string>();
  for (const event of events) {
    if (
      (event.method === "item/started" || event.method === "item/completed") &&
      event.params.threadId === threadId &&
      event.params.item.type === "userMessage" &&
      event.params.item.clientId
    )
      keys.add(
        JSON.stringify([event.params.turnId, event.params.item.clientId]),
      );
    if (event.method === "turn/completed" && event.params.threadId === threadId)
      for (const item of event.params.turn.items)
        if (item.type === "userMessage" && item.clientId)
          keys.add(JSON.stringify([event.params.turn.id, item.clientId]));
  }
  return keys;
}
export function CodexSteerReceipts(props: {
  threadId: string;
  events: ServerNotification[];
  pendingClientIds: readonly string[];
  revision: number;
}) {
  const visible = useContext(TranscriptDetailVisibility);
  return visible ? <ReceiptPage key={props.threadId} {...props} /> : null;
}
function ReceiptPage({
  threadId,
  events,
  pendingClientIds,
  revision,
}: {
  threadId: string;
  events: ServerNotification[];
  pendingClientIds: readonly string[];
  revision: number;
}) {
  const owner = useId(),
    budget = useRef<ReturnType<typeof retainExternalTranscriptBody> | null>(
      null,
    );
  useEffect(() => {
    const retained = retainExternalTranscriptBody(
      `steer-receipt:${owner}`,
      threadId,
    );
    budget.current = retained;
    return () => {
      page.current = null;
      retained.dispose();
      budget.current = null;
    };
  }, [owner, threadId]);
  const [request, setRequest] = useState({
      cursor: null as string | null,
      attempt: 0,
    }),
    [phase, setPhase] = useState<"loading" | "ready" | "failed" | "revoked">(
      "loading",
    ),
    [error, setError] = useState<string | null>(null);
  const page = useRef<NativeSteerReceiptPage | null>(null),
    controller = useRef<AbortController | null>(null),
    revoked = useRef(false);
  const acknowledged = useMemo(
    () => nativeInputKeys(events, threadId),
    [events, threadId],
  );
  // Token deltas do not reread the display log. A completed turn or accepted
  // queue mutation may have added a receipt while this page stayed mounted.
  const completed = useMemo(
    () =>
      events
        .filter(
          (event) =>
            event.method === "turn/completed" &&
            event.params.threadId === threadId,
        )
        .map((event) => (event.params as any).turn.id)
        .join("\0"),
    [events, threadId],
  );
  useEffect(() => {
    const scope = captureHistorySourceScope(endpoint);
    const stop = watchHistorySourceScope(scope, () => {
      revoked.current = true;
      controller.current?.abort();
      page.current = null;
      budget.current?.report(0);
      setError("补充说明记录的连接已变化，请重新读取。");
      setPhase("revoked");
    });
    return () => {
      controller.current?.abort();
      page.current = null;
      stop();
    };
  }, [threadId, request.attempt]);
  useEffect(() => {
    let active = true;
    const abort = new AbortController(),
      scope = captureHistorySourceScope(endpoint);
    controller.current = abort;
    revoked.current = false;
    const current = () =>
      active &&
      !revoked.current &&
      !abort.signal.aborted &&
      isHistorySourceScopeCurrent(scope);
    page.current = null;
    budget.current?.report(0);
    setError(null);
    setPhase("loading");
    const timer = setTimeout(() => abort.abort(), 10_000);
    queueMicrotask(() => {
      if (!current()) return;
      void enqueueSessionRead(
        "status",
        `steer-receipts:${threadId}:${JSON.stringify(scope)}:${request.cursor ?? ""}`,
        async () => {
          const native = await readNativeOperationContext();
          if (!current()) return null;
          const query = new URLSearchParams({
            threadId,
            expectedScope: native.scopeToken,
            limit: "30",
          });
          if (request.cursor) query.set("cursor", request.cursor);
          const url = scope.url + (scope.url.includes("?") ? "&" : "?") + query;
          const response = await fetch(url, {
            method: "GET",
            headers: scope.headers,
            signal: abort.signal,
            redirect: "error",
          });
          return readPage(response, threadId, native.namespace);
        },
        abort.signal,
      )
        .then((value) => {
          if (!value || !current()) return;
          page.current = value;
          budget.current?.report(value.bodyBytes);
          setPhase("ready");
        })
        .catch((reason) => {
          if (!active || revoked.current || !isHistorySourceScopeCurrent(scope))
            return;
          page.current = null;
          budget.current?.report(0);
          setError(
            abort.signal.aborted
              ? "补充说明读取超时，请重试。"
              : reason instanceof Error
                ? reason.message
                : "补充说明读取失败。",
          );
          setPhase("failed");
        })
        .finally(() => clearTimeout(timer));
    });
    return () => {
      active = false;
      clearTimeout(timer);
      abort.abort();
      if (controller.current === abort) controller.current = null;
      page.current = null;
    };
  }, [threadId, request, revision, completed]);
  const identityCounts = new Map<string, number>();
  for (const row of page.current?.data ?? []) {
    const key = JSON.stringify([row.turnId, row.clientId]);
    identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
  }
  const rows =
    phase === "ready"
      ? (page.current?.data.filter((row) => {
          const key = JSON.stringify([row.turnId, row.clientId]);
          // The server's persistent identity index detects duplicates outside this
          // page as well. Unknown/ambiguous provenance must retain its original text.
          const unique =
            row.nativeIdentityUnique === true && identityCounts.get(key) === 1;
          return (
            !unique ||
            (!acknowledged.has(key) && !pendingClientIds.includes(row.clientId))
          );
        }) ?? [])
      : [];
  if (phase === "loading") return null;
  if (
    phase === "ready" &&
    !rows.length &&
    !page.current?.nextCursor &&
    !request.cursor
  )
    return null;
  return (
    <section aria-label="已发送的补充说明记录" className="space-y-2">
      {error && (
        <p role="alert" className="text-xs text-muted-foreground">
          {error}
        </p>
      )}
      {rows.map((row) => (
        <div
          key={row.sourceId}
          data-steer-receipt={row.sourceId}
          className="pb-2"
        >
          <UserMessageItem
            content={[
              ...(row.text || row.contexts?.length
                ? [
                    {
                      type: "text" as const,
                      text: composeContextText(row.text, row.contexts),
                      text_elements: [],
                    },
                  ]
                : []),
              ...row.images.map((path) => ({
                type: "localImage" as const,
                path,
              })),
            ]}
          />
          {row.nativeReferences?.length || row.mentions?.length ? (
            <details className="ml-auto max-w-full rounded border border-border/60 p-2 text-xs">
              <summary className="min-h-6 cursor-pointer">
                原始附件与引用（
                {(row.nativeReferences?.length ?? 0) +
                  (row.mentions?.length ?? 0)}
                ）
              </summary>
              <ul className="mt-2 space-y-2">
                {row.nativeReferences?.map((reference, index) => (
                  <li
                    key={index}
                    className="max-h-24 overflow-auto whitespace-pre-wrap break-all"
                  >
                    <span className="mr-2">
                      {
                        {
                          image: "图片引用",
                          audio: "语音引用",
                          localImage: "本地图片引用",
                          localAudio: "本地语音引用",
                          mention: "提及",
                          skill: "技能",
                        }[reference.type]
                      }
                    </span>
                    <code>
                      {"name" in reference ? `${reference.name} · ` : ""}
                      {"url" in reference ? reference.url : reference.path}
                    </code>
                  </li>
                ))}
                {row.mentions?.map((mention, index) => (
                  <li
                    key={`mention-${index}`}
                    className="max-h-24 overflow-auto break-all"
                  >
                    <span className="mr-2">提及</span>
                    <code>
                      {mention.name} · {mention.path}
                    </code>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <p className="pt-1 text-right text-xs text-muted-foreground">
            已发送的补充说明
          </p>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {phase === "ready" && page.current?.nextCursor && (
          <button
            type="button"
            className="min-h-11 rounded border px-3 text-xs"
            onClick={() =>
              setRequest((value) => ({
                ...value,
                cursor: page.current!.nextCursor,
              }))
            }
          >
            更早的补充说明
          </button>
        )}
        {request.cursor && (
          <button
            type="button"
            className="min-h-11 rounded border px-3 text-xs"
            onClick={() =>
              setRequest((value) => ({
                cursor: null,
                attempt: value.attempt + 1,
              }))
            }
          >
            最新的补充说明
          </button>
        )}
        {(phase === "failed" || phase === "revoked") && (
          <button
            type="button"
            className="min-h-11 rounded border px-3 text-xs"
            onClick={() =>
              setRequest((value) => ({ ...value, attempt: value.attempt + 1 }))
            }
          >
            重新读取补充说明
          </button>
        )}
      </div>
    </section>
  );
}
