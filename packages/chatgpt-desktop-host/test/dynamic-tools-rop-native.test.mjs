import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url),
  {
    createDynamicToolsRouter,
    adaptDynamicToolsChunk,
  } = require("../src/dynamic-tools-routing.cjs");
const pinned = process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT;
async function members(root) {
  const fd = await open(join(root, "resources", "app.asar"), "r");
  try {
    const prefix = Buffer.alloc(16);
    await fd.read(prefix, 0, 16, 0);
    const header = Buffer.alloc(prefix.readUInt32LE(12));
    await fd.read(header, 0, header.length, 16);
    const index = JSON.parse(header.toString()),
      begin = 8 + prefix.readUInt32LE(4);
    async function read(name, sha) {
      let entry = index;
      for (const part of name.split("/")) entry = entry.files[part];
      const b = Buffer.alloc(entry.size);
      await fd.read(b, 0, b.length, begin + Number(entry.offset));
      assert.equal(createHash("sha256").update(b).digest("hex"), sha);
      return b.toString("utf8");
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
function extract(source, start, end) {
  const a = source.indexOf(start),
    b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
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
  assert.equal(typeof bundle.modules[12892], "function");
  bundle.modules[12892](null, output, webpack);
  assert.equal(typeof output.TF, "function");
  assert.equal(typeof output.oB, "function");
  return output;
}
class Transport {
  encodingLevel = "structuredClonable";
  constructor(port) {
    this.port = port;
    this.queue = [];
    this.pending = null;
    this.error = null;
    port.on("message", (data) => {
      if (data == null) return this.abort(Error("closed"));
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        p.resolve(data);
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
      assert.equal(this.pending, null);
      this.pending = { resolve, reject };
    });
  }
  abort(error) {
    if (this.error) return;
    this.error = error ?? Error("closed");
    this.port.close();
    if (this.pending) {
      this.pending.reject(this.error);
      this.pending = null;
    }
  }
}
function view(id) {
  const sender = { id, isDestroyed: () => false };
  const window = { webContents: sender, isDestroyed: () => false };
  return { senderId: id, window, failed: false };
}

test(
  "original pinned ROP, original Et and ye retain two independent view contexts through RPC",
  { skip: !pinned, timeout: 15000 },
  async (t) => {
    const source = await members(pinned),
      rop = loadRop(source.rop),
      a = view(2),
      b = view(3),
      records = new Map([
        [2, a],
        [3, b],
      ]),
      owned = new WeakMap([
        [a.window.webContents, a],
        [b.window.webContents, b],
      ]);
    const router = createDynamicToolsRouter({
      getRecord: (id) => records.get(id),
      getOwnedRecord: (sender) => owned.get(sender),
    });
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
    let slow = false,
      release;
    const fakeManager = {
      async resumeConversation(params) {
        if (slow && params.conversationId === "shared")
          await new Promise((r) => {
            release = r;
          });
        else await delay(params.pause);
        const selected = router.selectWindow();
        return selected?.webContents.id ?? null;
      },
    };
    const watchers = new Set(),
      hosts = {
        getCurrent() {
          return { resource: { manager: fakeManager }, assertCurrent() {} };
        },
        hasConnection() {
          return true;
        },
        subscribe(_host, callback) {
          watchers.add(callback);
          return () => watchers.delete(callback);
        },
      };
    const service = new Et(hosts, {}),
      allPorts = [];
    class Root extends rop.TF {
      constructor(sender) {
        super();
        this.sender = sender;
      }
      getManagers() {
        return router.bindManagers(service, this.sender);
      }
    }
    function connect(sender) {
      const channel = new MessageChannel(),
        server = new Transport(channel.port1),
        client = new Transport(channel.port2);
      allPorts.push(server, client);
      new rop.oB(server, new Root(sender));
      return new rop.oB(client).getRemoteMain();
    }
    t.after(() => {
      for (const p of allPorts) p.abort(Error("fixture closed"));
    });
    const [serviceA, serviceB] = await Promise.all([
      connect(a.window.webContents).getManagers(),
      connect(b.window.webContents).getManagers(),
    ]);
    const [stateA, stateB] = await Promise.all([
      serviceA.open("local"),
      serviceB.open("local"),
    ]);
    assert.equal(stateA.status, "ready");
    assert.equal(stateB.status, "ready");
    assert.deepEqual(
      await Promise.all([
        stateA.manager.resumeConversation({ conversationId: "one", pause: 15 }),
        stateB.manager.resumeConversation({ conversationId: "two", pause: 5 }),
      ]),
      [2, 3],
    );
    let seenA, seenB;
    const [subA, subB] = await Promise.all([
      serviceA.subscribe("local", (s) => {
        seenA = s.manager.dup();
      }),
      serviceB.subscribe("local", (s) => {
        seenB = s.manager.dup();
      }),
    ]);
    for (const watch of watchers) watch();
    for (let i = 0; i < 100 && (!seenA || !seenB); i++) await delay(5);
    assert.ok(seenA && seenB);
    assert.deepEqual(
      await Promise.all([
        seenA.resumeConversation({ conversationId: "three", pause: 15 }),
        seenB.resumeConversation({ conversationId: "four", pause: 5 }),
      ]),
      [2, 3],
    );
    seenA[Symbol.dispose]();
    seenB[Symbol.dispose]();
    await Promise.all([subA.unsubscribe(), subB.unsubscribe()]);
    assert.equal(watchers.size, 0);
    slow = true;
    const first = stateA.manager.resumeConversation({
      conversationId: "shared",
    });
    await delay(10);
    await assert.rejects(
      Promise.resolve(
        stateB.manager.resumeConversation({ conversationId: "shared" }),
      ),
      /Dynamic tools routing unavailable/,
    );
    release();
    assert.equal(await first, 2);
  },
);

test(
  "original request cleanup resolves only the destroyed originating view without accepting late replies",
  { skip: !pinned, timeout: 15000 },
  async () => {
    const original = await members(pinned),
      source = adaptDynamicToolsChunk({
        body: Buffer.from(original.main),
      }).body.toString("utf8");
    const req = extract(
      source,
      "requestDynamicToolsAndHostedAutomationAppForThreadStart(e,t,r){",
      "resolvePendingDynamicToolsForThreadStartRequestsForOrigin(e){",
    );
    const clean = extract(
      source,
      "resolvePendingDynamicToolsForThreadStartRequestsForOrigin(e){",
      "handleDynamicToolsForThreadStartResponse(e,t){",
    );
    const respond = extract(
      source,
      "handleDynamicToolsForThreadStartResponse(e,t){",
      "sendPersistedAtomState(e,t){",
    );
    const a = view(2),
      b = view(3),
      records = new Map([
        [2, a],
        [3, b],
      ]),
      owned = new WeakMap([
        [a.window.webContents, a],
        [b.window.webContents, b],
      ]),
      messages = [];
    const router = createDynamicToolsRouter({
      getRecord: (id) => records.get(id),
      getOwnedRecord: (sender) => owned.get(sender),
    });
    const Native = new Function(
      "tb",
      "eeP",
      "select",
      "messages",
      `class Native{constructor(){this.hostId='local';this.pendingDynamicToolsForThreadStartRequests=new Map;this.windowManager={getPrimaryWindow:()=>null}}sendMessageToOrigin(w,m){messages.push({w,m})}${req}${clean}${respond}};return Native`,
    )(
      { randomUUID },
      () => ({ warning() {} }),
      () => router.selectWindow(),
      messages,
    );
    // The fixed native edit references this name. Installing it only in this
    // isolated test process does not touch an Electron process or user instance.
    Object.defineProperty(globalThis, "__kanbanSelectDynamicToolsWindow", {
      value: () => router.selectWindow(),
      configurable: true,
    });
    try {
      const native = new Native(),
        mgr = {
          resumeConversation() {
            return native.requestDynamicToolsAndHostedAutomationAppForThreadStart(
              null,
              "default",
            );
          },
        };
      const A = router
        .bindManagers(
          {
            open() {
              return { status: "ready", manager: mgr };
            },
          },
          a.window.webContents,
        )
        .open("local").manager;
      const B = router
        .bindManagers(
          {
            open() {
              return { status: "ready", manager: mgr };
            },
          },
          b.window.webContents,
        )
        .open("local").manager;
      const first = A.resumeConversation({ conversationId: "one" }),
        second = B.resumeConversation({ conversationId: "two" });
      assert.equal(messages.length, 2);
      records.delete(a.senderId);
      native.resolvePendingDynamicToolsForThreadStartRequestsForOrigin(
        a.window.webContents,
      );
      assert.equal(await first, null);
      native.handleDynamicToolsForThreadStartResponse(b.window.webContents, {
        requestId: messages[0].m.requestId,
        dynamicTools: ["late"],
        hostedAutomationsAvailable: true,
      });
      native.handleDynamicToolsForThreadStartResponse(b.window.webContents, {
        requestId: messages[1].m.requestId,
        dynamicTools: ["right"],
        hostedAutomationsAvailable: false,
      });
      assert.equal((await second).dynamicTools[0], "right");
      assert.equal(native.pendingDynamicToolsForThreadStartRequests.size, 0);
    } finally {
      delete globalThis.__kanbanSelectDynamicToolsWindow;
    }
  },
);
