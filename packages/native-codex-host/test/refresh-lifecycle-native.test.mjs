import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  lstat,
  readFile,
  rm,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { createRefreshModelFixture } from "./fixtures/refresh-model.mjs";
import { createNativeClient } from "../refresh-prototype/native-client.mjs";
import { verifyControlSocket } from "../refresh-prototype/cli-bridge.mjs";
import { createThreadPool } from "../refresh-prototype/thread-pool.mjs";
import { createNativePoolAdapter } from "../refresh-prototype/native-pool-adapter.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  for (let n = 0; n < 300; n++) {
    const result = await check();
    if (result) return result;
    await delay(25);
  }
  throw new Error(`Native lifecycle timeout: ${label}`);
}

test(
  "matching native preserves a real turn across client exit and replays one pending approval to a new connection",
  {
    skip: !process.env.NATIVE_CODEX_REFRESH_CLI,
    timeout: 45000,
  },
  async (t) => {
    const binary = process.env.NATIVE_CODEX_REFRESH_CLI;
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(binary)) hash.update(bytes);
    assert.equal(
      hash.digest("hex"),
      "73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4",
    );
    const root = await mkdtemp(join(tmpdir(), "ck-life-"));
    const model = await createRefreshModelFixture();
    const clients = [];
    let server;
    t.after(async () => {
      model.release();
      for (const client of clients) await client.close().catch(() => {});
      if (server && server.exitCode === null && server.signalCode === null) {
        const exited = once(server, "exit");
        server.kill("SIGTERM");
        const timer = setTimeout(() => {
          if (server.exitCode === null && server.signalCode === null)
            server.kill("SIGKILL");
        }, 3000);
        await exited;
        clearTimeout(timer);
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
      `model = "acceptance-model"\nmodel_provider = "acceptance"\nmodel_reasoning_effort = "high"\napproval_policy = "on-request"\nsandbox_mode = "read-only"\n[model_providers.acceptance]\nname = "Private refresh lifecycle fixture"\nbase_url = "${model.url}"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`,
      { mode: 0o600 },
    );
    const socketPath = join(root, "control.sock"),
      cwd = join(root, "project");
    server = spawn(
      binary,
      [
        "app-server",
        "--listen",
        `unix://${socketPath}`,
        "-c",
        "thread_unload_delay_secs=1",
      ],
      {
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
      },
    );
    await until(async () => {
      try {
        await lstat(socketPath);
        return true;
      } catch {
        assert.equal(server.exitCode, null);
        return false;
      }
    }, "listener");
    await verifyControlSocket(socketPath);
    const client = async (name) => {
      const events = [];
      const connection = createNativeClient({
        socketPath,
        name,
        onLifecycle: (event) => {
          events.push(event);
          if (events.length > 128) events.shift();
        },
      });
      clients.push(connection);
      await connection.ready;
      return { ...connection, events };
    };
    const a = await client("refresh_origin");
    let keeper = await client("refresh_keeper");
    const running = await a.request("thread/start", {
      cwd,
      approvalPolicy: "on-request",
      sandbox: "read-only",
    });
    const threadId = running.thread.id;
    const started = await a.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "REFRESH_RUNNING", text_elements: [] }],
    });
    await until(
      () => model.calls.some((call) => call.mode === "running"),
      "actual local model request",
    );
    await keeper.request("thread/resume", { threadId, excludeTurns: true });
    await a.close();
    assert.equal(
      (await keeper.request("thread/unsubscribe", { threadId })).status,
      "unsubscribed",
    );
    await delay(1300);
    assert.equal(
      (await keeper.request("thread/read", { threadId, includeTurns: false }))
        .thread.status.type,
      "active",
    );
    assert.equal(server.exitCode, null);
    assert.ok(
      (await keeper.request("thread/loaded/list", {})).data.includes(threadId),
    );
    await keeper.request("thread/resume", { threadId, excludeTurns: true });
    model.release();
    await until(
      () =>
        keeper.events.some(
          (event) =>
            event.method === "turn/completed" &&
            event.turnId === started.turn.id,
        ),
      "running completion",
    );
    const history = await keeper.request("thread/read", {
      threadId,
      includeTurns: true,
    });
    assert.equal(history.thread.turns.length, 1);
    assert.equal(
      (await keeper.request("thread/unsubscribe", { threadId })).status,
      "unsubscribed",
    );
    await until(
      async () =>
        !(await keeper.request("thread/loaded/list", {})).data.includes(
          threadId,
        ),
      "native idle unload after last subscriber leaves",
    );
    const cold = await keeper.request("thread/resume", {
      threadId,
      excludeTurns: true,
    });
    assert.equal(cold.thread.id, threadId);
    assert.equal(cold.model, "acceptance-model");
    assert.equal(cold.cwd, cwd);
    assert.equal(cold.reasoningEffort, "high");
    const stale = await keeper.request("thread/resume", {
      threadId,
      excludeTurns: true,
      model: "stale-old-model",
      cwd: root,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      config: { model_reasoning_effort: "low" },
    });
    for (const field of [
      "model",
      "modelProvider",
      "cwd",
      "approvalPolicy",
      "sandbox",
      "reasoningEffort",
    ])
      assert.deepEqual(
        stale[field],
        cold[field],
        `subscribed context preserves native ${field}`,
      );
    assert.equal(
      (await keeper.request("thread/read", { threadId, includeTurns: true }))
        .thread.turns.length,
      1,
    );

    const approval = await keeper.request("thread/start", {
      cwd,
      approvalPolicy: "on-request",
      sandbox: "read-only",
    });
    const approvalId = approval.thread.id;
    await keeper.request("turn/start", {
      threadId: approvalId,
      input: [{ type: "text", text: "REFRESH_APPROVAL", text_elements: [] }],
    });
    const request = await until(
      () =>
        keeper.events.find(
          (event) =>
            event.method === "item/commandExecution/requestApproval" &&
            event.threadId === approvalId,
        ),
      "real command approval",
    );
    await keeper.close();
    await delay(1300);
    const b = await client("refresh_late_client");
    await b.request("thread/resume", {
      threadId: approvalId,
      excludeTurns: true,
    });
    const replay = await until(
      () =>
        b.events.find(
          (event) =>
            event.method === request.method && event.threadId === approvalId,
        ),
      "approval replay",
    );
    assert.equal(replay.requestId, request.requestId);
    assert.equal(replay.turnId, request.turnId);
    await delay(1300);
    assert.equal(
      (
        await b.request("thread/read", {
          threadId: approvalId,
          includeTurns: false,
        })
      ).thread.status.type,
      "active",
    );
    keeper = await client("refresh_recovered_manager");
    await keeper.request("thread/resume", {
      threadId: approvalId,
      excludeTurns: true,
    });
    const managerReplay = await until(
      () =>
        keeper.events.find(
          (event) =>
            event.method === request.method && event.threadId === approvalId,
        ),
      "manager approval replay",
    );
    assert.equal(managerReplay.requestId, request.requestId);
    // Both actual protocol clients resolve the same native request concurrently.
    // Native must execute its one tool item once and preserve one completion.
    keeper.reply(request.requestId, { decision: "accept" });
    b.reply(replay.requestId, { decision: "accept" });
    await until(
      async () =>
        (
          await b.request("thread/read", {
            threadId: approvalId,
            includeTurns: false,
          })
        ).thread.status.type === "idle",
      "approval completion",
    );
    assert.equal(
      await readFile(join(cwd, "approval-count.txt"), "utf8"),
      "APPROVED\n",
    );
    assert.equal(
      model.calls.filter((call) => call.mode === "approval" && call.afterTool)
        .length,
      1,
    );
    assert.equal(
      (
        await b.request("thread/read", {
          threadId: approvalId,
          includeTurns: true,
        })
      ).thread.turns.length,
      1,
    );
    await b.close();
    await keeper.request("thread/unsubscribe", { threadId });
    await keeper.request("thread/unsubscribe", { threadId: approvalId });
    await until(
      async () =>
        (await keeper.request("thread/loaded/list", {})).data.length === 0,
      "fixture contexts idle cleanup",
    );
    const generation = randomUUID(),
      domain = randomUUID();
    const readRss = async () => {
      assert.equal(server.exitCode, null);
      const status = await readFile(`/proc/${server.pid}/status`, "utf8");
      assert.equal(server.exitCode, null);
      const match = status.match(/^VmRSS:\s+(\d+) kB$/m);
      assert.ok(match);
      return Number(match[1]) * 1024;
    };
    const adapter = createNativePoolAdapter({
      client: keeper,
      domain,
      generation,
      readRss,
      cliVersion: "0.162.0-alpha.17.2",
      cliSha256:
        "73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4",
    });
    const background = await keeper.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    });
    const backgroundId = background.thread.id;
    const backgroundTurn = await keeper.request("turn/start", {
      threadId: backgroundId,
      input: [{ type: "text", text: "REFRESH_BACKGROUND", text_elements: [] }],
    });
    await until(
      () =>
        keeper.events.some(
          (event) =>
            event.method === "turn/completed" &&
            event.turnId === backgroundTurn.turn.id,
        ),
      "background turn completion",
    );
    const terminals = await keeper.request("thread/backgroundTerminals/list", {
      threadId: backgroundId,
      limit: 1,
    });
    assert.equal(terminals.data.length, 1);
    const backgroundKey = { domain, generation, threadId: backgroundId, cwd };
    assert.notEqual((await adapter.probe(backgroundKey)).status, "idle");
    assert.equal((await adapter.unsubscribe(backgroundKey)).protected, true);
    await until(async () => {
      try {
        return (
          (await readFile(join(cwd, "background-proof.txt"), "utf8")) ===
          "BACKGROUND_DONE"
        );
      } catch {
        return false;
      }
    }, "protected actual background command completion");
    await until(
      async () => (await adapter.probe(backgroundKey)).status === "idle",
      "background resources idle",
    );
    assert.deepEqual(await adapter.unsubscribe(backgroundKey), {
      released: true,
    });
    const pool = createThreadPool({
      domain,
      generation,
      adapter,
      idleLimit: 10,
      memoryBudgetBytes: 2 * 1024 ** 3,
    });
    const keys = [],
      rss = { empty: await readRss() };
    for (let index = 0; index < 11; index++) {
      const opened = await keeper.request("thread/start", {
        cwd,
        approvalPolicy: "on-request",
        sandbox: "read-only",
      });
      const key = { domain, generation, threadId: opened.thread.id, cwd };
      const turn = await keeper.request("turn/start", {
        threadId: key.threadId,
        input: [{ type: "text", text: "REFRESH_IDLE", text_elements: [] }],
      });
      await until(
        () =>
          keeper.events.some(
            (event) =>
              event.method === "turn/completed" &&
              event.turnId === turn.turn.id,
          ),
        "warm pool seed completion",
      );
      await pool.retain(key);
      keys.push(key);
      if (index === 0) rss.one = await readRss();
      if (index === 9) rss.ten = await readRss();
    }
    rss.eleven = await readRss();
    pool.touch(keys[0].threadId);
    const callsBefore = model.calls.length;
    await pool.trim();
    assert.equal(pool.snapshot().entries.length, 10);
    assert.equal(pool.snapshot().warmAdmission, true);
    const loaded = (await keeper.request("thread/loaded/list", {})).data;
    assert.equal(loaded.length, 10);
    assert.equal(
      loaded.includes(keys[1].threadId),
      false,
      "only actual native idle LRU is evicted",
    );
    assert.ok(loaded.includes(keys[0].threadId));
    const restored = await pool.retain(keys[1]);
    assert.equal(restored.threadId, keys[1].threadId);
    assert.equal(
      (
        await keeper.request("thread/read", {
          threadId: keys[1].threadId,
          includeTurns: true,
        })
      ).thread.turns.length,
      1,
    );
    assert.equal(
      model.calls.length,
      callsBefore,
      "retention, release and cold history recovery must not start model work",
    );
    await pool.trim();
    assert.equal(
      (await keeper.request("thread/loaded/list", {})).data.length,
      10,
    );
    assert.equal(pool.snapshot().entries.length, 10);
    rss.afterColdRestore = await readRss();
    t.diagnostic(
      JSON.stringify({
        nativeRssBytes: rss,
        localModelCalls: model.calls.length,
        remoteModelCalls: 0,
        fixtureBudgetBytes: 2 * 1024 ** 3,
      }),
    );
  },
);
