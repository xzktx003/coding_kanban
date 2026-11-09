import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { seedDesktopAccountSnapshot } from "../src/account-snapshot.mjs";
import { createDesktopAccountSynchronizer } from "../src/account-sync.mjs";

const cli = process.env.CHATGPT_SYNC_NATIVE_CLI;
const expectedSha = "6253fb59fc4c21a9134b2f73237650eaec4a3d9380e5af12f3f1e9040dc24c14";
const jwt = (value) => ["eyJhbGciOiJub25lIn0", Buffer.from(JSON.stringify(value)).toString("base64url"), "c2ln"].join(".");
function fixtureAuth(serial, issued, validSeconds = 86400) {
  const payload = { iss: "https://issuer.fixture", sub: "fixture-user", iat: issued, exp: issued + validSeconds, email: "fixture@example.invalid", "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account", chatgpt_plan_type: "plus" } };
  return { auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { id_token: jwt({ ...payload, jti: `id-${serial}` }), access_token: jwt({ ...payload, jti: `access-${serial}` }), refresh_token: "", account_id: "fixture-account" }, last_refresh: new Date().toISOString() };
}

for (const nearExpiry of [false, true]) test(`pinned native CLI observes rotation ${nearExpiry ? "on proactive expiry" : "after explicit reload"}`, { skip: !cli, timeout: 30000 }, async (t) => {
  assert.deepEqual(Object.keys(networkInterfaces()), ["lo"], "fixture must run in a network-none namespace");
  assert.equal(createHash("sha256").update(await readFile(cli)).digest("hex"), expectedSha);
  const sourceRoot = await mkdtemp("/dev/shm/desktop-sync-native-source-");
  const homeRoot = await mkdtemp("/dev/shm/desktop-sync-native-home-");
  const grantRoot = await mkdtemp("/dev/shm/desktop-sync-native-grant-");
  const sourceFile = join(sourceRoot, "auth.json"), grantFile = join(grantRoot, "grant");
  const first = fixtureAuth("first", Math.floor(Date.now() / 1000) - 10, nearExpiry ? 60 : 86400);
  const second = fixtureAuth("second", Math.floor(Date.now() / 1000));
  await writeFile(sourceFile, JSON.stringify(first), { mode: 0o600 });
  await writeFile(join(sourceRoot, "auth.lock"), "", { mode: 0o600 });
  await writeFile(grantFile, "chatgpt-desktop-account-sync-v1\n", { mode: 0o600 });
  await seedDesktopAccountSnapshot({ sourceFile, homeRoot });
  const sync = await createDesktopAccountSynchronizer({ sourceFile, homeRoot, grantFile });
  const child = spawn(cli, ["app-server"], { env: { HOME: homeRoot, CODEX_HOME: join(homeRoot, ".codex"), PATH: "/usr/bin:/bin", RUST_LOG: "info", HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9" }, stdio: ["pipe", "pipe", "pipe"] });
  t.after(async () => {
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) {
      await Promise.race([new Promise((done) => child.once("exit", done)), new Promise((done) => setTimeout(done, 2000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    await sync.close();
    await Promise.all([sourceRoot, homeRoot, grantRoot].map((p) => rm(p, { recursive: true, force: true })));
  });
  let seq = 0;
  let lines = 0, unparsed = 0, withoutId = 0, stderrBytes = 0;
  child.stderr.on("data", (part) => { stderrBytes += part.length; });
  const pending = new Map();
  child.once("error", () => { for (const p of pending.values()) p.reject(new Error("native fixture process launch failed")); pending.clear(); });
  child.once("exit", (code, signal) => { for (const p of pending.values()) p.reject(new Error(`native fixture exited: ${code ?? signal}`)); pending.clear(); });
  createInterface({ input: child.stdout }).on("line", (line) => {
    lines++;
    let message; try { message = JSON.parse(line); } catch { unparsed++; return; }
    if (!Number.isSafeInteger(message.id)) { withoutId++; return; }
    const p = pending.get(message.id); if (!p) return; pending.delete(message.id);
    if (message.error) p.reject(new Error("native fixture RPC failed")); else p.resolve(message.result);
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    const timer = setTimeout(async () => { if (pending.delete(id)) { let wchan = "unknown"; try { wchan = (await readFile(`/proc/${child.pid}/wchan`, "utf8")).trim(); } catch {} reject(new Error(`native fixture RPC timed out: ${method}; lines=${lines}; unparsed=${unparsed}; withoutId=${withoutId}; stderrBytes=${stderrBytes}; wchan=${wchan}`)); } }, 10000); timer.unref();
  });
  await rpc("initialize", { clientInfo: { name: "account-sync-fixture", version: "1.0.0" }, capabilities: {} });
  child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
  if (!nearExpiry) {
    const before = await rpc("getAuthStatus", { includeToken: true, refreshToken: false });
    assert.equal(before.authToken, first.tokens.access_token);
  }
  await writeFile(sourceFile, JSON.stringify(second), { mode: 0o600 });
  assert.deepEqual(await sync.syncNow(), { state: "updated" });
  const cached = await rpc("getAuthStatus", { includeToken: true, refreshToken: false });
  if (nearExpiry) assert.equal(cached.authToken, second.tokens.access_token, "proactive expiry should use the rotated snapshot");
  else {
    assert.equal(cached.authToken, first.tokens.access_token, "snapshot replacement is not immediate native reload");
    const reloaded = await rpc("getAuthStatus", { includeToken: true, refreshToken: true });
    assert.equal(reloaded.authToken, second.tokens.access_token);
  }
});
