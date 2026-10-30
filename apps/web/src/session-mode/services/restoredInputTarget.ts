import {
  selectedAgentCard,
  agentCardKey,
  useAgentCenterStore,
} from "@session/stores/useAgentCenterStore";
import { selectCodexInputTarget } from "@session/components/codex/stores/codexInputTarget";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { useCCStore } from "@session/stores/cc/ccStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "./codexOperationScope";
import { isSessionInteractionVisible } from "@session/session-dom";

/** Prepare the saved visible input while the larger application graph loads.
 * This is selection/read-only recovery; it never acquires native execution. */
export function prepareRestoredInputTarget(
  load: () => Promise<
    Pick<
      typeof import("./builtinInputNavigation"),
      "synchronizeBuiltinInputTarget"
    >
  > = () => import("./builtinInputNavigation"),
) {
  const card = selectedAgentCard(useAgentCenterStore.getState());
  if (!card || useAcpStore.getState().active || !isSessionInteractionVisible())
    return () => {};
  const agent = useAgentSettingsStore.getState().selectedAgent;
  const sender = () =>
    card.kind === "codex"
      ? useCodexStore.getState().currentThreadId
      : useCCStore.getState().activeSessionId;
  const originalSender = sender();
  if (originalSender === card.id && agent === card.kind) return () => {};
  const scope = captureCodexOperationScope();
  // The target must be ready before the large navigation/history graph can
  // resolve; otherwise the first composer commit renders a mismatched owner.
  if (agent !== card.kind)
    useAgentSettingsStore.getState().setSelectedAgent(card.kind);
  const targetCwd = card.worktreePath || card.cwd;
  if (targetCwd) useWorkspaceStore.getState().setCwd(targetCwd);
  if (card.kind === "codex") selectCodexInputTarget(card.id);
  else useCCStore.getState().switchToSession(card.id);
  const preparedCwd = useWorkspaceStore.getState().cwd;
  let cancelled = false;
  const current = () => {
    const selected = selectedAgentCard(useAgentCenterStore.getState());
    return (
      isSessionInteractionVisible() &&
      !useAcpStore.getState().active &&
      isCodexOperationScopeCurrent(scope) &&
      !!selected &&
      agentCardKey(selected) === agentCardKey(card) &&
      (selected.worktreePath || selected.cwd) === targetCwd &&
      sender() === card.id &&
      useAgentSettingsStore.getState().selectedAgent === card.kind &&
      useWorkspaceStore.getState().cwd === preparedCwd
    );
  };
  const subscriptions: (() => void)[] = [];
  const release = () => subscriptions.splice(0).forEach((stop) => stop());
  const check = () => {
    if (!current()) {
      cancelled = true;
      release();
    }
  };
  // Returning to the same UUID cannot revive a preparation that lost ownership
  // while its optional module was downloading.
  subscriptions.push(
    useAgentCenterStore.subscribe(check),
    (card.kind === "codex" ? useCodexStore : useCCStore).subscribe(check),
    useWorkspaceStore.subscribe(check),
    useAgentSettingsStore.subscribe(check),
    useAcpStore.subscribe(check),
  );
  void load()
    .then((module) => {
      if (!cancelled && current())
        module.synchronizeBuiltinInputTarget(
          selectedAgentCard(useAgentCenterStore.getState())!,
        );
    })
    .catch(() => {
      /* Normal mounted navigation retains its own retry/error path. */
    })
    .finally(release);
  return () => {
    cancelled = true;
    release();
  };
}
