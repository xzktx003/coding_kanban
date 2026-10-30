import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useAgentInteractionVisible } from "@session/session-dom";
import { useAcpStore, type AcpEntry } from "@session/stores/useAcpStore";
import { usePairingStore } from "@session/stores/usePairingStore";
import { acpReadSessionTranscript } from "@session/services/apiAdapt/acp";
import { buildUrl } from "@session/hooks/runtime";
import { estimateTranscriptBytes } from "@session/services/codexTranscriptMemoryBudget";
import {
  retainProviderTranscript,
  trackProviderTranscript,
  updateProviderTranscript,
} from "@session/services/sessionProviderTranscriptState";
import {
  continueStoredAcpSession,
  type AcpStoredSource,
} from "./continueStoredSession";
import {
  captureHistorySourceScope,
  isHistorySourceScopeCurrent,
  watchHistorySourceScope,
} from "../history/historySourceScope";
import { ProviderHistoryDetail } from "../history/ProviderHistoryDetail";
import { AcpToolCall } from "./AcpToolCall";
import { Button } from "../ui/button";

/** This source is never sent to the Agent that owns the fresh composer target. */
export function AcpReadonlyHistoryPanel({
  source,
  target,
}: {
  source: AcpStoredSource;
  target: {
    agentId: string;
    connectionId: string | null;
    sessionId: string | null;
  };
}) {
  const visible = useAgentInteractionVisible();
  const endpoint = buildUrl("/api/acp/session");
  const identity = JSON.stringify([
    endpoint,
    target.agentId,
    target.connectionId,
    target.sessionId,
    source.sessionId,
  ]);
  const owner = `readonly-acp:${identity}`;
  const [opened, setOpened] = useState(identity);
  const sourceScope = useMemo(
    () => source.sourceScope ?? captureHistorySourceScope("/api/acp/session"),
    [identity, opened, source.sourceScope],
  );
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  const continueSource = async () => {
    if (continuing || !owns()) return;
    setContinuing(true);
    setContinueError(null);
    try {
      await continueStoredAcpSession({ ...source, sourceScope });
    } catch (reason) {
      if (identityRef.current === identity && owns())
        setContinueError(
          reason instanceof Error ? reason.message : String(reason),
        );
    } finally {
      if (identityRef.current === identity) setContinuing(false);
    }
  };
  const [rows, setRows] = useState<AcpEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const shown = visible && opened === identity;
  const owns = useCallback(() => {
    const current = useAcpStore.getState();
    return (
      current.agentId === target.agentId &&
      current.connectionId === target.connectionId &&
      current.sessionId === target.sessionId &&
      endpoint === buildUrl("/api/acp/session") &&
      isHistorySourceScopeCurrent(sourceScope)
    );
  }, [
    target.agentId,
    target.connectionId,
    target.sessionId,
    endpoint,
    sourceScope,
  ]);
  const close = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setOpened("");
    setRows([]);
    setCursor(null);
    setLoading(false);
    setError(null);
    updateProviderTranscript(owner, { externalBodyBytes: 0, loading: false });
  }, [owner]);
  const load = useCallback(
    async (nextCursor?: string) => {
      if (!owns()) return;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setLoading(true);
      setError(null);
      try {
        const page = await acpReadSessionTranscript(source.sessionId, {
          signal: abort.signal,
          suppressToast: true,
          ...(nextCursor ? { cursor: nextCursor } : {}),
        });
        if (
          abort.signal.aborted ||
          controller.current !== abort ||
          identityRef.current !== identity ||
          !owns()
        )
          return;
        if (
          page.projection !== "acp-entries" ||
          !Array.isArray(page.data) ||
          page.data.length > 256 ||
          (page.nextCursor !== null && typeof page.nextCursor !== "string")
        )
          throw new Error("旧记录的只读分页协议不可用，请更新会话服务后重试。");
        const bytes = estimateTranscriptBytes(page.data);
        if (bytes > 8 * 1024 * 1024)
          throw new Error("旧记录超过显示预算，请通过更小的只读页重试。");
        setRows(page.data);
        setCursor(page.nextCursor);
        updateProviderTranscript(owner, {
          externalBodyBytes: bytes,
          revision: page.revision,
          truncated: page.truncated,
          error: null,
          restoreNeeded: false,
        });
      } catch (reason) {
        if (!abort.signal.aborted && controller.current === abort && owns())
          setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          setLoading(false);
        }
      }
    },
    [owns, source.sessionId, owner, identity],
  );
  useEffect(() => {
    setOpened(identity);
    return () => {
      controller.current?.abort();
    };
  }, [identity]);
  useEffect(() => {
    if (!shown) {
      setRows([]);
      setCursor(null);
      controller.current?.abort();
      updateProviderTranscript(owner, { externalBodyBytes: 0, loading: false });
      return;
    }
    trackProviderTranscript(owner, "acp", source.sessionId);
    const release = retainProviderTranscript(owner, "acp", source.sessionId);
    const stopSource = watchHistorySourceScope(sourceScope, close);
    void load();
    const dispose = useAcpStore.subscribe(() => {
      if (!owns()) close();
    });
    const pairing = usePairingStore.subscribe(() => {
      if (!owns()) close();
    });
    return () => {
      controller.current?.abort();
      stopSource();
      dispose();
      pairing();
      release();
      updateProviderTranscript(owner, { externalBodyBytes: 0, loading: false });
    };
  }, [shown, owner, source.sessionId, load, owns, close, sourceScope]);
  return (
    <section
      className="shrink-0 rounded-md border border-border/70 bg-muted/30 mx-3 my-2 p-2 text-xs"
      data-acp-readonly-source={source.sessionId}
      onClickCapture={(event) => {
        if (!owns()) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">原会话记录（仅查看）：{source.title}</p>
          <p className="text-muted-foreground mt-1">
            {source.viewOnly
              ? target.connectionId
                ? "这里只读查看所选记录；输入仍发送到下方标明的当前会话，当前任务继续运行。"
                : "这里只读查看原记录，不启动Agent，也不会发送消息。"
              : "当前 Agent 不支持加载原会话，或原记录缺少可核实的来源。旧记录不包含在新会话上下文中，输入会发送到当前新会话。"}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11 shrink-0"
          onClick={() => (shown ? close() : setOpened(identity))}
        >
          {shown ? "收起旧记录" : "查看旧记录"}
        </Button>
      </div>
      {source.viewOnly && source.agentId && (
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground">
            继续会为该 Agent
            启动独立连接。支持原生加载时继续原会话；否则新建上下文，旧记录仍仅查看。原任务保持运行。
          </p>
          <Button
            type="button"
            size="sm"
            disabled={continuing || !shown}
            onClick={() => void continueSource()}
          >
            {continuing ? "正在核对并继续…" : "继续此会话"}
          </Button>
          {continueError && (
            <p role="alert" className="text-destructive">
              {continueError}
            </p>
          )}
        </div>
      )}
      {shown && (
        <div
          className="max-h-64 overflow-auto mt-2 space-y-2"
          data-acp-readonly-history
        >
          {loading && <p role="status">正在只读加载旧记录…</p>}
          {error && (
            <div role="alert">
              {error}
              <Button size="sm" variant="outline" onClick={() => void load()}>
                重试读取
              </Button>
            </div>
          )}
          {rows.map((row) => (
            <div key={row.id} className="rounded border border-border/50 p-2">
              <p className="text-muted-foreground mb-1">
                {row.role === "user"
                  ? "你"
                  : row.role === "tool"
                    ? "工具"
                    : "Agent"}
              </p>
              {row.role === "tool" ? (
                <AcpToolCall entry={row} />
              ) : (
                <>
                  <pre className="whitespace-pre-wrap break-words font-sans">
                    {row.text}
                  </pre>
                  {row.role === "user" &&
                    row.images?.map((image, index) => (
                      <img
                        key={index}
                        src={image}
                        alt="原会话图片"
                        className="max-h-40 max-w-full"
                      />
                    ))}
                </>
              )}
              {row.historyDetail && (
                <ProviderHistoryDetail
                  provider="acp"
                  sessionId={source.sessionId}
                  itemId={row.historyDetail.itemId}
                  ownerKey={identity}
                  active={shown}
                  originScope={sourceScope}
                  images={row.historyImages}
                />
              )}
            </div>
          ))}
          {!rows.length && !loading && !error && (
            <p>此原会话没有可读取的消息。</p>
          )}
          <div className="flex gap-2">
            {cursor && (
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => void load(cursor)}
              >
                读取更早旧记录
              </Button>
            )}
            {rows.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={loading}
                onClick={() => void load()}
              >
                返回最近旧记录
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
