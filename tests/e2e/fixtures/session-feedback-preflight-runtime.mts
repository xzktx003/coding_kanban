import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Json, JsonObject } from "../../../packages/session-runtime/src/core/json";
import type { createRuntimePreflightFixture as createLocalFixture } from "./session-feedback-preflight-runtime-core.mts";
import { ACCOUNT_RESPONSE } from "./session-feedback-preflight-runtime-core.mts";
export { ACCOUNT_RESPONSE, RUNTIME_INSTANCE } from "./session-feedback-preflight-runtime-core.mts";

type Fixture = Awaited<ReturnType<typeof createLocalFixture>>;
type Snapshot = ReturnType<Fixture["snapshot"]>;
type Cleanup = Awaited<ReturnType<Fixture["close"]>>;
type WorkerCleanup = Cleanup & {
  fixtureProcess: { pid: number; exited: boolean; code: number | null; signal: NodeJS.Signals | null };
};

/**
 * Playwright can import shared JS through both its CJS and ESM hooks, while
 * its in-memory transform cache is keyed by filename. Keep the production
 * handler outside those hooks in an owned tsx process. No listener, native
 * process, real account, login home or feedback upload is created.
 */
export async function createRuntimePreflightFixture(thread: JsonObject) {
  const home = await mkdtemp(join(tmpdir(), "feedback-preflight-worker-"));
  const localRequire = createRequire(resolve(process.cwd(), "packages/session-runtime/package.json"));
  const child = fork(fileURLToPath(new URL("./session-feedback-preflight-runtime-worker.mts", import.meta.url)), [], {
    execArgv: ["--import", localRequire.resolve("tsx")],
    env: { PATH: process.env.PATH, HOME: home, SESSION_DATA_HOME: join(home, "data") },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "", sequence = 0, exited = false;
  let exitCode: number | null = null, exitSignal: NodeJS.Signals | null = null;
  let snapshot: Snapshot | undefined;
  let closeWork: Promise<WorkerCleanup> | undefined;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const exitedPromise = new Promise<void>(done => child.once("exit", (code, signal) => { exited = true; exitCode = code; exitSignal = signal; done(); }));
  const fail = (message: string) => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
    pending.clear();
  };
  child.stdout?.on("data", chunk => { output = (output + String(chunk)).slice(-16_384); });
  child.stderr?.on("data", chunk => { output = (output + String(chunk)).slice(-16_384); });
  child.once("error", error => fail(`Owned preflight worker failed: ${error.message}`));
  child.once("exit", (code, signal) => fail(`Owned preflight worker exited (${code ?? signal}): ${output}`));
  child.on("message", (message: any) => {
    if (!message || !Number.isSafeInteger(message.id)) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(String(message.error)));
    else { if (message.snapshot) snapshot = message.snapshot; request.resolve(message.value); }
  });
  const call = (operation: "initialize" | "inject" | "close", body?: Json) => new Promise<any>((resolveRequest, reject) => {
    if (!child.connected || exited) return reject(new Error("Owned preflight worker is unavailable"));
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Owned preflight worker ${operation} deadline exceeded`)); }, 10_000);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    child.send({ id, operation, body }, error => {
      if (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  });
  const stopOwnedChild = async () => {
    if (!exited) child.kill("SIGTERM");
    await exitedPromise;
    await rm(home, { recursive: true, force: true });
  };
  try { await call("initialize", thread); }
  catch (error) { await stopOwnedChild(); throw error; }
  return {
    accountResponse: ACCOUNT_RESPONSE,
    async inject(body: Json) { return call("inject", body) as ReturnType<Fixture["inject"]>; },
    snapshot() { if (!snapshot) throw new Error("Owned preflight worker is not initialized"); return structuredClone(snapshot); },
    close() {
      if (closeWork) return closeWork;
      closeWork = (async () => {
        let result: Cleanup;
        try { result = await call("close") as Cleanup; }
        finally { await stopOwnedChild(); }
        return { ...result, fixtureProcess: { pid: child.pid!, exited, code: exitCode, signal: exitSignal } };
      })();
      return closeWork;
    },
  };
}
