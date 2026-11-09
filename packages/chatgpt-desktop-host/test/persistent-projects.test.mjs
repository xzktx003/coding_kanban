import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { projectStateProjection, nativeProjectState, openPersistentProjectStore, prepareLiveProjectPersistence, prepareNativeProjectSeed, startNativeProjectMonitor } from "../src/persistent-projects.mjs";

const allowedRoots = ["/fixtures/projects"];
const first = { id: "project-1", name: "One", rootPaths: ["/fixtures/projects/one"], createdAt: 1, updatedAt: 2 };
const second = { id: "project-2", name: "Two", rootPaths: ["/fixtures/projects/two"], createdAt: 3, updatedAt: 4 };

test("projection retains only local project metadata, ordering and a matching selected local project", () => {
  const state = {
    "local-projects": { [first.id]: first, [second.id]: second },
    "selected-project": { type: "local", projectId: second.id },
    "project-order": [second.id, first.id],
    "queued-follow-ups": { arbitrary: "must never persist" },
    auth: { refresh_token: "must never persist" },
  };
  const projected = projectStateProjection(state, { allowedRoots });
  assert.deepEqual(projected, { version: 1, projects: [second, first], selectedProjectId: second.id });
  assert.deepEqual(nativeProjectState(projected, { allowedRoots }), {
    "local-projects": { [second.id]: second, [first.id]: first },
    "selected-project": { type: "local", projectId: second.id },
    "project-order": [second.id, first.id],
  });
  assert.ok(!JSON.stringify(projected).includes("private"));
  assert.ok(!JSON.stringify(projected).includes("must never persist"));
});

test("no selection cannot grant access to a local project", () => {
  for (const selected of [undefined, null]) {
    const projected = projectStateProjection({ "local-projects": { [first.id]: first }, "selected-project": selected }, { allowedRoots });
    assert.equal(projected.selectedProjectId, null);
    assert.equal(Object.hasOwn(nativeProjectState(projected, { allowedRoots }), "selected-project"), false);
  }
});

test("cloud backing, remote projects, unknown project fields and unresolved ordering are explicitly unsupported", () => {
  const invalid = [
    { "local-projects": { [first.id]: { ...first, chatGptBacking: { accountId: "private" } } } },
    { "local-projects": { [first.id]: { ...first, futureProjectField: true } } },
    { "local-projects": { [first.id]: first }, "selected-project": { type: "remote", projectId: "remote-1" } },
    { "local-projects": { [first.id]: first }, "selected-project": { type: "local", projectId: first.id, futureSelectionField: true } },
    { "local-projects": { [first.id]: first }, "remote-projects": [{ id: "remote-1" }] },
    { "local-projects": { [first.id]: first }, "project-order": [first.id, "unknown"] },
    { "local-projects": { [first.id]: first }, "project-appearances": { [first.id]: { color: "blue" } } },
  ];
  for (const state of invalid) assert.throws(() => projectStateProjection(state, { allowedRoots }), { code: "PROJECT_STATE_UNSUPPORTED" });
});

test("project paths outside the fixed authorized roots or malformed selection fail closed", () => {
  for (const bad of ["/fixtures/projects2/one", "/fixtures/projects/../elsewhere", "/etc/passwd", "relative", "/fixtures/projects/one\u0000oops"]) {
    const candidate = { ...first, rootPaths: [bad] };
    assert.throws(() => projectStateProjection({ "local-projects": { [first.id]: candidate } }, { allowedRoots }), { code: "PROJECT_STATE_INVALID" });
  }
  assert.throws(() => projectStateProjection({ "local-projects": { [first.id]: first }, "selected-project": { type: "local", projectId: "missing" } }, { allowedRoots }), { code: "PROJECT_STATE_INVALID" });
  assert.throws(() => nativeProjectState({ version: 1, projects: [{ ...first, rootPaths: ["/elsewhere"] }], selectedProjectId: first.id }, { allowedRoots }), { code: "PROJECT_STATE_INVALID" });
});

test("duplicates, malformed records and excessive project counts fail closed", () => {
  assert.throws(() => projectStateProjection({ "local-projects": { wrong: first } }, { allowedRoots }), { code: "PROJECT_STATE_INVALID" });
  assert.throws(() => nativeProjectState({ version: 1, projects: [first, first], selectedProjectId: null }, { allowedRoots }), { code: "PROJECT_STATE_INVALID" });
  const tooMany = Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`id-${i}`, { ...first, id: `id-${i}` }]));
  assert.throws(() => projectStateProjection({ "local-projects": tooMany }, { allowedRoots }), { code: "PROJECT_STATE_INVALID" });
});

async function storageFixture(t) {
  const base = await mkdtemp(join(tmpdir(), "desktop-project-store-"));
  const storeRoot = join(base, "store"), projectRoot = join(base, "projects"), projectPath = join(projectRoot, "one");
  await mkdir(storeRoot, { mode: 0o700 }); await mkdir(projectRoot, { mode: 0o700 }); await mkdir(projectPath, { mode: 0o700 });
  t.after(() => rm(base, { recursive: true, force: true }));
  const project = { ...first, rootPaths: [projectPath] }, binding = "a".repeat(64);
  const writer = { containerId: "b".repeat(64), profileId: randomUUID(), generation: randomUUID() };
  let authorized = true;
  const options = { storeRoot, accountBinding: binding, previousContainerId: null, allowedRoots: [projectRoot], verifyAuthority: () => authorized };
  return { base, storeRoot, projectRoot, projectPath, project, binding, writer, options, revoke() { authorized = false; } };
}

test("normal manager close leaves the projection unconfirmed while native may still write", async (t) => {
  const f = await storageFixture(t);
  const store = openPersistentProjectStore(f.options);
  assert.equal(store.restore(), null);
  const state = { "local-projects": { [f.project.id]: f.project },
    "selected-project": { type: "local", projectId: f.project.id }, "queued-follow-ups": { token: "never store" } };
  store.capture(state, f.writer);
  const bytes = await readFile(join(f.storeRoot, "projects.json"), "utf8");
  assert.ok(!bytes.includes("never store"));
  assert.equal(JSON.parse(await readFile(join(f.storeRoot, "pending.json"), "utf8")).state, "pending");
  store.close();
  assert.throws(() => openPersistentProjectStore({ ...f.options, previousContainerId: f.writer.containerId }), { code: "PROJECT_STATE_UNCERTAIN" });
});

test("an interrupted new generation cannot silently restore its predecessor's stale project snapshot", async (t) => {
  const f = await storageFixture(t), store = openPersistentProjectStore(f.options);
  store.capture({ "local-projects": { [f.project.id]: f.project } }, f.writer);
  const original = await readFile(join(f.storeRoot, "projects.json"), "utf8");
  store.close();
  // Simulate an older unsealed projection lacking this version's marker.
  await unlink(join(f.storeRoot, "pending.json"));
  const next = openPersistentProjectStore({ ...f.options, previousContainerId: f.writer.containerId });
  const writer = { containerId: "c".repeat(64), profileId: randomUUID(), generation: randomUUID() };
  next.adopt(writer); next.close();
  assert.equal(await readFile(join(f.storeRoot, "projects.json"), "utf8"), original);
  assert.throws(() => openPersistentProjectStore({ ...f.options, previousContainerId: writer.containerId }), { code: "PROJECT_STATE_UNCERTAIN" });
});

test("the live host refuses to seed an unsealed older snapshot and leaves its bytes untouched", async (t) => {
  const f = await storageFixture(t), store = openPersistentProjectStore(f.options);
  store.capture({ "local-projects": { [f.project.id]: f.project } }, f.writer); store.close();
  await unlink(join(f.storeRoot, "pending.json"));
  const before = await readFile(join(f.storeRoot, "projects.json"), "utf8");
  const result = prepareLiveProjectPersistence({ ...f.options, previousContainerId: f.writer.containerId });
  assert.equal(result.state, "error");
  assert.equal(result.store, undefined);
  assert.equal(await readFile(join(f.storeRoot, "projects.json"), "utf8"), before);
});

test("manager crash after a successful capture keeps the generation unconfirmed", async (t) => {
  const f = await storageFixture(t);
  const moduleUrl = new URL("../src/persistent-projects.mjs", import.meta.url).href;
  const script = `import { openPersistentProjectStore } from ${JSON.stringify(moduleUrl)};
    const { options, state, writer } = JSON.parse(process.argv[1]);
    options.verifyAuthority = () => true;
    const store = openPersistentProjectStore(options);
    store.adopt(writer); store.capture(state, writer);
    process.kill(process.pid, 'SIGKILL');`;
  const input = JSON.stringify({ options: { ...f.options, verifyAuthority: undefined }, state: { "local-projects": { [f.project.id]: f.project } }, writer: f.writer });
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, input], { stdio: "ignore", timeout: 5000 });
  assert.equal(child.signal, "SIGKILL");
  assert.equal(JSON.parse(await readFile(join(f.storeRoot, "pending.json"), "utf8")).state, "pending");
  const before = await readFile(join(f.storeRoot, "projects.json"), "utf8");
  const result = prepareLiveProjectPersistence({ ...f.options, previousContainerId: f.writer.containerId });
  assert.equal(result.state, "error"); assert.equal(result.store, undefined);
  assert.equal(await readFile(join(f.storeRoot, "projects.json"), "utf8"), before);
});

test("unsupported data leaves a durable restricted marker without replacing the last known project snapshot", async (t) => {
  const f = await storageFixture(t), store = openPersistentProjectStore(f.options);
  store.capture({ "local-projects": { [f.project.id]: f.project } }, f.writer);
  const original = await readFile(join(f.storeRoot, "projects.json"), "utf8");
  assert.throws(() => store.capture({ "local-projects": { [f.project.id]: { ...f.project, chatGptBacking: { secret: "do not store" } } } }, f.writer), { code: "PROJECT_STATE_UNSUPPORTED" });
  store.close();
  assert.equal(await readFile(join(f.storeRoot, "projects.json"), "utf8"), original);
  assert.ok(!(await readFile(join(f.storeRoot, "pending.json"), "utf8")).includes("do not store"));
  assert.throws(() => openPersistentProjectStore({ ...f.options, previousContainerId: f.writer.containerId }), { code: "PROJECT_STATE_UNSUPPORTED" });
});

test("project store refuses a different account or previous container", async (t) => {
  const f = await storageFixture(t), store = openPersistentProjectStore(f.options);
  store.capture({ "local-projects": { [f.project.id]: f.project } }, f.writer); store.close();
  assert.throws(() => openPersistentProjectStore({ ...f.options, accountBinding: "d".repeat(64), previousContainerId: f.writer.containerId }), { code: "PROJECT_STATE_INVALID" });
  assert.throws(() => openPersistentProjectStore({ ...f.options, previousContainerId: "c".repeat(64) }), { code: "PROJECT_STATE_INVALID" });
});

test("unsupported project state leaves the previously committed snapshot untouched", async (t) => {
  const f = await storageFixture(t), store = openPersistentProjectStore(f.options);
  store.capture({ "local-projects": { [f.project.id]: f.project } }, f.writer);
  const target = join(f.storeRoot, "projects.json"), before = await readFile(target, "utf8");
  assert.throws(() => store.capture({ "local-projects": { [f.project.id]: { ...f.project, chatGptBacking: { accountId: "do not store" } } } }, f.writer), { code: "PROJECT_STATE_UNSUPPORTED" });
  assert.equal(await readFile(target, "utf8"), before);
  store.close();
});

test("project store does not follow replaced state files or project symlinks", async (t) => {
  const f = await storageFixture(t), store = openPersistentProjectStore(f.options);
  const victim = join(f.base, "victim"); await writeFile(victim, "keep", { mode: 0o600 });
  await symlink(victim, join(f.storeRoot, "projects.json"));
  assert.throws(() => store.capture({ "local-projects": { [f.project.id]: f.project } }, f.writer), { code: "PROJECT_STATE_INVALID" });
  assert.equal(await readFile(victim, "utf8"), "keep"); store.close();
  const second = await storageFixture(t);
  await rm(second.projectPath, { recursive: true }); await symlink(second.base, second.projectPath);
  const next = openPersistentProjectStore(second.options);
  assert.throws(() => next.capture({ "local-projects": { [second.project.id]: second.project } }, second.writer), { code: "PROJECT_STATE_INVALID" });
  next.close();
});

test("revoked ownership and uninitialized global state cannot publish a project snapshot", async (t) => {
  const f = await storageFixture(t), store = openPersistentProjectStore(f.options);
  assert.equal(store.capture({ "queued-follow-ups": { body: "secret" } }, f.writer), false);
  f.revoke();
  assert.throws(() => store.capture({ "local-projects": { [f.project.id]: f.project } }, f.writer), { code: "PROJECT_STATE_INVALID" });
  await assert.rejects(readFile(join(f.storeRoot, "projects.json")), { code: "ENOENT" });
  store.close();
});

test("a native seed is private, contains only the verified projection and detects replacement before grant", async (t) => {
  const f = await storageFixture(t), homeRoot = join(f.base, "home");
  await mkdir(homeRoot, { mode: 0o700 }); await mkdir(join(homeRoot, ".codex"), { mode: 0o700 });
  const projection = projectStateProjection({ "local-projects": { [f.project.id]: f.project }, "selected-project": { type: "local", projectId: f.project.id } }, { allowedRoots: [f.projectRoot] });
  const seed = prepareNativeProjectSeed({ homeRoot, projection, allowedRoots: [f.projectRoot], verifyAuthority: () => true });
  const path = join(homeRoot, ".codex", ".codex-global-state.json");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), nativeProjectState(projection, { allowedRoots: [f.projectRoot] }));
  assert.equal(seed.verifyBeforeGrant(), true);
  await unlink(path); await writeFile(path, "{}", { mode: 0o600 });
  assert.equal(seed.verifyBeforeGrant(), false);
  seed.close();
});

test("native monitor copies only authorized project changes and stops on revoked owner", async (t) => {
  const f = await storageFixture(t), homeRoot = join(f.base, "home"), codex = join(homeRoot, ".codex");
  await mkdir(homeRoot, { mode: 0o700 }); await mkdir(codex, { mode: 0o700 });
  const path = join(codex, ".codex-global-state.json"), store = openPersistentProjectStore(f.options);
  const failures = [], monitor = startNativeProjectMonitor({ homeRoot, store, writer: f.writer, verifyAuthority: f.options.verifyAuthority, onFailure: (code) => failures.push(code) });
  assert.equal(monitor.pollNow(), "waiting");
  assert.deepEqual(monitor.status(), { state: "waiting" });
  await writeFile(path, JSON.stringify({ "other-desktop-setting": true }), { mode: 0o600 });
  assert.equal(monitor.pollNow(), "waiting");
  assert.deepEqual(monitor.status(), { state: "waiting" });
  await writeFile(path, JSON.stringify({ "local-projects": { [f.project.id]: f.project }, "selected-project": { type: "local", projectId: f.project.id }, "queued-follow-ups": { body: "not saved" } }), { mode: 0o600 });
  assert.equal(monitor.pollNow(), "saved");
  assert.deepEqual(monitor.status(), { state: "active" });
  assert.equal(JSON.parse(await readFile(join(f.storeRoot, "pending.json"), "utf8")).state, "pending");
  assert.ok(!(await readFile(join(f.storeRoot, "projects.json"), "utf8")).includes("not saved"));
  f.revoke();
  assert.equal(monitor.pollNow(), "stopped");
  assert.equal(monitor.status().state, "error");
  assert.deepEqual(failures, ["PROJECT_STATE_INVALID"]);
  monitor.close(); store.close();
});

test("monitor does not rewrite a committed projection when the native file identity is unchanged", async (t) => {
  const f = await storageFixture(t), homeRoot = join(f.base, "home"), codex = join(homeRoot, ".codex");
  await mkdir(homeRoot, { mode: 0o700 }); await mkdir(codex, { mode: 0o700 });
  const path = join(codex, ".codex-global-state.json"), store = openPersistentProjectStore(f.options);
  let writes = 0;
  const observed = { capture: (...args) => { writes++; return store.capture(...args); }, verifyCurrent: (...args) => store.verifyCurrent(...args), markFailure: (...args) => store.markFailure(...args) };
  const monitor = startNativeProjectMonitor({ homeRoot, store: observed, writer: f.writer, verifyAuthority: f.options.verifyAuthority, onFailure() {} });
  await writeFile(path, JSON.stringify({ "local-projects": { [f.project.id]: f.project } }), { mode: 0o600 });
  assert.equal(monitor.pollNow(), "saved");
  assert.deepEqual(monitor.status(), { state: "active" });
  assert.equal(monitor.pollNow(), "unchanged");
  assert.deepEqual(monitor.status(), { state: "active" });
  assert.equal(writes, 1);
  await unlink(join(f.storeRoot, "projects.json"));
  assert.equal(monitor.pollNow(), "stopped");
  assert.equal(monitor.status().state, "error");
  monitor.close(); store.close();
});

test("monitor exposes unsupported native projects while preserving the last valid snapshot", async (t) => {
  const f = await storageFixture(t), homeRoot = join(f.base, "home"), codex = join(homeRoot, ".codex");
  await mkdir(homeRoot, { mode: 0o700 }); await mkdir(codex, { mode: 0o700 });
  const path = join(codex, ".codex-global-state.json"), store = openPersistentProjectStore(f.options), failures = [];
  const monitor = startNativeProjectMonitor({ homeRoot, store, writer: f.writer, verifyAuthority: f.options.verifyAuthority, onFailure: (code) => failures.push(code) });
  await writeFile(path, JSON.stringify({ "local-projects": { [f.project.id]: f.project } }), { mode: 0o600 });
  assert.equal(monitor.pollNow(), "saved");
  const old = await readFile(join(f.storeRoot, "projects.json"), "utf8");
  await writeFile(path, JSON.stringify({ "local-projects": { [f.project.id]: { ...f.project, chatGptBacking: { accountId: "private" } } } }), { mode: 0o600 });
  assert.equal(monitor.pollNow(), "stopped");
  assert.deepEqual(failures, ["PROJECT_STATE_UNSUPPORTED"]);
  assert.deepEqual(monitor.status(), { state: "unsupported", reasonCode: "PROJECT_STATE_UNSUPPORTED" });
  assert.equal(await readFile(join(f.storeRoot, "projects.json"), "utf8"), old);
  monitor.close(); store.close();
});
