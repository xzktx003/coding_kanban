import { useCodexStore } from "../components/codex/stores/useCodexStore";
import { subscribeGoalCompletionScopeReset } from "./goalCompletionAutoClear";

// An operation's lifetime is local to this page. This is a stale-receipt guard,
// not a server-side ownership token or a cross-client CAS guarantee.
const lifetime: { revision: number } = import.meta.hot?.data
  ?.codexOperationScope ?? { revision: 0 };
export function invalidateCodexOperationScope() {
  lifetime.revision++;
}
export function captureCodexOperationScope() {
  const state = useCodexStore.getState();
  return Object.freeze({
    revision: lifetime.revision,
    accountNamespace: state.accountNamespace,
    hasAccount: state.hasAccount,
    accountType: state.account?.type,
  });
}
export type CodexOperationScope = ReturnType<typeof captureCodexOperationScope>;
export function isCodexOperationScopeCurrent(scope: CodexOperationScope) {
  const current = captureCodexOperationScope();
  return (
    scope.revision === current.revision &&
    scope.accountNamespace === current.accountNamespace &&
    scope.hasAccount === current.hasAccount &&
    scope.accountType === current.accountType
  );
}
let operationScopeClients = 0;
let stopOperationScopeSync: (() => void) | undefined;
export function startCodexOperationScopeSync() {
  operationScopeClients++;
  if (!stopOperationScopeSync) {
    const unsubscribe = useCodexStore.subscribe((state, previous) => {
      if (
        state.accountNamespace !== previous.accountNamespace ||
        state.hasAccount !== previous.hasAccount ||
        state.account?.type !== previous.account?.type
      )
        invalidateCodexOperationScope();
    });
    const unsubscribeAccountNotification = subscribeGoalCompletionScopeReset(
      invalidateCodexOperationScope,
    );
    if (typeof window !== "undefined")
      window.addEventListener(
        "session-runtime-restarted",
        invalidateCodexOperationScope,
      );
    stopOperationScopeSync = () => {
      unsubscribe();
      unsubscribeAccountNotification();
      if (typeof window !== "undefined")
        window.removeEventListener(
          "session-runtime-restarted",
          invalidateCodexOperationScope,
        );
      stopOperationScopeSync = undefined;
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    operationScopeClients = Math.max(0, operationScopeClients - 1);
    if (!operationScopeClients) stopOperationScopeSync?.();
  };
}

if (import.meta.hot)
  import.meta.hot.dispose((data) => {
    invalidateCodexOperationScope();
    data.codexOperationScope = lifetime;
    operationScopeClients = 0;
    stopOperationScopeSync?.();
  });
