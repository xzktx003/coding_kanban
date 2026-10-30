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
import { CodexService } from "./client.js";
import {
  registerOwnedNativeFixture,
  cleanupOwnedNativeFixture,
  ownedDaemonIdentity,
  type OwnedNativeIdentity,
} from "./daemon-native-fixture.js";

const run = promisify(execFile),
  binary = process.env.SESSION_CODEX_DAEMON_NATIVE_BIN;
async function wait<T>(
  read: () => Promise<T | undefined> | T | undefined,
  label: string,
): Promise<T> {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Native queue deadline: ${label}`);
}
test(
  "official queue is the sole scheduler, adopts thread settings, preserves interruption, and requires explicit restart",
  { skip: !binary, timeout: 60_000 },
  async (t) => {
    const base = await mkdtemp(join(tmpdir(), "kanban-daemon-queue-")),
      home = join(base, "home"),
      codexHome = join(base, "codex"),
      project = join(base, "project");
    await Promise.all(
      [home, codexHome, project].map((path) => mkdir(path, { mode: 0o700 })),
    );
    let releaseFirst!: () => void, releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve)),
      secondGate = new Promise<void>((resolve) => (releaseSecond = resolve));
    const models: string[] = [];
    const provider = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString()),
        index = models.length + 1;
      models.push(String(body.model));
      if (index === 1) await firstGate;
      if (index === 2) await secondGate;
      if (response.destroyed) return;
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "response.created", response: { id: `queue-${index}` } },
        {
          type: "response.output_item.done",
          item: {
            type: "message",
            id: `message-${index}`,
            role: "assistant",
            content: [{ type: "output_text", text: `QUEUE_FIXTURE_${index}` }],
          },
        },
        {
          type: "response.completed",
          response: {
            id: `queue-${index}`,
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
      `model="fixture-a"\nmodel_provider="fixture"\napproval_policy="never"\nsandbox_mode="read-only"\n[features]\ngoals=true\n[model_providers.fixture]\nname="Private queue fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n`,
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
      service = new CodexService({
        hub,
        env,
        instance: "native-queue",
        sweepIntervalMs: 0,
      });
    let identity: OwnedNativeIdentity | undefined;
    t.after(async () => {
      releaseFirst();
      releaseSecond();
      await service.close();
      hub.close();
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
    const started = object(
        await service.raw("thread/start", {
          cwd: project,
          model: "fixture-a",
          approvalPolicy: "never",
          sandbox: "read-only",
        }),
      ),
      id = String(object(started.thread).id);
    identity = await ownedDaemonIdentity(codexHome);
    const input = (text: string) => [{ type: "text", text, text_elements: [] }];
    await service.raw("thread/queue/add", {
      threadId: id,
      clientUserMessageId: "first",
      input: input("first"),
    });
    await wait(
      () => (models.length === 1 ? true : undefined),
      "idle enqueue starts first task",
    );
    const second = object(
      await service.raw("thread/queue/add", {
        threadId: id,
        clientUserMessageId: "same-client-id",
        input: input("second"),
      }),
    );
    const duplicate = object(
      await service.raw("thread/queue/add", {
        threadId: id,
        clientUserMessageId: "same-client-id",
        input: input("second"),
      }),
    );
    assert.notEqual(
      object(second.queuedSubmission).id,
      object(duplicate.queuedSubmission).id,
      "clientUserMessageId is not an idempotency guarantee",
    );
    await service.raw("thread/queue/delete", {
      threadId: id,
      queuedSubmissionId: object(duplicate.queuedSubmission).id,
    });
    await service.raw("thread/settings/update", {
      threadId: id,
      model: "fixture-b",
    });
    releaseFirst();
    await wait(
      () => (models.length === 2 ? true : undefined),
      "official automatic queue advance",
    );
    assert.deepEqual(models, ["fixture-a", "fixture-b"]);
    await service.raw("thread/queue/add", {
      threadId: id,
      clientUserMessageId: "third",
      input: input("third"),
    });
    const page = object(
        await service.raw("thread/turns/list", {
          threadId: id,
          limit: 1,
          sortDirection: "desc",
          itemsView: "notLoaded",
        }),
      ),
      turn = object((page.data as JsonObject[])[0]);
    assert.equal(turn.status, "inProgress");
    await service.raw("thread/goal/set", {
      threadId: id,
      objective: "Complete only the private queued fixture",
      status: "active",
      origin: "user",
    });
    await service.raw("thread/goal/set", {
      threadId: id,
      status: "paused",
      origin: "user",
    });
    assert.equal(
      object(
        object(await service.raw("thread/goal/get", { threadId: id })).goal,
      ).status,
      "paused",
    );
    assert.equal(models.length, 2);
    await service.raw("turn/interrupt", { threadId: id, turnId: turn.id });
    releaseSecond();
    await wait(async () => {
      const value = object(
        await service.raw("thread/read", { threadId: id, includeTurns: false }),
      );
      return object(object(value.thread).status).type === "idle"
        ? true
        : undefined;
    }, "exact native interruption");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.equal(
      models.length,
      2,
      "interruption must stop automatic queue advance",
    );
    const queued = object(
      await service.raw("thread/queue/list", { threadId: id, limit: 10 }),
    );
    assert.equal((queued.data as unknown[]).length, 1);
    await service.raw("thread/archive", { threadId: id });
    await assert.rejects(
      service.raw("thread/queue/list", { threadId: id, limit: 10 }),
      /is archived/,
    );
    await service.raw("thread/unarchive", { threadId: id });
    const afterRestore = object(
      await service.raw("thread/queue/list", { threadId: id, limit: 10 }),
    );
    assert.equal(
      (afterRestore.data as unknown[]).length,
      1,
      "archive must retain pending native queue content",
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.equal(
      models.length,
      2,
      "unarchive alone must not resume queued execution",
    );
    assert.equal(
      object(
        object(await service.raw("thread/goal/get", { threadId: id })).goal,
      ).status,
      "paused",
    );
    await assert.rejects(
      service.raw("thread/queue/start", { threadId: id }),
      /resume the thread before starting a queued message/,
      "cold queue/start must not be assumed to load the task",
    );
    const restoreContext = await service.operationContext();
    await service.restoreQueueThread(
      id,
      restoreContext.scope,
      (afterRestore.data as JsonObject[]).map((item) => String(item.id)),
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.equal(
      models.length,
      2,
      "loaded restore must preserve the fresh native interruption pause",
    );
    await service.raw("thread/queue/start", { threadId: id });
    await wait(
      () => (models.length === 3 ? true : undefined),
      "explicit queue restart",
    );
    await wait(async () => {
      const value = object(
        await service.raw("thread/turns/list", {
          threadId: id,
          limit: 1,
          sortDirection: "desc",
        }),
      );
      return object((value.data as JsonObject[])[0]).status === "completed"
        ? true
        : undefined;
    }, "final queued task completion");
    assert.deepEqual(models, ["fixture-a", "fixture-b", "fixture-b"]);
    const receipt = object(
      object(
        await service.raw("thread/read", { threadId: id, includeTurns: false }),
      ).readState,
    );
    assert.equal(typeof receipt.revision, "string");
    const receiptContext = await service.operationContext();
    const read = object(
      await service.guardedCall(
        "thread/readState/update",
        {
          threadId: id,
          expectedRevision: receipt.revision,
          operation: { type: "read" },
        },
        receiptContext.scope,
      ),
    );
    const readRevision = object(read.readState).revision;
    const unread = object(
      await service.guardedCall(
        "thread/readState/update",
        {
          threadId: id,
          expectedRevision: readRevision,
          operation: { type: "unread" },
        },
        receiptContext.scope,
      ),
    );
    assert.notEqual(object(unread.readState).revision, readRevision);
    await assert.rejects(
      service.guardedCall(
        "thread/readState/update",
        {
          threadId: id,
          expectedRevision: readRevision,
          operation: { type: "read" },
        },
        receiptContext.scope,
      ),
      /revision|changed|conflict/i,
    );
    await service.raw("thread/archive", { threadId: id });
    await wait(async () => {
      const loaded = object(await service.raw("thread/loaded/list", {}));
      return !(loaded.data as string[]).includes(id) ? true : undefined;
    }, "archive releases completed task");
    await service.raw("thread/unarchive", { threadId: id });
    let coldSettingsError: string | undefined;
    try {
      await service.raw("thread/settings/update", {
        threadId: id,
        model: "fixture-c",
      });
    } catch (error) {
      coldSettingsError = String(error);
    }
    assert.ok(
      coldSettingsError,
      "cold settings must not implicitly acquire or execute the thread",
    );
    assert.equal(models.length, 3);
    const coldContext = await service.operationContext();
    await service.loadQueueThread(id, coldContext.scope);
    await service.guardedCall(
      "thread/settings/update",
      { threadId: id, model: "fixture-c" },
      coldContext.scope,
    );
    await service.guardedCall(
      "thread/queue/add",
      { threadId: id, clientUserMessageId: "fourth", input: input("fourth") },
      coldContext.scope,
    );
    await wait(
      () => (models.length === 4 ? true : undefined),
      "explicit cold send preparation",
    );
    await wait(async () => {
      const value = object(
        await service.raw("thread/turns/list", {
          threadId: id,
          limit: 1,
          sortDirection: "desc",
        }),
      );
      return object((value.data as JsonObject[])[0]).status === "completed"
        ? true
        : undefined;
    }, "cold task completion");
    assert.deepEqual(models, [
      "fixture-a",
      "fixture-b",
      "fixture-b",
      "fixture-c",
    ]);
    console.log(
      "OFFICIAL_DAEMON_QUEUE",
      JSON.stringify({
        idleEnqueueAutoStarts: true,
        sameClientIdDeduplicated: false,
        duplicateRemovedBeforeExecution: true,
        settingsAppliedPerThread: true,
        interruptPreservedQueue: true,
        pausedGoalPreserved: true,
        archiveRetainedPendingQueue: true,
        unarchiveDidNotExecute: true,
        explicitRestartRequired: true,
        providerModels: models,
        coldSettingsError,
        explicitColdSendLoaded: true,
        readStateOpaqueRevisionCAS: true,
        quietObservationMs: 2000,
        nativePidIdentityConfirmed: true,
      }),
    );
  },
);
