import { lazy, Suspense, useEffect, useState } from "react";
import { Library } from "lucide-react";
import type { ServerNotification } from "@session/bindings";
import { OptionalSessionPanel } from "@session/components/layout/OptionalSessionPanel";
import { useAgentInteractionVisible } from "@session/session-dom";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { usePairingStore } from "@session/stores/usePairingStore";
import { authHeaders, buildUrl } from "@session/hooks/runtime";
import { openEventStream } from "@session/lib/eventStream";
import { captureCodexOperationScope, isCodexOperationScopeCurrent } from "@session/services/codexOperationScope";
const Panel = lazy(() => import("./ThreadSourcesPanel"));
const captureSourceScope = () => ({ operation: captureCodexOperationScope(), url: buildUrl("/api/codex/thread/item-detail"), authorization: authHeaders().Authorization });
const sourceScopeCurrent = (scope: ReturnType<typeof captureSourceScope>) => isCodexOperationScopeCurrent(scope.operation) && scope.url === buildUrl("/api/codex/thread/item-detail") && scope.authorization === authHeaders().Authorization;
/** The optional panel and source aggregation stay outside the entry dependency path. */
export function ThreadSources({
  threadId,
  events,
}: {
  threadId: string;
  events: readonly ServerNotification[];
}) {
  const [scope, setScope] = useState<ReturnType<typeof captureSourceScope> | null>(null);
  const visible = useAgentInteractionVisible();
  const close = () => setScope(null);
  useEffect(() => {
    if (!scope) return;
    const closeCaptured = () => setScope(current => current === scope ? null : current);
    if (!visible || !sourceScopeCurrent(scope)) { closeCaptured(); return; }
    const check = () => { if (!sourceScopeCurrent(scope)) closeCaptured(); };
    const stopAccount = useCodexStore.subscribe(check);
    const stopDevice = usePairingStore.subscribe(check);
    const stopSignals = openEventStream({ agents: ["codex"], label: "sources-scope", onResync: closeCaptured, onEvent: event => {
      const payload = event.payload;
      const method = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>).method : undefined;
      if (event.event === "codex:initialized" || event.event === "codex:disconnected" || method === "account/updated" || method === "account/login/completed") closeCaptured();
    } });
    const hidden = () => { if (document.visibilityState === "hidden") closeCaptured(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("session-runtime-restarted", closeCaptured);
    return () => { stopAccount(); stopDevice(); stopSignals(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("session-runtime-restarted", closeCaptured); };
  }, [scope, visible]);
  return (
    <>
      <button
        type="button"
        className="codex-sources-trigger inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-2"
        disabled={!visible}
        onClick={() => setScope(captureSourceScope())}
        aria-label="查看会话来源"
      >
        <Library size={14} aria-hidden="true" />
        来源
      </button>
      {scope && visible && (
        <OptionalSessionPanel
          label="来源"
          onClose={close}
          overlay
        >
          <Suspense
            fallback={
              <div role="status" className="session-optional-panel-error">
                正在加载来源…
                <button type="button" onClick={close}>
                  取消
                </button>
              </div>
            }
          >
            <Panel
              key={threadId}
              threadId={threadId}
              events={events}
              onClose={close}
            />
          </Suspense>
        </OptionalSessionPanel>
      )}
    </>
  );
}
