import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { seedDesktopAccountSnapshot } from "../src/account-snapshot.mjs";
import { createDesktopAccountSynchronizer, desktopAccountIdentityDigest } from "../src/account-sync.mjs";

const GRANT = "chatgpt-desktop-account-sync-v1\n";
const fakeJwt = (payload) => ["eyJhbGciOiJub25lIn0", Buffer.from(JSON.stringify(payload)).toString("base64url"), "c2ln"].join(".");
const makeAuth = ({ account = "fixture-account", subject = "fixture-user", issued = 100, serial = "one" } = {}) => {
  const claims = { iss: "https://issuer.fixture", sub: subject, iat: issued, exp: issued + 3600, "https://api.openai.com/auth": { chatgpt_account_id: account } };
  return { auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { id_token: fakeJwt({ ...claims, jti: `id-${serial}` }), access_token: fakeJwt({ ...claims, jti: `access-${serial}` }), account_id: account, refresh_token: "FAKE_REFRESH_NEVER_IN_DESTINATION" }, last_refresh: "2026-11-04T00:00:00Z" };
};

test("identity digest remains stable across token rotation and changes with account identity", () => {
  const hash = (v) => desktopAccountIdentityDigest(Buffer.from(JSON.stringify(v)));
  assert.match(hash(makeAuth()), /^[a-f0-9]{64}$/);
  assert.equal(hash(makeAuth()), hash(makeAuth({ issued: 200, serial: "two" })));
  assert.notEqual(hash(makeAuth()), hash(makeAuth({ subject: "another" })));
  assert.notEqual(hash(makeAuth()), hash(makeAuth({ account: "another" })));
  const missing = makeAuth(); delete missing.tokens.account_id;
  assert.throws(() => hash(missing), { code: "ACCOUNT_SYNC_INVALID_SOURCE" });
});

async function fixture(t) {
  const sourceRoot = await mkdtemp("/dev/shm/desktop-sync-source-");
  const homeRoot = await mkdtemp("/dev/shm/desktop-sync-home-");
  const grantRoot = await mkdtemp("/dev/shm/desktop-sync-grant-");
  const sourceFile = join(sourceRoot, "auth.json"), grantFile = join(grantRoot, "grant"), targetFile = join(homeRoot, ".codex", "auth.json");
  await writeFile(sourceFile, JSON.stringify(makeAuth()), { mode: 0o600 });
  await writeFile(join(sourceRoot, "auth.lock"), "", { mode: 0o600 });
  await writeFile(grantFile, GRANT, { mode: 0o600 });
  await seedDesktopAccountSnapshot({ sourceFile, homeRoot });
  const sync = await createDesktopAccountSynchronizer({ sourceFile, homeRoot, grantFile });
  t.after(async () => { await sync.close(); await Promise.all([sourceRoot, homeRoot, grantRoot].map((p) => rm(p, { recursive: true, force: true }))); });
  const replaceSource = async (value) => writeFile(sourceFile, JSON.stringify(value), { mode: 0o600 });
  return { sourceFile, sourceRoot, homeRoot, grantFile, targetFile, sync, replaceSource };
}

test("same identity token rotation is copied only into the private snapshot", async (t) => {
  const f = await fixture(t), next = makeAuth({ issued: 200, serial: "two" });
  await f.replaceSource(next);
  const sourceBefore = await readFile(f.sourceFile), infoBefore = await lstat(f.sourceFile, { bigint: true });
  assert.deepEqual(await f.sync.syncNow(), { state: "updated" });
  const destination = await readFile(f.targetFile, "utf8"), parsed = JSON.parse(destination);
  assert.equal(parsed.tokens.access_token, next.tokens.access_token);
  assert.equal(parsed.tokens.id_token, next.tokens.id_token);
  assert.equal(parsed.tokens.refresh_token, "");
  assert.ok(!destination.includes("FAKE_REFRESH_NEVER_IN_DESTINATION"));
  assert.equal((await lstat(f.targetFile)).mode & 0o7777, 0o600);
  assert.deepEqual(await readFile(f.sourceFile), sourceBefore);
  const infoAfter = await lstat(f.sourceFile, { bigint: true });
  for (const key of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"]) assert.equal(infoAfter[key], infoBefore[key]);
  assert.deepEqual(await f.sync.syncNow(), { state: "unchanged" });
});

test("rejects account switch, subject switch, missing account and inconsistent token claims", async (t) => {
  const bad = [makeAuth({ account: "other", issued: 200 }), makeAuth({ subject: "other", issued: 200 }), makeAuth({ issued: 200 }), makeAuth({ issued: 200 })];
  delete bad[2].tokens.account_id;
  bad[3].tokens.id_token = makeAuth({ account: "other", issued: 200 }).tokens.id_token;
  for (const value of bad) {
    const f = await fixture(t), before = await readFile(f.targetFile);
    await f.replaceSource(value);
    await assert.rejects(f.sync.syncNow(), (e) => /^ACCOUNT_SYNC_(IDENTITY_CHANGED|INVALID_SOURCE)$/.test(e.code) && !e.message.includes("fixture"));
    assert.deepEqual(await readFile(f.targetFile), before);
  }
});

test("removing or replacing the explicit grant revokes future updates", async (t) => {
  const f = await fixture(t), before = await readFile(f.targetFile);
  await unlink(f.grantFile);
  await f.replaceSource(makeAuth({ issued: 200 }));
  await assert.rejects(f.sync.syncNow(), { code: "ACCOUNT_SYNC_REVOKED" });
  await writeFile(f.grantFile, GRANT, { mode: 0o600 });
  await assert.rejects(f.sync.syncNow(), { code: "ACCOUNT_SYNC_REVOKED" });
  assert.deepEqual(await readFile(f.targetFile), before);
});

test("does not restore a logged-out destination or overwrite an independent auth change", async (t) => {
  const a = await fixture(t);
  await unlink(a.targetFile);
  await a.replaceSource(makeAuth({ issued: 200 }));
  await assert.rejects(a.sync.syncNow(), { code: "ACCOUNT_SYNC_TARGET_CHANGED" });
  await assert.rejects(lstat(a.targetFile), { code: "ENOENT" });
  const b = await fixture(t);
  await writeFile(b.targetFile, JSON.stringify(makeAuth({ account: "different" })), { mode: 0o600 });
  const external = await readFile(b.targetFile);
  await b.replaceSource(makeAuth({ issued: 200 }));
  await assert.rejects(b.sync.syncNow(), { code: "ACCOUNT_SYNC_TARGET_CHANGED" });
  assert.deepEqual(await readFile(b.targetFile), external);
});

test("does not roll back to an older token or follow an unsafe source", async (t) => {
  const f = await fixture(t), before = await readFile(f.targetFile);
  await f.replaceSource(makeAuth({ issued: 99 }));
  await assert.rejects(f.sync.syncNow(), { code: "ACCOUNT_SYNC_STALE_SOURCE" });
  assert.deepEqual(await readFile(f.targetFile), before);
  const g = await fixture(t), unchanged = await readFile(g.targetFile);
  await chmod(g.sourceFile, 0o644);
  await assert.rejects(g.sync.syncNow(), { code: "ACCOUNT_SYNC_UNSAFE_SOURCE" });
  assert.deepEqual(await readFile(g.targetFile), unchanged);
});

test("revocation is terminal and close waits for all in-flight synchronization", async (t) => {
  const f = await fixture(t);
  await f.replaceSource(makeAuth({ issued: 200 }));
  const work = f.sync.syncNow();
  await f.sync.close();
  await work.catch(() => {});
  const afterClose = await readFile(f.targetFile);
  await f.replaceSource(makeAuth({ issued: 300 }));
  await assert.rejects(f.sync.syncNow(), { code: "ACCOUNT_SYNC_REVOKED" });
  assert.deepEqual(await readFile(f.targetFile), afterClose);
});

test("does not wait for or overwrite a native writer holding the official auth lock", async (t) => {
  const f = await fixture(t), lock = join(f.homeRoot, ".codex", "auth.lock");
  await writeFile(lock, "", { mode: 0o600 });
  const child = spawn("/usr/bin/flock", ["-x", lock, "/bin/sh", "-c", "printf ready; read ignored"], { stdio: ["pipe", "pipe", "ignore"] });
  t.after(() => child.stdin.end("\n"));
  await new Promise((resolve, reject) => { child.stdout.once("data", resolve); child.once("error", reject); });
  const before = await readFile(f.targetFile);
  await f.replaceSource(makeAuth({ issued: 200 }));
  assert.deepEqual(await f.sync.syncNow(), { state: "busy" });
  assert.deepEqual(await readFile(f.targetFile), before);
  child.stdin.end("\n");
  await new Promise((resolve) => child.once("exit", resolve));
  assert.deepEqual(await f.sync.syncNow(), { state: "updated" });
});

test("a busy official source lock prevents copying without changing the login source", async (t) => {
  const f = await fixture(t), lock = join(f.sourceRoot, "auth.lock");
  const child = spawn("/usr/bin/flock", ["-x", lock, "/bin/sh", "-c", "printf ready; read ignored"], { stdio: ["pipe", "pipe", "ignore"] });
  t.after(() => child.stdin.end("\n"));
  await new Promise((resolve, reject) => { child.stdout.once("data", resolve); child.once("error", reject); });
  const before = await readFile(f.targetFile), sourceLockBefore = await lstat(lock, { bigint: true });
  await f.replaceSource(makeAuth({ issued: 200 }));
  assert.deepEqual(await f.sync.syncNow(), { state: "busy" });
  assert.deepEqual(await readFile(f.targetFile), before);
  const sourceLockAfter = await lstat(lock, { bigint: true });
  for (const key of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"]) assert.equal(sourceLockAfter[key], sourceLockBefore[key]);
  child.stdin.end("\n");
  await new Promise((resolve) => child.once("exit", resolve));
  assert.deepEqual(await f.sync.syncNow(), { state: "updated" });
});

test("a missing source lock is never created as a side effect", async (t) => {
  const f = await fixture(t), lock = join(f.sourceRoot, "auth.lock"), before = await readFile(f.targetFile);
  await unlink(lock);
  await f.replaceSource(makeAuth({ issued: 200 }));
  await assert.rejects(f.sync.syncNow(), { code: "ACCOUNT_SYNC_LOCK_UNAVAILABLE" });
  await assert.rejects(lstat(lock), { code: "ENOENT" });
  assert.deepEqual(await readFile(f.targetFile), before);
});

test("a same-account independent target rewrite is detected as a target change", async (t) => {
  const f = await fixture(t), target = JSON.parse(await readFile(f.targetFile, "utf8"));
  target.last_refresh = "2026-11-04T01:00:00Z";
  await writeFile(f.targetFile, JSON.stringify(target));
  const external = await readFile(f.targetFile);
  await f.replaceSource(makeAuth({ issued: 200 }));
  await assert.rejects(f.sync.syncNow(), { code: "ACCOUNT_SYNC_TARGET_CHANGED" });
  assert.deepEqual(await readFile(f.targetFile), external);
});

test("symlinked source or grant cannot enroll a synchronizer", async (t) => {
  const f = await fixture(t), alias = join(f.sourceRoot, "alias");
  await symlink(f.sourceFile, alias);
  await assert.rejects(createDesktopAccountSynchronizer({ sourceFile: alias, homeRoot: f.homeRoot, grantFile: f.grantFile }));
  const grantAlias = join(f.sourceRoot, "grant-alias");
  await symlink(f.grantFile, grantAlias);
  await assert.rejects(createDesktopAccountSynchronizer({ sourceFile: f.sourceFile, homeRoot: f.homeRoot, grantFile: grantAlias }));
});

test("accessor and extra-key configurations are rejected without evaluating them", async (t) => {
  const f = await fixture(t); let evaluated = false;
  const options = { homeRoot: f.homeRoot, grantFile: f.grantFile };
  Object.defineProperty(options, "sourceFile", { enumerable: true, get() { evaluated = true; return f.sourceFile; } });
  await assert.rejects(createDesktopAccountSynchronizer(options), { code: "ACCOUNT_SYNC_INVALID_CONFIG" });
  assert.equal(evaluated, false);
  await assert.rejects(createDesktopAccountSynchronizer({ sourceFile: f.sourceFile, homeRoot: f.homeRoot, grantFile: f.grantFile, extra: true }), { code: "ACCOUNT_SYNC_INVALID_CONFIG" });
});
