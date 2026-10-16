// Isolated acceptance client for the actual generated CLI wrapper, never a renderer.
import { spawn } from "node:child_process";
export async function startRefreshStdioClient(executable, name) {
  const child = spawn(
      executable,
      ["app-server", "--analytics-default-enabled"],
      { stdio: ["pipe", "pipe", "pipe"] },
    ),
    pending = new Map();
  let partial = Buffer.alloc(0),
    ended = false,
    stderrBytes = 0,
    resolveClosed;
  const closed = new Promise((r) => (resolveClosed = r));
  const rejectPending = () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(Error("fixture wrapper closed"));
    }
    pending.clear();
  };
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
  };
  child.stderr.on("data", (bytes) => {
    stderrBytes += bytes.length;
    if (stderrBytes > 8192) stop();
  });
  child.on("error", () => {
    ended = true;
    rejectPending();
    resolveClosed({ code: null, error: true });
  });
  child.once("exit", (code, signal) => {
    ended = true;
    rejectPending();
    resolveClosed({ code, signal });
  });
  child.stdout.on("data", (bytes) => {
    partial = Buffer.concat([partial, bytes]);
    if (partial.length > 2 * 1024 * 1024) {
      stop();
      return;
    }
    let end;
    while ((end = partial.indexOf(10)) >= 0) {
      const line = partial.subarray(0, end);
      partial = partial.subarray(end + 1);
      let message;
      try {
        message = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(line),
        );
      } catch {
        stop();
        return;
      }
      if (message.method) continue;
      const entry = pending.get(message.id);
      if (!entry) continue;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(Error("fixture native request failed"));
      else entry.resolve(message.result);
    }
    if (!partial.length) partial = Buffer.alloc(0);
  });
  const request = (id, method, params) => {
    if (ended || pending.has(id) || pending.size >= 32)
      return Promise.reject(Error("bounded live fixture request required"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("fixture native request timed out"));
        stop();
      }, 10000);
      timer.unref();
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  };
  const client = {
    request,
    closed,
    cancel: stop,
    async close() {
      if (!ended) child.stdin.end();
      const timer = setTimeout(stop, 5000);
      timer.unref();
      try {
        await closed;
      } finally {
        clearTimeout(timer);
      }
    },
  };
  child.stdin.on("error", () => {});
  try {
    await request(1, "initialize", {
      clientInfo: { name, version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write('{"method":"initialized"}\n');
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}
