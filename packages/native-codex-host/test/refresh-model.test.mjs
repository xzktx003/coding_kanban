import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRefreshModelFixture } from "./fixtures/refresh-model.mjs";
import { createNativeClient } from "../refresh-prototype/native-client.mjs";
import { verifyControlSocket } from "../refresh-prototype/cli-bridge.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await pause(25);
  }
  throw Error(label);
}

test(
  "held fixture emits bounded progress events and completes only after release",
  { timeout: 10000 },
  async (t) => {
    const model = await createRefreshModelFixture();
    t.after(() => model.close());
    const response = await fetch(model.url + "/responses", {
      method: "POST",
      body: JSON.stringify({
        input: [{ role: "user", content: "REFRESH_RUNNING" }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    assert.match(initial, /response.created/);
    const progress = new TextDecoder().decode((await reader.read()).value);
    assert.match(progress, /response.in_progress/);
    assert.ok(progress.length < 256);
    assert.doesNotMatch(progress, /output_item|output_text|response.completed/);
    model.release();
    let remaining = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      remaining += new TextDecoder().decode(value);
      assert.ok(remaining.length < 4096);
    }
    assert.equal(remaining.match(/response.completed/g)?.length, 1);
    assert.equal(model.calls.length, 1);
  },
);

test(
  "matching native turn outlives several SSE idle deadlines without retry or duplicate output",
  {
    skip: !process.env.NATIVE_CODEX_REFRESH_CLI,
    timeout: 25000,
  },
  async (t) => {
    const binary = process.env.NATIVE_CODEX_REFRESH_CLI;
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(binary)) hash.update(bytes);
    assert.equal(
      hash.digest("hex"),
      "73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4",
    );
    const root = await mkdtemp(join(tmpdir(), "ck-model-stream-"));
    const model = await createRefreshModelFixture();
    let server, client;
    t.after(async () => {
      model.release();
      await client?.close().catch(() => {});
      if (server && server.exitCode === null && server.signalCode === null) {
        const exited = once(server, "exit");
        server.kill("SIGTERM");
        const timer = setTimeout(() => {
          if (server.exitCode === null && server.signalCode === null)
            server.kill("SIGKILL");
        }, 3000);
        try {
          await exited;
        } finally {
          clearTimeout(timer);
        }
      }
      await model.close();
      await rm(root, { recursive: true, force: true });
    });
    for (const name of [
      "home",
      "cli",
      "tmp",
      "config",
      "data",
      "cache",
      "project",
    ])
      await mkdir(join(root, name), { mode: 0o700 });
    await writeFile(
      join(root, "cli/config.toml"),
      `model="acceptance-model"\nmodel_provider="acceptance"\n[model_providers.acceptance]\nname="Private refresh stream fixture"\nbase_url="${model.url}"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\nstream_idle_timeout_ms=1500\n`,
      { mode: 0o600 },
    );
    const cwd = join(root, "project"),
      socketPath = join(root, "control.sock");
    server = spawn(binary, ["app-server", "--listen", `unix://${socketPath}`], {
      cwd,
      env: {
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
        HOME: join(root, "home"),
        CODEX_HOME: join(root, "cli"),
        TMPDIR: join(root, "tmp"),
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_CACHE_HOME: join(root, "cache"),
        XDG_DATA_HOME: join(root, "data"),
        DO_NOT_TRACK: "1",
        OTEL_SDK_DISABLED: "true",
        NO_PROXY: "127.0.0.1,localhost,::1",
      },
      stdio: "ignore",
    });
    await until(async () => {
      assert.equal(server.exitCode, null);
      try {
        await lstat(socketPath);
        return true;
      } catch {
        return false;
      }
    }, "Own native listener missing");
    await verifyControlSocket(socketPath);
    const events = [];
    client = createNativeClient({
      socketPath,
      name: "refresh_stream_liveness",
      onLifecycle: (e) => {
        assert.ok(events.length < 128);
        events.push(e);
      },
    });
    await client.ready;
    const { thread } = await client.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    const { turn } = await client.request("turn/start", {
      threadId: thread.id,
      input: [{ type: "text", text: "REFRESH_RUNNING", text_elements: [] }],
    });
    await until(() => model.calls.length === 1, "Own provider request missing");
    await pause(4500);
    const held = (
      await client.request("thread/read", {
        threadId: thread.id,
        includeTurns: true,
      })
    ).thread;
    assert.equal(held.status.type, "active");
    assert.equal(held.turns.length, 1);
    assert.equal(held.turns[0].id, turn.id);
    assert.equal(held.turns[0].status, "inProgress");
    model.release();
    await until(
      () =>
        events.find(
          (e) => e.method === "turn/completed" && e.turnId === turn.id,
        ),
      "Original turn completion missing",
    );
    const completed = (
      await client.request("thread/read", {
        threadId: thread.id,
        includeTurns: true,
      })
    ).thread;
    assert.equal(completed.turns.length, 1);
    assert.equal(completed.turns[0].id, turn.id);
    assert.equal(completed.turns[0].status, "completed");
    assert.equal(
      completed.turns[0].items.filter(
        (i) => i.type === "agentMessage" && i.text === "REFRESH_RUNNING_DONE",
      ).length,
      1,
    );
    assert.equal(model.calls.length, 1);
  },
);
