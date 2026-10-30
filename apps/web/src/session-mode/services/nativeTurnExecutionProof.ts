import type { TurnTiming } from "../components/codex/stores/types";
import type { ServerNotification } from "../bindings";
import { isCachedTurnExecutionUnverified } from "./cachedTurnExecutionView";
import { authHeaders, buildUrl } from "../hooks/runtime";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "./codexOperationScope";

export const captureNativeExecutionScope = () =>
  Object.freeze({
    operation: captureCodexOperationScope(),
    endpoint: buildUrl("/health"),
    authorization: authHeaders().Authorization,
  });
export type NativeExecutionScope = ReturnType<
  typeof captureNativeExecutionScope
>;
export const isNativeExecutionScopeCurrent = (scope: NativeExecutionScope) =>
  isCodexOperationScopeCurrent(scope.operation) &&
  scope.endpoint === buildUrl("/health") &&
  scope.authorization === authHeaders().Authorization;

// Only accepted native lifecycle events, activity reads and turn/start ACKs
// register evidence. A cached or optimistic timing object has no entry. Weak
// keys retain neither past store roots nor transcript bodies; nothing is saved.
const proofs = new WeakMap<
  TurnTiming,
  {
    threadId: string;
    scope: NativeExecutionScope;
    timing: TurnTiming;
  }
>();

export function recordNativeExecutionTiming(
  threadId: string,
  timing: TurnTiming,
  scope: NativeExecutionScope,
) {
  if (!threadId || !timing.turnId || !isNativeExecutionScopeCurrent(scope))
    return;
  proofs.set(timing, { threadId, scope, timing: { ...timing } });
}

export function currentNativeExecutionTiming(
  threadId: string,
  timing: TurnTiming | undefined,
): TurnTiming | undefined {
  const proof = timing && proofs.get(timing);
  return proof &&
    proof.threadId === threadId &&
    isNativeExecutionScopeCurrent(proof.scope) &&
    proof.timing.turnId === timing!.turnId &&
    proof.timing.status === timing!.status &&
    proof.timing.startedAtMs === timing!.startedAtMs &&
    proof.timing.durationMs === timing!.durationMs
    ? timing
    : undefined;
}

/** Reconcile a passive display immediately when exact native evidence arrives. */
export function reconcileNativeExecutionEvents(
  threadId: string,
  events: ServerNotification[],
  timing: TurnTiming | undefined,
  active: boolean,
) {
  const native = currentNativeExecutionTiming(threadId, timing);
  if (!native || (native.status === "inProgress" && !active)) return events;
  let changed = false;
  const projected: ServerNotification[] = [];
  for (const event of events) {
    if (
      event.method !== "turn/completed" ||
      event.params.threadId !== threadId ||
      event.params.turn.id !== native.turnId ||
      event.params.turn.status !== "interrupted"
    ) {
      projected.push(event);
      continue;
    }
    if (
      native.status === "interrupted" &&
      !isCachedTurnExecutionUnverified(event)
    ) {
      projected.push(event);
      continue;
    }
    changed = true;
    if (native.status === "inProgress") continue;
    projected.push({
      ...event,
      params: {
        ...event.params,
        turn: {
          ...event.params.turn,
          status: native.status,
          durationMs: native.durationMs,
        },
      },
    });
  }
  return changed ? projected : events;
}
