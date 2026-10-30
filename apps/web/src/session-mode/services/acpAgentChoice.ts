import {
  rememberCurrentAcpOwner,
  findAcpRuntimeOwner,
  openAcpRuntimeOwner,
  assertAcpRuntimeOwnerCapacity,
} from "./acpRuntimeOwners";
import { activateAcpAgent } from "./acpConnectionRecoveryPointer";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "./codexOperationScope";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { useCCStore } from "@session/stores/cc/ccStore";
import { invalidateAcpSessionOperation } from "@session/components/acp/sessionOperations";

type Ask = (request: {
  title: string;
  description: string;
  confirmLabel: string;
}) => Promise<boolean>;
let choiceRevision = 0;
export function cancelPendingAcpAgentChoice() {
  choiceRevision++;
}

function inputIdentity() {
  const acp = useAcpStore.getState(),
    cards = useAgentCenterStore.getState();
  return JSON.stringify([
    acp.active,
    acp.agentId,
    acp.connectionId,
    acp.sessionId,
    cards.currentAgentCardKind,
    cards.currentAgentCardId,
    useAgentSettingsStore.getState().selectedAgent,
    useWorkspaceStore.getState().cwd,
    useCodexStore.getState().currentThreadId,
    useCCStore.getState().activeSessionId,
  ]);
}

/** Provider choice is navigation. Preserve the old runtime owner and re-observe
 * existing targets without stopping, creating or loading a native task. */
export async function chooseAcpAgent(id: string, _ask: Ask) {
  const original = useAcpStore.getState();
  if (original.active && original.agentId === id) return;
  const revision = ++choiceRevision,
    identity = inputIdentity(),
    scope = captureCodexOperationScope();
  let changed = false,
    committing = false;
  const observe = () => {
    if (!committing && inputIdentity() !== identity) changed = true;
  };
  const stops = [
    useAcpStore.subscribe(observe),
    useAgentSettingsStore.subscribe(observe),
    useAgentCenterStore.subscribe(observe),
    useWorkspaceStore.subscribe(observe),
    useCodexStore.subscribe(observe),
    useCCStore.subscribe(observe),
  ];
  const current = () =>
    !changed &&
    revision === choiceRevision &&
    isCodexOperationScopeCurrent(scope);
  try {
    if (original.connectionId && original.agentId !== id) {
      rememberCurrentAcpOwner(original);
      const existing = findAcpRuntimeOwner(id);
      if (!current()) return;
      committing = true;
      invalidateAcpSessionOperation();
      if (existing) {
        openAcpRuntimeOwner(existing.key);
        return;
      }
      assertAcpRuntimeOwnerCapacity();
      original.reset();
    } else if (!original.connectionId) {
      const existing = findAcpRuntimeOwner(id);
      if (existing && current()) {
        committing = true;
        openAcpRuntimeOwner(existing.key);
        return;
      }
      assertAcpRuntimeOwnerCapacity();
    }
    if (
      !changed &&
      revision === choiceRevision &&
      isCodexOperationScopeCurrent(scope)
    )
      activateAcpAgent(id);
  } finally {
    stops.forEach((stop) => stop());
  }
}

import.meta.hot?.dispose(cancelPendingAcpAgentChoice);
