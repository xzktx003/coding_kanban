import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadId } from "@session/bindings";
import type {
  ThreadListParams,
  ThreadListResponse,
} from "@session/bindings/v2";
import { modelProviders } from "@session/components/codex/constants";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { Button } from "@session/components/ui/button";
import { Card, CardContent } from "@session/components/ui/card";
import { listThreads, unarchiveThread } from "@session/services/apiAdapt/codex";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "@session/services/codexOperationScope";
import { subscribeGoalCompletionScopeReset } from "@session/services/goalCompletionAutoClear";
import { formatThreadAge } from "@session/utils/formatThreadAge";
import { getFilename } from "@session/utils/getFilename";
const EMPTY: ThreadListResponse = {
  data: [],
  nextCursor: null,
  backwardsCursor: null,
};
export function ArchivedThreadSettings() {
  const [response, setResponse] = useState<ThreadListResponse>(EMPTY),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<{
      message: string;
      kind: "load" | "restore";
    } | null>(null),
    [restoring, setRestoring] = useState<Set<string>>(() => new Set()),
    [scopeNonce, setScopeNonce] = useState(0);
  const namespace = useCodexStore((state) => state.accountNamespace),
    hasAccount = useCodexStore((state) => state.hasAccount),
    accountType = useCodexStore((state) => state.account?.type);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    retryCursor = useRef<string | null>(null),
    seen = useRef(new Set<string>()),
    pending = useRef(new Map<string, object>()),
    restored = useRef(new Set<string>()),
    mounted = useRef(true);
  const load = useCallback(async (cursor: string | null, reset = false) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const version = ++generation.current,
      scope = captureCodexOperationScope();
    retryCursor.current = cursor;
    setLoading(true);
    setError(null);
    if (reset) seen.current.clear();
    try {
      const params: ThreadListParams = {
        cursor,
        limit: 50,
        modelProviders,
        archived: true,
        useStateDbOnly: true,
      };
      const next = await listThreads(params, {
        signal: abort.signal,
        suppressToast: true,
      });
      if (
        !mounted.current ||
        version !== generation.current ||
        !isCodexOperationScopeCurrent(scope)
      )
        return;
      if (
        !Array.isArray(next?.data) ||
        next.data.some((row) => !row || typeof row.id !== "string") ||
        (next.nextCursor !== null && typeof next.nextCursor !== "string")
      )
        throw new Error("归档列表返回无效状态");
      if (
        next.nextCursor &&
        (next.nextCursor === cursor || seen.current.has(next.nextCursor))
      )
        throw new Error("归档列表游标重复，请刷新后重试");
      if (next.nextCursor) seen.current.add(next.nextCursor);
      setResponse((previous) => {
        const rows = new Map(
          (reset ? [] : previous.data).map((row) => [row.id, row]),
        );
        for (const row of next.data)
          if (!restored.current.has(row.id)) rows.set(row.id, row);
        return { ...next, data: [...rows.values()] };
      });
    } catch (value) {
      if (
        mounted.current &&
        version === generation.current &&
        isCodexOperationScopeCurrent(scope) &&
        !abort.signal.aborted
      )
        setError({
          message: value instanceof Error ? value.message : String(value),
          kind: "load",
        });
    } finally {
      if (mounted.current && version === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const wake = () => setScopeNonce((value) => value + 1),
      stop = subscribeGoalCompletionScopeReset(wake);
    window.addEventListener("session-runtime-restarted", wake);
    return () => {
      stop();
      window.removeEventListener("session-runtime-restarted", wake);
    };
  }, []);
  useEffect(() => {
    mounted.current = true;
    pending.current.clear();
    setRestoring(new Set());
    restored.current.clear();
    setResponse(EMPTY);
    void load(null, true);
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [load, namespace, hasAccount, accountType, scopeNonce]);
  useEffect(
    () => () => {
      mounted.current = false;
      generation.current++;
      controller.current?.abort();
      pending.current.clear();
    },
    [],
  );
  const restore = async (id: ThreadId) => {
    if (pending.current.has(id)) return;
    const owner = {},
      scope = captureCodexOperationScope();
    pending.current.set(id, owner);
    setRestoring(new Set(pending.current.keys()));
    setError(null);
    try {
      await unarchiveThread(id);
      if (
        !mounted.current ||
        pending.current.get(id) !== owner ||
        !isCodexOperationScopeCurrent(scope)
      )
        return;
      restored.current.add(id);
      setResponse((previous) => ({
        ...previous,
        data: previous.data.filter((row) => row.id !== id),
      }));
    } catch (value) {
      if (
        mounted.current &&
        pending.current.get(id) === owner &&
        isCodexOperationScopeCurrent(scope)
      )
        setError({
          message: value instanceof Error ? value.message : String(value),
          kind: "restore",
        });
    } finally {
      if (mounted.current && pending.current.get(id) === owner) {
        pending.current.delete(id);
        setRestoring(new Set(pending.current.keys()));
      }
    }
  };
  return (
    <section className="space-y-3" aria-label="归档聊天设置">
      <div className="flex items-center justify-between gap-3 px-1">
        <h3 className="text-sm font-medium">归档聊天</h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            restored.current.clear();
            void load(null, true);
          }}
          disabled={loading}
        >
          刷新
        </Button>
      </div>
      <Card>
        <CardContent className="space-y-3 p-4">
          {error && (
            <div className="space-y-2 text-xs text-destructive" role="alert">
              <p>
                {error.kind === "load" ? "加载归档聊天失败" : "恢复聊天失败"}：
                {error.message}
              </p>
              {error.kind === "load" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading}
                  onClick={() =>
                    void load(retryCursor.current, retryCursor.current === null)
                  }
                >
                  重试加载归档聊天
                </Button>
              )}
            </div>
          )}
          {!error && !loading && response.data.length === 0 && (
            <p className="text-xs text-muted-foreground">暂无归档聊天。</p>
          )}
          {response.data.map((thread) => {
            const title = thread.name?.trim() || thread.preview || "未命名聊天";
            return (
              <div
                key={thread.id}
                className="flex items-center justify-between gap-3 rounded-md border p-2"
                aria-label={"归档聊天：" + title}
              >
                <div className="min-w-0 space-y-1">
                  <div className="truncate text-sm font-medium" title={title}>
                    {title}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{formatThreadAge(thread.createdAt ?? 0)}</span>
                    <span>{getFilename(thread.cwd)}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  aria-label={"恢复聊天：" + title}
                  disabled={restoring.has(thread.id)}
                  onClick={() => void restore(thread.id)}
                >
                  {restoring.has(thread.id) ? "正在恢复…" : "恢复"}
                </Button>
              </div>
            );
          })}
          {loading && (
            <p role="status" className="text-xs text-muted-foreground">
              正在加载归档聊天…
            </p>
          )}
          {response.nextCursor && !(error?.kind === "load") && (
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => void load(response.nextCursor)}
            >
              加载更多归档聊天
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            恢复只移出归档；任务、Goal 和待发队列仍需明确继续。
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
