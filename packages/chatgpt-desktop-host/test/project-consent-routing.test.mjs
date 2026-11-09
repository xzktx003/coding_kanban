import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import vm from "node:vm";

const require = createRequire(import.meta.url);
let adapter;
try { adapter = require("../src/project-consent-routing.cjs"); }
catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
const routerFor = (records) => {
  const owned = new WeakMap([...records.values()].map(record => [record.window.webContents, record]));
  return adapter?.createProjectConsentRouter({getRecord: id => records.get(id), getOwnedRecord: sender => owned.get(sender)}) ?? {
    bindProjects: projects => projects,
    selectWindow: () => undefined,
  };
};
function view(id) {
  const sender = new EventEmitter();
  sender.id = id;
  let destroyed = false;
  sender.isDestroyed = () => destroyed;
  const window = { webContents: sender, isDestroyed: () => destroyed, show() {}, destroy() { destroyed = true; sender.emit("destroyed"); } };
  return { senderId: id, window, failed: false };
}

test("concurrent private project calls retain their own view through asynchronous work", async () => {
  const a = view(2), b = view(3), records = new Map([[2, a], [3, b]]), router = routerFor(records);
  const projects = { async createLocal(ms) { await delay(ms); return router.selectWindow(); } };
  const boundA = router.bindProjects(projects, a.window.webContents), boundB = router.bindProjects(projects, b.window.webContents);
  const [selectedA, selectedB] = await Promise.all([boundA.createLocal(20), boundB.createLocal(5)]);
  assert.equal(selectedA, a.window);
  assert.equal(selectedB, b.window);
  assert.equal(router.selectWindow(), undefined);
  assert.equal(router.bindProjects(projects, { id: 999 }), projects);
});

test("a removed or failed originating view never falls back to a different view", async () => {
  const a = view(2), b = view(3), records = new Map([[2, a], [3, b]]), router = routerFor(records);
  let resume;
  const projects = { async createLocal() { await new Promise((resolve) => { resume = resolve; }); return router.selectWindow(); } };
  const bound = router.bindProjects(projects, a.window.webContents), result = bound.createLocal();
  records.delete(2);
  resume();
  assert.equal(await result, null);
});

test("a late AppHost for a retired owned view cannot become an unscoped service", async () => {
  const a = view(2), b = view(3), records = new Map([[2, a], [3, b]]), router = routerFor(records);
  const projects = { async createLocal() { return router.selectWindow(); } };
  records.delete(2);
  const late = router.bindProjects(projects, a.window.webContents);
  assert.notEqual(late, projects);
  assert.equal(await late.createLocal(), null);
  assert.equal(router.bindProjects(projects, {id:2}), projects);
});

test("an expired asynchronous project scope cannot regain another view's consent", async () => {
  const a = view(2), records = new Map([[2, a]]), router = routerFor(records);
  let release, escaped;
  const projects = { async createLocal() {
    escaped = (async () => {
      await new Promise((resolve) => { release = resolve; });
      return router.selectWindow();
    })();
    return "finished";
  } };
  const bound = router.bindProjects(projects, a.window.webContents);
  assert.equal(await bound.createLocal(), "finished");
  release();
  assert.equal(await escaped, null);
  assert.equal(router.selectWindow(), undefined);
});

test("binding preserves private fields, constructor, and method identity", async () => {
  const a = view(2), records = new Map([[2, a]]), router = routerFor(records);
  class Projects {
    #count = 0;
    async createLocal() { this.#count += 1; await delay(1); return [this.#count, router.selectWindow()]; }
  }
  const original = new Projects(), bound = router.bindProjects(original, a.window.webContents);
  assert.equal(bound.constructor, Projects);
  assert.ok(bound instanceof Projects);
  assert.equal(bound.createLocal, bound.createLocal);
  assert.deepEqual(await bound.createLocal(), [1, a.window]);
});

test("settlement of a cross-realm promise expires the originating scope", async () => {
  const a = view(2), records = new Map([[2, a]]), router = routerFor(records);
  const deferred = vm.runInNewContext("(() => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; })()");
  let releasePending, releaseSettled, pending, settled;
  const projects = { createLocal() {
    pending = (async () => {
      await new Promise((resolve) => { releasePending = resolve; });
      return router.selectWindow();
    })();
    settled = (async () => {
      await new Promise((resolve) => { releaseSettled = resolve; });
      return router.selectWindow();
    })();
    return deferred.promise;
  } };
  const result = router.bindProjects(projects, a.window.webContents).createLocal();
  releasePending();
  assert.equal(await pending, a.window);
  deferred.resolve("finished");
  assert.equal(await result, "finished");
  releaseSettled();
  assert.equal(await settled, null);
});

async function originalChunk(root) {
  const fd = await open(join(root, "resources", "app.asar"), "r");
  try {
    const prefix = Buffer.alloc(16); await fd.read(prefix, 0, 16, 0);
    const header = Buffer.alloc(prefix.readUInt32LE(12)); await fd.read(header, 0, header.length, 16);
    let item = JSON.parse(header.toString());
    for (const part of ".vite/build/early-bootstrap-439-a0f25ba32c465de1.js".split("/")) item = item.files[part];
    const body = Buffer.alloc(item.size); await fd.read(body, 0, body.length, 8 + prefix.readUInt32LE(4) + Number(item.offset));
    assert.equal(createHash("sha256").update(body).digest("hex"), "c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333");
    return body;
  } finally { await fd.close(); }
}
function rpcCallback(callback) {
  callback.dup = () => callback;
  callback.onRpcBroken = () => {};
  callback[Symbol.dispose] = () => {};
  return callback;
}

test("pinned original consent service sends two simultaneous denials to their originating views", {
  skip: !process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT && "Provide the pinned Linux app root",
}, async () => {
  const original = await originalChunk(process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT);
  const adapted = adapter ? adapter.adaptProjectConsentChunk({body:original}) : {body:original};
  assert.equal(adapted.codexPolicySha256, "f8fa2affe8e3ddfc04e36548afb9a7fd9c2bf5c851959904f3231aedfd90815e");
  assert.equal(adapted.adaptedSha256, "007f0a854dd57f5e25e8b62abe4321e4d1cdf12622a1902a983206ce418fc960");
  assert.throws(() => adapter.adaptProjectConsentChunk({body:Buffer.from("different version")}), {code:"CODEX_POLICY_DIGEST_MISMATCH"});
  const source = adapted.body.toString("utf8");
  const begin = source.indexOf("class ehK{"), end = source.indexOf("var ehQ=", begin);
  assert.ok(begin >= 0 && end > begin);
  const a = view(2), b = view(3), blank = view(1), records = new Map([[2, a], [3, b]]), router = routerFor(records), seen = [];
  const ctx = {
    eo: { TF: class {} }, ehV: { safeParse: () => ({success:true, data:{projects:{}}}) },
    em: { cPM: () => ({}) }, eI: (x) => x, ar: {n:"local"},
    ea: { BrowserWindow: { getFocusedWindow: () => null } }, AbortController, Symbol,
    __kanbanSelectConsentWindow: () => router.selectWindow(),
  };
  const Consent = vm.runInNewContext(`${source.slice(begin,end)};ehK`, ctx);
  const connection = { sendAppServerRequest: async (method) => { assert.equal(method,"config/read"); return {config:{},layers:[]}; } };
  const consent = new Consent(() => connection, () => ({}), async () => { setTimeout(() => blank.window.destroy(), 20); return blank.window; });
  consent.serviceForWindow(a.window.webContents).subscribe(rpcCallback(async () => { seen.push("A"); return false; }));
  consent.serviceForWindow(b.window.webContents).subscribe(rpcCallback(async () => { seen.push("B"); return false; }));
  const projects = { async createLocal(root) { return consent.confirm("local",[root]); } };
  const boundA = router.bindProjects(projects,a.window.webContents), boundB = router.bindProjects(projects,b.window.webContents);
  assert.deepEqual(await Promise.all([boundA.createLocal("/fixture/a"),boundB.createLocal("/fixture/b")]),[false,false]);
  assert.deepEqual(seen,["A","B"]);
});

test("original consent waits for the originating view or rejects when it closes", {
  skip: !process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT && "Provide the pinned Linux app root",
}, async () => {
  const original = await originalChunk(process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT);
  const source = adapter.adaptProjectConsentChunk({body:original}).body.toString("utf8");
  const begin = source.indexOf("class ehK{"), end = source.indexOf("var ehQ=", begin);
  const a = view(2), b = view(3), records = new Map([[2,a],[3,b]]), router = routerFor(records), seen=[];
  const ctx = {
    eo:{TF:class {}}, ehV:{safeParse:()=>({success:true,data:{projects:{}}})},
    em:{cPM:()=>({})}, eI:x=>x, ar:{n:"local"},
    ea:{BrowserWindow:{getFocusedWindow:()=>b.window}}, AbortController, Symbol,
    __kanbanSelectConsentWindow:()=>router.selectWindow(),
  };
  const Consent = vm.runInNewContext(`${source.slice(begin,end)};ehK`,ctx);
  const consent = new Consent(() => ({sendAppServerRequest:async () => ({config:{},layers:[]})}), () => ({}), async () => b.window);
  consent.serviceForWindow(b.window.webContents).subscribe(rpcCallback(async () => {seen.push("B"); return false;}));
  const bound = router.bindProjects({async createLocal() {return consent.confirm("local",["/fixture/a"]);}},a.window.webContents);
  const first = bound.createLocal();
  await delay(15);
  assert.deepEqual(seen, []);
  const registration = consent.serviceForWindow(a.window.webContents).subscribe(rpcCallback(async () => {seen.push("A"); return false;}));
  assert.equal(await first, false);
  assert.deepEqual(seen, ["A"]);
  registration.unsubscribe();
  const second = bound.createLocal();
  await delay(15);
  a.window.destroy();
  assert.equal(await second, false);
  assert.deepEqual(seen, ["A"]);
});
