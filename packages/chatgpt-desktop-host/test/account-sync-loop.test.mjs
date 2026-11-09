import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { seedDesktopAccountSnapshot } from "../src/account-snapshot.mjs";
import { createDesktopAccountSynchronizer, startDesktopAccountSyncLoop } from "../src/account-sync.mjs";

const jwt = (payload) => ["eyJhbGciOiJub25lIn0", Buffer.from(JSON.stringify(payload)).toString("base64url"), "c2ln"].join(".");
function auth({ account = "fixture-account", issued = 100 } = {}) {
  const claims = { iss: "https://issuer.fixture", sub: "fixture-user", iat: issued, exp: issued + 3600, "https://api.openai.com/auth": { chatgpt_account_id: account } };
  return { auth_mode: "chatgpt", tokens: { id_token: jwt(claims), access_token: jwt({ ...claims, kind: "access" }), account_id: account, refresh_token: "FAKE_NOT_COPIED" } };
}
function scheduler(t) {
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout, pending = new Set();
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
    if (ms !== 30000) return realSet(fn, ms, ...args);
    const timer = { unref() { return this; }, fire() { pending.delete(timer); fn(...args); } }; pending.add(timer); return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer) => { if (!pending.delete(timer)) realClear(timer); });
  return { pending, fire() { assert.equal(pending.size, 1); [...pending][0].fire(); } };
}
async function until(predicate) {
  for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise((done) => setTimeout(done, 5)); }
  throw new Error("fixture loop did not settle");
}
async function fixture(t) {
  const sourceRoot = await mkdtemp("/dev/shm/desktop-loop-source-");
  const homeRoot = await mkdtemp("/dev/shm/desktop-loop-home-");
  const grantRoot = await mkdtemp("/dev/shm/desktop-loop-grant-");
  const sourceFile = join(sourceRoot, "auth.json"), grantFile = join(grantRoot, "grant"), targetFile = join(homeRoot, ".codex/auth.json");
  await writeFile(sourceFile, JSON.stringify(auth()), { mode: 0o600 });
  await writeFile(join(sourceRoot, "auth.lock"), "", { mode: 0o600 });
  await writeFile(grantFile, "chatgpt-desktop-account-sync-v1\n", { mode: 0o600 });
  await seedDesktopAccountSnapshot({ sourceFile, homeRoot });
  const sync = await createDesktopAccountSynchronizer({ sourceFile, homeRoot, grantFile });
  t.after(async () => { await sync.close(); await Promise.all([sourceRoot, homeRoot, grantRoot].map((p) => rm(p, { recursive: true, force: true }))); });
  return { sourceRoot, sourceFile, homeRoot, grantFile, targetFile, sync };
}

test("loop checks immediately then serially at its fixed interval", async (t) => {
  const clock = scheduler(t), f = await fixture(t), loop = startDesktopAccountSyncLoop(f.sync);
  t.after(() => loop.close());
  await until(() => loop.status().lastCheck === "unchanged");
  assert.equal(clock.pending.size, 1);
  await writeFile(f.sourceFile, JSON.stringify(auth({ issued: 200 })));
  clock.fire();
  await until(() => loop.status().lastCheck === "updated");
  assert.equal(clock.pending.size, 1);
  assert.equal(JSON.parse(await readFile(f.targetFile, "utf8")).tokens.refresh_token, "");
});

test("a busy lock is skipped until the next fixed check", async (t) => {
  const clock = scheduler(t), f = await fixture(t);
  const child = spawn("/usr/bin/flock", ["-x", join(f.sourceRoot, "auth.lock"), "/bin/sh", "-c", "printf ready; read ignored"], { stdio: ["pipe", "pipe", "ignore"] });
  t.after(() => child.stdin.end("\n"));
  await new Promise((resolve, reject) => { child.stdout.once("data", resolve); child.once("error", reject); });
  await writeFile(f.sourceFile, JSON.stringify(auth({ issued: 200 })));
  const loop = startDesktopAccountSyncLoop(f.sync); t.after(() => loop.close());
  await until(() => loop.status().lastCheck === "busy");
  assert.equal(clock.pending.size, 1);
  child.stdin.end("\n"); await new Promise((done) => child.once("exit", done));
  clock.fire(); await until(() => loop.status().lastCheck === "updated");
});

for (const reason of ["revoked", "identity", "target"]) test(`loop stops after ${reason}`, async (t) => {
  const clock = scheduler(t), f = await fixture(t), loop = startDesktopAccountSyncLoop(f.sync); t.after(() => loop.close());
  await until(() => loop.status().lastCheck === "unchanged");
  if (reason === "revoked") await unlink(f.grantFile);
  if (reason === "identity") await writeFile(f.sourceFile, JSON.stringify(auth({ account: "other", issued: 200 })));
  if (reason === "target") await unlink(f.targetFile);
  clock.fire(); await until(() => loop.status().state === "stopped");
  const codes = { revoked: "ACCOUNT_SYNC_REVOKED", identity: "ACCOUNT_SYNC_IDENTITY_CHANGED", target: "ACCOUNT_SYNC_TARGET_CHANGED" };
  assert.equal(loop.status().code, codes[reason]);
  assert.equal(clock.pending.size, 0);
});

test("close clears the timer and fences an in-flight check", async (t) => {
  const clock = scheduler(t), f = await fixture(t);
  await writeFile(f.sourceFile, JSON.stringify(auth({ issued: 200 })));
  const loop = startDesktopAccountSyncLoop(f.sync);
  await loop.close();
  const after = await readFile(f.targetFile);
  await writeFile(f.sourceFile, JSON.stringify(auth({ issued: 300 })));
  assert.equal(loop.status().state, "closed");
  assert.equal(clock.pending.size, 0);
  assert.deepEqual(await readFile(f.targetFile), after);
});

test("only an explicitly enrolled synchronizer may start one loop", async (t) => {
  const f = await fixture(t);
  assert.throws(() => startDesktopAccountSyncLoop({ syncNow() {}, close() {} }), { code: "ACCOUNT_SYNC_INVALID_CONFIG" });
  const loop = startDesktopAccountSyncLoop(f.sync); t.after(() => loop.close());
  assert.throws(() => startDesktopAccountSyncLoop(f.sync), { code: "ACCOUNT_SYNC_INVALID_CONFIG" });
});
