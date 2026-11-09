import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const {
  createDynamicToolsRouter,
  adaptDynamicToolsChunk,
} = require("../src/dynamic-tools-routing.cjs");
function view(id) {
  const sender = new EventEmitter();
  sender.id = id;
  let destroyed = false;
  sender.isDestroyed = () => destroyed;
  const window = {
    webContents: sender,
    isDestroyed: () => destroyed,
    destroy() {
      destroyed = true;
      sender.emit("destroyed");
    },
  };
  return { senderId: id, window, failed: false };
}
function makeRouter(records) {
  const owned = new WeakMap(
    [...records.values()].map((r) => [r.window.webContents, r]),
  );
  return createDynamicToolsRouter({
    getRecord: (id) => records.get(id),
    getOwnedRecord: (sender) => owned.get(sender),
  });
}
const defer = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const connected = (manager) => ({
  open() {
    return { status: "ready", manager };
  },
});

test("concurrent private manager calls choose the originating view after awaits", async () => {
  const a = view(2),
    b = view(3),
    records = new Map([
      [2, a],
      [3, b],
    ]),
    router = makeRouter(records);
  const mgr = {
    async resumeConversation({ delayMs }) {
      await delay(delayMs);
      return router.selectWindow();
    },
  };
  const A = router
    .bindManagers(connected(mgr), a.window.webContents)
    .open("local").manager;
  const B = router
    .bindManagers(connected(mgr), b.window.webContents)
    .open("local").manager;
  assert.deepEqual(
    await Promise.all([
      A.resumeConversation({ conversationId: "one", delayMs: 20 }),
      B.resumeConversation({ conversationId: "two", delayMs: 5 }),
    ]),
    [a.window, b.window],
  );
  assert.equal(router.selectWindow(), undefined);
});

test("retired, destroyed and failed views never fall back to another view or start a new call", async () => {
  for (const invalidate of [
    (r, m) => m.delete(r.senderId),
    (r) => r.window.destroy(),
    (r) => {
      r.failed = true;
    },
  ]) {
    const a = view(2),
      b = view(3),
      records = new Map([
        [2, a],
        [3, b],
      ]),
      router = makeRouter(records),
      gate = defer();
    let invoked = 0;
    const mgr = {
      async resumeConversation() {
        invoked++;
        await gate.promise;
        return router.selectWindow();
      },
    };
    const bound = router
      .bindManagers(connected(mgr), a.window.webContents)
      .open("local").manager;
    const pending = bound.resumeConversation({ conversationId: "same" });
    invalidate(a, records);
    gate.resolve();
    assert.equal(await pending, null);
    await assert.rejects(
      async () => bound.resumeConversation({ conversationId: "other" }),
      { code: "DYNAMIC_TOOLS_VIEW_UNAVAILABLE" },
    );
    assert.equal(invoked, 1);
  }
});

test("late owned views and expired async descendants fail closed, unowned service stays unchanged", async () => {
  const a = view(2),
    records = new Map([[2, a]]),
    router = makeRouter(records),
    gate = defer();
  let escaped;
  const mgr = {
    async startConversation() {
      escaped = (async () => {
        await gate.promise;
        return router.selectWindow();
      })();
      return "done";
    },
  };
  const service = connected(mgr),
    bound = router
      .bindManagers(service, a.window.webContents)
      .open("local").manager;
  assert.equal(await bound.startConversation({}), "done");
  gate.resolve();
  assert.equal(await escaped, null);
  records.delete(2);
  assert.throws(
    () => router.bindManagers(service, a.window.webContents).open("local"),
    { code: "DYNAMIC_TOOLS_VIEW_UNAVAILABLE" },
  );
  assert.equal(router.bindManagers(service, { id: 999 }), service);
});

test("subscription callbacks retain view identity through dup, RPC break and disposal", async () => {
  const a = view(2),
    b = view(3),
    records = new Map([
      [2, a],
      [3, b],
    ]),
    router = makeRouter(records),
    callbacks = [],
    breakers = [];
  let disposed = 0,
    broken = 0;
  const mgr = {
    async resumeConversation() {
      await delay(1);
      return router.selectWindow();
    },
  };
  const service = {
    open() {
      return { status: "ready", manager: mgr };
    },
    subscribe(host, callback) {
      const duplicate = callback.dup();
      callbacks.push(duplicate);
      duplicate.onRpcBroken(() => {
        broken++;
      });
      return {
        unsubscribe() {
          duplicate[Symbol.dispose]();
        },
      };
    },
  };
  const seen = [];
  function callback(value) {
    seen.push(value.manager);
  }
  callback.dup = () => {
    const copy = (value) => callback(value);
    copy.dup = () => copy;
    copy.onRpcBroken = (fn) => {
      breakers.push(fn);
    };
    copy[Symbol.dispose] = () => {
      disposed++;
    };
    return copy;
  };
  const subA = router
      .bindManagers(service, a.window.webContents)
      .subscribe("local", callback),
    subB = router
      .bindManagers(service, b.window.webContents)
      .subscribe("local", callback);
  callbacks[0]({ status: "ready", manager: mgr });
  callbacks[1]({ status: "ready", manager: mgr });
  assert.deepEqual(
    await Promise.all([
      seen[0].resumeConversation({ conversationId: "one" }),
      seen[1].resumeConversation({ conversationId: "two" }),
    ]),
    [a.window, b.window],
  );
  breakers[0]();
  assert.equal(broken, 1);
  subA.unsubscribe();
  subB.unsubscribe();
  assert.equal(disposed, 2);
});

test("same-thread concurrent resume from another view is refused, then works after settlement", async () => {
  const a = view(2),
    b = view(3),
    records = new Map([
      [2, a],
      [3, b],
    ]),
    router = makeRouter(records),
    gate = defer();
  let calls = 0;
  const mgr = {
    async resumeConversation() {
      calls++;
      if (calls === 1) await gate.promise;
      return router.selectWindow();
    },
  };
  const A = router
      .bindManagers(connected(mgr), a.window.webContents)
      .open("local").manager,
    B = router
      .bindManagers(connected(mgr), b.window.webContents)
      .open("local").manager;
  const first = A.resumeConversation({ conversationId: "shared" });
  await assert.rejects(
    async () => B.resumeConversation({ conversationId: "shared" }),
    { code: "DYNAMIC_TOOLS_VIEW_CONFLICT" },
  );
  assert.equal(calls, 1);
  gate.resolve();
  assert.equal(await first, a.window);
  assert.equal(
    await B.resumeConversation({ conversationId: "shared" }),
    b.window,
  );
});

test("manager wrappers retain private receiver, identity and cross-realm promise lifetime", async () => {
  const a = view(2),
    records = new Map([[2, a]]),
    router = makeRouter(records),
    d = vm.runInNewContext(
      "(()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}})()",
    ),
    gate = defer();
  let late;
  class Manager {
    #value = 7;
    resumeConversation() {
      late = (async () => {
        await gate.promise;
        return router.selectWindow();
      })();
      return d.promise;
    }
    getNumber() {
      return this.#value;
    }
  }
  const target = new Manager(),
    bound = router
      .bindManagers(connected(target), a.window.webContents)
      .open("local").manager;
  assert.ok(bound instanceof Manager);
  assert.equal(bound.constructor, Manager);
  assert.equal(bound.getNumber(), 7);
  assert.equal(bound.resumeConversation, bound.resumeConversation);
  const result = bound.resumeConversation({ conversationId: "one" });
  d.resolve("done");
  assert.equal(await result, "done");
  gate.resolve();
  assert.equal(await late, null);
});

async function originalChunk(root) {
  const fd = await open(join(root, "resources", "app.asar"), "r");
  try {
    const prefix = Buffer.alloc(16);
    await fd.read(prefix, 0, 16, 0);
    const header = Buffer.alloc(prefix.readUInt32LE(12));
    await fd.read(header, 0, header.length, 16);
    let item = JSON.parse(header.toString());
    for (const part of ".vite/build/early-bootstrap-439-a0f25ba32c465de1.js".split(
      "/",
    ))
      item = item.files[part];
    const body = Buffer.alloc(item.size);
    await fd.read(
      body,
      0,
      body.length,
      8 + prefix.readUInt32LE(4) + Number(item.offset),
    );
    assert.equal(
      createHash("sha256").update(body).digest("hex"),
      "c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333",
    );
    return body;
  } finally {
    await fd.close();
  }
}
function section(source, first, next) {
  const a = source.indexOf(first),
    b = source.indexOf(next, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}

test(
  "original dynamic request preserves actual origin checks and rejects another view response",
  { skip: !process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT },
  async () => {
    const original = await originalChunk(
      process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT,
    );
    const adapted = adaptDynamicToolsChunk({ body: original });
    const source = adapted.body.toString("utf8");
    assert.equal(
      adapted.adaptedSha256,
      "362690aa7cebb9bcdf64a4037cfb6fe1e1ab09b2f4a547db67059502bd963c70",
    );
    assert.throws(
      () =>
        adaptDynamicToolsChunk({ body: Buffer.from("unrecognized version") }),
      { code: "DYNAMIC_TOOLS_DIGEST_MISMATCH" },
    );
    const req = section(
      source,
      "requestDynamicToolsAndHostedAutomationAppForThreadStart(e,t,r){",
      "resolvePendingDynamicToolsForThreadStartRequestsForOrigin(e){",
    );
    const clean = section(
      source,
      "resolvePendingDynamicToolsForThreadStartRequestsForOrigin(e){",
      "handleDynamicToolsForThreadStartResponse(e,t){",
    );
    const respond = section(
      source,
      "handleDynamicToolsForThreadStartResponse(e,t){",
      "sendPersistedAtomState(e,t){",
    );
    const a = view(2),
      b = view(3),
      blank = view(1),
      records = new Map([
        [2, a],
        [3, b],
      ]),
      router = makeRouter(records),
      messages = [];
    const context = {
      tb: { randomUUID },
      setTimeout,
      clearTimeout,
      eeP: () => ({ warning() {} }),
      __kanbanSelectDynamicToolsWindow: () => router.selectWindow(),
    };
    const Native = vm.runInNewContext(
      `class Native{constructor(){this.hostId='local';this.pendingDynamicToolsForThreadStartRequests=new Map;this.windowManager={getPrimaryWindow:()=>blank};}sendMessageToOrigin(w,m){messages.push({w,m})}${req}${clean}${respond}};Native`,
      { ...context, blank: blank.window, messages },
    );
    const native = new Native();
    const mgr = {
      async resumeConversation() {
        return native.requestDynamicToolsAndHostedAutomationAppForThreadStart(
          null,
          "default",
        );
      },
    };
    const A = router
        .bindManagers(connected(mgr), a.window.webContents)
        .open("local").manager,
      B = router
        .bindManagers(connected(mgr), b.window.webContents)
        .open("local").manager;
    const first = A.resumeConversation({ conversationId: "one" }),
      second = B.resumeConversation({ conversationId: "two" });
    assert.equal(messages.length, 2);
    assert.equal(messages[0].w, a.window.webContents);
    assert.equal(messages[1].w, b.window.webContents);
    let done = false;
    first.then(() => (done = true));
    native.handleDynamicToolsForThreadStartResponse(b.window.webContents, {
      requestId: messages[0].m.requestId,
      dynamicTools: ["forged"],
      hostedAutomationsAvailable: true,
    });
    await delay(5);
    assert.equal(done, false);
    native.handleDynamicToolsForThreadStartResponse(a.window.webContents, {
      requestId: messages[0].m.requestId,
      dynamicTools: ["a"],
      hostedAutomationsAvailable: true,
    });
    native.handleDynamicToolsForThreadStartResponse(b.window.webContents, {
      requestId: messages[1].m.requestId,
      dynamicTools: ["b"],
      hostedAutomationsAvailable: false,
    });
    assert.equal((await first).dynamicTools[0], "a");
    assert.equal((await second).dynamicTools[0], "b");
  },
);
