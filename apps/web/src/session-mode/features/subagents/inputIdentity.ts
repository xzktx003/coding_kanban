import {
  classifySubagentThread,
  type SubagentThread,
} from "@agent-orchestrator/shared/session-subagents";
import { useCodexStore } from "@session/components/codex/stores";
import { MutationNotStartedError } from "@session/services/MutationNotStartedError";
import { useSubagentStore } from "./store";
import type { SubagentIdentity, SubagentNode } from "./model";

export interface CodexThreadInputState {
  kind: "main" | "child" | "unknown";
  blocked: boolean;
  needsVerification: boolean;
  reason: string | null;
}
export const checkingThreadInputReason =
  "线程身份或输入权限尚未确认，请重新核对。";
export const restrictedThreadInputReason =
  "当前子线程由主 Agent 调度，不能直接发送消息。";

/** The observation index is a discovery hint, not an input permission source. */
export function selectCodexThreadInput(
  native: SubagentThread | undefined,
  node: SubagentNode | undefined,
  identity: SubagentIdentity | undefined,
  runtimeEpoch: number,
  requireChild = false,
): CodexThreadInputState {
  const current =
    identity?.runtimeEpoch === runtimeEpoch ? identity.thread : undefined;
  const confirmed = current && classifySubagentThread(current);
  const nativeKind = native && classifySubagentThread(native);
  if (
    confirmed === "main" ||
    (nativeKind === "main" && confirmed !== "child")
  ) {
    return requireChild
      ? {
          kind: "main",
          blocked: true,
          needsVerification: false,
          reason: "当前线程已确认不是此子任务，请保留草稿并核对所选线程。",
        }
      : {
          kind: "main",
          blocked: false,
          needsVerification: false,
          reason: null,
        };
  }
  const suspect =
    requireChild || !!node || confirmed === "child" || nativeKind === "child";
  if (!suspect) {
    // Older main-thread metadata has no source. Preserve that compatibility
    // without asserting that a missing source proves a main-thread identity.
    // The backend still performs the final native input check.
    return {
      kind: "unknown",
      blocked: false,
      needsVerification: false,
      reason: null,
    };
  }
  const knownChild =
    confirmed === "child" ||
    nativeKind === "child" ||
    (node?.verified && classifySubagentThread(node.thread) === "child");
  const capability = node?.unavailable
    ? null
    : current
      ? confirmed === "child"
        ? current.canAcceptDirectInput
        : null
      : node?.verified
        ? node.thread.canAcceptDirectInput
        : null;
  if (knownChild && capability === true) {
    return {
      kind: "child",
      blocked: false,
      needsVerification: false,
      reason: null,
    };
  }
  if (knownChild && capability === false) {
    return {
      kind: "child",
      blocked: true,
      needsVerification: false,
      reason: restrictedThreadInputReason,
    };
  }
  return {
    kind: knownChild ? "child" : "unknown",
    blocked: true,
    needsVerification: true,
    reason: checkingThreadInputReason,
  };
}

export function codexThreadInputState(id: string, requireChild = false) {
  const state = useSubagentStore.getState();
  return selectCodexThreadInput(
    useCodexStore.getState().threads.find((thread) => thread.id === id),
    state.nodes[id],
    state.identities[id],
    state.runtimeEpoch,
    requireChild,
  );
}
export function assertCodexThreadInput(id: string) {
  const input = codexThreadInputState(id);
  if (input.blocked)
    throw new MutationNotStartedError(
      input.reason ?? checkingThreadInputReason,
    );
}
