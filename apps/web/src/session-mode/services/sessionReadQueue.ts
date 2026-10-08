type Lane = "recent" | "history";
type Job = {
  key: string;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};
const lanes: Record<Lane, { active: number; limit: number; jobs: Job[] }> = {
  recent: { active: 0, limit: 4, jobs: [] },
  history: { active: 0, limit: 2, jobs: [] },
};
const pending = new Map<string, Promise<unknown>>();

/** All transcript readers, including mounted grids, share the same limits. */
export function enqueueSessionRead<T>(
  lane: Lane,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const identity = `${lane}:${key}`;
  const existing = pending.get(identity);
  if (existing) return existing as Promise<T>;
  const promise = new Promise<T>((resolve, reject) => {
    lanes[lane].jobs.push({
      key: identity,
      run,
      resolve: resolve as Job["resolve"],
      reject,
    });
  });
  pending.set(identity, promise);
  pump(lane);
  return promise;
}
function pump(lane: Lane) {
  const state = lanes[lane];
  while (state.active < state.limit && state.jobs.length) {
    const job = state.jobs.shift()!;
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
        pending.delete(job.key);
        state.active--;
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
