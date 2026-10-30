import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  lstat,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { EventHub } from "../core/events.js";
import { object } from "../core/json.js";
import { CodexService } from "./client.js";
import {
  registerOwnedNativeFixture,
  cleanupOwnedNativeFixture,
  ownedDaemonIdentity,
  type OwnedNativeIdentity,
} from "./daemon-native-fixture.js";

const run = promisify(execFile);
const binary =
  process.env.SESSION_CODEX_DAEMON_NATIVE_BIN ??
  "/data01/home/huxing/.codex/packages/app-server-daemon/releases/0.163.0-x86_64-unknown-linux-musl/bin/codex";
const expectedSha256 =
  "399ff69c431c066e40de318fba45c2b07f45a76b19939d247ee4828fc70c4215";
const eventually = async <T>(
  read: () => T | undefined,
  label: string,
  timeout = 15_000,
): Promise<T> => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Native approval fixture deadline: ${label}`);
};

test(
  "official 0.163 native approval reaches two SSE clients, rejects resolved token, and since recovers next request",
  { skip: process.env.SESSION_CODEX_APPROVAL_NATIVE !== "1", timeout: 60_000 },
  async (t) => {
    assert.equal(
      createHash("sha256")
        .update(await readFile(binary))
        .digest("hex"),
      expectedSha256,
    );
    const base = await mkdtemp(join(tmpdir(), "kanban-approval-native-"));
    const home = join(base, "home"),
      codexHome = join(base, "codex"),
      project = join(base, "project");
    await Promise.all(
      [home, codexHome, project].map((path) => mkdir(path, { mode: 0o700 })),
    );
    let calls = 0;
    let providerError: string | undefined;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const provider = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const part of request) chunks.push(part as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        calls++;
        const tools = body.tools.flatMap((tool: any) =>
          tool.tools
            ? tool.tools.map((inner: any) => ({
                ...inner,
                namespace: tool.name,
              }))
            : [tool],
        );
        let item;
        if (calls <= 2) {
          await gate;
          const tool = tools.find(
            (value: any) => value.name === "exec_command",
          );
          assert.ok(tool, "native turn did not advertise exec_command");
          item = {
            type: "function_call",
            id: `approval-tool-${calls}`,
            call_id: `approval-call-${calls}`,
            name: tool.name,
            ...(tool.namespace ? { namespace: tool.namespace } : {}),
            arguments: JSON.stringify({
              cmd: `printf APPROVED_NATIVE_COMMAND_${calls}`,
              workdir: project,
              sandbox_permissions: "require_escalated",
              justification: `Run private approval command ${calls}?`,
            }),
          };
        } else {
          item = {
            type: "message",
            role: "assistant",
            id: "approval-fixture-final",
            content: [
              {
                type: "output_text",
                text: "NATIVE_APPROVAL_TURN_COMPLETED_ONCE",
              },
            ],
          };
        }
        response.writeHead(200, { "content-type": "text/event-stream" });
        for (const event of [
          {
            type: "response.created",
            response: { id: `approval-response-${calls}` },
          },
          { type: "response.output_item.done", item },
          {
            type: "response.completed",
            response: {
              id: `approval-response-${calls}`,
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          },
        ])
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        response.end();
      } catch (error) {
        providerError = String(error);
        response.writeHead(500);
        response.end();
      }
    });
    await new Promise<void>((resolve) =>
      provider.listen(0, "127.0.0.1", resolve),
    );
    const port = (provider.address() as { port: number }).port;
    await writeFile(
      join(codexHome, "config.toml"),
      `model="fixture"\nmodel_provider="fixture"\napproval_policy="on-request"\nsandbox_mode="read-only"\n[projects.${JSON.stringify(project)}]\ntrust_level="trusted"\n[model_providers.fixture]\nname="Private approval fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n`,
      { mode: 0o600 },
    );
    await registerOwnedNativeFixture(codexHome);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: codexHome,
      CODEX_PATH: binary,
      TERM: "xterm-256color",
      HTTP_PROXY: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      NO_PROXY: "127.0.0.1,localhost",
      SESSION_CODEX_DAEMON_AUTO_START: "1",
    };
    const hub = new EventHub();
    const service = new CodexService({
      hub,
      env,
      instance: "approval-native",
      sweepIntervalMs: 0,
    });
    let identity: OwnedNativeIdentity | undefined;
    t.after(async () => {
      release();
      await service.close();
      hub.close();
      identity ??= await ownedDaemonIdentity(codexHome);
      const stopResult = await run(binary, ["app-server", "daemon", "stop"], {
        env,
        timeout: 15_000,
        maxBuffer: 64 * 1024,
      });
      if (identity) await cleanupOwnedNativeFixture(identity);
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await rm(base, { recursive: true, force: true });
      await assert.rejects(lstat(base), { code: "ENOENT" });
      console.log(
        "OFFICIAL_NATIVE_APPROVAL_CLEANUP",
        JSON.stringify({
          officialStopStatus: JSON.parse(stopResult.stdout).status,
          capturedDaemonPid: identity?.pid,
          capturedDaemonStartTicks: identity?.startTicks,
          capturedDaemonAndUpdaterExited: true,
          ownedFixtureHomeRemoved: true,
          providerClosed: true,
        }),
      );
    });

    await service.raw("thread/loaded/list", {});
    identity = await ownedDaemonIdentity(codexHome);
    const started = object(
      await service.raw("thread/start", {
        cwd: project,
        model: "fixture",
        approvalPolicy: "on-request",
        sandbox: "read-only",
      }),
    );
    const threadId = String(object(started.thread).id);
    assert.ok(threadId && threadId !== "undefined");
    const turnPromise = service.raw("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: "Run the private approval fixture",
          text_elements: [],
        },
      ],
    });
    void turnPromise.catch(() => {});
    await eventually(
      () => (calls > 0 ? true : undefined),
      "first Responses request",
    );
    release();

    const first = await eventually(() => {
      const snapshot = hub.subscribe({ since: 0, snapshots: true });
      const found = snapshot.backlog.find(
        (event) => event.event === "codex/approval-request",
      );
      snapshot.close();
      return found;
    }, "first native approval");
    const acceptedTokens: string[] = [];
    const firstSequence = first.seq;
    // Independent SSE subscribers represent two browser clients sharing the production runtime.
    const clientA = hub.subscribe({ since: firstSequence - 1 });
    const clientB = hub.subscribe({ since: firstSequence - 1 });
    assert.equal(
      clientA.backlog.at(-1)?.payload.requestToken,
      first.payload.requestToken,
    );
    assert.equal(
      clientB.backlog.at(-1)?.payload.requestToken,
      first.payload.requestToken,
    );
    clientA.close();
    clientB.close();
    await service.respond("commandExecution", {
      request_id: first.payload.requestId,
      request: first.payload,
      decision: "accept",
    });
    acceptedTokens.push(String(first.payload.requestToken));
    await assert.rejects(
      service.respond("commandExecution", {
        request_id: first.payload.requestId,
        request: first.payload,
        decision: "accept",
      }),
      /SESSION_RPC_EXPIRED/,
      "second SSE client's resolved approval token must be rejected",
    );

    const second = await eventually(() => {
      const snapshot = hub.subscribe({ since: 0, snapshots: true });
      const found = snapshot.backlog.find(
        (event) =>
          event.event === "codex/approval-request" &&
          event.payload.requestToken !== first.payload.requestToken,
      );
      snapshot.close();
      return found;
    }, "second native approval in the same turn");
    // Client B disconnects from EventSource while the runtime-native connection remains alive.
    const lastSeen = firstSequence;
    const resumedB = hub.subscribe({ since: lastSeen });
    const caughtUp = resumedB.backlog.find(
      (event) =>
        event.event === "codex/approval-request" &&
        event.payload.requestToken === second.payload.requestToken,
    );
    resumedB.close();
    assert.ok(caughtUp, "SSE since did not recover the next native request");
    assert.notEqual(caughtUp.payload.requestToken, first.payload.requestToken);
    await assert.rejects(
      service.respond("commandExecution", {
        request_id: first.payload.requestId,
        request: first.payload,
        decision: "accept",
      }),
      /SESSION_RPC_EXPIRED/,
      "old token remains rejected after catch-up",
    );
    await service.respond("commandExecution", {
      request_id: caughtUp.payload.requestId,
      request: caughtUp.payload,
      decision: "accept",
    });
    acceptedTokens.push(String(caughtUp.payload.requestToken));
    const completed = await eventually(() => {
      const snapshot = hub.subscribe({ since: 0 });
      const done = snapshot.backlog.find(
        (event) =>
          event.event === "codex:notification" &&
          object(event.payload).method === "turn/completed" &&
          object(object(event.payload).params).threadId === threadId,
      );
      snapshot.close();
      return done;
    }, "single native turn completion");
    const turn = object(await turnPromise);
    const turnId = String(turn.turnId ?? object(turn.turn).id);
    const completedTurn = object(object(object(completed.payload).params).turn);
    assert.equal(String(completedTurn.id), turnId);
    assert.equal(providerError, undefined);
    assert.equal(
      calls,
      3,
      "the turn must make two approval rounds and one final response",
    );
    assert.equal(
      new Set(acceptedTokens).size,
      2,
      "each distinct native approval is accepted once",
    );
    const history = object(
      await service.raw("thread/turns/list", { threadId, limit: 5 }),
    );
    const serialized = JSON.stringify(history);
    assert.match(serialized, /NATIVE_APPROVAL_TURN_COMPLETED_ONCE/);
    assert.equal(
      (history.data as unknown[]).length,
      1,
      "approval rounds must remain in one turn",
    );
    console.log(
      "OFFICIAL_NATIVE_APPROVAL_COMPETITION",
      JSON.stringify({
        officialVersion: "0.163.0",
        officialBinarySha256: expectedSha256,
        nativePid: identity.pid,
        nativeStartTicks: identity.startTicks,
        privateHomeOnly: true,
        providerCalls: calls,
        sameNativeRequestDeliveredToTwoSseClients: true,
        firstApprovalAcceptedOnce: true,
        duplicateOldTokenRejected: true,
        sinceRecoveredSecondApproval: true,
        secondApprovalAccepted: true,
        acceptedDistinctApprovalTokens: new Set(acceptedTokens).size,
        completedTurnCount: (history.data as unknown[]).length,
        runtimeNativeConnectionStayedOpenDuringSseGap: true,
        nativeReconnectReplayClaimed: false,
      }),
    );
  },
);
