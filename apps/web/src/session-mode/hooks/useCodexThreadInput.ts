import { useCallback, useEffect, useRef, useState } from "react";
import { useCodexStore } from "@session/components/codex/stores";
import {
  confirmSubagentMetadata,
  useSubagentStore,
} from "@session/features/subagents/store";
import { subagentService } from "@session/features/subagents/service";
import { selectCodexThreadInput } from "@session/features/subagents/inputIdentity";
import { classifySubagentThread } from "@agent-orchestrator/shared";
import { useSessionInteractionVisible } from "@session/session-dom";

/** Only visible inputs with a child clue read metadata; no history or writer is opened. */
export function useCodexThreadInput(id?: string | null, requireChild = false) {
  const visible = useSessionInteractionVisible();
  const native = useCodexStore((s) =>
    s.threads.find((thread) => thread.id === id),
  );
  const node = useSubagentStore((s) => (id ? s.nodes[id] : undefined));
  const identity = useSubagentStore((s) => (id ? s.identities[id] : undefined));
  const epoch = useSubagentStore((s) => s.runtimeEpoch);
  const scope = useSubagentStore((s) => s.scope);
  const check = useSubagentStore((s) =>
    id ? s.identityChecks[id] : undefined,
  );
  const [retry, setRetry] = useState(0);
  const handledRetry = useRef("");
  const input = selectCodexThreadInput(
    native,
    node,
    identity,
    epoch,
    requireChild,
  );
  const recheck = useCallback(() => setRetry((value) => value + 1), []);
  useEffect(() => {
    // A current raw main source corrects old observation hints. Do not merge
    // the hint's parent into this raw metadata before classification.
    if (!native || !node || classifySubagentThread(native) !== "main") return;
    if (
      identity?.runtimeEpoch === epoch &&
      classifySubagentThread(identity.thread) === "child"
    )
      return;
    confirmSubagentMetadata([native]);
  }, [native, node, identity, epoch]);
  useEffect(() => {
    const retryKey = `${scope}:${epoch}:${id}:${retry}`;
    const explicit = retry > 0 && handledRetry.current !== retryKey;
    if (!id || !visible || (!input.needsVerification && !explicit)) return;
    handledRetry.current = retryKey;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // One initial read and one bounded retry. No silent complete-history polling.
    const read = (remaining: number) => {
      void subagentService
        .inspectIdentity(id, controller.signal)
        .then(() => {
          const state = useSubagentStore.getState();
          const stillUnknown = selectCodexThreadInput(
            useCodexStore.getState().threads.find((thread) => thread.id === id),
            state.nodes[id],
            state.identities[id],
            state.runtimeEpoch,
            requireChild,
          ).needsVerification;
          if (stillUnknown && remaining && !controller.signal.aborted)
            timer = setTimeout(() => read(remaining - 1), 1500);
        })
        .catch(() => {
          if (remaining && !controller.signal.aborted)
            timer = setTimeout(() => read(remaining - 1), 1500);
        });
    };
    read(1);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // Identity/capability snapshots update the view, but must not create a read
    // loop. Target, runtime, scope and explicit retry are the read generation.
  }, [id, epoch, scope, retry, requireChild, input.needsVerification, visible]);
  return {
    ...input,
    reason:
      input.needsVerification && check?.loading
        ? "正在核对线程身份与输入权限…"
        : input.reason,
    rechecking: check?.loading ?? false,
    recheck,
  };
}
