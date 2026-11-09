import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readlink, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectRecoverySource,
  openPersistentProjectStore,
  prepareLiveProjectPersistence,
  prepareNativeProjectSeed,
  projectStateProjection,
  sealPendingProjectState,
} from "../src/persistent-projects.mjs";
import { desktopAccountIdentityDigest } from "../src/account-sync.mjs";

const anonymous = createHash("sha256").update("kanban-codex-history-v1\0anonymous").digest("hex");

function auth(account = "account-a", sub = "subject-a", issued = 100) {
  const payload = { iss: "https://issuer.test", sub, iat: issued, exp: issued + 10000, "https://api.openai.com/auth": { chatgpt_account_id: account } };
  const jwt = "e30." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".c2ln";
  return JSON.stringify({ auth_mode: "chatgpt", tokens: { id_token: jwt, access_token: jwt, account_id: account, refresh_token: "" } });
}

async function fixture(t, accountSeeded = false) {
  const root = await mkdtemp(join(tmpdir(), "desktop-project-final-"));
  const storeRoot = join(root, "store"), homeRoot = accountSeeded ? await mkdtemp("/dev/shm/desktop-project-final-") : join(root, "home"), codex = join(homeRoot, ".codex"), projectRoot = join(root, "projects");
  for (const path of [storeRoot, ...(accountSeeded ? [] : [homeRoot]), codex, projectRoot]) await mkdir(path, { mode: 0o700 });
  const binding = accountSeeded ? desktopAccountIdentityDigest(Buffer.from(auth())) : anonymous;
  if (accountSeeded) await writeFile(join(codex, "auth.json"), auth(), { mode: 0o600 });
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await once(child, "spawn");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await once(child, "exit").catch(() => {}); }
    await rm(root, { recursive: true, force: true });
    if (accountSeeded) await rm(homeRoot, { recursive: true, force: true });
  });
  const stat = await readFile(`/proc/${child.pid}/stat`, "utf8"), fields = stat.slice(stat.lastIndexOf(") ") + 2).trim().split(/\s+/);
  const native = { pid: child.pid, startTicks: fields[19], pidns: await readlink(`/proc/${child.pid}/ns/pid`), uid: process.getuid() };
  const writer = { containerId: "b".repeat(64), profileId: randomUUID(), generation: randomUUID() };
  const project = { id: "project-1", name: "initial", rootPaths: [projectRoot], createdAt: 1, updatedAt: 2 };
  const state = (entry) => ({ "local-projects": { [entry.id]: entry }, "selected-project": { type: "local", projectId: entry.id }, "project-order": [entry.id] });
  const recoverySource = createProjectRecoverySource({ homeRoot, accountSeeded, allowedRoots: [projectRoot] });
  let authorized = true;
  const base = { storeRoot, accountBinding: binding, previousContainerId: null, allowedRoots: [projectRoot], verifyAuthority: () => authorized };
  const store = openPersistentProjectStore({ ...base, recoverySource });
  store.adopt(writer);
  store.bindNative(writer, native, () => true);
  store.capture(state(project), writer);
  store.close();
  const finalFile = join(codex, ".codex-global-state.json");
  await writeFile(finalFile, JSON.stringify(state({ ...project, name: "final" })), { mode: 0o600 });
  let leaseCalls = 0;
  const options = { ...base, previousContainerId: writer.containerId, withPreviousOwnerLease: (fn) => { leaseCalls++; return fn(); } };
  return { root, storeRoot, homeRoot, projectRoot, child, native, writer, project, state, finalFile, options, leaseCalls: () => leaseCalls, revoke: () => { authorized = false; } };
}

async function exited(child) {
  const exit = once(child, "exit"); child.kill("SIGTERM"); await exit;
}

test("final seal refuses a still-running native and preserves the old snapshot and pending marker", async (t) => {
  const f = await fixture(t), before = await readFile(join(f.storeRoot, "projects.json"));
  const pending = await readFile(join(f.storeRoot, "pending.json"));
  assert.throws(() => sealPendingProjectState(f.options), { code: "PROJECT_STATE_UNCERTAIN" });
  assert.ok(f.leaseCalls() > 0);
  assert.deepEqual(await readFile(join(f.storeRoot, "projects.json")), before);
  assert.deepEqual(await readFile(join(f.storeRoot, "pending.json")), pending);
});

test("after the exact native exits, a held previous-owner lease seals its final original project state", async (t) => {
  const f = await fixture(t); await exited(f.child);
  assert.equal(sealPendingProjectState(f.options), true);
  const { withPreviousOwnerLease: _lease, ...openOptions } = f.options;
  const store = openPersistentProjectStore(openOptions);
  const restored = store.restore(); store.close();
  assert.equal(restored["local-projects"][f.project.id].name, "final");
  assert.equal(restored["selected-project"].projectId, f.project.id);
});

test("the final seal preserves the latest project selection and does not resurrect a removed project", async (t) => {
  const f = await fixture(t);
  const changedRoot = join(f.projectRoot, "selected-later");
  await mkdir(changedRoot, { mode: 0o700 });
  const changed = { id: "project-2", name: "selected later", rootPaths: [changedRoot], createdAt: 3, updatedAt: 4 };
  await writeFile(f.finalFile, JSON.stringify(f.state(changed)), { mode: 0o600 });
  await exited(f.child);
  assert.equal(sealPendingProjectState(f.options), true);
  const { withPreviousOwnerLease: _lease, ...openOptions } = f.options;
  const store = openPersistentProjectStore(openOptions);
  const restored = store.restore(); store.close();
  assert.deepEqual(Object.keys(restored["local-projects"]), [changed.id]);
  assert.equal(restored["selected-project"].projectId, changed.id);
  assert.deepEqual(restored["project-order"], [changed.id]);
});

test("the next HOME is seeded only from the sealed final state and rechecks the old source before grant", async (t) => {
  const f = await fixture(t); await exited(f.child);
  const nextHome = join(f.root, "next-home"); await mkdir(nextHome, { mode: 0o700 }); await mkdir(join(nextHome, ".codex"), { mode: 0o700 });
  const recoverySource = createProjectRecoverySource({ homeRoot: nextHome, accountSeeded: false, allowedRoots: [f.projectRoot] });
  const prepared = prepareLiveProjectPersistence({ ...f.options, recoverySource });
  assert.equal(prepared.state, "waiting");
  assert.equal(prepared.restored["local-projects"][f.project.id].name, "final");
  const seed = prepareNativeProjectSeed({ homeRoot: nextHome, projection: projectStateProjection(prepared.restored, { allowedRoots: [f.projectRoot] }), allowedRoots: [f.projectRoot], verifyAuthority: () => prepared.store.verifyRestored() });
  const nextWriter = { containerId: "c".repeat(64), profileId: randomUUID(), generation: randomUUID() };
  prepared.store.adopt(nextWriter);
  assert.equal(seed.verifyBeforeGrant(), true);
  await writeFile(f.finalFile, JSON.stringify(f.state({ ...f.project, name: "changed-after-seal" })), { mode: 0o600 });
  assert.equal(seed.verifyBeforeGrant(), false);
  seed.close(); prepared.store.close();
});

test("a replaced old HOME, changed project root or unsupported final shape never replaces the prior snapshot", async (t) => {
  for (const kind of ["home", "root", "unsupported"]) {
    const f = await fixture(t); await exited(f.child);
    const before = await readFile(join(f.storeRoot, "projects.json")), pending = await readFile(join(f.storeRoot, "pending.json"));
    if (kind === "home") { await rename(f.homeRoot, f.homeRoot + ".old"); await mkdir(f.homeRoot, { mode: 0o700 }); }
    if (kind === "root") { await rename(f.projectRoot, f.projectRoot + ".old"); await mkdir(f.projectRoot, { mode: 0o700 }); }
    if (kind === "unsupported") await writeFile(f.finalFile, JSON.stringify(f.state({ ...f.project, chatGptBacking: { secret: "do not persist" } })), { mode: 0o600 });
    assert.throws(() => sealPendingProjectState(f.options));
    assert.deepEqual(await readFile(join(f.storeRoot, "projects.json")), before);
    assert.deepEqual(await readFile(join(f.storeRoot, "pending.json")), pending);
  }
});

test("a disappeared old HOME keeps pending project evidence and does not seed an old snapshot", async (t) => {
  const f = await fixture(t); await exited(f.child);
  const before = await readFile(join(f.storeRoot, "projects.json"));
  const pending = await readFile(join(f.storeRoot, "pending.json"));
  await rm(f.homeRoot, { recursive: true });
  const nextHome = join(f.root, "next-home");
  await mkdir(nextHome, { mode: 0o700 }); await mkdir(join(nextHome, ".codex"), { mode: 0o700 });
  const recoverySource = createProjectRecoverySource({ homeRoot: nextHome, accountSeeded: false, allowedRoots: [f.projectRoot] });
  const prepared = prepareLiveProjectPersistence({ ...f.options, recoverySource });
  assert.deepEqual(prepared, { state: "error" });
  assert.deepEqual(await readFile(join(f.storeRoot, "projects.json")), before);
  assert.deepEqual(await readFile(join(f.storeRoot, "pending.json")), pending);
  await assert.rejects(readFile(join(nextHome, ".codex", ".codex-global-state.json")), { code: "ENOENT" });
});

test("same-account token rotation is accepted, while old-HOME account switch or revoked source blocks sealing", async (t) => {
  const rotated = await fixture(t, true); await exited(rotated.child);
  await writeFile(join(rotated.homeRoot, ".codex", "auth.json"), auth("account-a", "subject-a", 200), { mode: 0o600 });
  assert.equal(sealPendingProjectState(rotated.options), true);
  for (const kind of ["old-account", "source-revoked"]) {
    const f = await fixture(t, true); await exited(f.child);
    const before = await readFile(join(f.storeRoot, "projects.json")), pending = await readFile(join(f.storeRoot, "pending.json"));
    if (kind === "old-account") await writeFile(join(f.homeRoot, ".codex", "auth.json"), auth("other-account"), { mode: 0o600 });
    else f.revoke();
    assert.throws(() => sealPendingProjectState(f.options));
    assert.deepEqual(await readFile(join(f.storeRoot, "projects.json")), before);
    assert.deepEqual(await readFile(join(f.storeRoot, "pending.json")), pending);
  }
});

test("a final state change during sealing never publishes the candidate or overwrites the prior snapshot", async (t) => {
  const f = await fixture(t); await exited(f.child);
  const before = await readFile(join(f.storeRoot, "projects.json")), pending = await readFile(join(f.storeRoot, "pending.json"));
  let checks = 0;
  const verifyAuthority = () => {
    if (++checks === 2) writeFileSync(f.finalFile, JSON.stringify(f.state({ ...f.project, name: "changed-during-seal" })), { mode: 0o600 });
    return true;
  };
  assert.throws(() => sealPendingProjectState({ ...f.options, verifyAuthority }));
  assert.deepEqual(await readFile(join(f.storeRoot, "projects.json")), before);
  assert.deepEqual(await readFile(join(f.storeRoot, "pending.json")), pending);
});
