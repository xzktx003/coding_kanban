import { fileSrc } from "@session/hooks/runtime";
import { useSessionReadReceipt } from "@session/hooks/useSessionReadReceipt";
import { useEffect, useRef, useState } from "react";
import { Button } from "@session/components/ui/button";
import {
  acpAuthenticate,
  acpNewSession,
  acpRespondPermission,
} from "@session/services/apiAdapt/acp";
import { useWorkspaceStore } from "@session/stores";
import { useAcpStore } from "@session/stores/useAcpStore";
import { AcpToolCall } from "./AcpToolCall";
import { useAcpEvents } from "./useAcpEvents";

export default function AcpSession() {
  const {
    connectionId,
    sessionId,
    authMethods,
    entries,
    permission,
    setPermission,
    applySession,
    addEntry,
  } = useAcpStore();
  const cwd = useWorkspaceStore((s) => s.cwd);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const pendingReplies = useRef(new Set<string>());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const permissionKey = permission
    ? `${connectionId}:${sessionId}:${permission.requestId}`
    : null;
  const responding = !!permissionKey && busyKey === permissionKey;
  const agentId = useAcpStore((s) => s.agentId);
  useSessionReadReceipt(
    "acp",
    sessionId ? `${agentId}:${sessionId}` : null,
    bottomRef,
  );

  useAcpEvents(connectionId);

  useEffect(() => {
    following.current = true;
    setShowLatest(false);
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [sessionId]);
  useEffect(() => {
    if (following.current)
      bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    else setShowLatest(true);
  }, [entries]);

  const readPosition = () => {
    const el = scrollRef.current;
    if (!el) return;
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 4;
    if (following.current) setShowLatest(false);
  };

  const authenticate = async (methodId: string) => {
    if (!connectionId || !cwd) return;
    try {
      await acpAuthenticate(connectionId, methodId);
      applySession(await acpNewSession(connectionId, cwd));
    } catch (e) {
      addEntry({ id: `auth-${Date.now()}`, role: "error", text: String(e) });
    }
  };

  const respond = async (optionId: string | null) => {
    if (
      !connectionId ||
      !permission ||
      !permissionKey ||
      pendingReplies.current.has(permissionKey)
    )
      return;
    const key = permissionKey;
    const requestId = permission.requestId;
    const targetConnection = connectionId;
    const targetSession = sessionId;
    pendingReplies.current.add(key);
    setBusyKey(key);
    setReplyError(null);
    try {
      await acpRespondPermission(targetConnection, requestId, optionId);
      const state = useAcpStore.getState();
      if (
        state.connectionId === targetConnection &&
        state.sessionId === targetSession &&
        state.permission?.requestId === requestId
      )
        setPermission(null);
    } catch (error) {
      const state = useAcpStore.getState();
      if (
        state.connectionId === targetConnection &&
        state.sessionId === targetSession &&
        state.permission?.requestId === requestId
      ) {
        setReplyError({
          key,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      pendingReplies.current.delete(key);
      setBusyKey((current) => (current === key ? null : current));
    }
  };

  if (!connectionId) return null;

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div
        ref={scrollRef}
        data-acp-history
        onScroll={readPosition}
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 text-sm"
      >
        {!sessionId && authMethods.length > 0 && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="text-xs text-muted-foreground">
              此 Agent 需要先登录，才能开始会话。
            </div>
            <div className="flex flex-wrap gap-2">
              {authMethods.map((m) => (
                <Button
                  key={m.id}
                  size="sm"
                  variant="outline"
                  onClick={() => authenticate(m.id)}
                >
                  {m.name}
                </Button>
              ))}
            </div>
          </div>
        )}

        {entries.map((entry) => {
          if (entry.role === "tool") {
            return <AcpToolCall key={entry.id} entry={entry} />;
          }
          const tone =
            entry.role === "user"
              ? "bg-muted"
              : entry.role === "thought"
                ? "text-muted-foreground italic"
                : entry.role === "error"
                  ? "text-destructive"
                  : "";
          return (
            <div
              key={entry.id}
              className={`min-w-0 max-w-full whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md px-2 py-1 ${tone}`}
            >
              {entry.role === "user" &&
                entry.images?.map((path, i) => (
                  <img
                    key={i}
                    src={path.startsWith("data:") ? path : fileSrc(path)}
                    alt="用户图片"
                    className="max-h-48 rounded-md my-2"
                  />
                ))}
              {entry.text}
            </div>
          );
        })}
        <div ref={bottomRef} data-session-latest style={{ height: 1 }} />
      </div>

      {showLatest && (
        <div className="shrink-0 flex justify-center py-1">
          <Button
            size="sm"
            variant="secondary"
            aria-label="回到最新消息"
            onClick={() => {
              following.current = true;
              setShowLatest(false);
              bottomRef.current?.scrollIntoView({
                behavior: "auto",
                block: "end",
              });
            }}
          >
            回到最新消息
          </Button>
        </div>
      )}
      {permission && (
        <div
          className="shrink-0 border-t p-3 space-y-2"
          role="region"
          aria-label="待审批操作"
          aria-busy={responding}
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground text-xs">
              {responding ? "正在提交…" : "等待确认"}
            </span>
            <span>{permission.title}</span>
          </div>
          {replyError?.key === permissionKey && (
            <p role="alert" className="text-sm text-destructive">
              审批提交失败：{replyError.message}。请重试。
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {permission.options.map((o) => (
              <Button
                key={o.optionId}
                size="sm"
                disabled={responding}
                onClick={() => respond(o.optionId)}
              >
                {o.name}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              disabled={responding}
              onClick={() => respond(null)}
            >
              取消本次操作
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
