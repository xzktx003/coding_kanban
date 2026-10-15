import { authHeaders, buildUrl } from "@session/hooks/runtime";
import { openEventStream } from "@session/lib/eventStream";
import { usePairingStore } from "@session/stores/usePairingStore";

// This is an observed browser generation, never a server epoch or writer lease.
export type CommandDetailTarget = {
  threadId: string;
  turnId: string;
  itemId: string;
  expectedType: "commandExecution";
};
export type CommandDetailItem = {
  type: "commandExecution";
  id: string;
  command: string;
  cwd: string;
  status: "inProgress" | "completed" | "failed" | "declined";
  aggregatedOutput: string | null;
  exitCode: number | null;
  durationMs: number | null;
  [field: string]: unknown;
};
export type CommandDetailFailure = "busy" | "identity" | "incomplete";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const validId = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 512 &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(v);
const finiteOrNull = (v: unknown) =>
  v === null || (typeof v === "number" && Number.isFinite(v));
function validated(
  value: unknown,
  target: CommandDetailTarget,
): CommandDetailItem {
  if (
    !record(value) ||
    value.threadId !== target.threadId ||
    value.turnId !== target.turnId ||
    value.itemId !== target.itemId ||
    !record(value.item)
  )
    throw Error("incomplete");
  const i = value.item;
  if (
    i.id !== target.itemId ||
    i.type !== target.expectedType ||
    typeof i.command !== "string" ||
    typeof i.cwd !== "string" ||
    typeof i.status !== "string" ||
    !["inProgress", "completed", "failed", "declined"].includes(i.status) ||
    (i.aggregatedOutput !== null && typeof i.aggregatedOutput !== "string") ||
    !finiteOrNull(i.exitCode) ||
    (i.exitCode !== null && !Number.isSafeInteger(i.exitCode)) ||
    !finiteOrNull(i.durationMs) ||
    (typeof i.durationMs === "number" && i.durationMs < 0)
  )
    throw Error("incomplete");
  return i as CommandDetailItem;
}
type Owner = { invalidate: () => void };
type Job = {
  key: string;
  abort: AbortController;
  consumers: Map<
    Owner,
    {
      success: (item: CommandDetailItem) => void;
      failure: (kind: CommandDetailFailure) => void;
    }
  >;
};
const owners = new Set<Owner>();
let job: Job | null = null,
  deviceGeneration = 0,
  runtimeGeneration = 0,
  stopSignals: (() => void) | null = null;
const path = "/api/codex/thread/item-detail";
function invalidate(device = false) {
  if (device) deviceGeneration++;
  else runtimeGeneration++;
  job?.abort.abort();
  for (const owner of [...owners]) owner.invalidate();
}
function watchSignals() {
  if (stopSignals) return;
  const stopStream = openEventStream({
    agents: ["codex"],
    label: "explicit-command-detail",
    onResync: () => invalidate(),
    onEvent: (event) => {
      if (event.event === "codex:disconnected") invalidate();
    },
  });
  const restart = () => invalidate();
  const hidden = () => {
    if (document.visibilityState === "hidden") invalidate();
  };
  window.addEventListener("session-runtime-restarted", restart);
  document.addEventListener("visibilitychange", hidden);
  const stopPairing = usePairingStore.subscribe((state, previous) => {
    const a = state.desktops.find((d) => d.host === state.selectedHost),
      b = previous.desktops.find((d) => d.host === previous.selectedHost);
    if (
      state.selectedHost !== previous.selectedHost ||
      a?.host !== b?.host ||
      a?.port !== b?.port ||
      a?.token !== b?.token
    )
      invalidate(true);
  });
  stopSignals = () => {
    stopStream();
    stopPairing();
    window.removeEventListener("session-runtime-restarted", restart);
    document.removeEventListener("visibilitychange", hidden);
    stopSignals = null;
  };
}
/** Only live owners are coordinated. No completed body, promise, or serialized copy cache. */
export function openCommandDetail(
  target: CommandDetailTarget,
  callbacks: {
    success: (item: CommandDetailItem) => void;
    failure: (kind: CommandDetailFailure) => void;
    invalidate: () => void;
  },
): () => void {
  if (
    !validId(target.threadId) ||
    !validId(target.turnId) ||
    !validId(target.itemId) ||
    target.expectedType !== "commandExecution"
  ) {
    callbacks.failure("identity");
    return () => {};
  }
  const url = buildUrl(path),
    headers = authHeaders();
  const device = deviceGeneration,
    runtime = runtimeGeneration;
  const key = JSON.stringify([
    device,
    runtime,
    target.threadId,
    target.turnId,
    target.itemId,
    target.expectedType,
  ]);
  if (job && (job.key !== key || job.abort.signal.aborted)) {
    callbacks.failure("busy");
    return () => {};
  }
  const owner: Owner = {
    invalidate: () => {
      release();
      callbacks.invalidate();
    },
  };
  const release = () => {
    owners.delete(owner);
    if (job?.consumers.delete(owner) && !job.consumers.size) job.abort.abort();
    if (!owners.size) stopSignals?.();
  };
  owners.add(owner);
  watchSignals();
  if (job) {
    job.consumers.set(owner, callbacks);
    return release;
  }
  const current: Job = {
    key,
    abort: new AbortController(),
    consumers: new Map([[owner, callbacks]]),
  };
  job = current;
  // URL and authentication are captured together synchronously at activation.
  void (async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(target),
        signal: current.abort.signal,
        cache: "no-store",
      });
      if (!response.ok)
        throw Error(response.status === 429 ? "busy" : "incomplete");
      const value = await response.json();
      if (
        current.abort.signal.aborted ||
        deviceGeneration !== device ||
        runtimeGeneration !== runtime ||
        url !== buildUrl(path) ||
        headers.Authorization !== authHeaders().Authorization
      )
        throw Error("incomplete");
      const item = validated(value, target);
      if (job === current) job = null;
      for (const [consumer, callback] of current.consumers)
        if (owners.has(consumer)) callback.success(item);
    } catch (error) {
      if (job === current) job = null;
      for (const [consumer, callback] of [...current.consumers])
        if (owners.has(consumer)) {
          owners.delete(consumer);
          callback.failure(
            error instanceof Error && error.message === "busy"
              ? "busy"
              : "incomplete",
          );
        }
    } finally {
      if (job === current) job = null;
      current.consumers.clear();
      if (!owners.size) stopSignals?.();
    }
  })();
  return release;
}
