import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import { createRequire } from "node:module";
import { createSharedDaemonRpcGate } from "../src/shared-daemon-rpc-gate.mjs";

const require = createRequire(import.meta.url);
const {
  createDynamicToolsRouter,
} = require("../src/dynamic-tools-routing.cjs");
const {
  createNativeSharedThreadRouter,
} = require("../src/native-shared-thread-routing.cjs");

// Explicit pinned Linux source, original ROP and original Et/ye; no daemon or account.
const pinned = process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT;
async function sources(root) {
  const fd = await open(join(root, "resources", "app.asar"), "r");
  try {
    const prefix = Buffer.alloc(16);
    await fd.read(prefix, 0, 16, 0);
    const header = Buffer.alloc(prefix.readUInt32LE(12));
    await fd.read(header, 0, header.length, 16);
    const index = JSON.parse(header.toString()),
      start = 8 + prefix.readUInt32LE(4);
    async function read(name, sha) {
      let e = index;
      for (const part of name.split("/")) e = e.files[part];
      const data = Buffer.alloc(e.size);
      await fd.read(data, 0, data.length, start + Number(e.offset));
      assert.equal(createHash("sha256").update(data).digest("hex"), sha);
      return data.toString("utf8");
    }
    return {
      main: await read(
        ".vite/build/early-bootstrap-439-a0f25ba32c465de1.js",
        "c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333",
      ),
      rop: await read(
        ".vite/build/early-bootstrap-133-a2b781596743bab7.js",
        "35629d1aabe19b3ebb2833d126f70f858778eb5252c29778b1aa93dee2167855",
      ),
    };
  } finally {
    await fd.close();
  }
}
function extract(s, start, end) {
  const a = s.indexOf(start),
    b = s.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return s.slice(a, b);
}
function loadRop(source) {
  const bundle = {};
  new Function("exports", source)(bundle);
  const output = {};
  function webpack() {
    throw Error("unexpected dependency");
  }
  webpack.d = (target, getters, values) => {
    for (const [key, get] of Object.entries(getters ?? {}))
      Object.defineProperty(target, key, { enumerable: true, get });
    for (const [key, value] of Object.entries(values ?? {}))
      Object.defineProperty(target, key, { enumerable: true, value });
  };
  bundle.modules[12892](null, output, webpack);
  return output;
}
class Transport {
  encodingLevel = "structuredClonable";
  constructor(port) {
    this.port = port;
    this.queue = [];
    this.waiter = null;
    this.error = null;
    port.on("message", (data) => {
      if (data == null) return this.abort(Error("closed"));
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w.resolve(data);
      } else this.queue.push(data);
    });
    port.on("close", () => this.abort(Error("closed")));
    port.start();
  }
  send(value) {
    if (this.error) throw this.error;
    this.port.postMessage(value);
  }
  receive() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      assert.equal(this.waiter, null);
      this.waiter = { resolve, reject };
    });
  }
  abort(error) {
    if (this.error) return;
    this.error = error ?? Error("closed");
    this.port.close();
    if (this.waiter) {
      this.waiter.reject(this.error);
      this.waiter = null;
    }
  }
}

test(
  "original pinned ROP and Et/ye preserve a per-call connect attempt alongside the exact thread",
  { skip: !pinned, timeout: 15000 },
  async (t) => {
    const source = await sources(pinned),
      rop = loadRop(source.rop);
    const ye = extract(
        source.main,
        "class ye extends eo.TF{",
        "function yt(e)",
      ),
      et = extract(source.main, "class Et extends eo.TF{", "let Er=!1;"),
      wm = extract(source.main, "function wh(e,t,r){", "var wg=");
    const { Et } = new Function("eo", "wV", `${wm};${ye};${et};return {Et,ye}`)(
      rop,
      (x) => x,
    );
    const seen = [],
      manager = {
        async resumeConversation(value) {
          seen.push(value);
          return { status: "ready" };
        },
      };
    const hosts = {
      getCurrent: () => ({ resource: { manager }, assertCurrent() {} }),
      hasConnection: () => true,
    };
    class Root extends rop.TF {
      getManagers() {
        return new Et(hosts, {});
      }
    }
    const channel = new MessageChannel(),
      server = new Transport(channel.port1),
      client = new Transport(channel.port2);
    t.after(() => {
      server.abort();
      client.abort();
    });
    new rop.oB(server, new Root());
    const service = await new rop.oB(client).getRemoteMain().getManagers();
    const state = await service.open("local"),
      id = randomUUID(),
      attempt = randomUUID();
    await state.manager.resumeConversation({
      conversationId: id,
      __kanbanSharedConnectAttempt: attempt,
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].conversationId, id);
    assert.equal(seen[0].__kanbanSharedConnectAttempt, attempt);
  },
);

test(
  "pinned ROP and original Et/ye carry one view-scoped intent through the final synchronous gate",
  { skip: !pinned, timeout: 15000 },
  async (t) => {
    const source = await sources(pinned),
      rop = loadRop(source.rop);
    const ye = extract(
        source.main,
        "class ye extends eo.TF{",
        "function yt(e)",
      ),
      et = extract(source.main, "class Et extends eo.TF{", "let Er=!1;"),
      wm = extract(source.main, "function wh(e,t,r){", "var wg=");
    const { Et } = new Function("eo", "wV", `${wm};${ye};${et};return {Et,ye}`)(
      rop,
      (x) => x,
    );
    const profileId = randomUUID(),
      generation = randomUUID(),
      viewId = randomUUID(),
      threadId = randomUUID(),
      epoch = randomUUID(),
      attemptId = randomUUID();
    const sender = { id: 2, isDestroyed: () => false },
      window = { webContents: sender, isDestroyed: () => false },
      record = { viewId, senderId: 2, window, failed: false };
    const writes = [],
      outgoing = [];
    const gate = createSharedDaemonRpcGate({
      verifyReadSync: () => true,
      verifyBindingSync: () => true,
      verifyHistorySync: () => true,
      write: (encoded) => writes.push(JSON.parse(encoded)),
    });
    const router = createNativeSharedThreadRouter({
      profileId,
      generation,
      getRecord: (id) => (id === 2 ? record : null),
      getOwnedRecord: (value) => (value === sender ? record : null),
      verifyRuntimeSync: () => true,
      resolveBinding: async () => ({
        hostId: "local",
        runtimeGeneration: generation,
        daemonGeneration: randomUUID(),
        accountRevision: 1,
        projectId: "private-project",
        threadId,
        viewId,
        clientId: randomUUID(),
      }),
      verifyBinding: async () => true,
      verifyBindingSync: () => true,
      authorizeRequest: (...args) => gate.registerConnect(...args),
      sendToView: (_record, message) => outgoing.push(message),
    });
    const dynamic = createDynamicToolsRouter({
      getRecord: (id) => (id === 2 ? record : null),
      getOwnedRecord: (value) => (value === sender ? record : null),
      withResume: router.withResume,
    });
    const manager = {
      async resumeConversation(value) {
        assert.equal(
          Object.hasOwn(value, "__kanbanSharedConnectAttempt"),
          false,
        );
        assert.equal(dynamic.selectWindow(), window);
        const request = await router.guardRequest("local", {
          id: `thread/resume:${randomUUID()}`,
          method: "thread/resume",
          params: {
            threadId: value.conversationId,
            model: "must-not-be-forwarded",
          },
        });
        gate.write(JSON.stringify(request));
        gate.receive(
          JSON.stringify({
            id: request.id,
            result: {
              thread: { id: threadId, historyMode: "paginated", turns: [] },
              turnsBackwardsCursor: null,
              itemsBackwardsCursor: null,
            },
          }),
        );
        return { status: "ready" };
      },
    };
    const hosts = {
      getCurrent: () => ({ resource: { manager }, assertCurrent() {} }),
      hasConnection: () => true,
    };
    class Root extends rop.TF {
      getManagers() {
        return dynamic.bindManagers(new Et(hosts, {}), sender);
      }
    }
    const channel = new MessageChannel(),
      server = new Transport(channel.port1),
      client = new Transport(channel.port2);
    t.after(() => {
      server.abort();
      client.abort();
      router.dispose();
      gate.close();
    });
    new rop.oB(server, new Root());
    const service = await new rop.oB(client).getRemoteMain().getManagers();
    assert.equal(
      router.lifecycle(sender, {
        type: "kanban-shared-connect-lifecycle",
        sequence: 1,
        epoch,
      }),
      true,
    );
    assert.equal(
      await router.intent(sender, {
        type: "kanban-shared-connect-intent",
        v: 1,
        action: "connect",
        attemptId,
        profileId,
        generation,
        viewId,
        hostId: "local",
        threadId,
        sequence: 1,
        epoch,
      }),
      true,
    );
    assert.equal(outgoing.at(-1).accepted, true);
    const state = await service.open("local");
    assert.deepEqual(
      await state.manager.resumeConversation({
        conversationId: threadId,
        __kanbanSharedConnectAttempt: attemptId,
      }),
      { status: "ready" },
    );
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].params, { threadId, excludeTurns: true });
    await assert.rejects(
      Promise.resolve(
        state.manager.resumeConversation({
          conversationId: threadId,
          __kanbanSharedConnectAttempt: attemptId,
        }),
      ),
    );
    assert.equal(writes.length, 1);
  },
);
