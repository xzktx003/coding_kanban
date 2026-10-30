import { useSyncExternalStore } from "react";
import { authHeaders, buildUrl } from "@session/hooks/runtime";
import { usePairingStore } from "@session/stores/usePairingStore";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { subscribeGoalCompletionScopeReset } from "@session/services/goalCompletionAutoClear";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "@session/services/codexOperationScope";
import { openEventStream } from "@session/lib/eventStream";
import { invalidatePluginCapabilities } from "./pluginInputs";
const changeKey = "kanban.session.plugins.changed.v1";
let revision = 0,
  epoch = 0,
  stop: (() => void) | undefined;
const listeners = new Set<() => void>();
let cache:
  | {
      scope: ReturnType<typeof capturePluginScope>;
      value: any;
    }
  | undefined;
const stamp = () =>
  JSON.stringify([
    buildUrl("/api/codex/plugin/list"),
    authHeaders(),
    useCodexStore.getState().accountNamespace,
    useCodexStore.getState().hasAccount,
  ]);
const notify = (revoke = false) => {
  revision++;
  if (revoke) epoch++;
  cache = undefined;
  for (const listener of listeners) listener();
};
/** Subscriptions exist only while the optional plugin UI is mounted. */
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stop) {
    const revoke = () => notify(true),
      changed = () => {
        invalidatePluginCapabilities();
        notify();
      };
    const offAccount = subscribeGoalCompletionScopeReset(revoke),
      offDevice = usePairingStore.subscribe((state, before) => {
        if (state !== before) revoke();
      });
    const offStore = useCodexStore.subscribe((state, before) => {
      if (
        state.accountNamespace !== before.accountNamespace ||
        state.hasAccount !== before.hasAccount ||
        state.account?.type !== before.account?.type
      )
        revoke();
    });
    const offEvents = openEventStream({
      agents: ["codex"],
      label: "plugin-catalog",
      onResync: revoke,
      onEvent: (event) => {
        const method = (event.payload as { method?: string }).method;
        if (
          event.event === "codex:notification" &&
          ["app/list/updated", "mcpServer/startupStatus/updated"].includes(
            method ?? "",
          )
        )
          changed();
        else if (event.event === "codex:disconnected") revoke();
      },
    });
    const storage = (event: StorageEvent) => {
      if (event.key === changeKey) changed();
    };
    window.addEventListener("storage", storage);
    window.addEventListener("session-runtime-restarted", revoke);
    stop = () => {
      offAccount();
      offDevice();
      offStore();
      offEvents();
      window.removeEventListener("storage", storage);
      window.removeEventListener("session-runtime-restarted", revoke);
      stop = undefined;
    };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stop?.();
  };
}
export function capturePluginScope() {
  return { epoch, stamp: stamp(), codex: captureCodexOperationScope() };
}
export function isPluginScopeCurrent(
  scope: ReturnType<typeof capturePluginScope>,
) {
  return (
    epoch === scope.epoch &&
    scope.stamp === stamp() &&
    isCodexOperationScopeCurrent(scope.codex)
  );
}
export function usePluginCatalogRevision() {
  return useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision,
  );
}
export function readPluginCatalogCache() {
  // The optional UI has no subscription while closed. A same-value account
  // notification or runtime replacement must still revoke its old cache.
  if (cache && !isPluginScopeCurrent(cache.scope)) cache = undefined;
  return cache?.value ?? null;
}
export function savePluginCatalogCache(value: unknown) {
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength <=
    2 * 1024 * 1024
  )
    cache = { scope: capturePluginScope(), value };
}
export function publishPluginChange() {
  invalidatePluginCapabilities();
  notify();
  try {
    localStorage.setItem(changeKey, String(Date.now()) + ":" + Math.random());
  } catch {
    /* The native notification and local update remain usable. */
  }
}
