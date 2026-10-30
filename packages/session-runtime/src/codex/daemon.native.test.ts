import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { EventHub } from "../core/events.js";
import { object, type JsonObject } from "../core/json.js";
import { JsonLineRpc } from "../transport/rpc.js";
import { CodexService } from "./client.js";
import { connectDaemonStream } from "./daemon.js";
import {
  registerOwnedNativeFixture,
  cleanupOwnedNativeFixture,
  ownedDaemonIdentity,
  type OwnedNativeIdentity,
} from "./daemon-native-fixture.js";

const run = promisify(execFile);
const binary = process.env.SESSION_CODEX_DAEMON_NATIVE_BIN;
test(
  "explicit isolated official daemon shares a live task, survives a client close, and permits read-only reconnect",
  { skip: !binary, timeout: 60_000 },
  async (t) => {
    const base = await mkdtemp(join(tmpdir(), "kanban-official-native-"));
    const home = join(base, "home"),
      codexHome = join(base, "codex"),
      project = join(base, "project");
    await Promise.all(
      [home, codexHome, project].map((path) => mkdir(path, { mode: 0o700 })),
    );
    let releaseProvider!: () => void;
    let providerStarted!: () => void;
    const accepted = new Promise<void>(
      (resolve) => (providerStarted = resolve),
    );
    const held = new Promise<void>((resolve) => (releaseProvider = resolve));
    let calls = 0;
    const provider = createServer(async (request, response) => {
      for await (const _part of request) {
      }
      calls++;
      providerStarted();
      await held;
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "response.created", response: { id: "fixture-response" } },
        {
          type: "response.output_item.done",
          item: {
            type: "message",
            role: "assistant",
            id: "fixture-message",
            content: [
              { type: "output_text", text: "SHARED_DAEMON_FIXTURE_OK" },
            ],
          },
        },
        {
          type: "response.completed",
          response: {
            id: "fixture-response",
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        },
      ])
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end();
    });
    await new Promise<void>((resolve) =>
      provider.listen(0, "127.0.0.1", resolve),
    );
    const port = (provider.address() as { port: number }).port;
    await writeFile(
      join(codexHome, "config.toml"),
      `model="fixture"\nmodel_provider="fixture"\napproval_policy="never"\nsandbox_mode="read-only"\n[model_providers.fixture]\nname="Private shared daemon fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n`,
      { mode: 0o600 },
    );
    await registerOwnedNativeFixture(codexHome);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: codexHome,
      CODEX_PATH: binary!,
      HTTP_PROXY: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      NO_PROXY: "127.0.0.1,localhost",
      SESSION_CODEX_DAEMON_AUTO_START: "1",
    };
    const hub = new EventHub(),
      second = new CodexService({
        hub,
        env,
        instance: "native-shared-fixture",
        sweepIntervalMs: 0,
      });
    let first: JsonLineRpc | undefined, late: CodexService | undefined;
    let identity: OwnedNativeIdentity | undefined;
    t.after(async () => {
      releaseProvider();
      await second.close();
      await late?.close();
      await first?.close();
      hub.close();
      // Exactly this private CODEX_HOME was created by this test, with no copied account data.
      identity ??= await ownedDaemonIdentity(codexHome);
      await run(binary!, ["app-server", "daemon", "stop"], {
        env,
        timeout: 15_000,
        maxBuffer: 64 * 1024,
      });
      if (identity) await cleanupOwnedNativeFixture(identity);
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await rm(base, { recursive: true, force: true });
    });
    const connection = await connectDaemonStream(env);
    identity = await ownedDaemonIdentity(codexHome);
    const closed = new Promise<void>((resolve) =>
      connection.stream.once("close", () => resolve()),
    );
    const originalEvents: JsonObject[] = [];
    first = new JsonLineRpc(
      { onNotification: (value) => originalEvents.push(value) },
      connection.stream,
      connection.stream,
      closed,
    );
    const initialize = await first.request("initialize", {
      clientInfo: { name: "kanban_daemon_fixture", version: "1" },
      capabilities: { experimentalApi: true },
    });
    await first.notify("initialized");
    await second.raw("thread/loaded/list", {});
    const initialContext = await second.operationContext();
    assert.match(initialContext.daemonIdentity ?? "", /^[a-f0-9]{64}$/);
    const starting = object(
      await first.request("thread/start", {
        cwd: project,
        model: "fixture",
        approvalPolicy: "never",
        sandbox: "read-only",
      }),
    );
    const id = String(object(starting.thread).id);
    assert.ok(id && id !== "undefined");
    // Native listener attachment is asynchronous relative to the thread/start reply.
    // Keep the provider held and let the connection process its notification queue.
    await second.raw("thread/loaded/list", {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    const turn = object(
      await first.request("turn/start", {
        threadId: id,
        input: [
          {
            type: "text",
            text: "Reply only from the private fixture",
            text_elements: [],
          },
        ],
      }),
    );
    await accepted;
    assert.equal(calls, 1);
    const sub = hub.subscribe({ since: 0, snapshots: true });
    console.log(
      "OFFICIAL_DAEMON_INITIAL_EVENTS",
      JSON.stringify(
        sub.backlog
          .filter((event) => event.event === "codex:notification")
          .map((event) => object(event.payload).method),
      ),
    );
    assert.ok(
      sub.backlog.some(
        (event) =>
          event.event === "codex:notification" &&
          object(event.payload).method === "thread/started",
      ),
    );
    sub.close();
    const before = object(
      await second.raw("thread/read", { threadId: id, includeTurns: false }),
    );
    assert.equal(object(before.thread).id, id);
    await second.close();
    const continued = object(
      await first.request("thread/read", { threadId: id, includeTurns: false }),
    );
    assert.equal(object(object(continued.thread).status).type, "active");
    const lateHub = new EventHub();
    t.after(() => lateHub.close());
    late = new CodexService({
      hub: lateHub,
      env,
      instance: "native-late-fixture",
      sweepIntervalMs: 0,
    });
    await late.raw("thread/read", { threadId: id, includeTurns: false });
    const reconnectedContext = await late.operationContext();
    assert.equal(
      reconnectedContext.daemonIdentity,
      initialContext.daemonIdentity,
    );
    assert.equal(reconnectedContext.namespace, initialContext.namespace);
    assert.notEqual(reconnectedContext.scope, initialContext.scope);
    releaseProvider();
    const deadline = Date.now() + 15_000;
    while (
      !originalEvents.some((event) => event.method === "turn/completed") &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(
      originalEvents.some((event) => event.method === "turn/completed"),
    );
    const history = await late.raw("thread/turns/list", {
      threadId: id,
      limit: 10,
    });
    assert.match(JSON.stringify(history), /SHARED_DAEMON_FIXTURE_OK/);
    const fullPage = object(
      await late.raw("thread/turns/list", {
        threadId: id,
        limit: 1,
        sortDirection: "desc",
        itemsView: "full",
      }),
    );
    assert.match(JSON.stringify(fullPage), /SHARED_DAEMON_FIXTURE_OK/);
    const fullThread = object(
      await late.raw("thread/read", { threadId: id, includeTurns: true }),
    );
    assert.match(JSON.stringify(fullThread), /SHARED_DAEMON_FIXTURE_OK/);
    const context = await late.operationContext();
    await late.guardedCall("thread/archive", { threadId: id }, context.scope);
    await late.guardedCall("thread/unarchive", { threadId: id }, context.scope);
    const coldLoaded = object(await late.raw("thread/loaded/list", {}));
    assert.ok(!(coldLoaded.data as string[]).includes(id));
    const coldFull = await late.raw("thread/turns/list", {
      threadId: id,
      limit: 1,
      sortDirection: "desc",
      itemsView: "full",
    });
    assert.match(JSON.stringify(coldFull), /SHARED_DAEMON_FIXTURE_OK/);
    assert.ok(
      !(
        object(await late.raw("thread/loaded/list", {})).data as string[]
      ).includes(id),
      "full history is read-only and must not load the task",
    );
    const lateEvents = lateHub.subscribe({ since: 0, snapshots: true });
    console.log(
      "OFFICIAL_DAEMON_NATIVE",
      JSON.stringify({
        userAgent: object(initialize).userAgent,
        sameThread: id === object(before.thread).id,
        nativePidIdentityConfirmed: identity.pid > 1 && !!identity.startTicks,
        daemonBindingStableAcrossKanbanReplacement:
          reconnectedContext.daemonIdentity === initialContext.daemonIdentity,
        turnId: object(turn.turn).id,
        providerCalls: calls,
        firstConnectionCompleted: true,
        readOnlyReconnectCompleted: true,
        fullItemsReadAfterCompletion: true,
        fullThreadReadAfterCompletion: true,
        coldFullHistoryWithoutResume: true,
        lateConnectionReceivedTurnEvents: lateEvents.backlog.some(
          (event) => object(event.payload).method === "turn/completed",
        ),
        daemonScopeMatched:
          late.connectionSnapshot().scope === connection.scope,
      }),
    );
    assert.equal(late.connectionSnapshot().scope, connection.scope);
    lateEvents.close();
  },
);
