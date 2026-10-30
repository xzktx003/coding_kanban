import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import * as pty from "node-pty";
import { EventHub } from "../core/events.js";
import { object } from "../core/json.js";
import { CodexService } from "./client.js";
import {
  registerOwnedNativeFixture,
  cleanupOwnedNativeFixture,
  ownedDaemonIdentity,
  type OwnedNativeIdentity,
} from "./daemon-native-fixture.js";

const run = promisify(execFile),
  binary = process.env.SESSION_CODEX_DAEMON_NATIVE_BIN;
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
  throw new Error(`Native CLI fixture deadline: ${label}`);
};
test(
  "actual CLI and Kanban share a daemon; explicit loaded-task attach receives and resolves its approval",
  { skip: !binary, timeout: 60_000 },
  async (t) => {
    const base = await mkdtemp(join(tmpdir(), "kanban-daemon-cli-")),
      home = join(base, "home"),
      codexHome = join(base, "codex"),
      project = join(base, "project");
    await Promise.all(
      [home, codexHome, project].map((path) => mkdir(path, { mode: 0o700 })),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0,
      providerError: string | undefined;
    const callMetadata: Array<{ tools: number; inputTypes: string[] }> = [];
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
        callMetadata.push({
          tools: tools.length,
          inputTypes: (body.input ?? []).map((entry: any) =>
            String(entry.type ?? entry.role),
          ),
        });
        let item;
        if (calls === 1) {
          await gate;
          const tool = tools.find(
            (value: any) => value.name === "exec_command",
          );
          assert.ok(tool, "CLI did not advertise exec_command");
          item = {
            type: "function_call",
            id: "approval-tool",
            call_id: "approval-call",
            name: tool.name,
            ...(tool.namespace ? { namespace: tool.namespace } : {}),
            arguments: JSON.stringify({
              cmd: "printf SHARED_CLI_APPROVED",
              workdir: project,
              sandbox_permissions: "require_escalated",
              justification:
                "Run this private fixture printf in its temporary project?",
            }),
          };
        } else
          item = {
            type: "message",
            role: "assistant",
            id: "cli-done",
            content: [
              { type: "output_text", text: "CLI_SHARED_TASK_COMPLETED" },
            ],
          };
        response.writeHead(200, { "content-type": "text/event-stream" });
        for (const event of [
          { type: "response.created", response: { id: `cli-${calls}` } },
          { type: "response.output_item.done", item },
          {
            type: "response.completed",
            response: {
              id: `cli-${calls}`,
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
      `model="fixture"\nmodel_provider="fixture"\napproval_policy="on-request"\nsandbox_mode="read-only"\n[projects.${JSON.stringify(project)}]\ntrust_level="trusted"\n[model_providers.fixture]\nname="Private CLI fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n`,
      { mode: 0o600 },
    );
    await registerOwnedNativeFixture(codexHome);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: codexHome,
      CODEX_PATH: binary!,
      TERM: "xterm-256color",
      HTTP_PROXY: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      NO_PROXY: "127.0.0.1,localhost",
      SESSION_CODEX_DAEMON_AUTO_START: "1",
    };
    const hub = new EventHub(),
      service = new CodexService({
        hub,
        env,
        instance: "cli-native",
        sweepIntervalMs: 0,
      });
    let terminal: pty.IPty | undefined,
      tail = "",
      exited = false;
    let identity: OwnedNativeIdentity | undefined;
    t.after(async () => {
      release();
      if (terminal && !exited) {
        terminal.kill();
        try {
          await eventually(
            () => (exited ? true : undefined),
            "owned CLI exit",
            3000,
          );
        } catch {
          terminal.kill("SIGKILL");
          await eventually(
            () => (exited ? true : undefined),
            "owned CLI final exit",
            3000,
          );
        }
      }
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
    await service.raw("thread/loaded/list", {});
    identity = await ownedDaemonIdentity(codexHome);
    terminal = pty.spawn(
      binary!,
      [
        "--remote",
        `unix://${join(codexHome, "app-server-control", "app-server-control.sock")}`,
        "--no-alt-screen",
        "-C",
        project,
        "-a",
        "on-request",
        "Complete the private shared-daemon fixture",
      ],
      { env: env as Record<string, string>, cwd: project, cols: 100, rows: 35 },
    );
    terminal.onExit(() => (exited = true));
    terminal.onData((data) => {
      tail = (tail + data).slice(-12_000);
      if (data.includes("\x1b[6n")) terminal?.write("\x1b[1;1R");
      if (data.includes("\x1b[c")) terminal?.write("\x1b[?1;2c");
    });
    try {
      await eventually(
        () => (calls > 0 ? true : undefined),
        "CLI provider request",
      );
    } catch (error) {
      console.log(
        "CLI_FIXTURE_TERMINAL",
        tail.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""),
      );
      throw error;
    }
    const current = hub.subscribe({ since: 0, snapshots: true });
    const started = current.backlog.find(
      (event) =>
        event.event === "codex:notification" &&
        object(event.payload).method === "thread/started",
    );
    current.close();
    assert.ok(started);
    const threadId = String(
      object(object(started.payload).params).thread &&
        object(object(object(started.payload).params).thread).id,
    );
    const metadata = object(
      await service.raw("thread/read", { threadId, includeTurns: false }),
    );
    assert.equal(object(object(metadata.thread).status).type, "active");
    assert.equal(calls, 1);
    // This is an explicit fixture interaction, never a background/history recovery operation.
    // Loaded-thread resume attaches this native connection without starting a second turn.
    const latest = object(
      await service.raw("thread/turns/list", {
        threadId,
        limit: 1,
        sortDirection: "desc",
        itemsView: "notLoaded",
      }),
    );
    const context = await service.operationContext();
    await service.attachLoadedThread(
      threadId,
      String(object((latest.data as any[])[0]).id),
      context.scope,
    );
    assert.equal(calls, 1);
    release();
    const approval = await eventually(() => {
      const snapshot = hub.subscribe({ since: 0, snapshots: true });
      const found = snapshot.backlog.find(
        (event) => event.event === "codex/approval-request",
      );
      snapshot.close();
      return found;
    }, "shared command approval");
    await service.respond("commandExecution", {
      request_id: approval.payload.requestId,
      request: approval.payload,
      decision: "accept",
    });
    await eventually(() => {
      const snapshot = hub.subscribe({ since: 0, snapshots: true });
      const completed = snapshot.backlog.some(
        (event) =>
          event.event === "codex:notification" &&
          object(event.payload).method === "turn/completed",
      );
      snapshot.close();
      return completed ? true : undefined;
    }, "CLI turn completion");
    assert.equal(providerError, undefined);
    const history = object(
      await service.raw("thread/turns/list", { threadId, limit: 5 }),
    );
    assert.match(JSON.stringify(history), /CLI_SHARED_TASK_COMPLETED/);
    assert.equal(
      Array.isArray(history.data) && history.data.length,
      1,
      "explicit attach must not create another turn",
    );
    console.log(
      "OFFICIAL_DAEMON_CLI",
      JSON.stringify({
        actualCliProcess: true,
        sameThread: true,
        nativePidIdentityConfirmed: identity.pid > 1 && !!identity.startTicks,
        providerCalls: calls,
        providerCallMetadata: callMetadata,
        explicitLoadedAttach: true,
        approvalResolvedFromKanban: true,
        taskCompleted: true,
        cliStillAlive: !exited,
        readonlyRecoveryAutoResume: false,
      }),
    );
  },
);
