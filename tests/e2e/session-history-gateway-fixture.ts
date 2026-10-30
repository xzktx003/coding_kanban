import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export async function historyGateway(delayMs = 900) {
  const require = createRequire(resolve("apps/server/package.json"));
  const child = spawn(
    process.execPath,
    [
      require.resolve("tsx/cli"),
      resolve("tests/e2e/session-history-gateway-server.mts"),
      String(delayMs),
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors = (errors + chunk).slice(-4000);
  });
  const pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  let ready!: (origin: string) => void;
  let rejectReady!: (error: Error) => void;
  const started = new Promise<string>((resolve, reject) => {
    ready = resolve;
    rejectReady = reject;
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.ready) ready(message.origin);
    else {
      pending.get(message.id)?.resolve(message.value);
      pending.delete(message.id);
    }
  });
  child.once("exit", (code) => {
    const error = new Error(`Owned history fixture exited ${code}: ${errors}`);
    rejectReady(error);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    lines.close();
  });
  const origin = await started;
  let sequence = 0;
  const call = (method: string) =>
    new Promise<any>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method }) + "\n");
    });
  return {
    origin,
    reads: () => call("reads"),
    requests: () => call("requests"),
    close: () => call("close"),
  };
}
