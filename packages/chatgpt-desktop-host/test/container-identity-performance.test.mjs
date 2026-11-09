import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, mkdir, writeFile, lstat, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import {
  verifyContainerFileIdentities,
  readContainerProcessIdentity,
  readContainerProcessIdentitySync,
} from "../src/container-service.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "container-identities-"));
  const directory = join(root, "directory"),
    socketPath = join(root, "socket");
  await mkdir(directory, { mode: 0o700 });
  const paths = Array.from({ length: 8 }, (_, index) =>
    join(root, `file-${index}`),
  );
  for (const path of paths) await writeFile(path, "fixed", { mode: 0o600 });
  const server = createServer();
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return {
    snapshots: await Promise.all(
      paths.map(async (path) => ({
        path,
        info: await lstat(path, { bigint: true }),
      })),
    ),
    directories: [
      { path: directory, info: await lstat(directory, { bigint: true }) },
    ],
    socketPath,
    socketInfo: await lstat(socketPath, { bigint: true }),
  };
}

test("one fixed identity scan reads every local identity synchronously and never caches another scan", async (t) => {
  const f = await fixture(t),
    originalAsync = fs.promises.lstat,
    originalSync = fs.lstatSync;
  const expected = f.snapshots.length + f.directories.length + 1;
  let asyncReads = 0,
    reads = 0;
  fs.promises.lstat = async (...args) => {
    asyncReads++;
    return originalAsync(...args);
  };
  fs.lstatSync = (...args) => {
    reads++;
    return originalSync(...args);
  };
  syncBuiltinESMExports();
  try {
    const initial = verifyContainerFileIdentities(f);
    assert.equal(await initial, true);
    assert.equal(reads, expected);
    assert.equal(asyncReads, 0, "fixed metadata avoids libuv dispatch");
    await chmod(f.snapshots[3].path, 0o640);
    assert.equal(await verifyContainerFileIdentities(f), false);
    assert.equal(
      reads,
      expected * 2,
      "a changed next request still obtains every identity afresh",
    );
  } finally {
    fs.promises.lstat = originalAsync;
    fs.lstatSync = originalSync;
    syncBuiltinESMExports();
  }
});

test("the async process API takes a complete fresh synchronous snapshot with a final PID identity sample", async () => {
  const expected = readContainerProcessIdentitySync(process.pid),
    originalRead = fs.readFileSync,
    originalAsync = fs.promises.readFile;
  let syncReads = 0,
    asyncReads = 0;
  fs.readFileSync = (...args) => {
    syncReads++;
    return originalRead(...args);
  };
  fs.promises.readFile = async (...args) => {
    asyncReads++;
    return originalAsync(...args);
  };
  syncBuiltinESMExports();
  try {
    assert.deepEqual(await readContainerProcessIdentity(process.pid), expected);
    assert.equal(syncReads, 4, "stat/status/cgroup plus the final stat sample");
    assert.equal(asyncReads, 0);
    assert.deepEqual(await readContainerProcessIdentity(process.pid), expected);
    assert.equal(
      syncReads,
      8,
      "the next request reads the complete identity again",
    );
    assert.equal(asyncReads, 0);
  } finally {
    fs.readFileSync = originalRead;
    fs.promises.readFile = originalAsync;
    syncBuiltinESMExports();
  }
});

test("a process changing during the final local sample or a missing PID fails closed", async () => {
  for (const pid of [0, 1, 1.5, 2147483647])
    await assert.rejects(readContainerProcessIdentity(pid));
  const original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = (path, ...args) => {
    const value = original(path, ...args);
    if (path === `/proc/${process.pid}/stat` && ++reads === 2) {
      const end = value.lastIndexOf(") "),
        fields = value
          .slice(end + 2)
          .trim()
          .split(/\s+/);
      fields[19] += "0";
      return value.slice(0, end + 2) + fields.join(" ") + "\n";
    }
    return value;
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(readContainerProcessIdentity(process.pid), {
      code: "CONTAINER_IDENTITY_CHANGED",
    });
  } finally {
    fs.readFileSync = original;
    syncBuiltinESMExports();
  }
});

test("changed files, directories, socket identities and missing paths all fail closed", async (t) => {
  const f = await fixture(t);
  assert.equal(await verifyContainerFileIdentities(f), true);
  assert.equal(
    await verifyContainerFileIdentities({ ...f, socketInfo: undefined }),
    false,
  );
  assert.equal(
    await verifyContainerFileIdentities({
      ...f,
      socketInfo: f.snapshots[0].info,
    }),
    false,
  );
  await chmod(f.directories[0].path, 0o750);
  assert.equal(await verifyContainerFileIdentities(f), false);
  await chmod(f.directories[0].path, 0o700);
  await rm(f.snapshots[1].path);
  assert.equal(await verifyContainerFileIdentities(f), false);
});
