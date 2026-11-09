import test from "node:test";
import assert from "node:assert/strict";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureStableProfileCandidate,
  inspectStableProfileAlias,
  publishStableProfileAlias,
} from "../src/stable-profile-alias.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "desktop-profile-alias-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const makeProfile = async () => {
    const attemptId = randomUUID(),
      generation = randomUUID(),
      profileId = randomUUID();
    const dir = join(root, `g${attemptId.replaceAll("-", "")}`);
    await mkdir(dir, { mode: 0o700 });
    const stat = await readFile(`/proc/${process.pid}/stat`, "utf8");
    const startTicks = stat
      .slice(stat.lastIndexOf(") ") + 2)
      .trim()
      .split(/\s+/)[19];
    const profile = {
      version: 1,
      id: profileId,
      generation,
      pid: process.pid,
      startTicks,
      uid: process.getuid(),
      macAsarPath: "/fixture/mac.asar",
      macAsarSha256: "a".repeat(64),
      linuxAsarPath: "/fixture/linux.asar",
      linuxAsarSha256: "b".repeat(64),
      controlSocketPath: "/fixture/control.sock",
    };
    const file = join(dir, "p.json");
    await writeFile(file, JSON.stringify(profile) + "\n", { mode: 0o600 });
    return { attemptId, profileId, generation, file };
  };
  return { root, alias: join(root, "current.profile.json"), makeProfile };
}
const sameInode = (a, b) => a.dev === b.dev && a.ino === b.ino;
const pin = async ({ attemptId, file }) => {
  const info = await lstat(file, { bigint: true });
  return {
    attemptId,
    file,
    anchor: { dev: info.dev.toString(), ino: info.ino.toString() },
  };
};

test("first stable alias links the actual owned profile and shares revocation", async (t) => {
  const f = await fixture(t),
    current = await f.makeProfile();
  await publishStableProfileAlias({
    deploymentRoot: f.root,
    current,
    verifyLease: async () => true,
  });
  assert.ok(sameInode(await lstat(current.file), await lstat(f.alias)));
  await writeFile(current.file, '{"version":0,"state":"revoked"}\n');
  assert.equal(
    await readFile(f.alias, "utf8"),
    '{"version":0,"state":"revoked"}\n',
  );
});

test("a new generation replaces only the verified previous alias", async (t) => {
  const f = await fixture(t),
    previous = await f.makeProfile(),
    current = await f.makeProfile();
  await publishStableProfileAlias({
    deploymentRoot: f.root,
    current: previous,
    verifyLease: async () => true,
  });
  await publishStableProfileAlias({
    deploymentRoot: f.root,
    current,
    previousAttemptId: previous.attemptId,
    verifyLease: async () => true,
  });
  assert.ok(sameInode(await lstat(current.file), await lstat(f.alias)));
  assert.equal(
    JSON.parse(await readFile(previous.file, "utf8")).id,
    previous.profileId,
  );
});

test("unexpected existing alias, wrong source identity and revoked lease never replace a file", async (t) => {
  const f = await fixture(t),
    current = await f.makeProfile(),
    old = await f.makeProfile();
  await writeFile(f.alias, "do not overwrite\n", { mode: 0o600 });
  await assert.rejects(
    publishStableProfileAlias({
      deploymentRoot: f.root,
      current,
      previousAttemptId: old.attemptId,
      verifyLease: async () => true,
    }),
  );
  assert.equal(await readFile(f.alias, "utf8"), "do not overwrite\n");
  await rm(f.alias);
  await assert.rejects(
    publishStableProfileAlias({
      deploymentRoot: f.root,
      current: { ...current, generation: randomUUID() },
      verifyLease: async () => true,
    }),
  );
  await assert.rejects(
    publishStableProfileAlias({
      deploymentRoot: f.root,
      current,
      verifyLease: async () => false,
    }),
  );
  await assert.rejects(lstat(f.alias), { code: "ENOENT" });
});

test("lost authorization after alias creation reports an unknown publication outcome", async (t) => {
  const f = await fixture(t),
    current = await f.makeProfile();
  let checks = 0;
  await assert.rejects(
    publishStableProfileAlias({
      deploymentRoot: f.root,
      current,
      verifyLease: async () => ++checks < 3,
    }),
    { code: "DESKTOP_ALIAS_OUTCOME_UNKNOWN" },
  );
  assert.ok(sameInode(await lstat(current.file), await lstat(f.alias)));
});

test("alias replaced while the lease is checked is preserved", async (t) => {
  const f = await fixture(t),
    previous = await f.makeProfile(),
    current = await f.makeProfile();
  await publishStableProfileAlias({
    deploymentRoot: f.root,
    current: previous,
    verifyLease: async () => true,
  });
  let checks = 0;
  await assert.rejects(
    publishStableProfileAlias({
      deploymentRoot: f.root,
      current,
      previousAttemptId: previous.attemptId,
      verifyLease: async () => {
        if (++checks === 3) {
          await rm(f.alias);
          await writeFile(f.alias, "independent change\n", { mode: 0o600 });
        }
        return true;
      },
    }),
  );
  assert.equal(await readFile(f.alias, "utf8"), "independent change\n");
});

test("read-only reconciliation finds only an exact candidate inode and bounds absence", async (t) => {
  const f = await fixture(t),
    a = await f.makeProfile(),
    b = await f.makeProfile();
  const candidates = await Promise.all([a, b].map(pin));
  const inspect = (mayBeAbsent = false) =>
    inspectStableProfileAlias({
      deploymentRoot: f.root,
      candidates,
      mayBeAbsent,
      verifyLease: async () => true,
    });
  await assert.rejects(inspect());
  assert.deepEqual(await inspect(true), { state: "absent" });
  await publishStableProfileAlias({
    deploymentRoot: f.root,
    current: a,
    verifyLease: async () => true,
  });
  assert.deepEqual(await inspect(), {
    state: "matched",
    attemptId: a.attemptId,
  });
  await publishStableProfileAlias({
    deploymentRoot: f.root,
    current: b,
    previousAttemptId: a.attemptId,
    verifyLease: async () => true,
  });
  assert.deepEqual(await inspect(), {
    state: "matched",
    attemptId: b.attemptId,
  });
  await rm(f.alias);
  await writeFile(f.alias, "independent\n", { mode: 0o600 });
  await assert.rejects(inspect());
  assert.equal(await readFile(f.alias, "utf8"), "independent\n");
});

test("ambiguous hardlinks, symlinked candidates and expired lease are never reconciled", async (t) => {
  const f = await fixture(t),
    a = await f.makeProfile(),
    b = await f.makeProfile();
  await publishStableProfileAlias({
    deploymentRoot: f.root,
    current: a,
    verifyLease: async () => true,
  });
  const candidates = await Promise.all([a, b].map(pin));
  const inspect = (verifyLease = async () => true) =>
    inspectStableProfileAlias({
      deploymentRoot: f.root,
      candidates,
      mayBeAbsent: false,
      verifyLease,
    });
  await assert.rejects(inspect(async () => false));
  await rm(b.file);
  await link(a.file, b.file);
  await assert.rejects(inspect());
  await rm(b.file);
  await symlink(a.file, b.file);
  await assert.rejects(inspect());
  assert.ok(sameInode(await lstat(a.file), await lstat(f.alias)));
});

test("replacing both a profile path and alias cannot impersonate the recorded original inode", async (t) => {
  const f = await fixture(t),
    a = await f.makeProfile();
  await publishStableProfileAlias({
    deploymentRoot: f.root,
    current: a,
    verifyLease: async () => true,
  });
  const held = await open(a.file, "r");
  t.after(() => held.close());
  const original = await held.stat({ bigint: true });
  const candidate = {
    attemptId: a.attemptId,
    file: a.file,
    anchor: { dev: original.dev.toString(), ino: original.ino.toString() },
  };
  const inspect = () =>
    inspectStableProfileAlias({
      deploymentRoot: f.root,
      candidates: [candidate],
      mayBeAbsent: false,
      verifyLease: async () => true,
    });
  assert.deepEqual(await inspect(), {
    state: "matched",
    attemptId: a.attemptId,
  });
  await rm(f.alias);
  await rm(a.file);
  await writeFile(a.file, "unrelated inode\n", { mode: 0o600 });
  await link(a.file, f.alias);
  assert.notEqual((await lstat(a.file, { bigint: true })).ino, original.ino);
  await assert.rejects(inspect());
  assert.equal(await readFile(f.alias, "utf8"), "unrelated inode\n");
});

test("only the live owner's original profile is eligible for an inode anchor", async (t) => {
  const f = await fixture(t),
    current = await f.makeProfile();
  const capture = (value = current, verifyLease = async () => true) =>
    captureStableProfileCandidate({
      deploymentRoot: f.root,
      current: value,
      verifyLease,
    });
  const info = await lstat(current.file, { bigint: true });
  assert.deepEqual(await capture(), {
    dev: info.dev.toString(),
    ino: info.ino.toString(),
  });
  await assert.rejects(capture({ ...current, generation: randomUUID() }));
  await assert.rejects(capture(current, async () => false));
  await writeFile(current.file, '{"version":0,"state":"revoked"}\n');
  await assert.rejects(capture());
});
