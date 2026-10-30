import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface OwnedNativeIdentity {
  pid: number;
  startTicks: string;
}
interface FixtureAuthority {
  home: string;
  dev: number;
  ino: number;
  uid: number;
}
interface OwnedProcess extends OwnedNativeIdentity {
  argv: string[];
  executable: string;
}
const registeredHomes = new Map<string, FixtureAuthority>();
const captured = new WeakMap<
  OwnedNativeIdentity,
  {
    authority: FixtureAuthority;
    updater: OwnedProcess;
  }
>();

async function processIdentity(pid: number) {
  const text = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  return { state: fields[0], startTicks: fields[19] };
}
async function verifyHome(authority: FixtureAuthority) {
  const stat = await lstat(authority.home);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(await realpath(authority.home), authority.home);
  assert.equal(stat.dev, authority.dev);
  assert.equal(stat.ino, authority.ino);
  assert.equal(stat.uid, authority.uid);
  assert.equal(stat.mode & 0o077, 0, "native fixture home must stay private");
}

/** Call only immediately after creating a new private fixture HOME, before any daemon launch. */
export async function registerOwnedNativeFixture(home: string): Promise<void> {
  const canonical = resolve(home);
  assert.notEqual(
    canonical,
    resolve(homedir(), ".codex"),
    "the normal Codex home is never a test fixture",
  );
  assert.equal(
    await realpath(canonical),
    canonical,
    "fixture home must not be a symlink",
  );
  assert.ok(
    !registeredHomes.has(canonical),
    "native fixture ownership must not be registered twice",
  );
  const stat = await lstat(canonical);
  const authority = {
    home: canonical,
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
  };
  if (process.getuid) assert.equal(stat.uid, process.getuid());
  await verifyHome(authority);
  for (const path of [
    join(canonical, "app-server-daemon", "daemon.pid"),
    join(canonical, "app-server-daemon", "app-server.pid"),
    join(canonical, "app-server-daemon", "daemon-updater.pid"),
    join(canonical, "app-server-control", "app-server-control.sock"),
  ]) {
    await assert.rejects(
      lstat(path),
      { code: "ENOENT" },
      "fixture registration must precede daemon creation",
    );
  }
  registeredHomes.set(canonical, authority);
}

async function readProcess(pid: number): Promise<OwnedProcess> {
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  const before = await processIdentity(pid);
  assert.notEqual(before.state, "Z");
  assert.ok(before.startTicks && /^\d+$/.test(before.startTicks));
  const argv = (await readFile(`/proc/${pid}/cmdline`, "utf8"))
    .split("\0")
    .filter(Boolean);
  const executable = await realpath(`/proc/${pid}/exe`);
  const status = await readFile(`/proc/${pid}/status`, "utf8");
  if (process.getuid)
    assert.equal(Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]), process.getuid());
  assert.equal(
    (await processIdentity(pid)).startTicks,
    before.startTicks,
    "process changed during ownership capture",
  );
  return { pid, startTicks: before.startTicks!, argv, executable };
}
async function readPrivatePid(home: string, names: string[]) {
  for (const name of names) {
    const path = join(home, "app-server-daemon", name);
    try {
      const stat = await lstat(path);
      assert.ok(stat.isFile() && !stat.isSymbolicLink());
      if (process.getuid) assert.equal(stat.uid, process.getuid());
      const record = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        unknown
      >;
      assert.ok(Number.isSafeInteger(record.pid) && Number(record.pid) > 1);
      return Number(record.pid);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("private native fixture did not publish its PID record");
}

/** Capture live processes from this invocation's registered private domain, never a /tmp or UID sweep. */
export async function ownedDaemonIdentity(
  home: string,
): Promise<OwnedNativeIdentity> {
  const authority = registeredHomes.get(resolve(home));
  assert.ok(authority, "native fixture HOME must be registered before launch");
  await verifyHome(authority);
  const native = await readProcess(
    await readPrivatePid(authority.home, ["daemon.pid", "app-server.pid"]),
  );
  assert.ok(
    native.argv.some((argument) => argument.includes(authority.home)),
    "native process must identify the registered private fixture domain",
  );
  const updater = await readProcess(
    await readPrivatePid(authority.home, ["daemon-updater.pid"]),
  );
  assert.notEqual(updater.pid, native.pid);
  const releasePrefix =
    join(authority.home, "packages", "app-server-daemon", "releases") + "/";
  assert.ok(updater.argv[0]?.startsWith(releasePrefix));
  assert.match(
    updater.argv[0]!.slice(releasePrefix.length),
    /^[A-Za-z0-9._-]+\/bin\/codex$/,
  );
  assert.equal(await realpath(updater.argv[0]!), updater.executable);
  assert.deepEqual(updater.argv.slice(1), [
    "app-server",
    "daemon",
    "pid-update-loop",
  ]);
  const identity = Object.freeze({
    pid: native.pid,
    startTicks: native.startTicks,
  });
  captured.set(identity, { authority, updater });
  return identity;
}

async function stillAlive(identity: OwnedNativeIdentity) {
  try {
    const current = await processIdentity(identity.pid);
    return current.startTicks === identity.startTicks && current.state !== "Z";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function verifyCapturedUpdater(
  authority: FixtureAuthority,
  updater: OwnedProcess,
) {
  await verifyHome(authority);
  const current = await readProcess(updater.pid);
  assert.equal(current.startTicks, updater.startTicks);
  assert.equal(current.executable, updater.executable);
  assert.deepEqual(current.argv, updater.argv);
}

/** Official daemon stop must happen first. Only its already captured fixture updater is signalled. */
export async function cleanupOwnedNativeFixture(
  identity: OwnedNativeIdentity,
): Promise<void> {
  const ownership = captured.get(identity);
  assert.ok(ownership, "cleanup refuses uncaptured native fixture identities");
  assert.equal(
    await stillAlive(identity),
    false,
    "official stop must finish before fixture monitor cleanup",
  );
  const { authority, updater } = ownership;
  if (await stillAlive(updater)) {
    await verifyCapturedUpdater(authority, updater);
    process.kill(updater.pid, "SIGTERM");
    const deadline = Date.now() + 2_000;
    while ((await stillAlive(updater)) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    if (await stillAlive(updater)) {
      await verifyCapturedUpdater(authority, updater);
      process.kill(updater.pid, "SIGKILL");
      const deadline = Date.now() + 2_000;
      while ((await stillAlive(updater)) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  await assertOwnedNativeExited(identity);
  registeredHomes.delete(authority.home);
}

/** Assert all captured native resources are gone; no signals are sent by this check. */
export async function assertOwnedNativeExited(
  identity: OwnedNativeIdentity,
): Promise<void> {
  const ownership = captured.get(identity);
  assert.ok(ownership, "exit evidence requires the original in-memory capture");
  assert.equal(
    await stillAlive(identity),
    false,
    "owned official daemon remains alive after official stop",
  );
  assert.equal(
    await stillAlive(ownership.updater),
    false,
    "owned private fixture updater monitor remains alive",
  );
}
