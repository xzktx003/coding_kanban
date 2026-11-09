import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { readFileSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { createRequire } from "node:module";
import { Script, createContext } from "node:vm";
import { createSharedDaemonRpcGate } from "../src/shared-daemon-rpc-gate.mjs";
import { createContainerSharedAuthority } from "../src/container-shared-authority.mjs";
const require = createRequire(import.meta.url);
const {
  createNativeSharedThreadIntegration,
} = require("../src/native-shared-thread-integration.cjs");
const {
  adaptNativeSharedThreadChunk,
} = require("../src/native-shared-thread-policy.cjs");
import { fileURLToPath } from "node:url";
import {
  createSharedThreadPolicy,
  createTrustedSendIntentRegistry,
} from "../src/shared-thread-policy.mjs";
import { prepareDaemonCliAdapter } from "../src/daemon-cli-adapter.mjs";

// Opt-in only: both binaries are fixed by digest; the daemon and two clients
// below are created by this test in a fresh home and never use the default IPC.
const nativeBin = process.env.CHATGPT_DESKTOP_ADAPTER_NATIVE_BIN;
const stableBin = process.env.CHATGPT_DESKTOP_ADAPTER_DAEMON_BIN;
const nativeSha =
  "6253fb59fc4c21a9134b2f73237650eaec4a3d9380e5af12f3f1e9040dc24c14";
const stableSha =
  "b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8";
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function multiViewStage(name) {
  if (process.env.CHATGPT_SHARED_MULTI_VIEW !== "1") return;
  console.log("PRIVATE_SHARED_MULTI_STAGE", name);
  const tracePath = process.env.CHATGPT_SHARED_MULTI_TRACE;
  if (tracePath) await writeFile(tracePath, `${name}\n`, { flag: "a", mode: 0o600 });
}
async function stageDeadline(promise, name, timeout = 25_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`private fixture deadline: ${name}`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function until(predicate, label, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await delay(30);
  }
  throw new Error(`private fixture deadline: ${label}`);
}
async function ticks(pid) {
  const text = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = text
    .slice(text.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  assert.notEqual(fields[0], "Z");
  return fields[19];
}
async function exited(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((done) => child.once("exit", done));
}
async function stopOwn(child, identity) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  assert.equal(await ticks(child.pid), identity);
  child.kill("SIGTERM");
  await Promise.race([exited(child), delay(5000)]);
  if (child.exitCode === null && child.signalCode === null) {
    assert.equal(await ticks(child.pid), identity);
    child.kill("SIGKILL");
    await exited(child);
  }
}
class Rpc {
  constructor(executable, cwd, env) {
    this.child = spawn(
      executable,
      ["app-server", "--analytics-default-enabled"],
      { cwd, env, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.sequence = 0;
    this.pending = new Map();
    this.events = [];
    this.stderr = "";
    this.child.stderr.on("data", (part) => {
      this.stderr = (this.stderr + part).slice(-4096);
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        return;
      }
      if (
        (Object.hasOwn(frame, "result") || Object.hasOwn(frame, "error")) &&
        this.pending.has(frame.id)
      ) {
        const complete = this.pending.get(frame.id);
        this.pending.delete(frame.id);
        complete(frame);
      } else this.events.push(frame);
    });
  }
  notify(method, params) {
    this.child.stdin.write(
      JSON.stringify({ method, ...(params === undefined ? {} : { params }) }) +
        "\n",
    );
  }
  respond(id, result) {
    this.child.stdin.write(JSON.stringify({ id, result }) + "\n");
  }
  request(method, params) {
    return this.requestEncoded(
      JSON.stringify({ id: ++this.sequence, method, params }),
    );
  }
  requestEncoded(encoded) {
    const frame = JSON.parse(encoded);
    if (this.pending.has(frame.id))
      throw new Error("duplicate fixture request ID");
    let timer;
    const response = new Promise((done) => this.pending.set(frame.id, done));
    this.child.stdin.write(encoded + "\n"); // synchronous dispatch required by the unconnected policy fixture
    return Promise.race([
      response,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`fixture RPC timeout: ${frame.method}`)),
          20_000,
        );
      }),
    ]).finally(() => {
      clearTimeout(timer);
      this.pending.delete(frame.id);
    });
  }
  async close() {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.stdin.end();
      await exited(this.child);
    }
  }
}
// The second client writes to the actual private daemon WS in the gate's
// synchronous write callback. It never opens the user's default IPC.
class WsRpc {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.events = [];
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw));
      if (
        (Object.hasOwn(frame, "result") || Object.hasOwn(frame, "error")) &&
        this.pending.has(frame.id)
      ) {
        const complete = this.pending.get(frame.id);
        this.pending.delete(frame.id);
        complete(frame, String(raw));
      } else {
        this.events.push(frame);
        this.onEvent?.(String(raw));
      }
    });
  }
  static async create(socketPath) {
    const { default: WebSocket } = await import("ws");
    const socket = new WebSocket("ws://localhost/", {
      createConnection: () => createConnection({ path: socketPath }),
      perMessageDeflate: false,
      maxPayload: 32 * 1024 * 1024,
    });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new WsRpc(socket);
  }
  prepare(encoded, { raw = false } = {}) {
    const frame = JSON.parse(encoded);
    assert.equal(this.pending.has(frame.id), false);
    let timer;
    const response = new Promise((resolve) =>
      this.pending.set(frame.id, (frame, encoded) =>
        resolve(raw ? encoded : frame),
      ),
    );
    return Promise.race([
      response,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error(`fixture RPC timeout: ${frame.method}`)),
          20000,
        );
      }),
    ]).finally(() => {
      clearTimeout(timer);
      this.pending.delete(frame.id);
    });
  }
  write(encoded) {
    this.socket.send(encoded, { binary: false, compress: false });
  }
  request(method, params) {
    const encoded = JSON.stringify({ id: ++this.sequence, method, params }),
      result = this.prepare(encoded);
    this.write(encoded);
    return result;
  }
  notify(method, params) {
    this.write(
      JSON.stringify({ method, ...(params === undefined ? {} : { params }) }),
    );
  }
  async close() {
    if (this.socket.readyState === 3) return;
    await new Promise((resolve) => {
      this.socket.once("close", resolve);
      this.socket.close();
    });
  }
}
function success(response) {
  assert.ok(
    response &&
      Object.hasOwn(response, "result") &&
      !Object.hasOwn(response, "error"),
    "private RPC returned an error",
  );
  return response.result;
}

test(
  "private daemon forwards one explicitly scoped observer approval and resolves the original pending turn",
  { skip: !nativeBin, timeout: 100_000 },
  async () => {
    const daemonBin = stableBin || nativeBin,
      daemonSha = stableBin ? stableSha : nativeSha;
    assert.equal(resolve(nativeBin), nativeBin);
    assert.equal(resolve(daemonBin), daemonBin);
    assert.equal(
      createHash("sha256")
        .update(await readFile(nativeBin))
        .digest("hex"),
      nativeSha,
    );
    assert.equal(
      createHash("sha256")
        .update(await readFile(daemonBin))
        .digest("hex"),
      daemonSha,
    );
    // The pinned CLI refuses to create helper aliases when its HOME is in /tmp.
    const fixtureRoot =
      process.env.CHATGPT_DESKTOP_POLICY_FIXTURE_ROOT ??
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../..",
        ".dev-runtime",
      );
    const base = await mkdtemp(join(fixtureRoot, "shared-policy-"));
    const home = join(base, "home"),
      codexHome = join(home, ".codex"),
      project = join(base, "project"),
      adapterDir = join(base, "adapter");
    for (const dir of [home, codexHome, project, adapterDir])
      await mkdir(dir, { mode: 0o700 });
    const socketPath = join(base, "daemon.sock");
    let release;
    const gate = new Promise((done) => {
      release = done;
    });
    let calls = 0,
      providerError;
    const provider = createServer(async (request, response) => {
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        calls++;
        let item;
        if (calls === 1) {
          await gate;
          const tools = (body.tools ?? []).flatMap((tool) =>
            tool.tools
              ? tool.tools.map((inner) => ({ ...inner, namespace: tool.name }))
              : [tool],
          );
          const tool = tools.find((value) => value.name === "exec_command");
          assert.ok(tool, "fixture must offer exec_command");
          item = {
            type: "function_call",
            id: "fixture-tool",
            call_id: "fixture-call",
            name: tool.name,
            ...(tool.namespace ? { namespace: tool.namespace } : {}),
            arguments: JSON.stringify({
              cmd: "printf OWNED_FIXTURE_ONLY",
              workdir: project,
              sandbox_permissions: "require_escalated",
              justification: "Private fixture approval",
            }),
          };
        } else
          item = {
            type: "message",
            id: "fixture-end",
            role: "assistant",
            content: [{ type: "output_text", text: "PRIVATE_FIXTURE_DONE" }],
          };
        response.writeHead(200, { "content-type": "text/event-stream" });
        for (const event of [
          { type: "response.created", response: { id: `private-${calls}` } },
          { type: "response.output_item.done", item },
          {
            type: "response.completed",
            response: {
              id: `private-${calls}`,
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          },
        ])
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        response.end();
      } catch (error) {
        providerError = String(error);
        response.destroy();
      }
    });
    await new Promise((done) => provider.listen(0, "127.0.0.1", done));
    const port = provider.address().port;
    await writeFile(
      join(codexHome, "config.toml"),
      `model="fixture"\nmodel_provider="fixture"\napproval_policy="on-request"\nsandbox_mode="read-only"\n[projects.${JSON.stringify(project)}]\ntrust_level="trusted"\n[model_providers.fixture]\nname="Private approval fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n`,
      { mode: 0o600 },
    );
    const env = {
      HOME: home,
      CODEX_HOME: codexHome,
      XDG_CONFIG_HOME: join(home, ".config"),
      TMPDIR: base,
      PATH: "/usr/bin:/bin",
      HTTP_PROXY: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      NO_PROXY: "localhost,127.0.0.1",
      RUST_LOG: "error",
    };
    let daemon,
      daemonTicks,
      owner,
      observer,
      rpcGate,
      nativeRouter,
      containerAuthority,
      browserNavigation,
      browserNavigationSecond;
    let fixtureApprovalDispatched = false;
    let fixtureThreadId,
      fixtureTurnId,
      fixtureQueueId,
      fixtureQueueRemoved = false;
    let turnStartIssued = false,
      fixtureCompleted = false;
    try {
      const oldUmask = process.umask(0o077);
      try {
        daemon = spawn(
          daemonBin,
          ["app-server", "--listen", `unix://${socketPath}`],
          { cwd: project, env, stdio: ["ignore", "ignore", "pipe"] },
        );
      } finally {
        process.umask(oldUmask);
      }
      daemon.stderr.resume();
      daemonTicks = await ticks(daemon.pid);
      await until(async () => {
        try {
          return (await stat(socketPath)).isSocket();
        } catch {
          return false;
        }
      }, "private socket");
      const adapter = await prepareDaemonCliAdapter({
        adapterDir,
        cliPath: nativeBin,
        socketPath,
        daemonPid: daemon.pid,
        daemonStartTicks: daemonTicks,
        daemonExeSha256: daemonSha,
        daemonVersion: stableBin ? "0.166.0" : "0.166.0-alpha.5.1",
        codexHome,
      });
      owner = new Rpc(adapter.executable, project, env);
      observer = await WsRpc.create(socketPath);
      for (const [name, client] of [
        ["owner", owner],
        ["observer", observer],
      ]) {
        success(
          await client.request("initialize", {
            clientInfo: { name: `private_${name}`, title: null, version: "1" },
            capabilities: { experimentalApi: true, requestAttestation: false },
          }),
        );
        client.notify("initialized");
      }
      const thread = success(
        await owner.request("thread/start", {
          cwd: project,
          model: "fixture",
          approvalPolicy: "on-request",
          sandbox: "read-only",
          historyMode: "paginated",
        }),
      ).thread;
      const threadId = thread.id;
      fixtureThreadId = threadId;
      assert.equal(thread.historyMode, "paginated");
      turnStartIssued = true;
      const turn = success(
        await owner.request("turn/start", {
          threadId,
          input: [{ type: "text", text: "private fixture", text_elements: [] }],
        }),
      ).turn;
      fixtureTurnId = turn.id;
      await until(() => calls === 1, "first fixture provider request");
      const queue = success(
        await owner.request("thread/queue/add", {
          threadId,
          clientUserMessageId: "private-queued",
          input: [
            { type: "text", text: "private queued item", text_elements: [] },
          ],
        }),
      ).queuedSubmission;
      fixtureQueueId = queue.id;
      const beforeQueue = success(
        await owner.request("thread/queue/list", { threadId, limit: 10 }),
      ).data;
      assert.equal(beforeQueue.length, 1);
      assert.equal(beforeQueue[0].id, queue.id);
      const binding = {
        hostId: "local",
        runtimeGeneration: randomUUID(),
        daemonGeneration: randomUUID(),
        accountRevision: 0,
        projectId: "private-fixture",
        threadId,
        viewId: randomUUID(),
        clientId: randomUUID(),
      };
      const multiView = process.env.CHATGPT_SHARED_MULTI_VIEW === "1";
      const secondBinding = { ...binding, viewId: randomUUID(), clientId: randomUUID() };
      const allowedBindings = multiView ? [binding, secondBinding] : [binding];
      const intents = createTrustedSendIntentRegistry(),
        policyFrames = [],
        pendingRequests = new Map();
      let historyEvidence;
      const daemonLive = () => {
        try {
          const statText = readFileSync(`/proc/${daemon.pid}/stat`, "utf8"),
            fields = statText.slice(statText.lastIndexOf(")") + 2).split(" ");
          return (
            fields[0] !== "Z" &&
            fields[19] === daemonTicks &&
            statSync(`/proc/${daemon.pid}`).uid === process.getuid()
          );
        } catch {
          return false;
        }
      };
      rpcGate = createSharedDaemonRpcGate({
        verifyReadSync: () => daemonLive(),
        verifyBindingSync: (value) =>
          daemonLive() && JSON.stringify(value) === JSON.stringify(binding),
        // The AppHost tail capability is a fixture assertion; it is not GUI evidence.
        verifyHistorySync: () =>
          historyEvidence?.historyMode === "paginated" &&
          historyEvidence.turnsListAvailable === true &&
          historyEvidence.appHostTailHydration === true &&
          historyEvidence.experimentalEnabled === true,
        write: (encoded) => {
          const frame = JSON.parse(encoded);
          policyFrames.push(frame);
          observer.write(encoded);
        },
      });
      const dispatch = (encoded) => {
        const frame = JSON.parse(encoded),
          pending = observer.prepare(encoded);
        pendingRequests.set(frame.id, pending);
        try {
          rpcGate.write(encoded);
        } catch (error) {
          pending.catch(() => {});
          throw error;
        }
        return pending
          .then((value) => JSON.parse(rpcGate.receive(JSON.stringify(value))))
          .finally(() => pendingRequests.delete(frame.id));
      };
      const policy = createSharedThreadPolicy({
        binding,
        intents,
        verifyIdentity: async () => (await ticks(daemon.pid)) === daemonTicks,
        // The native thread/page are actually probed below. GUI support is a
        // test stub; this fixture does not instantiate the original AppHost.
        inspectHistory: async () => historyEvidence,
        dispatch,
      });
      const control = () => ({
        signal: new AbortController().signal,
        deadline: performance.now() + 20_000,
      });
      const observed = success(
        await policy.read(
          JSON.stringify({
            id: 101,
            method: "thread/read",
            params: { threadId, includeTurns: false },
          }),
          control(),
        ),
      );
      assert.equal(observed.thread.id, threadId);
      assert.equal(observed.thread.status.type, "active");
      await assert.rejects(
        policy.read(
          JSON.stringify({
            id: 102,
            method: "thread/resume",
            params: { threadId },
          }),
          control(),
        ),
        { code: "SHARED_POLICY_DENIED" },
      );
      release();
      const approval = await until(
        () =>
          owner.events.find(
            (event) => event.method === "item/commandExecution/requestApproval",
          ),
        "original owner approval",
      );
      assert.ok(Object.hasOwn(approval, "id"));
      const approvalCountBefore = owner.events.filter(
        (event) =>
          event.method === "serverRequest/resolved" &&
          event.params?.requestId === approval.id,
      ).length;
      assert.equal(approvalCountBefore, 0);
      const beforePending = success(
        await owner.request("thread/queue/list", { threadId, limit: 10 }),
      ).data;
      const pendingRead = success(
        await policy.read(
          JSON.stringify({
            id: 103,
            method: "thread/read",
            params: { threadId, includeTurns: false },
          }),
          control(),
        ),
      );
      assert.equal(pendingRead.thread.status.type, "active");
      assert.equal(pendingRead.thread.historyMode, "paginated");
      const readonlyPage = await policy.read(
        JSON.stringify({
          id: 104,
          method: "thread/turns/list",
          params: {
            threadId,
            limit: 5,
            sortDirection: "desc",
            itemsView: "summary",
          },
        }),
        control(),
      );
      const page = success(readonlyPage);
      assert.ok(Array.isArray(page.data));
      const listed = success(
        await dispatch(
          JSON.stringify({
            id: 105,
            method: "thread/list",
            params: {
              limit: 100,
              cursor: null,
              sortKey: "updated_at",
              modelProviders: null,
              archived: false,
              useStateDbOnly: true,
            },
          }),
        ),
      );
      assert.ok(
        listed.data.some((item) => item.id === threadId),
        "private running thread should be listed",
      );
      historyEvidence = {
        threadId,
        historyMode: pendingRead.thread.historyMode,
        turnsListAvailable: true,
        appHostTailHydration: true, // isolated fixture assertion, not GUI evidence
        experimentalEnabled: true, // capability sent on this fixture connection
      };
      const unsupported = await observer.request("thread/subscribe", {
        threadId,
      });
      assert.ok(
        Object.hasOwn(unsupported, "error"),
        "fixed binary unexpectedly supports thread/subscribe",
      );
      assert.deepEqual(
        success(
          await owner.request("thread/queue/list", { threadId, limit: 10 }),
        ).data,
        beforePending,
      );
      assert.equal(
        owner.events.filter(
          (event) =>
            event.method === "serverRequest/resolved" &&
            event.params?.requestId === approval.id,
        ).length,
        0,
      );
      assert.equal(
        calls,
        1,
        "readonly observation must not start another provider call",
      );

      // The opt-in browser path below uses the original fixed row/provider and
      // resume expression; the normal no-browser path uses a synthetic intent.
      assert.equal(
        policyFrames.filter((frame) => frame.method === "thread/resume").length,
        0,
      );
      const sender = { id: 2, isDestroyed: () => false },
        window = { webContents: sender, isDestroyed: () => false };
      const record = {
          senderId: 2,
          viewId: binding.viewId,
          window,
          failed: false,
        },
        profileId = randomUUID();
      const secondSender = { id: 3, isDestroyed: () => false };
      const secondRecord = { senderId: 3, viewId: secondBinding.viewId, window: { webContents: secondSender, isDestroyed: () => false }, failed: false };
      let epoch = randomUUID(), attemptId = randomUUID(), deliverView = () => {}, deliverSecondView = () => {}, secondEpoch = randomUUID();
      containerAuthority = createContainerSharedAuthority({
        profileId,
        generation: binding.runtimeGeneration,
        verifyContainerSync: daemonLive,
        verifyOwnedViewSync: (id) => daemonLive() && allowedBindings.some((value) => value.viewId === id),
        sendFrame: (frame) => nativeRouter.receive(frame),
        sharedThread: {
          resolveBinding: async (value) => allowedBindings.find((candidate) => candidate.viewId === value.viewId),
          verifyViewSync: (value) =>
            value.hostId === binding.hostId &&
            value.threadId === binding.threadId &&
            allowedBindings.some((candidate) => candidate.viewId === value.viewId),
          verifyBindingSync: (value) =>
            daemonLive() && allowedBindings.some((candidate) => JSON.stringify(value) === JSON.stringify(candidate)),
          verifyHistorySync: () =>
            historyEvidence?.historyMode === "paginated" &&
            historyEvidence.turnsListAvailable === true &&
            historyEvidence.appHostTailHydration === true &&
            historyEvidence.experimentalEnabled === true,
          verifyReadSync: daemonLive,
          write: (encoded) => {
            const frame = JSON.parse(encoded);
            if (Object.hasOwn(frame, "method")) {
              const result = observer.prepare(encoded, { raw: true });
              result
                .then((raw) => {
                  if (!containerAuthority.receiveDaemon(raw))
                    throw Error("private response rejected");
                })
                .catch(() => containerAuthority.close());
            } else fixtureApprovalDispatched = true;
            policyFrames.push(frame);
            observer.write(encoded);
          },
        },
      });
      const viewMessages = [];
      nativeRouter = createNativeSharedThreadIntegration({
        profileId,
        generation: binding.runtimeGeneration,
        getRecord: (id) => (id === 2 ? record : multiView && id === 3 ? secondRecord : undefined),
        getOwnedRecord: (value) => (value === sender ? record : multiView && value === secondSender ? secondRecord : undefined),
        verifyRuntimeSync: daemonLive,
        sendToView: (target, frame) => { viewMessages.push(frame); if (target === secondRecord) deliverSecondView(frame); else deliverView(frame); },
        sendFrame: (frame) => containerAuthority.receive(frame),
      });
      const originalChunk =
        process.env.CHATGPT_PICKER_NATIVE_CHUNK ??
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../../..",
          ".dev-runtime/chatgpt-linux-audit-20261103-7jyjn55e/evidence/native-browser-capabilities/extracted/linux/.vite/build/early-bootstrap-439-a0f25ba32c465de1.js",
        );
      const patchedSource = adaptNativeSharedThreadChunk({
        body: await readFile(originalChunk),
      }).body.toString("utf8");
      const bindStart = patchedSource.indexOf(
        "bind(e){if(this.assertCurrent(),this.disposed||0!==this.cleanup.length)",
      );
      const bindEnd = patchedSource.indexOf(
        "async callInteractiveDynamicAppTool(",
        bindStart,
      );
      const responseStart = patchedSource.indexOf(
        "async sendResponse(e,t){",
        bindEnd,
      );
      const responseEnd = patchedSource.indexOf("dispose(){", responseStart);
      assert.ok(
        bindStart >= 0 &&
          bindEnd > bindStart &&
          responseStart > bindEnd &&
          responseEnd > responseStart,
      );
      const managerRequests = [],
        managerNotifications = [];
      const context = createContext({
        yc: { IB: () => true },
        el: { JXB: (value) => value },
        __kanbanRegisterSharedHostEvents: nativeRouter.registerHostEvents,
        __kanbanIsSharedServerResponse: nativeRouter.isSharedServerResponse,
      });
      const originalMethods = new Script(
        `({${patchedSource.slice(bindStart, bindEnd)},${patchedSource.slice(responseStart, responseEnd)}})`,
      ).runInContext(context);
      const manager = {
        getHostId: () => "local",
        onRequest: (frame) => managerRequests.push(frame),
        onNotification: (...args) => managerNotifications.push(args),
        addThreadDeletedListener: () => () => {},
      };
      let wrongConnectionWrites = 0,
        eventError;
      const originalOwner = {
        ...originalMethods,
        cleanup: [],
        disposed: false,
        requests: new Map(),
        assertCurrent() {},
        isCurrent: () => true,
        connection: {
          registerHostEventHandler: () => () => {},
          registerInternalConnectionStateHandler: () => () => {},
          handleClientResponse: async () => {
            wrongConnectionWrites++;
          },
        },
      };
      originalOwner.bind(manager);
      observer.onEvent = (encoded) => {
        if (!containerAuthority.receiveDaemon(encoded)) {
          const event = JSON.parse(encoded);
          console.log(
            "PRIVATE_EVENT_REJECTED",
            JSON.stringify({
              method: event.method,
              fields: Object.keys(event).sort(),
              paramsFields: Object.keys(event.params ?? {}).sort(),
            }),
          );
          eventError = Error("private event rejected");
          nativeRouter.dispose();
        }
      };
      await assert.rejects(
        nativeRouter.exchangeRequest({
          id: "no-intent",
          method: "thread/resume",
          params: { threadId, excludeTurns: true },
        }),
      );
      assert.equal(
        policyFrames.filter((frame) => frame.method === "thread/resume").length,
        0,
      );
      const invokeResume = async (params) => success(JSON.parse(await nativeRouter.withResume(
        sender, binding.hostId, params, async (clean) => {
          assert.equal(Object.hasOwn(clean, "__kanbanSharedConnectAttempt"), false);
          assert.equal(clean.conversationId, threadId);
          const request = await nativeRouter.guardRequest(binding.hostId, {
            id: `thread/resume:${randomUUID()}`, method: "thread/resume",
            params: { threadId, cwd: project, config: { fixtureOverride: true } },
          });
          return await nativeRouter.exchangeRequest(request);
        },
      )));
      let resume;
      if (process.env.CHATGPT_SHARED_NAV_ISOLATED === "1") {
        const { openSharedNavigationBrowser } = await import("./fixtures/shared-thread-navigation-browser-native.mjs");
        browserNavigation = await openSharedNavigationBrowser({
          scope: { profileId, generation: binding.runtimeGeneration, viewId: binding.viewId },
          threadId,
          setDelivery: (fn) => { deliverView = fn; },
          onMessage: async (message) => {
            if (message.type === "kanban-shared-connect-lifecycle") {
              assert.equal(message.sequence, 1); epoch = message.epoch;
              assert.equal(nativeRouter.lifecycle(sender, message), true); return;
            }
            assert.equal(message.type, "kanban-shared-connect-intent");
            assert.equal(message.threadId, threadId); assert.equal(message.viewId, binding.viewId);
            attemptId = message.attemptId;
            assert.equal(await nativeRouter.intent(sender, message), true);
          },
          onResume: invokeResume,
        });
        await browserNavigation.rejectAutomatic();
        assert.equal(policyFrames.filter((frame) => frame.method === "thread/resume").length, 0);
        await browserNavigation.click();
        await browserNavigation.rejectWrongThread(randomUUID());
        resume = await browserNavigation.resume();
        assert.equal(await browserNavigation.resume(), undefined);
        await browserNavigation.assertClean();
      } else {
        assert.equal(nativeRouter.lifecycle(sender, { type: "kanban-shared-connect-lifecycle", sequence: 1, epoch }), true);
        assert.equal(await nativeRouter.intent(sender, {
          type: "kanban-shared-connect-intent", v: 1, action: "connect", attemptId,
          profileId, generation: binding.runtimeGeneration, viewId: binding.viewId,
          hostId: binding.hostId, threadId, sequence: 1, epoch,
        }), true);
        resume = await invokeResume({ conversationId: threadId, __kanbanSharedConnectAttempt: attemptId });
      }
      const params = { conversationId: threadId, __kanbanSharedConnectAttempt: attemptId };
      await containerAuthority.waitForIdle({ timeoutMs: 5000 });
      assert.deepEqual(
        policyFrames
          .filter((frame) => frame.method === "thread/resume")
          .map((frame) => frame.params),
        [{ threadId, excludeTurns: true }],
      );
      await assert.rejects(
        nativeRouter.withResume(sender, binding.hostId, params, () => {}),
        {
          code: "SHARED_NAV_INTENT_DENIED",
        },
      );
      assert.equal(resume.thread.id, threadId);
      assert.equal(resume.thread.historyMode, "paginated");
      assert.deepEqual(resume.thread.turns, []);
      for (const key of ["turnsBackwardsCursor", "itemsBackwardsCursor"]) {
        assert.ok(Object.hasOwn(resume, key));
        assert.ok(resume[key] === null || typeof resume[key] === "string");
      }
      // The original AppHost reads a page of turns and then the items for each
      // turn. Both calls travel through the private authority to the real
      // observer connection; no extra resume or turn is issued here.
      const itemParams = {
        threadId,
        turnId: turn.id,
        cursor: null,
        limit: 100,
        sortDirection: "desc",
      };
      const nativeTurns = success(JSON.parse(await nativeRouter.exchangeRequest({
        id: "private-hydration-turns",
        method: "thread/turns/list",
        params: { threadId, cursor: null, limit: 5, sortDirection: "desc", itemsView: "notLoaded" },
      })));
      assert.ok(nativeTurns.data.some((value) => value.id === turn.id));
      const nativeItems = success(JSON.parse(await nativeRouter.exchangeRequest({
        id: "private-hydration-items",
        method: "thread/items/list",
        params: itemParams,
      })));
      assert.ok(nativeItems.data.length > 0);
      assert.ok(nativeItems.data.every((entry) => entry.turnId === turn.id));
      assert.ok(nativeItems.data.some((entry) => entry.item.type === "userMessage"));
      const policyItems = success(await policy.read(JSON.stringify({
        id: 106, method: "thread/items/list", params: itemParams,
      }), control()));
      assert.ok(policyItems.data.some((entry) => entry.item.type === "userMessage"));
      assert.equal(calls, 1, "history pagination must not start another turn");
      const afterResume = success(
        await owner.request("thread/read", { threadId, includeTurns: false }),
      ).thread;
      assert.equal(afterResume.status.type, "active");
      assert.equal(afterResume.cwd, pendingRead.thread.cwd);
      assert.deepEqual(
        success(
          await owner.request("thread/queue/list", { threadId, limit: 10 }),
        ).data,
        beforePending,
      );
      assert.equal(
        owner.events.filter(
          (event) =>
            event.method === "serverRequest/resolved" &&
            event.params?.requestId === approval.id,
        ).length,
        0,
      );
      await until(
        () =>
          observer.events.some(
            (event) =>
              event.method === "item/commandExecution/requestApproval" &&
              event.id === approval.id,
          ),
        "resumed observer receives the original approval",
      );
      await until(
        () => managerRequests.some((event) => event.id === approval.id),
        "original manager receives approval",
      );
      if (multiView) {
        assert.equal(process.env.CHATGPT_SHARED_NAV_ISOLATED, "1", "multi-view GUI needs the isolated original row");
        const { openSharedNavigationBrowser } = await import("./fixtures/shared-thread-navigation-browser-native.mjs");
        await multiViewStage("open second original row");
        browserNavigationSecond = await openSharedNavigationBrowser({
          scope: { profileId, generation: binding.runtimeGeneration, viewId: secondBinding.viewId },
          threadId,
          setDelivery: (fn) => { deliverSecondView = fn; },
          onMessage: async (message) => {
            if (message.type === "kanban-shared-connect-lifecycle") {
              assert.equal(message.sequence, 1); secondEpoch = message.epoch;
              assert.equal(nativeRouter.lifecycle(secondSender, message), true); return;
            }
            assert.equal(message.type, "kanban-shared-connect-intent");
            assert.equal(message.threadId, threadId); assert.equal(message.viewId, secondBinding.viewId);
            assert.equal(await nativeRouter.intent(secondSender, message), true);
          },
          onResume: async (params) => success(JSON.parse(await nativeRouter.withResume(
            secondSender, secondBinding.hostId, params, async (clean) => {
              assert.equal(clean.conversationId, threadId);
              const request = await nativeRouter.guardRequest(secondBinding.hostId, {
                id: `thread/resume:${randomUUID()}`, method: "thread/resume",
                params: { threadId, cwd: project, config: { fixtureOverride: true } },
              });
              return await nativeRouter.exchangeRequest(request);
            },
          ))),
        });
        await multiViewStage("second original row ready");
        await stageDeadline(browserNavigationSecond.rejectAutomatic(), "second view automatic navigation");
        await stageDeadline(browserNavigationSecond.click(), "second original row click");
        await multiViewStage("second original row clicked");
        const secondResume = await stageDeadline(browserNavigationSecond.resume(), "second explicit resume");
        assert.equal(secondResume.thread.id, threadId);
        await multiViewStage("second explicit resume complete");
        await browserNavigationSecond.assertClean();
        await containerAuthority.waitForIdle({ timeoutMs: 5000 });
        assert.equal(managerRequests.filter((event) => event.id === approval.id).length, 1,
          "the shared manager must not receive a duplicate original approval");
        assert.deepEqual(policyFrames.filter((frame) => frame.method === "thread/resume").map((frame) => frame.params),
          [{ threadId, excludeTurns: true }, { threadId, excludeTurns: true }]);
      }
      await assert.rejects(
        originalOwner.sendResponse(approval.method, {
          id: approval.id,
          result: { decision: "accept" },
        }),
        { code: "SHARED_APPROVAL_UNAVAILABLE" },
      );
      assert.equal(wrongConnectionWrites, 0);
      // The queue is removed explicitly by the owner so fixture cleanup never
      // starts a second queued turn. The original approval is explicitly declined.
      success(
        await owner.request("thread/queue/delete", {
          threadId,
          queuedSubmissionId: queue.id,
        }),
      );
      fixtureQueueRemoved = true;
      assert.equal(
        observer.socket.readyState,
        1,
        "owner must respond while the observer is still connected",
      );
      const approvalBinding = multiView ? secondBinding : binding;
      const approvalSender = multiView ? secondSender : sender;
      const approvalEpoch = multiView ? secondEpoch : epoch;
      const approvalAction = {
        type: "kanban-shared-approval-intent",
        v: 1,
        action: "approval",
        actionId: randomUUID(),
        profileId,
        generation: binding.runtimeGeneration,
        viewId: approvalBinding.viewId,
        hostId: approvalBinding.hostId,
        threadId,
        requestId: approval.id,
        itemId: approval.params.itemId,
        decision: "decline",
        sequence: 1,
        epoch: approvalEpoch,
      };
      console.log(
        "PRIVATE_APPROVAL_SHAPE",
        JSON.stringify({
          requestIdType: typeof approval.id,
          itemId: approval.params.itemId,
          turnId: approval.params.turnId,
          availableDecisions: approval.params.availableDecisions ?? null,
          managerCount: managerRequests.length,
        }),
      );
      let approvalResult;
      if (process.env.CHATGPT_APPROVAL_GUI_ISOLATED === "1") {
        const { runOriginalApprovalBrowser } =
          await import("./fixtures/shared-approval-browser-native.mjs");
        await multiViewStage("open original approval panel");
        const gui = await runOriginalApprovalBrowser({
          scope: {
            profileId,
            generation: binding.runtimeGeneration,
            viewId: approvalBinding.viewId,
          },
          approval: {
            id: approval.id,
            threadId,
            hostId: approvalBinding.hostId,
            itemId: approval.params.itemId,
            command: approval.params.command ?? "printf OWNED_FIXTURE_ONLY",
            cwd: project,
          },
          epoch: approvalEpoch,
          sender: approvalSender,
          nativeRouter,
          viewMessages,
          beforeClick: () => {
            assert.equal(fixtureApprovalDispatched, false);
            assert.equal(
              policyFrames.filter((x) => !Object.hasOwn(x, "method")).length,
              0,
            );
          },
        });
        await multiViewStage("original approval panel completed");
        Object.assign(approvalAction, gui.action);
        console.log(
          "PRIVATE_APPROVAL_ORIGINAL_BROWSER",
          JSON.stringify({
            originalApprovalPanel: gui.originalApprovalPanel,
            originalPendingCallbacks: gui.originalPendingCallbacks,
            trustedClick: gui.trustedClick,
            syntheticLifecycleAndHostTransport:
              gui.syntheticLifecycleAndHostTransport,
          }),
        );
        approvalResult = Promise.resolve({ state: "resolved" });
      } else {
        approvalResult = nativeRouter.approvalIntent(approvalSender, approvalAction);
      }
      void approvalResult.then((x) =>
        console.log("PRIVATE_APPROVAL_RESULT", JSON.stringify(x)),
      );
      await until(
        () => fixtureApprovalDispatched,
        "observer submits exact approval",
      );
      assert.deepEqual(
        policyFrames.filter((x) => !Object.hasOwn(x, "method")),
        [{ id: approval.id, result: { decision: "decline" } }],
      );
      assert.equal(
        (
          await nativeRouter.approvalIntent(approvalSender, {
            ...approvalAction,
            actionId: randomUUID(),
          })
        ).state,
        "denied",
      );
      assert.equal((await approvalResult).state, "resolved");
      await until(
        () =>
          owner.events.some(
            (event) =>
              event.method === "turn/completed" &&
              event.params?.turn?.id === turn.id,
          ),
        "owner turn completes",
      );
      fixtureCompleted = true;
      await until(
        () =>
          observer.events.some(
            (event) =>
              event.method === "turn/completed" &&
              event.params?.turn?.id === turn.id,
          ),
        "observer sees the same turn complete",
      );
      await until(
        () =>
          managerNotifications.some(
            ([method, params]) =>
              method === "turn/completed" && params.turn?.id === turn.id,
          ),
        "original manager receives the same completion",
      );
      assert.equal(eventError, undefined);
      observer.onEvent = undefined;
      await observer.close();
      observer = undefined;
      const turns = success(
        await owner.request("thread/turns/list", { threadId, limit: 5 }),
      );
      assert.equal(turns.data.length, 1);
      assert.equal(providerError, undefined);
      assert.ok(calls >= 2);
      assert.equal(await ticks(daemon.pid), daemonTicks);
      console.log(
        "PRIVATE_THREAD_OBSERVATION",
        JSON.stringify({
          version: stableBin ? "0.166.0" : "0.166.0-alpha.5.1",
          readMetadataWhileRunning: true,
          readMetadataWhileApprovalPending: true,
          readonlyTurnsPageAvailable: Object.hasOwn(readonlyPage, "result"),
          readonlyAutoResume: false,
          rawSubscribeUnsupported: true,
          fixtureExplicitConnectIntent: true,
          originalRowBrowserGesture: process.env.CHATGPT_SHARED_NAV_ISOLATED === "1",
          originalRowRouteAndNativeTransportUseFixture: process.env.CHATGPT_SHARED_NAV_ISOLATED === "1",
          fixedAuthorityChannelReturnedActualDaemonResponse: true,
          actualApprovalAndCompletionReachedOriginalManagerHandlers: true,
          sharedApprovalCannotWriteTheOldConnection: true,
          resumeParamsBoundedThreadIdAndExcludeTurns: true,
          resumeReportedPaginatedWithNoTurns: true,
          resumeSuppliedOriginalAppHostCursors: true,
          realPerTurnItemsReadAfterResume: true,
          guiTailHydrationIsTestStub: true,
          originalTurnSurvived: true,
          originalApprovalResolvedByExplicitObserver: true,
          exactResponseSentOnceWithoutReplay: true,
          originalCardChromiumClick:
            process.env.CHATGPT_APPROVAL_GUI_ISOLATED === "1",
          fullNativeGuiUnverified: true,
          queueUnchangedDuringResume: true,
          observerSawSamePendingApproval: true,
          observerSawSameTurnComplete: true,
        }),
      );
    } finally {
      release?.();
      await browserNavigationSecond?.close().catch(() => {});
      await browserNavigation?.close().catch(() => {});
      if (observer) observer.onEvent = undefined;
      nativeRouter?.dispose();
      containerAuthority?.close();
      rpcGate?.close();
      if (
        turnStartIssued &&
        !fixtureCompleted &&
        owner &&
        fixtureThreadId &&
        fixtureTurnId
      ) {
        try {
          if (fixtureQueueId && !fixtureQueueRemoved) {
            await owner.request("thread/queue/delete", {
              threadId: fixtureThreadId,
              queuedSubmissionId: fixtureQueueId,
            });
            fixtureQueueRemoved = true;
          }
          const approval = await until(
            () =>
              owner.events.find(
                (event) =>
                  event.method === "item/commandExecution/requestApproval" &&
                  event.params?.threadId === fixtureThreadId,
              ),
            "owned fixture cleanup approval",
            3000,
          );
          if (
            !fixtureApprovalDispatched &&
            !owner.events.some(
              (event) =>
                event.method === "serverRequest/resolved" &&
                event.params?.requestId === approval.id,
            )
          )
            owner.respond(approval.id, { decision: "decline" });
          await until(
            () =>
              owner.events.some(
                (event) =>
                  event.method === "turn/completed" &&
                  event.params?.turn?.id === fixtureTurnId,
              ),
            "owned fixture cleanup completion",
            8000,
          );
          fixtureCompleted = true;
        } catch {
          console.log(
            "PRIVATE_FIXTURE_RETAINED",
            JSON.stringify({ taskCompletionKnown: false }),
          );
        }
      }
      if (!turnStartIssued || fixtureCompleted) {
        if (owner) await Promise.race([owner.close(), delay(2500)]);
        if (observer) await Promise.race([observer.close(), delay(2500)]);
        if (daemon && daemonTicks) await stopOwn(daemon, daemonTicks);
        provider.closeAllConnections();
        await new Promise((done) => provider.close(done));
        await rm(base, { recursive: true, force: true });
      } else {
        daemon?.unref();
        provider.unref();
      }
    }
  },
);
