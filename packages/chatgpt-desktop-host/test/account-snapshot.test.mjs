import test from "node:test";
import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDesktopAccountSnapshot } from "../src/account-snapshot.mjs";
const seed = (f) =>
  seedDesktopAccountSnapshot({
    sourceFile: f.sourceFile,
    homeRoot: f.homeRoot,
  });

async function fixture(t, auth = {}) {
  const sourceRoot = await mkdtemp(join(tmpdir(), "desktop-auth-source-"));
  const homeRoot = await mkdtemp("/dev/shm/desktop-auth-home-");
  t.after(async () => {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  });
  const sourceFile = join(sourceRoot, "auth.json");
  const value = {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: "must-not-copy",
    tokens: {
      id_token: "fake-id-token",
      access_token: "fake-access-token",
      refresh_token: "must-not-copy",
      account_id: "fake-account",
    },
    last_refresh: "2026-11-04T00:00:00Z",
    unrelated: "must-not-copy",
    ...auth,
  };
  await writeFile(sourceFile, JSON.stringify(value), { mode: 0o600 });
  return { sourceFile, sourceRoot, homeRoot, value };
}

test("copies only an authorized access snapshot into fresh tmpfs, without changing its source", async (t) => {
  const f = await fixture(t),
    original = await readFile(f.sourceFile),
    before = await lstat(f.sourceFile, { bigint: true });
  const result = await seedDesktopAccountSnapshot({
    sourceFile: f.sourceFile,
    homeRoot: f.homeRoot,
  });
  assert.deepEqual(result, {
    kind: "chatgpt-access-snapshot",
    refreshEnabled: false,
  });
  const target = join(f.homeRoot, ".codex", "auth.json");
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: "fake-id-token",
      access_token: "fake-access-token",
      refresh_token: "",
      account_id: "fake-account",
    },
    last_refresh: "2026-11-04T00:00:00Z",
  });
  assert.equal((await lstat(join(f.homeRoot, ".codex"))).mode & 0o7777, 0o700);
  assert.equal((await lstat(target)).mode & 0o7777, 0o600);
  assert.deepEqual(await readFile(f.sourceFile), original);
  const after = await lstat(f.sourceFile, { bigint: true });
  for (const field of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"])
    assert.equal(after[field], before[field]);
  assert.ok(!JSON.stringify(result).includes("fake-"));
});

test("refuses replay into an already seeded or otherwise nonempty home", async (t) => {
  const f = await fixture(t);
  await seed(f);
  const before = await readFile(join(f.homeRoot, ".codex/auth.json"));
  await assert.rejects(seed(f), { code: "ACCOUNT_SNAPSHOT_UNSAFE_HOME" });
  assert.deepEqual(
    await readFile(join(f.homeRoot, ".codex/auth.json")),
    before,
  );
});

test("rejects disk-backed HOME and symlinked or permissive credential sources before writing", async (t) => {
  const f = await fixture(t),
    disk = join(f.sourceRoot, "home");
  await mkdir(disk, { mode: 0o700 });
  await assert.rejects(
    seedDesktopAccountSnapshot({ sourceFile: f.sourceFile, homeRoot: disk }),
    { code: "ACCOUNT_SNAPSHOT_UNSAFE_HOME" },
  );
  const alias = join(f.sourceRoot, "alias");
  await symlink(f.sourceFile, alias);
  await assert.rejects(
    seedDesktopAccountSnapshot({ sourceFile: alias, homeRoot: f.homeRoot }),
  );
  await chmod(f.sourceFile, 0o644);
  await assert.rejects(seed(f));
  assert.deepEqual(await readdir(f.homeRoot), []);
});

test("rejects malformed, oversized, missing-token and other-account-mode input without exposing it", async (t) => {
  for (const body of [
    "{fake-secret",
    "x".repeat(262145),
    JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "fake-secret" }),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { id_token: "fake-secret" },
    }),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { id_token: "fake-secret", access_token: "bad\nvalue" },
    }),
  ]) {
    const f = await fixture(t);
    await writeFile(f.sourceFile, body, { mode: 0o600 });
    await assert.rejects(seed(f), (error) => {
      assert.ok(error.code.startsWith("ACCOUNT_SNAPSHOT_"));
      assert.ok(!error.message.includes("fake-secret"));
      return true;
    });
    assert.deepEqual(await readdir(f.homeRoot), []);
  }
});

test("optional source fields stay optional and arbitrary options never select commands or destinations", async (t) => {
  const f = await fixture(t, {
    tokens: { id_token: "id", access_token: "access" },
    last_refresh: undefined,
  });
  await assert.rejects(
    seedDesktopAccountSnapshot({
      sourceFile: f.sourceFile,
      homeRoot: f.homeRoot,
      refresh: true,
    }),
    { code: "ACCOUNT_SNAPSHOT_INVALID_CONFIG" },
  );
  await seedDesktopAccountSnapshot({
    sourceFile: f.sourceFile,
    homeRoot: f.homeRoot,
  });
  const value = JSON.parse(
    await readFile(join(f.homeRoot, ".codex/auth.json"), "utf8"),
  );
  assert.equal(Object.hasOwn(value.tokens, "account_id"), false);
  assert.equal(Object.hasOwn(value, "last_refresh"), false);
  assert.equal(value.tokens.refresh_token, "");
});

test("malformed UTF-8 is rejected instead of changing credential bytes through replacement characters", async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.concat([
    Buffer.from('{"auth_mode":"chatgpt","tokens":{"id_token":"id'),
    Buffer.from([255]),
    Buffer.from('","access_token":"access"}}'),
  ]);
  await writeFile(f.sourceFile, bytes);
  await assert.rejects(seed(f), { code: "ACCOUNT_SNAPSHOT_INVALID_SOURCE" });
  assert.deepEqual(await readdir(f.homeRoot), []);
});
