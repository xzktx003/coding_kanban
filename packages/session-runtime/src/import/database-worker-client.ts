import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
export interface ImportDatabaseOperation<T> {
  promise: Promise<T>;
  started: Promise<void>;
  cancel: () => Promise<void>;
}
/** One request per worker: only paths/counts cross the boundary, never transcript data. */
export function importDatabaseWorker<T>(
  sourcePath: string,
  targetPath?: string,
): ImportDatabaseOperation<T> {
  const compiled = new URL("./database-worker.js", import.meta.url),
    module = existsSync(compiled)
      ? compiled
      : new URL("./database-worker.ts", import.meta.url);
  const cancellation = new SharedArrayBuffer(4);
  const workerData = {
    sourcePath,
    targetPath,
    cancel: cancellation,
    module: module.href,
  };
  const worker = module.pathname.endsWith(".ts")
    ? new Worker(
        'const{workerData}=require("node:worker_threads");import("tsx/esm/api").then(({register})=>{register();return import(workerData.module)}).catch(()=>process.exit(1));',
        {
          eval: true,
          workerData,
          resourceLimits: { maxOldGenerationSizeMb: 128 },
        },
      )
    : new Worker(module, {
        workerData,
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      });
  let reportStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    reportStarted = resolve;
  });
  let result: { value: T } | { error: string } | undefined;
  let cancelRequested = false;
  const promise = new Promise<T>((resolve, reject) => {
    worker.on(
      "message",
      (message: { value?: T; error?: string; started?: boolean }) => {
        if (message.started) {
          reportStarted();
          return;
        }
        result = message.error
          ? { error: message.error }
          : { value: message.value as T };
      },
    );
    worker.on("error", () => {
      result = { error: "Import database worker failed" };
    });
    worker.on("exit", (code) => {
      reportStarted();
      if (cancelRequested && !(result && "value" in result)) {
        reject(new Error("Import cancelled"));
        return;
      }
      // A successful value is sent only after COMMIT. Cancellation arriving
      // after that boundary must not claim that the transaction rolled back.
      if (code !== 0 || !result) {
        reject(new Error("Import database worker exited before completion"));
        return;
      }
      if ("error" in result) reject(new Error(result.error));
      else resolve(result.value);
    });
  });
  return {
    promise,
    started,
    cancel: async () => {
      cancelRequested = true;
      Atomics.store(new Int32Array(cancellation), 0, 1);
      await promise.catch(() => {});
    },
  };
}
