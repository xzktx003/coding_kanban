import { useCallback, useEffect, useRef } from "react";
import {
  useApprovalStore,
  useCodexStore,
  useElicitationStore,
  usePermissionsStore,
  useRequestUserInputStore,
} from "@session/components/codex/stores";
import { buildUrl, isDesktopTauri } from "@session/hooks/runtime";
import { getAccountWithParams } from "@session/services";
import { useLayoutStore } from "@session/stores";
import { useSettingsStore } from "@session/stores/settings";
import { useServerNotificationHandler } from "./useServerNotificationHandler";
import { useSseEventBridge } from "./useSseEventBridge";
import { useTauriEventListeners } from "./useTauriEventListeners";

export function useCodexEvents(enabled = true) {
  // Read volatile values via refs so downstream hooks never need to re-run
  // their effects when they change — re-registering Tauri listeners on every
  // store update or layout change (e.g. window resize) was causing listeners
  // to drop.
  const isCodexThreadActiveRef = useRef(false);
  const taskCompleteBeepModeRef = useRef<"never" | "unfocused" | "always">(
    "unfocused",
  );
  const preventSleepDuringTasksRef = useRef(false);

  // Keep refs in sync with current store values on every render (cheap).
  isCodexThreadActiveRef.current = useLayoutStore(
    (state) => state.view === "agent",
  );
  taskCompleteBeepModeRef.current = useSettingsStore(
    (state) => state.enableTaskCompleteBeep,
  );
  preventSleepDuringTasksRef.current = useSettingsStore(
    (state) => state.preventSleepDuringTasks,
  );

  const accountRead = useRef({ active: false, generation: 0, epoch: 0 });
  const syncAccountState = useCallback(async (refreshToken: boolean) => {
    if (!accountRead.current.active) return;
    const generation = ++accountRead.current.generation;
    const epoch = accountRead.current.epoch;
    const source = buildUrl("/health");
    try {
      const response = await getAccountWithParams({ refreshToken });
      const account = response?.account;
      if (
        account !== null &&
        (!account ||
          typeof account !== "object" ||
          !["apiKey", "chatgpt", "amazonBedrock"].includes(account.type))
      ) {
        throw new Error("Invalid account observation");
      }
      if (
        !accountRead.current.active ||
        generation !== accountRead.current.generation ||
        epoch !== accountRead.current.epoch ||
        source !== buildUrl("/health")
      )
        return;
      useCodexStore.getState().setAccount(response.account);
    } catch (error) {
      // A failed observation says nothing about authentication. Keep initial
      // unknown or the last authoritative account instead of inventing logout.
      if (
        accountRead.current.active &&
        generation === accountRead.current.generation
      )
        console.error("[useCodexEvents] Failed to sync account state:", error);
    }
  }, []);

  useEffect(() => {
    accountRead.current.active = enabled;
    if (!enabled) return;
    const invalidate = () => {
      accountRead.current.epoch++;
      accountRead.current.generation++;
    };
    window.addEventListener("session-runtime-restarted", invalidate);
    syncAccountState(false).catch(console.error);
    return () => {
      accountRead.current.active = false;
      invalidate();
      window.removeEventListener("session-runtime-restarted", invalidate);
    };
  }, [enabled, syncAccountState]);

  const handleServerNotification = useServerNotificationHandler(
    {
      isCodexThreadActiveRef,
      taskCompleteBeepModeRef,
      preventSleepDuringTasksRef,
    },
    syncAccountState,
  );

  // Store actions accessed via getState() are stable function references
  // defined once in the Zustand store initializer.
  const onApproval = useApprovalStore.getState().addApproval;
  const onUserInputRequest = useRequestUserInputStore.getState().addRequest;
  const onElicitationRequest = useElicitationStore.getState().addRequest;
  const onPermissionsRequest = usePermissionsStore.getState().addRequest;

  const sharedHandlers = {
    enabled,
    onApproval,
    onUserInputRequest,
    onElicitationRequest,
    onPermissionsRequest,
    onNotification: handleServerNotification,
  };

  // Agent events reach the desktop over the Tauri bus and everyone else over
  // SSE. The SSE stream stays open on desktop as well, because the filesystem
  // watcher now only publishes there — the bridge drops the duplicate agent
  // events itself.
  useTauriEventListeners({
    ...sharedHandlers,
    enabled: enabled && isDesktopTauri(),
  });
  useSseEventBridge({ ...sharedHandlers, enabled });
}
