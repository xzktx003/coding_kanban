import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";
import { EventHub } from "../core/events.js";
import { object } from "../core/json.js";
import { CodexService } from "./client.js";
import { ThreadRealtime } from "./realtime.js";
import {
  registerOwnedNativeFixture,
  cleanupOwnedNativeFixture,
  ownedDaemonIdentity,
  type OwnedNativeIdentity,
} from "./daemon-native-fixture.js";
const run = promisify(execFile),
  binary = process.env.SESSION_CODEX_DAEMON_NATIVE_BIN;
test(
  "isolated official native realtime posts WebRTC offer, emits exact SDP, and stops only its captured session",
  { skip: !binary, timeout: 60000 },
  async (t) => {
    const base = await mkdtemp(join(tmpdir(), "kanban-voice-native-")),
      home = join(base, "home"),
      codexHome = join(base, "codex"),
      project = join(base, "project");
    await Promise.all(
      [home, codexHome, project].map((path) => mkdir(path, { mode: 0o700 })),
    );
    let calls = 0,
      sidebands = 0,
      updates = 0,
      typed = 0;
    const provider = createServer(async (req, res) => {
      let text = "";
      for await (const part of req) text += part;
      if (req.url?.includes("/realtime/calls")) {
        calls++;
        assert.match(text, /sdp/);
        assert.match(text, /v=0/);
        res.writeHead(201, {
          "content-type": "application/sdp",
          location: "/v1/realtime/calls/rtc_private_fixture",
        });
        res.end("v=0\r\ns=private-native-answer\r\n");
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const sockets = new WebSocketServer({ server: provider });
    sockets.on("connection", (socket) => {
      sidebands++;
      socket.send(
        JSON.stringify({
          type: "session.created",
          session: { id: "private-voice" },
        }),
      );
      socket.on("message", (data) => {
        const event = JSON.parse(String(data));
        if (String(data).includes("PRIVATE_TYPED_VOICE")) typed++;
        if (event.type === "session.update") {
          updates++;
          socket.send(
            JSON.stringify({
              type: "session.updated",
              session: { id: "private-voice" },
            }),
          );
        }
      });
    });
    await new Promise<void>((resolve) =>
      provider.listen(0, "127.0.0.1", resolve),
    );
    const port = (provider.address() as { port: number }).port;
    await writeFile(
      join(codexHome, "config.toml"),
      `experimental_realtime_ws_base_url="http://127.0.0.1:${port}/v1"\nexperimental_realtime_webrtc_call_base_url="http://127.0.0.1:${port}/v1"\nexperimental_realtime_ws_startup_context="Private fixture context"\nmodel="fixture"\nmodel_provider="fixture"\napproval_policy="never"\nsandbox_mode="read-only"\n[realtime]\nversion="v1"\ntype="conversational"\n[model_providers.fixture]\nname="Private voice fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n`,
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
        instance: "realtime-native-fixture",
        sweepIntervalMs: 0,
      });
    let identity: OwnedNativeIdentity | undefined;
    const manager = new ThreadRealtime({
        raw: service.raw.bind(service),
        snapshot: () => service.connectionSnapshot(),
      }),
      events = hub.subscribe({
        filter: (event) => {
          if (event.event === "codex:notification") {
            const payload = object(event.payload);
            manager.observe(String(payload.method), object(payload.params));
          }
          return false;
        },
      });
    t.after(async () => {
      manager.invalidate();
      events.close();
      await service.close();
      hub.close();
      identity ??= await ownedDaemonIdentity(codexHome);
      await run(binary!, ["app-server", "daemon", "stop"], {
        env,
        timeout: 15000,
        maxBuffer: 65536,
      });
      if (identity) await cleanupOwnedNativeFixture(identity);
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await rm(base, { recursive: true, force: true });
    });
    const started = object(
      await service.raw("thread/start", {
        cwd: project,
        model: "fixture",
        approvalPolicy: "never",
        sandbox: "read-only",
      }),
    );
    identity = await ownedDaemonIdentity(codexHome);
    const threadId = String(object(started.thread).id);
    const context = await manager.preflight({ threadId });
    const connected = await manager.start({
      contextToken: context.contextToken,
      threadId,
      sdp: "v=0\r\ns=private-native-offer\r\n",
      replaceExisting: true,
    });
    assert.match(connected.sdp, /private-native-answer/);
    assert.equal(calls, 1);
    assert.equal(sidebands, 1);
    await manager.appendText({
      contextToken: context.contextToken,
      threadId,
      text: "PRIVATE_TYPED_VOICE",
      intentId: "private-typed-intent",
    });
    const typedDeadline = Date.now() + 3000;
    while (typed === 0 && Date.now() < typedDeadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(typed, 1);
    await manager.stop({ contextToken: context.contextToken, threadId });
    console.log(
      "REALTIME_NATIVE_ACCEPTANCE",
      JSON.stringify({
        actualOfficialProtocol: true,
        httpOffer: true,
        nativeAnswer: true,
        sidebands,
        sessionUpdates: updates,
        explicitStop: true,
        typedTextAccepted: typed === 1,
        accountCopied: false,
        noModelTurnSent: true,
      }),
    );
  },
);
