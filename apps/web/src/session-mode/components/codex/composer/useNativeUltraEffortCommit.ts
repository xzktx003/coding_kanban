import { useCallback } from "react";
import type { ReasoningEffort } from "@session/bindings";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { preferredNonFullAccessMode } from "@session/services/nonFullAccessPreference";
import { useNativeUltraFullAccessConfirmation } from "./NativeUltraFullAccessConfirmation";
import { needsUltraFullAccessConfirmation } from "./ultraFullAccessGate";

/** Same full-access question as the settings panel, for every session-menu write. */
export function useNativeUltraEffortCommit(threadId: string | null) {
  const { reasoningEffort, sandbox, permissionsKnown, permissions, setAccessMode } =
    useThreadModelSettings(threadId);
  const fallbackSandbox = preferredNonFullAccessMode();
  const { ask, confirmation } = useNativeUltraFullAccessConfirmation(fallbackSandbox);
  const commit = useCallback(
    (nextEffort: ReasoningEffort, apply: () => void) => {
      if (
        !needsUltraFullAccessConfirmation({
          nextEffort,
          currentEffort: reasoningEffort,
          sandbox,
          permissionsKnown,
          permissionProfile: permissions,
        })
      ) {
        apply();
        return;
      }
      void ask().then((choice) => {
        if (choice === "dismiss") return;
        if (choice === "fallback") {
          if (!fallbackSandbox) return;
          setAccessMode(fallbackSandbox);
        }
        apply();
      });
    },
    [reasoningEffort, sandbox, permissionsKnown, permissions, fallbackSandbox, ask, setAccessMode],
  );
  return { commit, confirmation };
}
