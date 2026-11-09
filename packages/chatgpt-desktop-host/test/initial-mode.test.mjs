import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as service from "../src/container-service.mjs";

const text = '[desktop]\nconversationDetailMode = "STEPS_COMMANDS"\n';
async function fixture(t, accountSeeded = false) {
  const root = await mkdtemp(join(tmpdir(), "desktop-initial-mode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (accountSeeded) {
    await mkdir(join(root, ".codex"), { mode: 0o700 });
    await writeFile(join(root, ".codex", "auth.json"), '{"synthetic":true}\n', {
      mode: 0o600,
      flag: "wx",
    });
  }
  return {
    homeRoot: root,
    homeIdentity: await lstat(root, { bigint: true }),
    accountSeeded,
  };
}
async function pathsForOpenFds(root) {
  const result = [];
  for (const fd of await readdir("/proc/self/fd")) {
    try {
      const path = await readlink(`/proc/self/fd/${fd}`);
      if (path === root || path.startsWith(`${root}/`)) result.push(path);
    } catch {}
  }
  return result;
}

test("initial Codex mode creates only the fixed private preference inside a new home", async (t) => {
  const options = await fixture(t),
    target = join(options.homeRoot, ".codex", "config.toml");
  assert.equal(typeof service.prepareInitialCodexMode, "function");
  const owner = await service.prepareInitialCodexMode(options);
  try {
    assert.equal(await readFile(target, "utf8"), text);
    assert.equal((await lstat(target)).mode & 0o7777, 0o600);
    assert.equal(
      (await lstat(join(options.homeRoot, ".codex"))).mode & 0o7777,
      0o700,
    );
    assert.deepEqual(await readdir(join(options.homeRoot, ".codex")), [
      "config.toml",
    ]);
    assert.equal(owner.verifyBeforeGrant(), true);
    assert.ok((await pathsForOpenFds(options.homeRoot)).length >= 2);
  } finally {
    await owner.close();
  }
  assert.deepEqual(await pathsForOpenFds(options.homeRoot), []);
  assert.equal(owner.verifyBeforeGrant(), false);
  await owner.close();
});

test("initial preference follows the isolated account seed without editing auth", async (t) => {
  const options = await fixture(t, true),
    auth = join(options.homeRoot, ".codex", "auth.json");
  const before = await readFile(auth, "utf8"),
    beforeStat = await lstat(auth, { bigint: true });
  const owner = await service.prepareInitialCodexMode(options);
  try {
    assert.equal(await readFile(auth, "utf8"), before);
    assert.equal((await lstat(auth, { bigint: true })).ino, beforeStat.ino);
    assert.equal(
      await readFile(join(options.homeRoot, ".codex", "config.toml"), "utf8"),
      text,
    );
    assert.equal(owner.verifyBeforeGrant(), true);
  } finally {
    await owner.close();
  }
});

test("initial preference accepts one private project seed and fences its inode before grant", async (t) => {
  const options = await fixture(t, true), codex = join(options.homeRoot, ".codex");
  await mkdir(join(codex, "sessions"), { mode: 0o700 });
  await mkdir(join(codex, "archived_sessions"), { mode: 0o700 });
  const target = join(codex, ".codex-global-state.json");
  await writeFile(target, '{"local-projects":{}}\n', { mode: 0o600 });
  const owner = await service.prepareInitialCodexMode({ ...options, historyDirectories: true, projectStateSeeded: true });
  try {
    assert.equal(owner.verifyBeforeGrant(), true);
    await rename(target, target + ".old"); await writeFile(target, '{}\n', { mode: 0o600 });
    assert.equal(owner.verifyBeforeGrant(), false);
  } finally { await owner.close(); }
});

test("existing preference, nonempty or unsafe homes and symlinked codex are rejected without overwrite", async (t) => {
  const existing = await fixture(t, true),
    config = join(existing.homeRoot, ".codex", "config.toml");
  await writeFile(config, "keep-existing\n", { mode: 0o600 });
  await assert.rejects(service.prepareInitialCodexMode(existing), {
    code: "CONTAINER_INITIAL_MODE_UNSAFE",
  });
  assert.equal(await readFile(config, "utf8"), "keep-existing\n");
  const populated = await fixture(t);
  await writeFile(join(populated.homeRoot, "sentinel"), "keep");
  await assert.rejects(service.prepareInitialCodexMode(populated), {
    code: "CONTAINER_INITIAL_MODE_UNSAFE",
  });
  const unsafe = await fixture(t);
  await chmod(unsafe.homeRoot, 0o755);
  await assert.rejects(service.prepareInitialCodexMode(unsafe), {
    code: "CONTAINER_INITIAL_MODE_UNSAFE",
  });
  const linked = await fixture(t, true),
    codex = join(linked.homeRoot, ".codex");
  await rename(codex, join(linked.homeRoot, "old"));
  await symlink(join(linked.homeRoot, "old"), codex);
  await assert.rejects(service.prepareInitialCodexMode(linked), {
    code: "CONTAINER_INITIAL_MODE_UNSAFE",
  });
});

test("pre-grant identity fails on replacement or mutation and releases its held FDs", async (t) => {
  for (const change of [
    "config-replace",
    "config-mutate",
    "codex-replace",
    "auth-replace",
    "home-replace",
    "home-populated",
  ]) {
    const options = await fixture(t, change === "auth-replace"),
      codex = join(options.homeRoot, ".codex"),
      config = join(codex, "config.toml");
    const owner = await service.prepareInitialCodexMode(options);
    if (change === "config-replace") {
      await rename(config, join(codex, "old"));
      await writeFile(config, text, { mode: 0o600 });
    }
    if (change === "config-mutate")
      await writeFile(config, "changed", { mode: 0o600 });
    if (change === "codex-replace") {
      await rename(codex, join(options.homeRoot, "old"));
      await mkdir(codex, { mode: 0o700 });
    }
    if (change === "auth-replace") {
      const auth = join(codex, "auth.json");
      await rename(auth, join(codex, "old"));
      await writeFile(auth, "{}", { mode: 0o600 });
    }
    if (change === "home-replace") {
      await rename(options.homeRoot, `${options.homeRoot}.old`);
      t.after(() =>
        rm(`${options.homeRoot}.old`, { recursive: true, force: true }),
      );
      await mkdir(options.homeRoot, { mode: 0o700 });
    }
    if (change === "home-populated")
      await writeFile(join(options.homeRoot, "unexpected"), "fixture");
    assert.equal(owner.verifyBeforeGrant(), false, change);
    await owner.close();
    assert.deepEqual(await pathsForOpenFds(options.homeRoot), [], change);
    if (change === "home-replace")
      assert.deepEqual(
        await pathsForOpenFds(`${options.homeRoot}.old`),
        [],
        change,
      );
  }
});

test(
  "real pinned runtime seeds the authorized account home before any Docker launch",
  { skip: !process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT },
  async (t) => {
    const sourceRoot = process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT;
    const root = await mkdtemp(join(tmpdir(), "cg-mode-runtime-"));
    const homeRoot = await mkdtemp("/dev/shm/cg-mode-home-");
    t.after(async () => {
      await rm(root, { recursive: true, force: true });
      await rm(homeRoot, { recursive: true, force: true });
    });
    const bridgeRoot = join(root, "bridge"),
      runtimeRoot = join(root, "r"),
      sourceFile = join(root, "auth.json");
    await mkdir(bridgeRoot, { mode: 0o700 });
    const auth =
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          id_token: "synthetic-id",
          access_token: "synthetic-access",
          refresh_token: "synthetic-refresh",
        },
      }) + "\n";
    await writeFile(sourceFile, auth, { flag: "wx", mode: 0o600 });
    const options = {
      imageDigest: "sha256:" + "0".repeat(64),
      profileId: randomUUID(),
      generation: randomUUID(),
      sourceRoot,
      runtimeRoot,
      bridgeRoot,
      dockerPath: await realpath("/usr/bin/false"),
      dockerSha256: "0".repeat(64),
      pythonPath: await realpath("/usr/bin/python3"),
      pythonSha256: "0".repeat(64),
      nodePath: await realpath(process.execPath),
      nodeSha256: "0".repeat(64),
      cpuId: 0,
      networkMode: "bridge",
      accountSnapshot: { sourceFile, homeRoot },
      initialMode: "codex",
    };
    // The deliberately wrong Docker executable digest stops before executing any
    // Docker command or issuing a native grant, after the real preparation path.
    await assert.rejects(service.startContainerDesktopUpstream(options), {
      code: "CONTAINER_ARTIFACT_CHANGED",
    });
    assert.equal(
      await readFile(join(homeRoot, ".codex", "config.toml"), "utf8"),
      text,
    );
    assert.equal(
      (await lstat(join(homeRoot, ".codex", "config.toml"))).mode & 0o7777,
      0o600,
    );
    const snapshot = JSON.parse(
      await readFile(join(homeRoot, ".codex", "auth.json"), "utf8"),
    );
    assert.equal(snapshot.tokens.id_token, "synthetic-id");
    assert.equal(snapshot.tokens.access_token, "synthetic-access");
    assert.equal(snapshot.tokens.refresh_token, "");
    assert.equal(await readFile(sourceFile, "utf8"), auth);
    assert.deepEqual(await readdir(join(runtimeRoot, "home")), []);
    assert.deepEqual(await pathsForOpenFds(homeRoot), []);

    const defaultRuntime = join(root, "r-default");
    const defaultBridge = join(root, "bridge-default");
    await mkdir(defaultBridge, { mode: 0o700 });
    const defaultOptions = {
      ...options,
      runtimeRoot: defaultRuntime,
      bridgeRoot: defaultBridge,
      networkMode: "none",
    };
    delete defaultOptions.accountSnapshot;
    delete defaultOptions.initialMode;
    await assert.rejects(
      service.startContainerDesktopUpstream(defaultOptions),
      {
        code: "CONTAINER_ARTIFACT_CHANGED",
      },
    );
    assert.deepEqual(await readdir(join(defaultRuntime, "home")), []);
  },
);
