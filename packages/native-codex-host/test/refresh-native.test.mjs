import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, lstat, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import {
  connectStdio,
  verifyControlSocket,
} from "../refresh-prototype/cli-bridge.mjs";

test(
  "matching real native server keeps one authority across independent connection IDs and client exit",
  { skip: !process.env.NATIVE_CODEX_REFRESH_CLI, timeout: 20000 },
  async (t) => {
    const binary = process.env.NATIVE_CODEX_REFRESH_CLI;
    assert.equal(
      createHash("sha256")
        .update(await readFile(binary))
        .digest("hex"),
      "73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4",
    );
    const root = await mkdtemp(join(tmpdir(), "ck-rn-"));
    for (const name of [
      "home",
      "cli",
      "tmp",
      "project",
      "config",
      "data",
      "cache",
    ])
      await mkdir(join(root, name), { mode: 0o700 });
    const socketPath = join(root, "control.sock");
    const env = {
      PATH: process.env.PATH,
      LANG: "C.UTF-8",
      HOME: join(root, "home"),
      CODEX_HOME: join(root, "cli"),
      TMPDIR: join(root, "tmp"),
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_CACHE_HOME: join(root, "cache"),
      DO_NOT_TRACK: "1",
      OTEL_SDK_DISABLED: "true",
    };
    const server = spawn(
      binary,
      ["app-server", "--listen", `unix://${socketPath}`],
      { cwd: join(root, "project"), env, stdio: "ignore" },
    );
    const clients = [];
    t.after(async () => {
      for (const client of clients) {
        client.input.end();
        await client.connection.done.catch(() => {});
      }
      if (server.exitCode === null && server.signalCode === null) {
        const exited = once(server, "exit");
        server.kill("SIGTERM");
        const timer = setTimeout(() => {
          if (server.exitCode === null && server.signalCode === null)
            server.kill("SIGKILL");
        }, 3000);
        await exited;
        clearTimeout(timer);
      }
      await rm(root, { recursive: true, force: true });
    });
    for (let i = 0; ; i++) {
      try {
        await lstat(socketPath);
        break;
      } catch {}
      assert.ok(
        i < 100 && server.exitCode === null,
        "owned native listener failed",
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    await verifyControlSocket(socketPath);
    async function client(name) {
      const input = new PassThrough(),
        output = new PassThrough();
      const connection = connectStdio({ socketPath, input, output });
      const waiting = new Map();
      let next = 0;
      createInterface({ input: output }).on("line", (line) => {
        const message = JSON.parse(line),
          waiter = waiting.get(message.id);
        if (!waiter) return;
        waiting.delete(message.id);
        clearTimeout(waiter.timer);
        message.error
          ? waiter.reject(new Error(message.error.message))
          : waiter.resolve(message.result);
      });
      const rpc = (method, params) =>
        new Promise((resolve, reject) => {
          const id = ++next;
          const timer = setTimeout(() => {
            waiting.delete(id);
            reject(new Error(`native ${method} timed out`));
          }, 5000);
          waiting.set(id, { resolve, reject, timer });
          input.write(JSON.stringify({ id, method, params }) + "\n");
        });
      const value = { input, output, connection, rpc };
      clients.push(value);
      await connection.ready;
      await rpc("initialize", {
        clientInfo: { name, version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      input.write('{"method":"initialized"}\n');
      return value;
    }
    const keeper = await client("refresh_native_keeper");
    const a = await client("refresh_native_a"),
      b = await client("refresh_native_b");
    // Both independent clients issue request id=2, but the server preserves each response.
    const [created, listed] = await Promise.all([
      keeper.rpc("thread/start", {
        cwd: join(root, "project"),
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
      }),
      a.rpc("thread/loaded/list", {}),
    ]);
    assert.equal(created.thread.cwd, join(root, "project"));
    assert.ok(Array.isArray(listed.data));
    const shared = await b.rpc("thread/loaded/list", {});
    assert.ok(shared.data.includes(created.thread.id));
    a.input.end();
    await a.connection.done;
    assert.equal(server.exitCode, null);
    const after = await b.rpc("thread/loaded/list", {});
    assert.ok(after.data.includes(created.thread.id));
    const unsubscribed = await keeper.rpc("thread/unsubscribe", {
      threadId: created.thread.id,
    });
    assert.equal(unsubscribed.status, "unsubscribed");
    // An explicit unsubscribe is not a stop. The server remains reachable;
    // native idle unload latency and active/approval races need separate proof.
    assert.ok(Array.isArray((await b.rpc("thread/loaded/list", {})).data));
    assert.equal(server.exitCode, null);
  },
);
