import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { encodeWireValue, decodeWireValue } from "../src/wire-value.mjs";
import {
  startDesktopDocument,
  createDesktopDocumentStarter,
} from "../src/browser-entry.mjs";
import { createBrowserSurfaceController } from "../src/browser-surface-controller.mjs";
import { installDesktopSurfaceHost } from "../src/surface-host-bridge.mjs";

const scope = Object.freeze({
  profileId: "43e56e8a-de3f-40fb-8cf3-7177d17d24f1",
  generation: "b94128f4-288c-4c97-a5cb-891555dc8199",
  viewId: "9d79066f-f08f-4f00-a75e-e24cc65e5d00",
});
const entry = "./assets/index-5a9cde31.js";
const pathname = `/chatgpt-desktop/${scope.profileId}/${scope.generation}/webview/index.html`;
const bootstrap = () => ({
  v: 1,
  type: "bootstrap",
  scope,
  bootstrap: {
    windowType: "electron",
    getters: { getBuildFlavor: "stable" },
    sharedObjects: {},
  },
});

class Events {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type, event = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }
}
class Node extends Events {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.style = {};
    this.attributes = {};
    this.textContent = "";
    this.parentNode = null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    this.onAppend?.(child);
    return child;
  }
  click() {
    this.dispatch("click", { isTrusted: true });
  }
}
class Socket extends Events {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.bufferedAmount = 0;
    this.sent = [];
    this.flowAcks = [];
    this.nextDelivery = 0;
    this.closeCount = 0;
    Socket.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.dispatch("open", {});
  }
  message(data) {
    // Simulate the new fixed gateway envelope while preserving exact native
    // frame payloads. rawMessage exists for explicit mismatch/sequence tests.
    this.rawMessage(typeof data === 'string' ? 'KBC1:' + scope.viewId + ':' + this.nextDelivery++ + '\n' + data : data);
  }
  rawMessage(data) { this.dispatch("message", { data }); }
  error() {
    this.dispatch("error", {});
  }
  close() {
    this.closeCount++;
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatch("close", {});
  }
  send(value) {
    if (this.throwOnSend) throw new Error("secret backend payload");
    if (typeof value === 'string' && value.startsWith('KBA1:')) this.flowAcks.push(value);
    else this.sent.push(value);
  }
}
Socket.all = [];
function fixture({
  url = `https://kanban.example:8443${pathname}`,
  manifest,
  manifests,
  baseURI,
} = {}) {
  Socket.all.length = 0;
  const location = new URL(url),
    manifestNode = new Node("script");
  manifestNode.id = "chatgpt-host-manifest";
  manifestNode.type = "application/json";
  manifestNode.textContent =
    manifest === undefined
      ? JSON.stringify({
          version: 1,
          profileId: scope.profileId,
          generation: scope.generation,
          entry,
        })
      : manifest;
  const root = new Node("div");
  root.id = "root";
  root.textContent = "original root survives";
  const body = new Node("body");
  body.appendChild(root);
  const head = new Node("head");
  const doc = {
    body,
    head,
    baseURI: baseURI ?? location.href,
    querySelectorAll(selector) {
      return selector === "#chatgpt-host-manifest"
        ? (manifests ?? [manifestNode])
        : [];
    },
    createElement(tag) {
      return new Node(tag);
    },
  };
  let reloads = 0;
  const events = new Events();
  const win = {
    document: doc,
    location: {
      href: location.href,
      origin: location.origin,
      protocol: location.protocol,
      pathname: location.pathname,
      reload() {
        reloads++;
      },
    },
    WebSocket: Socket,
    performance: { timeOrigin: 1 },
    isSecureContext: true,
    crypto: { randomUUID: () => scope.viewId, subtle: {} },
    MessageEvent: class {
      constructor(type, options) {
        this.type = type;
        Object.assign(this, options);
      }
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent(event) {
      events.dispatch(event.type, event);
    },
    setTimeout,
    clearTimeout,
  };
  const beforeScript = [],
    policyBeforeScript = [];
  head.onAppend = (node) => {
    if (node.tagName === "SCRIPT") {
      beforeScript.push(Boolean(win.electronBridge));
      policyBeforeScript.push(win.__kanbanCodexOnlySurface === true);
    }
  };
  return {
    win,
    doc,
    root,
    head,
    body,
    manifestNode,
    events,
    beforeScript,
    policyBeforeScript,
    get reloads() {
      return reloads;
    },
  };
}
function options(f, extra = {}) {
  return { window: f.win, handshakeTimeoutMs: 1000, ...extra };
}
function findStatus(f) {
  return f.body.children.find((x) => x.id === "chatgpt-host-connection-status");
}
function findButton(f) {
  return findStatus(f)?.children.find((x) => x.tagName === "BUTTON");
}
function text(node) {
  return [node.textContent, ...node.children.map(text)].join(" ");
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function ready(f, opts = {}) {
  const starting = startDesktopDocument(options(f, opts));
  const socket = Socket.all.at(-1);
  assert.ok(socket);
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  const controller = await starting;
  return { socket, controller };
}

test("imports safely in Node and does not access document during import", async () => {
  const module = await import("../src/browser-entry.mjs");
  assert.equal(typeof module.startDesktopDocument, "function");
  const source = `Object.defineProperty(globalThis,'document',{get(){throw Error('document accessed')}}); Object.defineProperty(globalThis,'window',{get(){throw Error('window accessed')}}); import(${JSON.stringify(new URL("../src/browser-entry.mjs", import.meta.url).href)}).then(()=>process.stdout.write('ok')).catch(()=>process.exit(1));`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "ok");
});

test("loads the original relative entry only after scoped bootstrap and bridge installation", async () => {
  const f = fixture(),
    starting = startDesktopDocument(options(f));
  assert.equal(Socket.all.length, 1);
  const socket = Socket.all[0];
  assert.equal(
    socket.url,
    `wss://kanban.example:8443/chatgpt-desktop/${scope.profileId}/${scope.generation}/bridge`,
  );
  assert.equal(f.head.children.length, 0);
  socket.open();
  assert.equal(f.head.children.length, 0);
  socket.message(encodeWireValue(bootstrap()));
  const controller = await starting;
  assert.deepEqual(controller.scope, scope);
  assert.deepEqual(f.beforeScript, [true]);
  assert.deepEqual(f.policyBeforeScript, [true]);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(f.win, "__kanbanCodexOnlySurface"),
    { value: true, writable: false, enumerable: false, configurable: false },
  );
  assert.equal(f.head.children.length, 1);
  assert.equal(f.head.children[0].type, "module");
  assert.equal(f.head.children[0].getAttribute("src"), entry);
  assert.equal(f.win.electronBridge.getBuildFlavor(), "stable");
  assert.equal(f.root.textContent, "original root survives");
  assert.equal(findStatus(f), undefined);
  controller.close();
});

test("binds local mode activation only from the validated native bootstrap and disposes it on disconnect", async () => {
  const f = fixture(),
    parent = {
      document: {},
      location: { origin: f.win.location.origin, href: f.win.location.href },
    };
  f.win.parent = parent;
  f.win.frameElement = {
    localName: "iframe",
    ownerDocument: parent.document,
    contentWindow: f.win,
    contentDocument: f.doc,
    isConnected: true,
    src: f.win.location.href,
  };
  const owner = installDesktopSurfaceHost({
    window: parent,
    frame: f.win.frameElement,
    profileId: scope.profileId,
    generation: scope.generation,
  });
  owner.confirmActive(true);
  const { socket, controller } = await ready(f);
  const activation = f.win.__kanbanDesktopSurfaceActivation;
  assert.ok(activation);
  assert.deepEqual(Object.keys(activation).sort(), [
    "getSnapshot",
    "isCurrent",
    "subscribe",
  ]);
  const token = activation.getSnapshot();
  assert.ok(token);
  owner.confirmActive(false);
  assert.equal(activation.isCurrent(token), false);
  owner.confirmActive(true);
  const next = activation.getSnapshot();
  assert.ok(next);
  assert.equal(
    Object.getOwnPropertyDescriptor(f.win, "__kanbanDesktopSurfaceActivation")
      .writable,
    false,
  );
  socket.error();
  assert.equal(activation.isCurrent(next), false);
  controller.close();
  owner.close();
});

test("uses ws for secure localhost HTTP and ignores query or hash when constructing the fixed same-origin URL", async () => {
  const f = fixture({
    url: `http://localhost:8484${pathname}?mode=chatgpt#part`,
  });
  const { socket, controller } = await ready(f);
  assert.equal(
    socket.url,
    `ws://localhost:8484/chatgpt-desktop/${scope.profileId}/${scope.generation}/bridge`,
  );
  controller.close();
});

test("requires a browser secure context and crypto before opening a native view", async () => {
  for (const missing of ["secure-context", "uuid", "subtle"]) {
    const f = fixture({ url: `http://10.30.0.26:8484${pathname}` });
    if (missing === "secure-context") f.win.isSecureContext = false;
    if (missing === "uuid") f.win.crypto.randomUUID = undefined;
    if (missing === "subtle") f.win.crypto.subtle = undefined;
    await assert.rejects(startDesktopDocument(options(f)), {
      code: "ENTRY_SECURE_CONTEXT_REQUIRED",
    });
    assert.equal(Socket.all.length, 0);
    assert.equal(f.head.children.length, 0);
    assert.ok(text(findStatus(f)).includes("HTTPS"));
    assert.equal(findButton(f), undefined);
  }
});

test("rejects invalid manifest, location, base and arbitrary entries before opening a socket", async () => {
  const values = [
    { manifest: "{" },
    {
      manifest: JSON.stringify({
        version: 1,
        profileId: scope.profileId,
        generation: scope.generation,
        entry: "https://evil.invalid/index.js",
      }),
    },
    {
      manifest: JSON.stringify({
        version: 1,
        profileId: scope.profileId,
        generation: scope.generation,
        entry: "./assets/index-1.js?x=1",
      }),
    },
    {
      manifest: JSON.stringify({
        version: 1,
        profileId: scope.profileId,
        generation: scope.generation,
        entry: "./assets/index-a.js",
        extra: true,
      }),
    },
    {
      manifest: `{"version":0,"version":1,"profileId":"${scope.profileId}","generation":"${scope.generation}","entry":"${entry}"}`,
    },
    {
      url: `https://kanban.example/chatgpt-desktop/${scope.generation}/${scope.generation}/webview/index.html`,
    },
    { url: `file://${pathname}` },
    { baseURI: "https://evil.invalid/" },
    { manifests: [] },
    { manifests: [new Node("script"), new Node("script")] },
  ];
  for (const value of values) {
    const f = fixture(value);
    await assert.rejects(startDesktopDocument(options(f)));
    assert.equal(Socket.all.length, 0);
    assert.equal(f.head.children.length, 0);
    assert.equal(f.root.textContent, "original root survives");
    assert.ok(findStatus(f));
  }
});

test("invalid bootstrap fails closed, preserves the root, and never shows native payload", async () => {
  const f = fixture(),
    starting = startDesktopDocument(options(f));
  const socket = Socket.all[0];
  socket.open();
  socket.message(
    encodeWireValue({
      ...bootstrap(),
      scope: { ...scope, generation: scope.profileId },
      secret: "private token abc",
    }),
  );
  await assert.rejects(starting, { code: "ENTRY_INVALID_BOOTSTRAP" });
  assert.equal(socket.closeCount, 1);
  assert.equal(f.head.children.length, 0);
  assert.equal(f.root.textContent, "original root survives");
  assert.ok(findStatus(f));
  assert.ok(findButton(f));
  assert.ok(!text(findStatus(f)).includes("private token abc"));
  assert.equal(f.reloads, 0);
  assert.equal(Socket.all.length, 1);
  findButton(f).dispatch("click", { isTrusted: false });
  assert.equal(f.reloads, 0);
  findButton(f).click();
  assert.equal(f.reloads, 1);
});

test("rejects malformed bootstrap fields and binary frames", async () => {
  for (const frame of [
    encodeWireValue({
      ...bootstrap(),
      bootstrap: { windowType: "browser", getters: {}, sharedObjects: {} },
    }),
    encodeWireValue({
      ...bootstrap(),
      scope: { ...scope, viewId: "not-a-uuid" },
    }),
    encodeWireValue({
      ...bootstrap(),
      bootstrap: { windowType: "electron", getters: [], sharedObjects: {} },
    }),
    "{not-wire}",
    new Uint8Array([123, 125]),
  ]) {
    const f = fixture(),
      starting = startDesktopDocument(options(f));
    const socket = Socket.all[0];
    socket.open();
    socket.message(frame);
    await assert.rejects(starting);
    assert.equal(f.head.children.length, 0);
    assert.equal(socket.closeCount, 1);
  }
});

test("handshake timeout or socket error shows only manual retry and does not reconnect", async () => {
  for (const kind of ["timeout", "error", "close"]) {
    const f = fixture(),
      starting = startDesktopDocument(options(f, { handshakeTimeoutMs: 10 }));
    const socket = Socket.all[0];
    if (kind === "error") socket.error();
    if (kind === "close") socket.close();
    await assert.rejects(starting);
    await flush();
    assert.equal(Socket.all.length, 1);
    assert.equal(f.reloads, 0);
    assert.equal(f.head.children.length, 0);
    assert.ok(findButton(f));
    findButton(f).click();
    assert.equal(f.reloads, 1);
  }
});

test("forwards encoded frames exactly, preserves scope/sequence and receives native state", async () => {
  const f = fixture(),
    { socket, controller } = await ready(f);
  const sending = f.win.electronBridge.sendMessageFromView({
    type: "fixture",
    value: "一",
  });
  await flush();
  assert.equal(socket.sent.length, 1);
  const outgoing = decodeWireValue(socket.sent[0]);
  assert.deepEqual(outgoing.scope, scope);
  assert.equal(outgoing.seq, 1);
  socket.message(
    encodeWireValue({
      v: 1,
      scope,
      seq: 1,
      type: "return",
      id: outgoing.id,
      value: undefined,
    }),
  );
  await sending;
  socket.message(
    encodeWireValue({ v: 1, scope, seq: 2, type: "theme", value: "dark" }),
  );
  assert.equal(f.win.electronBridge.getSystemThemeVariant(), "dark");
  controller.close();
});

test("rejects UTF-8 byte overflow and binary messages after bootstrap without replay", async () => {
  for (const data of ["é".repeat(513), new Uint8Array([1, 2, 3])]) {
    const f = fixture(),
      { socket } = await ready(f, { maxFrameBytes: 1024 });
    socket.message(data);
    await flush();
    assert.ok(findStatus(f));
    assert.equal(socket.closeCount, 1);
    assert.equal(socket.sent.length, 0);
    assert.equal(Socket.all.length, 1);
    assert.equal(f.reloads, 0);
  }
});

test("bounded WebSocket bufferedAmount stops the bridge without sending or retrying", async () => {
  const f = fixture(),
    { socket } = await ready(f, { maxBufferedBytes: 1024 });
  socket.bufferedAmount = 1024;
  await assert.rejects(
    f.win.electronBridge.sendMessageFromView({ type: "hello" }),
  );
  await flush();
  assert.equal(socket.sent.length, 0);
  assert.equal(socket.closeCount, 1);
  assert.equal(Socket.all.length, 1);
  assert.equal(f.reloads, 0);
  assert.ok(findStatus(f));
});

test("socket loss or bridge protocol failure after startup becomes visible and closes once", async () => {
  for (const kind of ["socket", "bridge"]) {
    const f = fixture(),
      { socket } = await ready(f);
    if (kind === "socket") socket.error();
    else
      socket.message(
        encodeWireValue({
          v: 1,
          scope: { ...scope, profileId: scope.generation },
          seq: 1,
          type: "theme",
          value: "dark",
        }),
      );
    await flush();
    assert.equal(socket.closeCount, 1);
    assert.ok(findStatus(f));
    assert.equal(f.reloads, 0);
    assert.equal(f.root.textContent, "original root survives");
  }
});

test("bridge failure retains its first bounded cause code without exposing payloads or replaying", async () => {
  for (const kind of ["scope", "unsupported"]) {
    const f = fixture(),
      { socket } = await ready(f);
    if (kind === "scope") {
      socket.message(
        encodeWireValue({
          v: 1,
          scope: { ...scope, viewId: scope.profileId },
          seq: 1,
          type: "theme",
          value: "dark",
        }),
      );
    } else {
      await assert.rejects(
        f.win.electronBridge.sendMessageFromView({
          type: "PRIVATE_PAYLOAD_SENTINEL",
          value: () => {},
        }),
      );
    }
    await flush();
    const box = findStatus(f),
      cause =
        kind === "scope" ? "BRIDGE_SCOPE_CHANGED" : "BRIDGE_UNSUPPORTED_VALUE";
    assert.equal(box?.getAttribute("data-error-code"), "ENTRY_BRIDGE_FAILED");
    assert.equal(box?.getAttribute("data-bridge-error-code"), cause);
    socket.error();
    await flush();
    assert.equal(findStatus(f), box);
    assert.equal(box.getAttribute("data-bridge-error-code"), cause);
    assert.ok(
      !JSON.stringify(box.attributes).includes("PRIVATE_PAYLOAD_SENTINEL"),
    );
    assert.ok(!text(box).includes(cause));
    assert.equal(socket.sent.length, 0);
    assert.equal(socket.closeCount, 1);
    assert.equal(Socket.all.length, 1);
    assert.equal(f.reloads, 0);
  }
});

test("exposes only an own, fixed queue limit kind from the first bridge failure", async () => {
  const cases = [
    { code: "BRIDGE_QUEUE_FULL", value: "waiting_count", expected: "waiting_count" },
    { code: "BRIDGE_QUEUE_FULL", value: "queued_bytes", expected: "queued_bytes" },
    { code: "BRIDGE_QUEUE_FULL", value: "snapshot_bytes", expected: "snapshot_bytes" },
    { code: "BRIDGE_QUEUE_FULL", value: "PRIVATE_PAYLOAD_SENTINEL", expected: null },
    { code: "BRIDGE_NATIVE_ERROR", value: "waiting_count", expected: null },
    { code: "BRIDGE_QUEUE_FULL", accessor: true, expected: null },
    { code: "BRIDGE_QUEUE_FULL", inherited: true, expected: null },
  ];
  for (const item of cases) {
    const f = fixture(), { socket } = await ready(f);
    let getterCalls = 0;
    const reason = item.inherited ? Object.create({ limitKind: "waiting_count" }) : {};
    Object.defineProperty(reason, "code", { value: item.code });
    if (item.accessor) Object.defineProperty(reason, "limitKind", { get() { getterCalls++; return "waiting_count"; } });
    else if (!item.inherited) Object.defineProperty(reason, "limitKind", { value: item.value });
    const handlers = new Map();
    const port = {
      addEventListener(type, callback) { handlers.set(type, callback); },
      postMessage() {}, start() {}, close() {},
    };
    f.events.dispatch("message", { source: f.win, data: { type: "connect-app-host", port } });
    assert.equal(typeof handlers.get("message"), "function");
    handlers.get("message")({ data: new Proxy({}, { ownKeys() { throw reason; } }) });
    await flush();
    const box = findStatus(f);
    assert.equal(box?.getAttribute("data-error-code"), "ENTRY_BRIDGE_FAILED");
    assert.equal(box?.getAttribute("data-bridge-error-code"), item.code);
    assert.equal(box?.getAttribute("data-bridge-limit-code"), item.expected);
    assert.equal(getterCalls, 0);
    assert.ok(!JSON.stringify(box.attributes).includes("PRIVATE_PAYLOAD_SENTINEL"));
    socket.error();
    assert.equal(findStatus(f), box);
    assert.equal(box?.getAttribute("data-bridge-limit-code"), item.expected);
    assert.equal(f.reloads, 0);
  }
});

test("exposes only an own fixed unknown outcome cause from the first bridge failure", async () => {
  const cases = [
    { code: "BRIDGE_OUTCOME_UNKNOWN", value: "send_failure", expected: "send_failure" },
    { code: "BRIDGE_OUTCOME_UNKNOWN", value: "request_timeout", expected: "request_timeout" },
    { code: "BRIDGE_OUTCOME_UNKNOWN", value: "port_closed_queued", expected: "port_closed_queued" },
    { code: "BRIDGE_OUTCOME_UNKNOWN", value: "PRIVATE_PAYLOAD_SENTINEL", expected: null },
    { code: "BRIDGE_SCOPE_CHANGED", value: "request_timeout", expected: null },
    { code: "BRIDGE_OUTCOME_UNKNOWN", accessor: true, expected: null },
    { code: "BRIDGE_OUTCOME_UNKNOWN", inherited: true, expected: null },
  ];
  for (const item of cases) {
    const f = fixture(), { socket } = await ready(f);
    let getterCalls = 0;
    const reason = item.inherited ? Object.create({ causeKind: "request_timeout" }) : {};
    Object.defineProperty(reason, "code", { value: item.code });
    Object.defineProperty(reason, "timedOutRequest", { get() { getterCalls++; return {method:'PRIVATE_PAYLOAD_SENTINEL'}; } });
    if (item.accessor) Object.defineProperty(reason, "causeKind", { get() { getterCalls++; return "request_timeout"; } });
    else if (!item.inherited) Object.defineProperty(reason, "causeKind", { value: item.value });
    const handlers = new Map();
    const port = {
      addEventListener(type, callback) { handlers.set(type, callback); },
      postMessage() {}, start() {}, close() {},
    };
    f.events.dispatch("message", { source: f.win, data: { type: "connect-app-host", port } });
    handlers.get("message")({ data: new Proxy({}, { ownKeys() { throw reason; } }) });
    await flush();
    const box = findStatus(f);
    assert.equal(box?.getAttribute("data-error-code"), "ENTRY_BRIDGE_FAILED");
    assert.equal(box?.getAttribute("data-bridge-error-code"), item.code);
    assert.equal(box?.getAttribute("data-bridge-cause-code"), item.expected);
    assert.equal(getterCalls, 0);
    assert.ok(!JSON.stringify(box.attributes).includes("PRIVATE_PAYLOAD_SENTINEL"));
    socket.error();
    assert.equal(findStatus(f), box);
    assert.equal(box?.getAttribute("data-bridge-cause-code"), item.expected);
    assert.equal(f.reloads, 0);
  }
});

test("reports an actual bridge request timeout without retransmitting", async (t) => {
  const f = fixture(),
    { socket } = await ready(f);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = f.win.electronBridge.sendMessageFromView({ type: "fixture" });
  const rejected = assert.rejects(pending, { code: "BRIDGE_OUTCOME_UNKNOWN" });
  assert.equal(socket.sent.length, 1);
  t.mock.timers.tick(10_000);
  await rejected;
  const box = findStatus(f);
  assert.equal(box?.getAttribute("data-error-code"), "ENTRY_BRIDGE_FAILED");
  assert.equal(box?.getAttribute("data-bridge-error-code"), "BRIDGE_OUTCOME_UNKNOWN");
  assert.equal(box?.getAttribute("data-bridge-cause-code"), "request_timeout");
  const detail=JSON.parse(box?.getAttribute("data-bridge-timeout-metadata")??"null");
  assert.deepEqual(detail?.timedOutRequest,{id:1,seq:1,type:'call',method:'sendMessageFromView',dispatched:true,admitted:true,queued:false,queueAhead:null});
  assert.equal(detail?.pendingTotal,1);
  assert.ok(!JSON.stringify(detail).includes('fixture'));
  assert.equal(socket.sent.length, 1);
  assert.equal(f.reloads, 0);
});

test("reports the real bounded MessagePort waiting limit on the first failure", async () => {
  const f = fixture(), { socket } = await ready(f);
  const handlers = new Map();
  const port = {
    addEventListener(type, callback) { handlers.set(type, callback); },
    postMessage() {}, start() {}, close() {},
  };
  f.events.dispatch("message", { source: f.win, data: { type: "connect-app-host", port } });
  // Do not acknowledge openPort: the original producer can fill the waiting
  // queue before any message can be forwarded.
  for (let index = 0; index < 1024; index++) handlers.get("message")({ data: { index } });
  assert.equal(findStatus(f), undefined, "1024 raw snapshots fit before openPort is acknowledged");
  assert.equal(socket.closeCount, 0);
  assert.equal(socket.sent.length, 1, "unopened-port snapshots are never forwarded");
  handlers.get("message")({ data: { index: 1024 } });
  const box = findStatus(f);
  assert.equal(box?.getAttribute("data-bridge-error-code"), "BRIDGE_QUEUE_FULL");
  assert.equal(box?.getAttribute("data-bridge-limit-code"), "waiting_count");
  handlers.get("message")({ data: { index: 1025 } });
  socket.error();
  await flush();
  assert.equal(findStatus(f), box, "the first overflow stays authoritative");
  assert.equal(box?.getAttribute("data-bridge-error-code"), "BRIDGE_QUEUE_FULL");
  assert.equal(box?.getAttribute("data-bridge-limit-code"), "waiting_count");
  assert.equal(socket.sent.length, 1, "overflow and later port events never replay snapshots");
  assert.equal(socket.closeCount, 1);
  assert.equal(f.reloads, 0);
});

test("connection loss rejects an in-flight operation without automatic retransmission", async () => {
  const f = fixture(),
    { socket } = await ready(f);
  const pending = f.win.electronBridge.sendMessageFromView({ type: "fixture" });
  await flush();
  assert.equal(socket.sent.length, 1);
  socket.error();
  await assert.rejects(pending);
  await flush();
  assert.equal(socket.sent.length, 1);
  assert.equal(Socket.all.length, 1);
  assert.ok(findStatus(f));
});

test("script load error is visible and pagehide cleans up only its own connection", async () => {
  const a = fixture(),
    first = await ready(a);
  a.head.children[0].dispatch("error", {});
  assert.ok(findStatus(a));
  assert.equal(first.socket.closeCount, 1);
  assert.equal(a.reloads, 0);
  const b = fixture(),
    second = await ready(b);
  b.events.dispatch("pagehide", {});
  assert.equal(second.socket.closeCount, 1);
  assert.equal(findStatus(b), undefined);
  assert.equal(b.reloads, 0);
});

test("back-forward cache restoration offers manual recovery without reconnecting", async () => {
  const f = fixture(),
    { socket } = await ready(f);
  f.events.dispatch("pagehide", { persisted: true });
  assert.equal(socket.closeCount, 1);
  assert.equal(findStatus(f), undefined);
  f.events.dispatch("pageshow", { persisted: true });
  assert.ok(findStatus(f));
  assert.equal(Socket.all.length, 1);
  assert.equal(f.reloads, 0);
  findButton(f).click();
  assert.equal(f.reloads, 1);
});

test("caps options and rejects a second start for the same document", async () => {
  for (const bad of [
    { handshakeTimeoutMs: 30001 },
    { maxFrameBytes: 8 * 1024 * 1024 + 1 },
    { maxBufferedBytes: 8 * 1024 * 1024 + 1 },
    { url: "wss://evil.invalid" },
  ]) {
    const f = fixture();
    await assert.rejects(startDesktopDocument(options(f, bad)));
    assert.equal(Socket.all.length, 0);
  }
  const f = fixture(),
    { socket, controller } = await ready(f);
  await assert.rejects(startDesktopDocument(options(f)), {
    code: "ENTRY_ALREADY_STARTED",
  });
  assert.equal(Socket.all.length, 1);
  assert.equal(socket.closeCount, 0);
  controller.close();
});

test("a pre-existing Codex surface flag fails closed before loading original code", async () => {
  for (const value of [true, false]) {
    const f = fixture();
    Object.defineProperty(f.win, "__kanbanCodexOnlySurface", {
      value,
      configurable: false,
    });
    const starting = startDesktopDocument(options(f));
    const socket = Socket.all[0];
    socket.open();
    socket.message(encodeWireValue(bootstrap()));
    await assert.rejects(starting, { code: "ENTRY_BRIDGE_FAILED" });
    assert.equal(f.head.children.length, 0);
    assert.equal(socket.closeCount, 1);
    assert.ok(findStatus(f));
  }
});

function fullHarness({
  version = 2,
  loadSharedNavigation,
  loadIsolatedPaneNavigation,
  createProjectFolderPicker = () => ({
    async ready() {},
    dispose() {},
  }),
} = {}) {
  const f = fixture({
    manifest: JSON.stringify({
      version,
      profileId: scope.profileId,
      generation: scope.generation,
      entry,
    }),
  });
  let release,
    reject,
    disposed = 0,
    loaded = 0,
    created = 0;
  const gate = new Promise((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  const capability = {
    captureScope: () => null,
    isScopeCurrent: () => false,
    captureAttachmentScope: () => null,
    isAttachmentScopeCurrent: () => false,
    getCommittedEditor: () => null,
    dispose() {
      disposed++;
    },
  };
  const start = createDesktopDocumentStarter({
    ...(createProjectFolderPicker ? { createProjectFolderPicker } : {}),
    ...(loadSharedNavigation ? { loadSharedNavigation } : {}),
    ...(loadIsolatedPaneNavigation ? { loadIsolatedPaneNavigation } : {}),
    loadSharedCatalog:async()=>({createBrowserSharedCatalog:()=>({loadPage:async()=>{},receive:()=>false,dispose(){}})}),
    loadSharedDirectory:async()=>({createBrowserSharedThreadDirectory:()=>({dispose(){}})}),
    createSurfaceController(options) {
      created++;
      assert.equal(Boolean(f.win.electronBridge), false);
      assert.equal(options.imagePickerEnabled, version === 4);
      return createBrowserSurfaceController(options);
    },
    async loadCapability() {
      loaded++;
      assert.equal(Boolean(f.win.electronBridge), true);
      await gate;
      return { initializeComposerCapability: async () => capability };
    },
  });
  return {
    f,
    start,
    release,
    reject,
    get disposed() {
      return disposed;
    },
    get loaded() {
      return loaded;
    },
    get created() {
      return created;
    },
  };
}

test("v3 installs one scope-bound shared navigator and waits for its native ACK before the original entry", async () => {
  let releaseNav,
    navOptions,
    disposed = 0,
    loads = 0;
  const ready = new Promise((resolve) => {
    releaseNav = resolve;
  });
  const h = fullHarness({
    version: 3,
    loadSharedNavigation: async () => {
      loads++;
      return {
        createBrowserSharedThreadNavigation(options) {
          navOptions = options;
          return {
            ready: () => ready,
            createRoot() {},
            wrapNavigation() {},
            bindAppServerHosts() {},
            consumeRoute() {},
            activateExplicit() {},
            dispose() {
              disposed++;
            },
          };
        },
      };
    },
  });
  const starting = h.start(options(h.f)),
    socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  h.release();
  await flush();
  assert.equal(loads, 1);
  assert.ok(navOptions);
  assert.deepEqual(navOptions.documentScope, scope);
  assert.equal(navOptions.scopeLease, h.f.win.__kanbanDesktopSurfaceActivation);
  assert.equal(h.f.head.children.length, 0);
  assert.equal(
    h.f.win.__kanbanSharedThreadNavigation.ready instanceof Function,
    true,
  );
  releaseNav();
  const controller = await starting;
  assert.equal(h.f.head.children.length, 1);
  controller.close();
  assert.equal(disposed, 1);
});

test("v2 never loads the explicitly enabled shared navigator", async () => {
  let loads = 0;
  const h = fullHarness({
    loadSharedNavigation: async () => {
      loads++;
      throw Error("must not load");
    },
  });
  const starting = h.start(options(h.f)),
    socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  h.release();
  const controller = await starting;
  assert.equal(loads, 0);
  assert.equal(Object.hasOwn(h.f.win, "__chatgptDesktopSplitPaneEnabled"), false);
  controller.close();
});

test("v4 fixes split selection before capability initialization without loading shared authority", async () => {
  let isolated = 0, shared = 0;
  const h = fullHarness({
    version: 4,
    loadSharedNavigation: async () => { shared++; throw Error("not enabled"); },
    loadIsolatedPaneNavigation: async () => ({
      createBrowserIsolatedPaneNavigation() {
        isolated++;
        return { activateExplicit() {}, dispose() {} };
      },
    }),
  });
  const starting = h.start(options(h.f)), socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  const descriptor = Object.getOwnPropertyDescriptor(h.f.win, "__chatgptDesktopSplitPaneEnabled");
  assert.deepEqual(descriptor, { value: true, writable: false, enumerable: false, configurable: false });
  h.release();
  const controller = await starting;
  assert.equal(isolated, 1);
  assert.equal(shared, 0);
  assert.equal(h.f.head.children.length, 1);
  controller.close();
});

test("a pre-existing split marker fails closed even for the default document", async () => {
  const h = fullHarness();
  Object.defineProperty(h.f.win, "__chatgptDesktopSplitPaneEnabled", { value: true });
  const starting = h.start(options(h.f)), socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  await assert.rejects(starting, { code: "ENTRY_BRIDGE_FAILED" });
  assert.equal(h.f.head.children.length, 0);
});

test("v2 installs an isolated pane navigator without loading shared authorization", async () => {
  let isolated = 0,
    shared = 0,
    disposed = 0;
  const h = fullHarness({
    loadSharedNavigation: async () => {
      shared++;
      throw Error("unavailable");
    },
    loadIsolatedPaneNavigation: async () => ({
      createBrowserIsolatedPaneNavigation(options) {
        isolated++;
        assert.deepEqual(options.documentScope, scope);
        return {
          activateExplicit() {},
          dispose() {
            disposed++;
          },
        };
      },
    }),
  });
  const starting = h.start(options(h.f)),
    socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  h.release();
  const controller = await starting;
  assert.equal(isolated, 1);
  assert.equal(shared, 0);
  assert.equal(
    typeof h.f.win.__kanbanSharedThreadNavigation.activateExplicit,
    "function",
  );
  controller.close();
  assert.equal(disposed, 1);
});

test("v3 shared readiness cannot restore a disconnected document", async () => {
  let releaseNav,
    disposed = 0;
  const ready = new Promise((resolve) => {
    releaseNav = resolve;
  });
  const h = fullHarness({
    version: 3,
    loadSharedNavigation: async () => ({
      createBrowserSharedThreadNavigation() {
        return {
          ready: () => ready,
          createRoot() {},
          wrapNavigation() {},
            bindAppServerHosts() {},
          consumeRoute() {},
          activateExplicit() {},
          dispose() {
            disposed++;
          },
        };
      },
    }),
  });
  const starting = h.start(options(h.f)),
    socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  h.release();
  await flush();
  socket.error();
  await assert.rejects(starting, { code: "ENTRY_CONNECTION_LOST" });
  releaseNav();
  await flush();
  assert.equal(disposed, 1);
  assert.equal(h.f.head.children.length, 0);
});

test("synchronous v3 authority failure disposes its returned navigator and does not load original entry", async () => {
  let disposed = 0;
  const h = fullHarness({
    version: 3,
    loadSharedNavigation: async () => ({
      createBrowserSharedThreadNavigation(options) {
        options.onFailure();
        return {
          ready: async () => {},
          createRoot() {},
          wrapNavigation() {},
          consumeRoute() {},
          activateExplicit() {},
          dispose() {
            disposed++;
          },
        };
      },
    }),
  });
  const starting = h.start(options(h.f)),
    socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  h.release();
  await assert.rejects(starting, { code: "ENTRY_SURFACE_FAILED" });
  assert.equal(disposed, 1);
  assert.equal(h.f.head.children.length, 0);
});

test("v2 installs the project picker after the bridge and disposes it before transport closes", async () => {
  let pickerOptions,
    disposeCount = 0;
  const h = fullHarness({
    createProjectFolderPicker(options) {
      pickerOptions = options;
      assert.ok(options.window.electronBridge);
      assert.equal(h.f.head.children.length, 0);
      assert.equal(h.loaded, 0);
      assert.equal(
        options.scopeLease,
        h.f.win.__kanbanDesktopSurfaceActivation,
      );
      assert.deepEqual(Object.keys(options.scopeLease).sort(), [
        "getSnapshot",
        "isCurrent",
        "subscribe",
      ]);
      return {
        async ready() {},
        dispose() {
          disposeCount++;
          void options
            .sendMessage({
              type: "kanban-project-folder-reply",
              requestId: scope.viewId,
              action: "cancel",
            })
            .catch(() => {});
        },
      };
    },
  });
  const starting = h.start(options(h.f));
  const socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  assert.ok(pickerOptions);
  assert.equal(pickerOptions.scopeLease.getSnapshot(), null);
  h.release();
  const controller = await starting;
  controller.close();
  assert.equal(disposeCount, 1);
  assert.equal(socket.sent.length, 1);
  const sent = decodeWireValue(socket.sent[0]);
  assert.equal(sent.method, "sendMessageFromView");
  assert.deepEqual(sent.args, [
    {
      type: "kanban-project-folder-reply",
      requestId: scope.viewId,
      action: "cancel",
    },
  ]);
  assert.equal(socket.readyState, 3);
  controller.close();
  assert.equal(disposeCount, 1);
});

test("v2 waits for the native picker lifecycle acknowledgement as well as the composer", async () => {
  let releasePicker,
    disposed = 0;
  const pickerReady = new Promise((resolve) => {
    releasePicker = resolve;
  });
  const h = fullHarness({
    createProjectFolderPicker() {
      return {
        ready: () => pickerReady,
        dispose() {
          disposed++;
        },
      };
    },
  });
  const starting = h.start(options(h.f));
  const socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  h.release();
  await flush();
  assert.equal(h.f.head.children.length, 0);
  socket.message(
    encodeWireValue({ v: 1, scope, seq: 1, type: "theme", value: "dark" }),
  );
  assert.equal(h.f.win.electronBridge.getSystemThemeVariant(), "dark");
  releasePicker();
  const controller = await starting;
  assert.equal(h.f.head.children.length, 1);
  controller.close();
  assert.equal(disposed, 1);
});

test("late picker readiness cannot start the original page after disconnection", async () => {
  let releasePicker,
    disposed = 0;
  const pickerReady = new Promise((resolve) => {
    releasePicker = resolve;
  });
  const h = fullHarness({
    createProjectFolderPicker() {
      return {
        ready: () => pickerReady,
        dispose() {
          disposed++;
        },
      };
    },
  });
  const starting = h.start(options(h.f));
  const socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  h.release();
  await flush();
  socket.error();
  await assert.rejects(starting, { code: "ENTRY_CONNECTION_LOST" });
  releasePicker();
  await flush();
  assert.equal(disposed, 1);
  assert.equal(h.f.head.children.length, 0);
});

test("picker lifecycle readiness failure does not start the original page", async () => {
  let disposed = 0;
  const h = fullHarness({
    createProjectFolderPicker() {
      return {
        async ready() {
          throw new Error("private native lifecycle detail");
        },
        dispose() {
          disposed++;
        },
      };
    },
  });
  const starting = h.start(options(h.f));
  const socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  h.release();
  await assert.rejects(starting, { code: "ENTRY_SURFACE_FAILED" });
  assert.equal(disposed, 1);
  assert.equal(h.f.head.children.length, 0);
  assert.ok(!text(findStatus(h.f)).includes("private native lifecycle detail"));
});

test("a synchronous picker readiness failure still owns and disposes a late composer", async () => {
  let disposed = 0;
  const h = fullHarness({
    createProjectFolderPicker() {
      return {
        ready() {
          throw new Error("private native lifecycle detail");
        },
        dispose() {
          disposed++;
        },
      };
    },
  });
  const starting = h.start(options(h.f));
  const socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  await assert.rejects(starting, { code: "ENTRY_SURFACE_FAILED" });
  h.release();
  await flush();
  await flush();
  assert.equal(disposed, 1);
  assert.equal(h.disposed, 1);
  assert.equal(h.f.head.children.length, 0);
});

test("picker lifecycle failure after startup visibly closes only this view", async () => {
  let pickerOptions,
    disposed = 0;
  const h = fullHarness({
    createProjectFolderPicker(options) {
      pickerOptions = options;
      return {
        async ready() {},
        dispose() {
          disposed++;
        },
      };
    },
  });
  const starting = h.start(options(h.f));
  const socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  h.release();
  await starting;
  pickerOptions.onFailure({ code: "PROJECT_FOLDER_UI_LIFECYCLE_UNAVAILABLE" });
  assert.equal(disposed, 1);
  assert.equal(socket.readyState, 3);
  assert.equal(
    findStatus(h.f)?.getAttribute("data-error-code"),
    "ENTRY_SURFACE_FAILED",
  );
  assert.equal(Socket.all.length, 1);
});

test("synchronous picker failure during construction disposes its returned local resources", async () => {
  let disposed = 0;
  const h = fullHarness({
    createProjectFolderPicker(options) {
      options.onFailure({ code: "PROJECT_FOLDER_UI_LIFECYCLE_UNAVAILABLE" });
      return {
        async ready() {},
        dispose() {
          disposed++;
        },
      };
    },
  });
  const starting = h.start(options(h.f));
  const socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  await assert.rejects(starting, { code: "ENTRY_SURFACE_FAILED" });
  assert.equal(disposed, 1);
  assert.equal(h.loaded, 0);
  assert.equal(h.f.head.children.length, 0);
});

test("picker setup failure never loads the original entry or exposes error details", async () => {
  const h = fullHarness({
    createProjectFolderPicker() {
      throw new Error("private folder detail");
    },
  });
  const starting = h.start(options(h.f));
  const socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  await assert.rejects(starting, { code: "ENTRY_BRIDGE_FAILED" });
  assert.equal(h.f.head.children.length, 0);
  assert.equal(h.loaded, 0);
  assert.ok(!text(findStatus(h.f)).includes("private folder detail"));
});

test("the diagnostic v1 document does not initialize the v2 project picker", async () => {
  const f = fixture();
  let pickerCalls = 0;
  const start = createDesktopDocumentStarter({
    createProjectFolderPicker() {
      pickerCalls++;
      throw new Error("must stay unused");
    },
  });
  const starting = start(options(f));
  const socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  const controller = await starting;
  assert.equal(pickerCalls, 0);
  assert.equal(f.head.children.length, 1);
  controller.close();
});

test("v2 keeps the native bridge active and menus closed until local capability is initialized", async () => {
  const h = fullHarness(),
    starting = h.start(options(h.f));
  const socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  assert.equal(h.created, 1);
  assert.equal(h.loaded, 1);
  assert.ok(h.f.win.electronBridge);
  assert.equal(h.f.head.children.length, 0);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(h.f.win, "__chatgptDesktopLayoutEnabled"),
    { value: true, writable: false, enumerable: false, configurable: false },
  );
  await assert.rejects(
    h.f.win.electronBridge.showContextMenu([{ id: "x", label: "x" }], {
      x: 0,
      y: 0,
    }),
    { code: "BRIDGE_MENU_UNAVAILABLE" },
  );
  assert.equal(socket.sent.length, 0);
  socket.message(
    encodeWireValue({ v: 1, scope, seq: 1, type: "theme", value: "dark" }),
  );
  assert.equal(h.f.win.electronBridge.getSystemThemeVariant(), "dark");
  h.release();
  const controller = await starting;
  assert.deepEqual(controller.scope, scope);
  assert.equal(h.f.head.children.length, 1);
  assert.equal(h.f.head.children[0].getAttribute("src"), entry);
  await assert.rejects(
    h.f.win.electronBridge.showContextMenu([{ id: "x", label: "x" }], {
      x: 0,
      y: 0,
    }),
    { code: "BRIDGE_MENU_UNAVAILABLE" },
  );
  assert.equal(socket.sent.length, 0);
  controller.close();
  assert.equal(h.disposed, 1);
});

test("v2 disconnect disposes a late capability without loading the original index or retrying", async () => {
  const h = fullHarness(),
    starting = h.start(options(h.f));
  const socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  socket.error();
  await assert.rejects(starting, { code: "ENTRY_CONNECTION_LOST" });
  h.release();
  await flush();
  await flush();
  assert.equal(h.disposed, 1);
  assert.equal(h.f.head.children.length, 0);
  assert.equal(socket.sent.length, 0);
  assert.equal(Socket.all.length, 1);
});

test("v2 initialization failure or timeout is visible and never falls back to native menu", async () => {
  for (const kind of ["failure", "timeout"]) {
    const h = fullHarness(),
      starting = h.start(
        options(h.f, { handshakeTimeoutMs: kind === "timeout" ? 10 : 1000 }),
      );
    const socket = Socket.all[0];
    socket.open();
    socket.message(encodeWireValue(bootstrap()));
    if (kind === "failure") h.reject(new Error("private loader payload"));
    await assert.rejects(starting, {
      code:
        kind === "failure" ? "ENTRY_SURFACE_FAILED" : "ENTRY_SURFACE_TIMEOUT",
    });
    if (kind === "timeout") {
      h.release();
      await flush();
      await flush();
      assert.equal(h.disposed, 1);
    }
    assert.equal(h.f.head.children.length, 0);
    assert.equal(socket.sent.length, 0);
    assert.ok(findStatus(h.f));
    assert.ok(!text(findStatus(h.f)).includes("private loader payload"));
  }
});

test("v2 rejects an existing mutable layout marker before bridge or original code", async () => {
  const h = fullHarness();
  Object.defineProperty(h.f.win, "__chatgptDesktopLayoutEnabled", {
    value: true,
    writable: true,
    configurable: true,
  });
  const starting = h.start(options(h.f));
  const socket = Socket.all[0];
  socket.open();
  socket.message(encodeWireValue(bootstrap()));
  await assert.rejects(starting, { code: "ENTRY_BRIDGE_FAILED" });
  assert.equal(h.loaded, 0);
  assert.equal(h.created, 0);
  assert.equal(h.f.head.children.length, 0);
  assert.equal(socket.sent.length, 0);
});

test("v2 scope mismatch never initializes local capability or original entry", async () => {
  const bad = fullHarness(),
    pending = bad.start(options(bad.f));
  const wrong = Socket.all[0];
  wrong.open();
  wrong.message(
    encodeWireValue({
      ...bootstrap(),
      scope: { ...scope, generation: scope.profileId },
    }),
  );
  await assert.rejects(pending, { code: "ENTRY_INVALID_BOOTSTRAP" });
  assert.equal(bad.created, 0);
  assert.equal(bad.loaded, 0);
  assert.equal(bad.f.head.children.length, 0);
});


test("real queue overflow explains the full queue and preserves manual recovery without replay", async () => {
  const f = fixture(), { socket } = await ready(f);
  const handlers = new Map();
  const port = {
    addEventListener(type, callback) { handlers.set(type, callback); },
    postMessage() {}, start() {}, close() {},
  };
  f.events.dispatch("message", { source: f.win, data: { type: "connect-app-host", port } });
  for (let index = 0; index < 1024; index++) handlers.get("message")({ data: { index } });
  assert.equal(findStatus(f), undefined, "1024 raw snapshots fit before openPort is acknowledged");
  assert.equal(socket.closeCount, 0);
  assert.equal(socket.sent.length, 1, "unopened-port snapshots are never forwarded");
  handlers.get("message")({ data: { index: 1024 } });
  const box = findStatus(f), button = findButton(f);
  assert.equal(box?.getAttribute("data-bridge-error-code"), "BRIDGE_QUEUE_FULL");
  assert.equal(box?.getAttribute("data-bridge-limit-code"), "waiting_count");
  handlers.get("message")({ data: { index: 1025 } });
  await flush();
  assert.equal(findStatus(f), box);
  assert.match(text(box), /队列已满/);
  assert.match(text(box), /重新连接后检查会话状态/);
  assert.ok(!text(box).includes("上一次操作"));
  assert.ok(!text(box).includes("BRIDGE_QUEUE_FULL"));
  assert.equal(button.textContent, "重新连接");
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.closeCount, 1);
  assert.equal(Socket.all.length, 1);
  assert.equal(f.reloads, 0);
  button.dispatch("click", { isTrusted: false });
  assert.equal(f.reloads, 0);
  button.click();
  assert.equal(f.reloads, 1);
  assert.equal(socket.sent.length, 1);
  assert.equal(Socket.all.length, 1);
});

test("real request timeout explains the unknown result and never replays before manual recovery", async (t) => {
  const f = fixture(), { socket } = await ready(f);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = f.win.electronBridge.sendMessageFromView({ type: "PRIVATE_PAYLOAD_SENTINEL" });
  const rejected = assert.rejects(pending, { code: "BRIDGE_OUTCOME_UNKNOWN" });
  assert.equal(socket.sent.length, 1);
  t.mock.timers.tick(10_000);
  await rejected;
  await flush();
  const box = findStatus(f), button = findButton(f);
  assert.equal(box?.getAttribute("data-bridge-error-code"), "BRIDGE_OUTCOME_UNKNOWN");
  assert.match(text(box), /上一次操作是否完成尚未确认/);
  assert.match(text(box), /先检查会话状态，再决定是否重试/);
  assert.match(text(box), /不会自动重发/);
  assert.ok(!text(box).includes("PRIVATE_PAYLOAD_SENTINEL"));
  assert.ok(!text(box).includes("BRIDGE_OUTCOME_UNKNOWN"));
  socket.error();
  assert.equal(findStatus(f), box);
  assert.equal(f.reloads, 0);
  assert.equal(socket.sent.length, 1);
  assert.equal(Socket.all.length, 1);
  button.dispatch("click", { isTrusted: false });
  assert.equal(f.reloads, 0);
  button.click();
  assert.equal(f.reloads, 1);
  assert.equal(socket.sent.length, 1);
  assert.equal(Socket.all.length, 1);
});

test("v5 requires shared authority and enables split before starting original code", async () => {
  let releaseNav, navOptions, loads=0, isolated=0, activated=0, disposed=0;
  const ready=new Promise(resolve=>{releaseNav=resolve;});
  const h=fullHarness({
    version:5,
    loadSharedNavigation:async()=>{
      loads++;
      return {createBrowserSharedThreadNavigation(options){
        navOptions=options;
        return {ready:()=>ready,createRoot(){},wrapNavigation(){},bindAppServerHosts(){},consumeRoute(){},
          activateExplicit(){activated++;},beginApproval(){},dispose(){disposed++;}};
      }};
    },
    loadIsolatedPaneNavigation:async()=>{isolated++;throw Error("v5 requires shared authority");},
  });
  const starting=h.start(options(h.f));
  void starting.catch(()=>{});
  assert.equal(Socket.all.length,1,"v5 must open its scope-bound connection");
  const socket=Socket.all[0];socket.open();socket.message(encodeWireValue(bootstrap()));
  assert.deepEqual(Object.getOwnPropertyDescriptor(h.f.win,"__chatgptDesktopSplitPaneEnabled"),
    {value:true,writable:false,enumerable:false,configurable:false});
  h.release();await flush();
  assert.equal(loads,1);assert.equal(isolated,0);assert.equal(activated,0);
  assert.deepEqual(navOptions.documentScope,scope);
  assert.equal(navOptions.scopeLease,h.f.win.__kanbanDesktopSurfaceActivation);
  assert.equal(h.f.head.children.length,0,"shared authority must be ready before original entry executes");
  assert.equal(socket.sent.length,0,"bootstrap must not send or resume a task");
  releaseNav();const controller=await starting;
  assert.equal(h.f.head.children.length,1);
  assert.equal(activated,0,"initializing combined mode is not a trusted navigation gesture");
  controller.close();assert.equal(disposed,1);
});

test("v5 rejects a navigator without original app-server host binding before loading the original entry", async () => {
  let disposed=0;
  const h=fullHarness({version:5,loadSharedNavigation:async()=>({
    createBrowserSharedThreadNavigation(){return {ready:async()=>{},createRoot(){},wrapNavigation(){},
      consumeRoute(){},activateExplicit(){},beginApproval(){},dispose(){disposed++;}};},
  })});
  const starting=h.start(options(h.f));void starting.catch(()=>{});
  const socket=Socket.all[0];socket.open();socket.message(encodeWireValue(bootstrap()));
  h.release();await assert.rejects(starting,{code:"ENTRY_SURFACE_FAILED"});
  assert.equal(disposed,1);assert.equal(h.f.head.children.length,0);
});

test("v5 rejects incomplete shared authority without starting the original entry", async () => {
  let disposed=0;
  const h=fullHarness({version:5,loadSharedNavigation:async()=>({
    createBrowserSharedThreadNavigation(){return {ready:async()=>{},createRoot(){},wrapNavigation(){},
      activateExplicit(){},dispose(){disposed++;}};},
  })});
  const starting=h.start(options(h.f));void starting.catch(()=>{});
  assert.equal(Socket.all.length,1);
  const socket=Socket.all[0];socket.open();socket.message(encodeWireValue(bootstrap()));
  h.release();await assert.rejects(starting,{code:"ENTRY_SURFACE_FAILED"});
  assert.equal(disposed,1);assert.equal(h.f.head.children.length,0);
});

test("v5 fails closed when shared approval authorization is unavailable", async () => {
  let disposed=0;
  const h=fullHarness({version:5,loadSharedNavigation:async()=>({
    createBrowserSharedThreadNavigation(){return {ready:async()=>{},createRoot(){},wrapNavigation(){},bindAppServerHosts(){},
      consumeRoute(){},activateExplicit(){},dispose(){disposed++;}};},
  })});
  const starting=h.start(options(h.f)),socket=Socket.all[0];
  socket.open();socket.message(encodeWireValue(bootstrap()));h.release();
  const outcome=await starting.then(controller=>{controller.close();return null;},error=>error);
  assert.equal(outcome?.code,"ENTRY_SURFACE_FAILED");
  assert.equal(disposed,1);assert.equal(h.f.head.children.length,0);
});


test("versioned browser deliveries acknowledge exact view slots without becoming native requests", async () => {
 const f=fixture(),{socket,controller}=await ready(f);
 assert.deepEqual(socket.flowAcks,['KBA1:'+scope.viewId+':0']);assert.equal(socket.sent.length,0);
 socket.message(encodeWireValue({v:1,scope,seq:1,type:'theme',value:'dark'}));await flush();
 assert.deepEqual(socket.flowAcks,['KBA1:'+scope.viewId+':0','KBA1:'+scope.viewId+':1']);assert.equal(socket.sent.length,0);controller.close();
});
test("old unversioned bootstrap, crossed view and repeated delivery fail before replay", async () => {
 const f=fixture(),starting=startDesktopDocument(options(f)),socket=Socket.all.at(-1);socket.open();socket.rawMessage(encodeWireValue(bootstrap()));await assert.rejects(starting,{code:'ENTRY_INVALID_FRAME'});assert.equal(socket.sent.length,0);assert.equal(socket.flowAcks.length,0);
 for(const kind of ['crossed','repeated']){
  const g=fixture(),{socket:s,controller}=await ready(g);
  const encoded=encodeWireValue({v:1,scope,seq:1,type:'theme',value:'dark'});
  s.rawMessage('KBC1:'+(kind==='crossed'?'9e534cbd-588b-4ace-885e-1d16817a21d0':scope.viewId)+':0\n'+encoded);
  assert.equal(s.readyState,3);assert.equal(s.flowAcks.length,1);assert.equal(s.sent.length,0);controller.close();
 }
});
