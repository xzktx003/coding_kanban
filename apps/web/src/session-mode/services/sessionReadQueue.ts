type Lane = "recent" | "history" | "status";
export type SessionReadPriority = "interactive" | "background";
type Job = {
  key: string;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  dispose?: () => void;
  priority: SessionReadPriority;
};
const lanes: Record<
  Lane,
  {
    active: number;
    background: number;
    burst: number;
    limit: number;
    jobs: Job[];
  }
> = {
  // Reserve one of the former four recent-read slots for lightweight queue
  // receipts. A valid 120s history read must not consume their entire 5s budget.
  // Total admission remains six, with no additional transcript concurrency.
  recent: { active: 0, background: 0, burst: 0, limit: 3, jobs: [] },
  history: { active: 0, background: 0, burst: 0, limit: 2, jobs: [] },
  status: { active: 0, background: 0, burst: 0, limit: 1, jobs: [] },
};
const pending = new Map<string, { promise: Promise<unknown>; job: Job }>();

/** All transcript readers, including mounted grids, share the same limits. */
export function enqueueSessionRead<T>(
  lane: Lane,
  key: string,
  run: () => Promise<T>,
  signal?: AbortSignal,
  priority: SessionReadPriority = "interactive",
): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const identity = `${lane}:${key}`;
  const existing = pending.get(identity);
  if (existing) {
    if (priority === "interactive") promoteSessionRead(lane, key);
    return existing.promise as Promise<T>;
  }
  let job!: Job;
  const promise = new Promise<T>((resolve, reject) => {
    job = {
      key: identity,
      run,
      resolve: resolve as Job["resolve"],
      reject,
      priority,
    };
    lanes[lane].jobs.push(job);
  });
  pending.set(identity, { promise, job });
  if (signal) {
    const cancel = () => {
      // A fresh read must never join an already cancelled operation, including
      // before the active operation's rejection reaches its finally callback.
      if (pending.get(identity)?.job === job) pending.delete(identity);
      const index = lanes[lane].jobs.indexOf(job);
      if (index < 0) return; // Started reads retain their own deadline/abort handling.
      lanes[lane].jobs.splice(index, 1);
      job.dispose?.();
      job.reject(
        signal.reason ?? new DOMException("Read cancelled", "AbortError"),
      );
    };
    job.dispose = () => signal.removeEventListener("abort", cancel);
    signal.addEventListener("abort", cancel, { once: true });
  }
  pump(lane);
  return promise;
}
/** Promotion changes only an owned queued read, never cancels other consumers. */
export function promoteSessionRead(lane: Lane, key: string) {
  const job = pending.get(`${lane}:${key}`)?.job;
  if (job) {
    job.priority = "interactive";
    pump(lane);
  }
}
function pump(lane: Lane) {
  const state = lanes[lane];
  while (state.active < state.limit && state.jobs.length) {
    const foreground = state.jobs.findIndex(
      (job) => job.priority === "interactive",
    );
    // Leave capacity in each transcript lane for explicit reads. The recent
    // lane retains two slots for overlapping old/new foreground selections.
    // After three foreground admissions a waiting background job gets a turn.
    const background =
      lane !== "status" && state.background >= 1
        ? -1
        : state.jobs.findIndex((job) => job.priority === "background");
    const index =
      background >= 0 && (foreground < 0 || state.burst >= 3)
        ? background
        : foreground;
    if (index < 0) break;
    const [job] = state.jobs.splice(index, 1);
    const wasBackground = job.priority === "background";
    state.burst = wasBackground ? 0 : Math.min(3, state.burst + 1);
    if (wasBackground) state.background++;
    state.active++;
    let result: Promise<unknown>;
    try {
      result = job.run();
    } catch (error) {
      result = Promise.reject(error);
    }
    Promise.resolve(result)
      .then(job.resolve, job.reject)
      .finally(() => {
        job.dispose?.();
        if (pending.get(job.key)?.job === job) pending.delete(job.key);
        state.active--;
        if (wasBackground) state.background--;
        pump(lane);
      });
  }
}

/** Also settles transports which ignore abort, so a worker cannot hang forever. */
export function readWithDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
  parent?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parent?.removeEventListener("abort", cancel);
      if (error !== undefined) reject(error);
      else resolve(value as T);
    };
    const cancel = () => {
      const reason =
        parent?.reason ?? new DOMException("Read cancelled", "AbortError");
      controller.abort(reason);
      finish(reason);
    };
    if (parent?.aborted) {
      cancel();
      return;
    }
    parent?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => {
      const reason = new DOMException("Read timed out", "TimeoutError");
      controller.abort(reason);
      finish(reason);
    }, milliseconds);
    // Invoke synchronously: callers can capture the original view before awaiting.
    try {
      Promise.resolve(run(controller.signal)).then(
        (value) => finish(undefined, value),
        (error) => finish(error),
      );
    } catch (error) {
      finish(error);
    }
  });
}
