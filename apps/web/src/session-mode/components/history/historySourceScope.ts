import { authHeaders, buildUrl } from "@session/hooks/runtime";
import { usePairingStore } from "@session/stores/usePairingStore";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { openEventStream } from "@session/lib/eventStream";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
  startCodexOperationScopeSync,
} from "@session/services/codexOperationScope";

export const captureHistorySourceScope = (path: string) => ({
  path,
  url: buildUrl(path),
  headers: authHeaders(),
  operation: captureCodexOperationScope(),
});
export const isHistorySourceScopeCurrent = (
  scope: ReturnType<typeof captureHistorySourceScope>,
) =>
  scope.url === buildUrl(scope.path) &&
  scope.headers.Authorization === authHeaders().Authorization &&
  isCodexOperationScopeCurrent(scope.operation);
/** Owned only while an explicit source viewer is mounted; no extra body cache. */
export function watchHistorySourceScope(
  scope: ReturnType<typeof captureHistorySourceScope>,
  invalidate: () => void,
) {
  const stopScope = startCodexOperationScopeSync();
  const check = () => {
    if (!isHistorySourceScopeCurrent(scope)) invalidate();
  };
  const stopDevice = usePairingStore.subscribe(check),
    stopAccount = useCodexStore.subscribe(check);
  const stopEvents = openEventStream({
    agents: ["codex"],
    label: "provider-history-detail",
    onResync: invalidate,
    onEvent: (event) => {
      const payload = event.payload;
      const method =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).method
          : null;
      if (
        event.event === "codex:initialized" ||
        event.event === "codex:disconnected" ||
        method === "account/updated" ||
        method === "account/login/completed"
      )
        invalidate();
    },
  });
  const hidden = () => {
    if (document.visibilityState === "hidden") invalidate();
  };
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("session-runtime-restarted", invalidate);
  check();
  return () => {
    stopScope();
    stopDevice();
    stopAccount();
    stopEvents();
    document.removeEventListener("visibilitychange", hidden);
    window.removeEventListener("session-runtime-restarted", invalidate);
  };
}
