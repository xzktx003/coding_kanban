import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { createSharedDaemonRpcGate } from "../src/shared-daemon-rpc-gate.mjs";
const { createHostSharedThreadCreationEndpoint } = createRequire(import.meta.url)("../src/shared-thread-creation-ipc.cjs");
const referenceDir = process.env.CHATGPT_DESKTOP_ATTACHED_LIST_REFERENCE_DIR;
const schemaFile = process.env.CHATGPT_DESKTOP_THREAD_LIST_SCHEMA;
const hashes = {
  14183: "fde57070f120009b3af4a50dd731cb90ef5641c2a427fe7363333982fe1d9c60",
  71415: "69efdb3bfa8e15478653f95c5948c995290b0ea317efbca9a1f01929d37592cf",
  84698: "87707c833d7c02550c176e81e182fa337092957caa8b6697d6b68a8a527680a9",
  85172: "c2871fdd0b7efc1abab94df0807895819b6fba1c4ce703680c49606cc894342c",
};
function original() {
  const factories = {}, cache = new Map();
  for (const [id, hash] of Object.entries(hashes)) {
    const text = readFileSync(resolve(referenceDir, `module-${id}.js`), "utf8");
    assert.equal(createHash("sha256").update(text).digest("hex"), hash);
    factories[id] = runInNewContext(`({${text}})[${id}]`, Object.create(null), { timeout: 1000 });
  }
  const requireModule = id => {
    if (cache.has(id)) return cache.get(id);
    assert.ok(factories[id], `Unreviewed original dependency ${id}`);
    const exports = {}; cache.set(id, exports);
    factories[id]({ exports }, exports, requireModule); return exports;
  };
  requireModule.d = (exports, getters, constants = {}) => {
    for (const [key, get] of Object.entries(getters)) Object.defineProperty(exports, key, { get, enumerable: true });
    for (const [key, value] of Object.entries(constants)) Object.defineProperty(exports, key, { value, enumerable: true });
  };
  assert.equal(requireModule(71415).JF("0.166.0", "attachedThreads"), true);
  return requireModule(14183);
}
function fixture() {
  const writes = [], reads = []; let live = true, sequence = 0;
  const gate = createSharedDaemonRpcGate({
    verifyReadSync: frame => { reads.push(frame.method); return live; },
    verifyBindingSync: () => live, verifyHistorySync: () => live,
    write: text => writes.push(JSON.parse(text)),
    desktop: { daemonVersion: "0.166.0", verifyInitializeSync: () => live, verifyInitialAccountNotificationSync: () => false,
      verifyServerEventSync: () => false, authorizeServerReplySync: () => false },
  });
  gate.write(JSON.stringify({ id: ++sequence, method: "initialize", params: { clientInfo: { name: "codex_desktop", version: "1" }, capabilities: { experimentalApi: true, requestAttestation: false } } }));
  gate.receive(JSON.stringify({ id: sequence, result: { userAgent: "codex_app_server/0.166.0", codexHome: "/owned/home" } }));
  gate.write(JSON.stringify({ method: "initialized", params: {} }));
  return { gate, writes, reads, setLive: value => { live = value; }, request(params) { const frame = { id: ++sequence, method: "thread/list", params }; gate.write(JSON.stringify(frame)); return frame; } };
}

test("the actual supported original attached-thread builder passes the bounded read gate", { skip: !referenceDir || !schemaFile }, async () => {
  const schemaText = readFileSync(schemaFile, "utf8");
  assert.equal(createHash("sha256").update(schemaText).digest("hex"), "1781b1778cb08619f0bf12528b128e55648b86569114196b1b5ec565b9b7935d");
  assert.deepEqual(JSON.parse(schemaText).properties.attachedToThreadId.type, ["string", "null"]);
  const sdk = original(), f = fixture(), ownThread = randomUUID(), generated = [];
  try {
    const result = await sdk.ut({ appServerVersion: "0.166.0", listThreads: async params => {
      generated.push(JSON.parse(JSON.stringify(params))); f.request(params); return { data: [], nextCursor: null };
    } }, ownThread, false, item => item.id);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), []);
    assert.deepEqual(generated, [{ attachedToThreadId: ownThread, archived: false, cursor: null, limit: 100, useStateDbOnly: true }]);
    assert.deepEqual(f.writes.at(-1).params, generated[0]);
  } finally { f.gate.close(); }
});

test("creation cancellation aborts only its control while ordinary read remains live and actual read revocation still denies", async () => {
  const f = fixture(), profileId = randomUUID(), generation = randomUUID(), id = randomUUID();
  let control;
  const endpoint = createHostSharedThreadCreationEndpoint({ profileId, generation, verifyCurrentSync: () => true,
    sendFrame: () => { throw Error("No reply after cancellation"); }, onScope: (_target, value) => { control = value; return new Promise(() => {}); },
    onAuthorize: () => { throw Error("No creation authority in this read-only fixture"); }, onBinding: () => { throw Error("No binding in this read-only fixture"); } });
  try {
    assert.equal(endpoint.receive({ v: 1, type: "shared-create-request", profileId, generation, id, op: "scope", data: { target: {
      hostId: "kanban-shared-cli", projectId: "owned-project", cwd: "/owned/project", viewId: randomUUID() }, attemptId: randomUUID() } }), true);
    assert.equal(control.signal.aborted, false);
    assert.equal(endpoint.receive({ v: 1, type: "shared-create-cancel", profileId, generation, id }), true);
    assert.equal(control.signal.aborted, true);
    assert.doesNotThrow(() => f.request({ limit: 100, cursor: null, useStateDbOnly: true }));
    f.setLive(false);
    assert.throws(() => f.request({ limit: 100, cursor: null, useStateDbOnly: true }), { code: "SHARED_DAEMON_DENIED" });
  } finally { endpoint.close(); f.gate.close(); }
});

test("attached read filter accepts only one optional UUID and never permits scanning or deletion", () => {
  const f = fixture(), ownThread = randomUUID(), base = { limit: 100, useStateDbOnly: true };
  try {
    assert.doesNotThrow(() => f.request({ ...base, attachedToThreadId: null }));
    for (const params of [{ ...base, attachedToThreadId: [] }, { ...base, attachedToThreadId: "" },
      { ...base, attachedToThreadId: "../foreign" }, { ...base, attachedToThreadId: ownThread, parentThreadId: ownThread },
      { ...base, attachedToThreadId: ownThread, ancestorThreadId: ownThread },
      { ...base, attachedToThreadId: ownThread, useStateDbOnly: false }, { ...base, attachedToThreadId: ownThread, limit: 201 },
      { ...base, attachedToThreadId: ownThread, config: {} }]) {
      assert.throws(() => f.request(params), { code: "SHARED_DAEMON_DENIED" });
    }
    assert.throws(() => f.gate.write(JSON.stringify({ id: 50, method: "thread/delete", params: { threadId: ownThread } })), { code: "SHARED_DAEMON_DENIED" });
  } finally { f.gate.close(); }
});
