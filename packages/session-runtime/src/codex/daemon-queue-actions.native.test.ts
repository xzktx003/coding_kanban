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
  "official queue update/reorder and queued steer preserve exact native IDs and the active turn",
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
    const requests: any[] = [];
    const provider = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString()),
        index = models.length + 1;
      models.push(String(body.model));
      requests.push(body);
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
    );
    const id = String(object(started.thread).id);
    identity = await ownedDaemonIdentity(codexHome);
    const input = (text: string) => [{ type: "text", text, text_elements: [] }];
    await service.raw("thread/queue/add", {
      threadId: id,
      clientUserMessageId: "running",
      input: input("RUNNING_NATIVE_QUEUE_FIXTURE"),
    });
    await wait(
      () => (models.length === 1 ? true : undefined),
      "first native task reached the private provider",
    );
    const edit = object(
      object(
        await service.raw("thread/queue/add", {
          threadId: id,
          clientUserMessageId: "same-client",
          input: input("BEFORE_NATIVE_EDIT"),
        }),
      ).queuedSubmission,
    );
    const steer = object(
      object(
        await service.raw("thread/queue/add", {
          threadId: id,
          clientUserMessageId: "same-client",
          input: input("STEER_NATIVE_EXACT_TURN"),
        }),
      ).queuedSubmission,
    );
    assert.notEqual(edit.id, steer.id);
    await service.raw("thread/queue/update", {
      threadId: id,
      queuedSubmissionId: edit.id,
      input: input("UPDATED_NATIVE_QUEUE_MESSAGE"),
    });
    await service.raw("thread/queue/reorder", {
      threadId: id,
      queuedSubmissionIds: [steer.id, edit.id],
    });
    const before = object(
      await service.raw("thread/queue/list", { threadId: id, limit: 10 }),
    );
    const queued = (before.data as JsonObject[]).map(object);
    assert.deepEqual(
      queued.map((row) => row.id),
      [steer.id, edit.id],
    );
    assert.match(
      JSON.stringify(queued[1].input),
      /UPDATED_NATIVE_QUEUE_MESSAGE/,
    );
    const turns = object(
      await service.raw("thread/turns/list", {
        threadId: id,
        limit: 1,
        sortDirection: "desc",
        itemsView: "notLoaded",
      }),
    );
    const running = object((turns.data as JsonObject[])[0]);
    assert.equal(running.status, "inProgress");
    await service.raw("thread/queue/delete", {
      threadId: id,
      queuedSubmissionId: steer.id,
    });
    const steered = object(
      await service.raw("turn/steer", {
        threadId: id,
        expectedTurnId: running.id,
        clientUserMessageId: "explicit-queued-steer",
        input: steer.input,
      }),
    );
    assert.equal(
      steered.turnId,
      running.id,
      "queued steer targets the same running turn",
    );
    const still = object(
      await service.raw("thread/turns/list", {
        threadId: id,
        limit: 1,
        sortDirection: "desc",
        itemsView: "notLoaded",
      }),
    );
    assert.equal(object((still.data as JsonObject[])[0]).id, running.id);
    assert.equal(object((still.data as JsonObject[])[0]).status, "inProgress");
    releaseSecond();
    releaseFirst();
    await wait(async () => {
      const metadata = object(
        await service.raw("thread/read", { threadId: id, includeTurns: false }),
      );
      const page = object(
        await service.raw("thread/queue/list", { threadId: id, limit: 10 }),
      );
      return object(object(metadata.thread).status).type === "idle" &&
        (page.data as unknown[]).length === 0
        ? true
        : undefined;
    }, "native accepted work completes without a second scheduler");
    const complete = object(
      await service.raw("thread/turns/list", {
        threadId: id,
        limit: 10,
        sortDirection: "asc",
      }),
    );
    const completed = (complete.data as JsonObject[]).map(object);
    assert.equal(
      completed.length,
      2,
      "steer must not create a third user turn",
    );
    assert.equal(completed[0].id, running.id);
    assert.equal(
      completed.every((turn) => turn.status === "completed"),
      true,
    );
    // Current official 0.165 history does not necessarily project accepted
    // steer input as a separate userMessage. The provider request below proves
    // delivery without inventing a native history row or a third user turn.
    const steerVisibleInHistory = JSON.stringify(completed[0].items).includes(
      "STEER_NATIVE_EXACT_TURN",
    );
    assert.match(
      JSON.stringify(completed[1].items),
      /UPDATED_NATIVE_QUEUE_MESSAGE/,
    );
    assert.equal(
      requests.some((body) =>
        JSON.stringify(body).includes("STEER_NATIVE_EXACT_TURN"),
      ),
      true,
    );
    assert.equal(
      requests.some((body) =>
        JSON.stringify(body).includes("UPDATED_NATIVE_QUEUE_MESSAGE"),
      ),
      true,
    );
    console.log(
      "OFFICIAL_NATIVE_QUEUE_ACTIONS",
      JSON.stringify({
        sameClientDistinctQueueIds: edit.id !== steer.id,
        updatedExactQueueId: true,
        reorderedExactQueueIds: true,
        steerKeptTurnId: steered.turnId === running.id,
        turns: completed.length,
        allCompleted: true,
        providerRequests: requests.length,
        steerVisibleInHistory,
      }),
    );
  },
);
