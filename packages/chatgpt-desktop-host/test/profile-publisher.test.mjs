import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProfilePublisher } from "../src/profile-publisher.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "desktop-publisher-"));
  const directory = join(root, "profile");
  await mkdir(directory, { mode: 0o700 });
  const profileFile = join(directory, "current.json");
  const profile = {
    version: 1,
    id: randomUUID(),
    generation: randomUUID(),
    pid: process.pid,
    startTicks: "123",
    uid: process.getuid(),
    macAsarPath: join(root, "mac.asar"),
    macAsarSha256: "a".repeat(64),
    linuxAsarPath: join(root, "linux.asar"),
    linuxAsarSha256: "b".repeat(64),
    controlSocketPath: join(root, "control.sock"),
  };
  const publishers = [];
  t.after(async () => {
    for (const publisher of publishers)
      await publisher.revoke().catch(() => {});
    await chmod(directory, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    directory,
    profileFile,
    profile,
    create: (deps) => {
      const publisher = createProfilePublisher({ profileFile, profile }, deps);
      publishers.push(publisher);
      return publisher;
    },
  };
}
const gate = () => {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
const revoked = async (path) => JSON.parse(await readFile(path, "utf8")).state;

test("publishes one private inode, verifies original bytes, and closes its FD on revoke", async (t) => {
  const f = await fixture(t);
  let closes = 0;
  const publisher = f.create({
    fs: {
      open: async (...args) => {
        const handle = await open(...args),
          close = handle.close.bind(handle);
        handle.close = async () => {
          closes += 1;
          return close();
        };
        return handle;
      },
    },
  });
  assert.equal(publisher.published, false);
  assert.equal(publisher.mayHavePublished, false);
  assert.equal(await publisher.verify(), false);
  await publisher.publish();
  assert.equal(publisher.published, true);
  assert.equal(publisher.mayHavePublished, true);
  assert.equal(await publisher.verify(), true);
  assert.deepEqual(
    JSON.parse(await readFile(f.profileFile, "utf8")),
    f.profile,
  );
  assert.equal((await lstat(f.profileFile)).mode & 0o7777, 0o600);
  await publisher.revoke();
  assert.equal(await revoked(f.profileFile), "revoked");
  assert.equal(await publisher.verify(), false);
  assert.equal(closes, 1);
  await publisher.revoke();
  assert.equal(closes, 1);
});

test("revoke never overwrites a replacement path and verify detects it", async (t) => {
  const f = await fixture(t),
    publisher = f.create();
  await publisher.publish();
  const original = join(f.directory, "renamed-original.json");
  await rename(f.profileFile, original);
  await writeFile(f.profileFile, "foreign", { mode: 0o600 });
  assert.equal(await publisher.verify(), false);
  await publisher.revoke();
  assert.equal(await readFile(f.profileFile, "utf8"), "foreign");
  assert.equal(await revoked(original), "revoked");
});

test("verify detects content changes on the original inode during its read", async (t) => {
  const f = await fixture(t);
  let changeOnRead = false;
  const publisher = f.create({
    fs: {
      open: async (...args) => {
        const handle = await open(...args),
          read = handle.read.bind(handle);
        handle.read = async (...readArgs) => {
          const result = await read(...readArgs);
          if (changeOnRead) {
            changeOnRead = false;
            await handle.write(Buffer.from("x"), 0, 1, 0);
            await handle.sync();
          }
          return result;
        };
        return handle;
      },
    },
  });
  await publisher.publish();
  assert.equal(await publisher.verify(), true);
  changeOnRead = true;
  assert.equal(await publisher.verify(), false);
  await publisher.revoke();
  assert.equal(await revoked(f.profileFile), "revoked");
});

test("verify detects original inode changes between its last FD and path stats", async (t) => {
  const f = await fixture(t);
  let mutate = false,
    pathStats = 0;
  const publisher = f.create({
    fs: {
      lstat: async (path, ...args) => {
        if (mutate && path === f.profileFile && ++pathStats === 2) {
          const handle = await open(path, "r+");
          try {
            await handle.write(Buffer.from("x"), 0, 1, 0);
            await handle.sync();
          } finally {
            await handle.close();
          }
        }
        return lstat(path, ...args);
      },
    },
  });
  await publisher.publish();
  mutate = true;
  assert.equal(await publisher.verify(), false);
  await publisher.revoke();
  assert.equal(await revoked(f.profileFile), "revoked");
});

test("failed revoke keeps the original FD and is retryable without leaking error details", async (t) => {
  const f = await fixture(t);
  let fail = true,
    closes = 0;
  const publisher = f.create({
    fs: {
      open: async (...args) => {
        const handle = await open(...args),
          truncate = handle.truncate.bind(handle),
          close = handle.close.bind(handle);
        handle.truncate = async (...truncArgs) => {
          if (fail) throw Object.assign(new Error(f.root), { code: "EIO" });
          return truncate(...truncArgs);
        };
        handle.close = async () => {
          closes += 1;
          return close();
        };
        return handle;
      },
    },
  });
  await publisher.publish();
  await assert.rejects(
    publisher.revoke(),
    (error) =>
      error.code === "PROFILE_REVOCATION_FAILED" &&
      !error.message.includes(f.root),
  );
  assert.equal(closes, 0);
  assert.equal(await publisher.verify(), false);
  fail = false;
  await publisher.revoke();
  assert.equal(await revoked(f.profileFile), "revoked");
  assert.equal(closes, 1);
});

test("a failed FD close after revocation can be retried without rewriting", async (t) => {
  const f = await fixture(t);
  let closes = 0,
    truncates = 0;
  const publisher = f.create({
    fs: {
      open: async (...args) => {
        const handle = await open(...args),
          truncate = handle.truncate.bind(handle),
          close = handle.close.bind(handle);
        handle.truncate = async (...truncArgs) => {
          truncates += 1;
          return truncate(...truncArgs);
        };
        handle.close = async () => {
          closes += 1;
          if (closes === 1) throw Error("private");
          return close();
        };
        return handle;
      },
    },
  });
  await publisher.publish();
  await assert.rejects(publisher.revoke(), {
    code: "PROFILE_REVOCATION_FAILED",
  });
  assert.equal(await revoked(f.profileFile), "revoked");
  await publisher.revoke();
  assert.equal(closes, 2);
  assert.equal(truncates, 1);
});

test("a lost link result is never replayed and retains the original inode for revoke", async (t) => {
  const f = await fixture(t);
  let links = 0;
  const publisher = f.create({
    fs: {
      link: async (...args) => {
        links += 1;
        await link(...args);
        throw Object.assign(new Error(f.root), { code: "EIO" });
      },
    },
  });
  const check = (error) =>
    error.code === "PROFILE_PUBLICATION_OUTCOME_UNKNOWN" &&
    !error.message.includes(f.root);
  await assert.rejects(publisher.publish(), check);
  assert.equal(publisher.mayHavePublished, true);
  assert.equal(await publisher.verify(), false);
  await assert.rejects(publisher.publish(), check);
  assert.equal(links, 1);
  await publisher.revoke();
  assert.equal(await revoked(f.profileFile), "revoked");
});

test("revoke during link waits for its result and revokes a late publication", async (t) => {
  const f = await fixture(t),
    entered = gate(),
    unblock = gate();
  let closed = 0;
  const publisher = f.create({
    fs: {
      open: async (...args) => {
        const handle = await open(...args),
          close = handle.close.bind(handle);
        handle.close = async () => {
          closed++;
          return close();
        };
        return handle;
      },
      link: async (...args) => {
        await link(...args);
        entered.release();
        await unblock.promise;
      },
    },
  });
  const publishing = publisher.publish();
  await entered.promise;
  assert.equal(publisher.mayHavePublished, true);
  let finished = false;
  const retiring = publisher.revoke().then(() => {
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  assert.equal(closed, 0);
  unblock.release();
  await assert.rejects(publishing, { code: "PROFILE_RETIRED" });
  await retiring;
  assert.equal(await revoked(f.profileFile), "revoked");
  assert.equal(closed, 1);
});

test("the public state remains unavailable until the linked inode is verified", async (t) => {
  const f = await fixture(t),
    entered = gate(),
    unblock = gate();
  let firstRead = true;
  const publisher = f.create({
    fs: {
      open: async (...args) => {
        const handle = await open(...args),
          read = handle.read.bind(handle);
        handle.read = async (...readArgs) => {
          if (firstRead) {
            firstRead = false;
            entered.release();
            await unblock.promise;
          }
          return read(...readArgs);
        };
        return handle;
      },
    },
  });
  const publishing = publisher.publish();
  await entered.promise;
  try {
    assert.equal(publisher.mayHavePublished, true);
    assert.equal(publisher.published, false);
    assert.equal(await publisher.verify(), false);
  } finally {
    unblock.release();
    await publishing.catch(() => {});
  }
});

test("a retirement during the pre-link guard never publishes", async (t) => {
  const f = await fixture(t),
    entered = gate(),
    unblock = gate();
  let links = 0;
  const publisher = f.create({
    beforeLink: async () => {
      entered.release();
      await unblock.promise;
      return true;
    },
    fs: {
      link: async (...args) => {
        links++;
        return link(...args);
      },
    },
  });
  const publishing = publisher.publish();
  await entered.promise;
  const retiring = publisher.revoke();
  unblock.release();
  await assert.rejects(publishing, { code: "PROFILE_RETIRED" });
  await retiring;
  assert.equal(links, 0);
  assert.equal(publisher.mayHavePublished, false);
  await assert.rejects(lstat(f.profileFile), { code: "ENOENT" });
});

test("identity guard failure and an occupied destination fail without exposing paths", async (t) => {
  const f = await fixture(t),
    rejected = f.create({ beforeLink: async () => false });
  await assert.rejects(
    rejected.publish(),
    (error) =>
      error.code === "PROFILE_IDENTITY_CHANGED" &&
      !error.message.includes(f.root),
  );
  await rejected.revoke();
  await writeFile(f.profileFile, "foreign", { mode: 0o600 });
  const occupied = f.create();
  await assert.rejects(occupied.publish(), { code: "PROFILE_PATH_EXISTS" });
  assert.equal(occupied.mayHavePublished, false);
  assert.equal(await readFile(f.profileFile, "utf8"), "foreign");
});

test("unsafe private directories and invalid profile data fail closed", async (t) => {
  const f = await fixture(t);
  assert.throws(
    () =>
      createProfilePublisher({
        profileFile: f.profileFile,
        profile: { ...f.profile, uid: -1 },
      }),
    { code: "PROFILE_INVALID_CONFIG" },
  );
  await chmod(f.directory, 0o755);
  const publisher = f.create();
  await assert.rejects(publisher.publish(), { code: "PROFILE_UNSAFE_PATH" });
  assert.equal(publisher.mayHavePublished, false);
});

test("private filesystem errors and profile accessors never escape", async (t) => {
  const f = await fixture(t);
  let getterCalls = 0;
  const invalid = { ...f.profile };
  Object.defineProperty(invalid, "id", {
    enumerable: true,
    get() {
      getterCalls++;
      throw Error(f.root);
    },
  });
  assert.throws(
    () =>
      createProfilePublisher({ profileFile: f.profileFile, profile: invalid }),
    { code: "PROFILE_INVALID_CONFIG" },
  );
  assert.equal(getterCalls, 0);
  const publisher = f.create({
    fs: {
      open: async () => {
        throw Object.assign(new Error(f.root), { code: "PROFILE_UNSAFE_PATH" });
      },
    },
  });
  await assert.rejects(
    publisher.publish(),
    (error) =>
      error.code === "PROFILE_UNSAFE_PATH" && !error.message.includes(f.root),
  );
  assert.equal(publisher.mayHavePublished, false);
});


test("default profile verification rereads the held inode and public path around the actual bytes", async (t) => {
  const f = await fixture(t), publisher = f.create();
  await publisher.publish();
  const original = fs.fstatSync;
  let stats = 0;
  fs.fstatSync = (...args) => { stats++; return original(...args); };
  syncBuiltinESMExports();
  try {
    const start = performance.now();
    for (let n = 0; n < 32; n++) assert.equal(await publisher.verify(), true);
    console.log(JSON.stringify({verifyRuns:32,heldInodeStats:stats,elapsedMs:performance.now()-start}));
    assert.equal(stats, 64, "each verification checks its held inode before and after reading");
  } finally { fs.fstatSync = original; syncBuiltinESMExports(); }
});

test("default profile verification detects mutation during the synchronous byte read", async (t) => {
  const f = await fixture(t), publisher = f.create();
  await publisher.publish();
  const original = fs.readSync;
  let changed = false;
  fs.readSync = (fd, ...args) => {
    const result = original(fd, ...args);
    if (!changed) {
      changed = true;
      const writer = fs.openSync(f.profileFile, "r+");
      try { fs.writeSync(writer, Buffer.from("X"), 0, 1, 0); } finally { fs.closeSync(writer); }
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    assert.equal(await publisher.verify(), false);
    assert.equal(changed, true);
  } finally { fs.readSync = original; syncBuiltinESMExports(); }
});

test("a revocation begun during the default profile read invalidates the verification", async (t) => {
  const f = await fixture(t), publisher = f.create();
  await publisher.publish();
  const original = fs.readSync;
  let retirement;
  fs.readSync = (fd, ...args) => {
    const result = original(fd, ...args);
    if (!retirement) retirement = publisher.revoke();
    return result;
  };
  syncBuiltinESMExports();
  try {
    assert.equal(await publisher.verify(), false);
    assert.ok(retirement);
  } finally { fs.readSync = original; syncBuiltinESMExports(); }
  await retirement;
  assert.equal(await publisher.verify(), false);
});

test('optional server SSH socket is immutable private metadata with an independently owned bridge parent',async t=>{
 const f=await fixture(t),bridge=join(f.root,'bridge');await mkdir(bridge,{mode:0o700});
 f.profile.serverSshSocketPath=join(bridge,'server-ssh.sock');
 const publisher=f.create();await publisher.publish();
 assert.equal(JSON.parse(await readFile(f.profileFile,'utf8')).serverSshSocketPath,f.profile.serverSshSocketPath);
 assert.equal(await publisher.verify(),true);
 await rename(bridge,bridge+'-old');await mkdir(bridge,{mode:0o700});
 assert.equal(await publisher.verify(),false);
});

test('optional server SSH path rejects arbitrary filenames, control overlap and accessors',async t=>{
 const f=await fixture(t),bridge=join(f.root,'bridge');await mkdir(bridge,{mode:0o700});
 for(const value of ['relative',join(bridge,'other.sock'),join(f.root,'server-ssh.sock')]){
  f.profile.serverSshSocketPath=value;assert.throws(()=>f.create(),{code:'PROFILE_INVALID_CONFIG'});
 }
 let reads=0;Object.defineProperty(f.profile,'serverSshSocketPath',{enumerable:true,configurable:true,get(){reads++;return join(bridge,'server-ssh.sock');}});
 assert.throws(()=>f.create(),{code:'PROFILE_INVALID_CONFIG'});assert.equal(reads,0);
});
