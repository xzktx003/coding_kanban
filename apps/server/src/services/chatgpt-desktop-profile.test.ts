import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createChatGptDesktopProfileService } from "./chatgpt-desktop-profile.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "chatgpt-profile-"),
  );
  const privateDir = join(root, "private");
  const project = join(root, "project");
  await mkdir(privateDir, { mode: 0o700 });
  await mkdir(project, { mode: 0o775 });
  await chmod(project, 0o775);
  const socketPath = join(privateDir, "control.sock");
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600);
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  });
  const macAsarPath = join(project, "mac.asar");
  const linuxAsarPath = join(project, "linux.asar");
  await writeFile(macAsarPath, "mac fixture", { mode: 0o644 });
  await writeFile(linuxAsarPath, "linux fixture", { mode: 0o644 });
  const stat = await readFile(`/proc/${process.pid}/stat`, "utf8");
  const startTicks = stat
    .slice(stat.lastIndexOf(") ") + 2)
    .trim()
    .split(/\s+/)[19];
  const uid = process.getuid?.();
  assert.notEqual(uid, undefined);
  const profile = {
    version: 1,
    id: randomUUID(),
    generation: randomUUID(),
    pid: process.pid,
    startTicks,
    uid: uid!,
    macAsarPath,
    macAsarSha256: "a".repeat(64),
    linuxAsarPath,
    linuxAsarSha256: "b".repeat(64),
    controlSocketPath: socketPath,
  };
  const path = join(privateDir, "profile.json");
  const save = async (value: unknown) => {
    await writeFile(path, JSON.stringify(value), { mode: 0o600 });
    await chmod(path, 0o600);
  };
  await save(profile);
  return { root, privateDir, project, socketPath, profile, path, save };
}

function assertUnavailable(value: { state: string; reasonCode: string }) {
  assert.equal(value.state, "unavailable");
  assert.match(value.reasonCode, /^[a-z_]+$/);
}

test("empty fixed configuration is unconfigured", async () => {
  const service = createChatGptDesktopProfileService({ profileFile: "" });
  assert.deepEqual(await service.status(), {
    state: "unconfigured",
    reasonCode: "not_configured",
  });
});

test("owned private profile and live owned Unix socket expose only public identity", async (t) => {
  const f = await fixture(t);
  const service = createChatGptDesktopProfileService({ profileFile: f.path });
  assert.deepEqual(await service.status(), {
    state: "ready",
    profileId: f.profile.id,
    generation: f.profile.generation,
    reasonCode: "identity_ready",
  });
  const result = await service.readValidated();
  assert.equal(result.status.state, "ready");
  if (result.status.state !== "ready" || !result.profile)
    assert.fail("expected validated internal profile");
  assert.deepEqual(result.profile, f.profile);
  assert.equal(Object.isFrozen(result.profile), true);
  const publicJson = JSON.stringify(await service.status());
  for (const secret of [
    f.root,
    f.profile.macAsarPath,
    f.socketPath,
    "startTicks",
    "pid",
    "uid",
    "Asar",
  ]) {
    assert.equal(publicJson.includes(secret), false);
  }
  assert.equal((await lstat(f.project)).mode & 0o777, 0o775);
});

test("rejects unknown/malformed fields, malformed JSON, unsafe paths and oversized records", async (t) => {
  const f = await fixture(t);
  const service = createChatGptDesktopProfileService({ profileFile: f.path });
  for (const patch of [
    { surprise: true },
    { version: 2 },
    { id: "bad" },
    { generation: "bad" },
    { pid: 1 },
    { pid: "1" },
    { uid: -1 },
    { startTicks: "1e5" },
    { macAsarSha256: "x".repeat(64) },
    { linuxAsarSha256: "b".repeat(63) },
    { macAsarPath: "relative.asar" },
    {
      linuxAsarPath: join(f.project, "..", "project", "linux.asar").replace(
        "/project/linux",
        "/project/../project/linux",
      ),
    },
    { controlSocketPath: `${f.socketPath}\n` },
  ]) {
    await f.save({ ...f.profile, ...patch });
    assertUnavailable(await service.status());
  }
  await writeFile(f.path, "{", { mode: 0o600 });
  assertUnavailable(await service.status());
  await writeFile(f.path, " ".repeat(16 * 1024 + 1), { mode: 0o600 });
  assertUnavailable(await service.status());
  assertUnavailable(
    await createChatGptDesktopProfileService({
      profileFile: "relative/profile.json",
    }).status(),
  );
});

test("rejects symbolic links for config, its ancestors, assets and control socket", async (t) => {
  const f = await fixture(t);
  const alias = join(f.privateDir, "profile-link.json");
  await symlink(f.path, alias);
  assertUnavailable(
    await createChatGptDesktopProfileService({ profileFile: alias }).status(),
  );
  const dirAlias = join(f.root, "private-link");
  await symlink(f.privateDir, dirAlias);
  assertUnavailable(
    await createChatGptDesktopProfileService({
      profileFile: join(dirAlias, "profile.json"),
    }).status(),
  );
  const assetAlias = join(f.project, "alias.asar");
  await symlink(f.profile.macAsarPath, assetAlias);
  await f.save({ ...f.profile, macAsarPath: assetAlias });
  assertUnavailable(
    await createChatGptDesktopProfileService({ profileFile: f.path }).status(),
  );
  const socketAlias = join(f.privateDir, "socket-link");
  await symlink(f.socketPath, socketAlias);
  await f.save({ ...f.profile, controlSocketPath: socketAlias });
  assertUnavailable(
    await createChatGptDesktopProfileService({ profileFile: f.path }).status(),
  );
});

test("requires owned 0600 profile and socket and owned 0700 private parents", async (t) => {
  const f = await fixture(t);
  const service = createChatGptDesktopProfileService({ profileFile: f.path });
  await chmod(f.path, 0o640);
  assertUnavailable(await service.status());
  await chmod(f.path, 0o600);
  await chmod(f.privateDir, 0o750);
  assertUnavailable(await service.status());
  await chmod(f.privateDir, 0o700);
  await chmod(f.socketPath, 0o660);
  assertUnavailable(await service.status());
  await chmod(f.socketPath, 0o600);
  const fakeSocket = join(f.privateDir, "not-socket");
  await writeFile(fakeSocket, "not socket", { mode: 0o600 });
  await f.save({ ...f.profile, controlSocketPath: fakeSocket });
  assertUnavailable(await service.status());
});

test("stale PID start ticks and unknown process identity fail closed", async (t) => {
  const f = await fixture(t);
  const service = createChatGptDesktopProfileService({ profileFile: f.path });
  await f.save({
    ...f.profile,
    startTicks: f.profile.startTicks === "1" ? "2" : "1",
  });
  assertUnavailable(await service.status());
  await f.save({ ...f.profile, uid: f.profile.uid + 1 });
  assertUnavailable(await service.status());
  await f.save({ ...f.profile, pid: 2_147_483_647 });
  assertUnavailable(await service.status());
  await f.save(f.profile);
  let count = 0;
  const differentTicks = f.profile.startTicks === "1" ? "2" : "1";
  const unstable = createChatGptDesktopProfileService({
    profileFile: f.path,
    inspectProcess: async () => ({
      uid: f.profile.uid,
      startTicks: ++count === 1 ? f.profile.startTicks : differentTicks,
      state: "S",
    }),
  });
  assertUnavailable(await unstable.status());
});

test("captures only the server environment at service creation", async (t) => {
  const f = await fixture(t);
  const previous = process.env.CHATGPT_DESKTOP_PROFILE_FILE;
  try {
    process.env.CHATGPT_DESKTOP_PROFILE_FILE = f.path;
    const service = createChatGptDesktopProfileService();
    process.env.CHATGPT_DESKTOP_PROFILE_FILE = "relative/changed.json";
    assert.equal((await service.status()).state, "ready");
  } finally {
    if (previous === undefined) delete process.env.CHATGPT_DESKTOP_PROFILE_FILE;
    else process.env.CHATGPT_DESKTOP_PROFILE_FILE = previous;
  }
});

test("requires a separate socket parent to be private and owned", async (t) => {
  const f = await fixture(t);
  const controlDir = join(f.root, "control");
  const socketPath = join(controlDir, "control.sock");
  await mkdir(controlDir, { mode: 0o700 });
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600);
  try {
    await f.save({ ...f.profile, controlSocketPath: socketPath });
    const service = createChatGptDesktopProfileService({ profileFile: f.path });
    assert.equal((await service.status()).state, "ready");
    await chmod(controlDir, 0o750);
    assert.equal(
      (await service.status()).reasonCode,
      "unsafe_control_directory",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("rejects a changed socket identity and does not connect to it", async (t) => {
  const f = await fixture(t);
  const oldSocket = join(f.privateDir, "old-control.sock");
  let changed = false;
  const service = createChatGptDesktopProfileService({
    profileFile: f.path,
    inspectProcess: async () => {
      if (!changed) {
        changed = true;
        await rename(f.socketPath, oldSocket);
        await symlink(oldSocket, f.socketPath);
      }
      return {
        uid: f.profile.uid,
        startTicks: f.profile.startTicks,
        state: "S",
      };
    },
  });
  try {
    assert.equal((await service.status()).reasonCode, "unsafe_control_socket");
    assert.equal(changed, true);
  } finally {
    if (changed) {
      await rm(f.socketPath, { force: true });
      await rename(oldSocket, f.socketPath);
    }
  }
});

test("rejects a profile owned by another UID and sanitizes low-level errors", async (t) => {
  const f = await fixture(t);
  const service = createChatGptDesktopProfileService({
    profileFile: f.path,
    fs: {
      lstat: async (path) => {
        const info = await lstat(path, { bigint: true });
        return path === f.path
          ? new Proxy(info, {
              get: (target, property, receiver) =>
                property === "uid"
                  ? BigInt(f.profile.uid + 1)
                  : Reflect.get(target, property, receiver),
            })
          : info;
      },
      realpath,
      open: async () => {
        throw new Error(`must not expose ${f.path}`);
      },
    },
  });
  const status = await service.status();
  assert.equal(status.reasonCode, "unsafe_profile_file");
  assert.equal(JSON.stringify(status).includes(f.root), false);

  const inaccessible = createChatGptDesktopProfileService({
    profileFile: f.path,
    inspectProcess: async () => {
      throw new Error(`must not expose ${f.path}`);
    },
  });
  const second = await inaccessible.status();
  assert.equal(second.reasonCode, "process_identity_unavailable");
  assert.equal(JSON.stringify(second).includes(f.root), false);
});

test("rejects a private directory or Unix socket owned by another UID", async (t) => {
  const f = await fixture(t);
  for (const [target, code] of [
    [f.privateDir, "unsafe_profile_directory"],
    [f.socketPath, "unsafe_control_socket"],
  ] as const) {
    const service = createChatGptDesktopProfileService({
      profileFile: f.path,
      fs: {
        lstat: async (path) => {
          const info = await lstat(path, { bigint: true });
          return path === target
            ? new Proxy(info, {
                get: (object, property, receiver) =>
                  property === "uid"
                    ? BigInt(f.profile.uid + 1)
                    : Reflect.get(object, property, receiver),
              })
            : info;
        },
        realpath,
        open: async (path, flags) => {
          const handle = await open(path, flags);
          return {
            stat: () => handle.stat({ bigint: true }),
            read: async (buffer, offset, length, position) =>
              handle.read(buffer, offset, length, position),
            close: () => handle.close(),
          };
        },
      },
    });
    assert.equal((await service.status()).reasonCode, code);
  }
});

test("detects in-place mutation of the profile while it is read", async (t) => {
  const f = await fixture(t);
  const service = createChatGptDesktopProfileService({
    profileFile: f.path,
    fs: {
      lstat: (path) => lstat(path, { bigint: true }),
      realpath,
      open: async (path, flags) => {
        const handle = await open(path, flags);
        let mutated = false;
        return {
          stat: () => handle.stat({ bigint: true }),
          read: async (buffer, offset, length, position) => {
            const result = await handle.read(buffer, offset, length, position);
            if (!mutated) {
              mutated = true;
              await writeFile(
                f.path,
                JSON.stringify({ ...f.profile, generation: randomUUID() }),
              );
            }
            return result;
          },
          close: () => handle.close(),
        };
      },
    },
  });
  assert.equal((await service.status()).reasonCode, "profile_changed");
});

test("detects same-size mutation even when file timestamps do not advance", async (t) => {
  const f = await fixture(t);
  const unchangedMetadata = await lstat(f.path, { bigint: true });
  const service = createChatGptDesktopProfileService({
    profileFile: f.path,
    fs: {
      lstat: (path) =>
        path === f.path
          ? Promise.resolve(unchangedMetadata)
          : lstat(path, { bigint: true }),
      realpath,
      open: async (path, flags) => {
        const handle = await open(path, flags);
        let mutated = false;
        return {
          stat: async () => unchangedMetadata,
          read: async (buffer, offset, length, position) => {
            const result = await handle.read(buffer, offset, length, position);
            if (!mutated) {
              mutated = true;
              await writeFile(
                f.path,
                JSON.stringify({ ...f.profile, generation: randomUUID() }),
              );
            }
            return result;
          },
          close: () => handle.close(),
        };
      },
    },
  });
  assert.equal((await service.status()).reasonCode, "profile_changed");
});

test("detects profile path replacement while the open file is read", async (t) => {
  const f = await fixture(t);
  const replacement = join(f.privateDir, "replacement.json");
  await writeFile(replacement, JSON.stringify(f.profile), { mode: 0o600 });
  const service = createChatGptDesktopProfileService({
    profileFile: f.path,
    fs: {
      lstat: (path) => lstat(path, { bigint: true }),
      realpath,
      open: async (path, flags) => {
        assert.equal(flags & constants.O_NOFOLLOW, constants.O_NOFOLLOW);
        const handle = await open(path, flags);
        let mutated = false;
        return {
          stat: () => handle.stat({ bigint: true }),
          read: async (buffer, offset, length, position) => {
            const result = await handle.read(buffer, offset, length, position);
            if (!mutated) {
              mutated = true;
              await rename(replacement, f.path);
            }
            return result;
          },
          close: () => handle.close(),
        };
      },
    },
  });
  assert.equal((await service.status()).reasonCode, "profile_changed");
});


test("fresh default profile validation does not queue metadata behind the libuv worker", async (t) => {
  const f = await fixture(t);
  const moduleUrl = new URL("./chatgpt-desktop-profile.ts", import.meta.url).href;
  const script = `
    import { pbkdf2 } from 'node:crypto';
    const {createChatGptDesktopProfileService}=await import(${JSON.stringify(moduleUrl)});
    const worker=new Promise((resolve,reject)=>pbkdf2('fixture','salt',2000000,32,'sha256',err=>err?reject(err):resolve('worker')));
    await new Promise(resolve=>setTimeout(resolve,20));
    const started=performance.now();
    const validation=createChatGptDesktopProfileService({profileFile:process.argv[1]}).readValidated().then(value=>value.status.state);
    const first=await Promise.race([validation.then(()=> 'validation'),worker]);
    const state=await validation; const elapsed=performance.now()-started; await worker;
    process.stdout.write(JSON.stringify({first,state,elapsedMs:Math.round(elapsed)}));
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script, f.path], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { ...process.env, UV_THREADPOOL_SIZE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = []; let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const [code] = await once(child, "close");
  assert.equal(code, 0, stderr);
  const result = JSON.parse(Buffer.concat(stdout).toString("utf8")) as { first: string; state: string; elapsedMs: number };
  t.diagnostic(`default profile validated in ${result.elapsedMs}ms with one occupied libuv worker`);
  assert.equal(result.state, "ready");
  assert.equal(result.first, "validation");
});

test('optional private SSH endpoint supports a separate private bridge directory and stays out of public status',async t=>{
  const f=await fixture(t),bridge=join(f.root,'bridge');await mkdir(bridge,{mode:0o700});const serverSshSocketPath=join(bridge,'server-ssh.sock');
  await f.save({...f.profile,serverSshSocketPath});const service=createChatGptDesktopProfileService({profileFile:f.path});
  const before=await service.readValidated();assert.equal(before.status.state,'ready');assert.equal(before.profile?.serverSshSocketPath,serverSshSocketPath);
  assert.doesNotMatch(JSON.stringify(await service.status()),/serverSshSocketPath|server-ssh|bridge/);
  const server=createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(serverSshSocketPath,resolve)});await chmod(serverSshSocketPath,0o600);
  try{assert.equal((await service.status()).state,'ready');await chmod(serverSshSocketPath,0o660);assert.equal((await service.status()).reasonCode,'unsafe_server_ssh_socket')}finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
test('private SSH endpoint shape and filesystem ownership reject malformed or substituted targets',async t=>{
  const f=await fixture(t),bridge=join(f.root,'bridge');await mkdir(bridge,{mode:0o700});const service=createChatGptDesktopProfileService({profileFile:f.path});
  for(const serverSshSocketPath of [null,123,'relative/server-ssh.sock',join(bridge,'other.sock'),join(bridge,'x','..','server-ssh.sock').replace('/server-ssh.sock','/x/../server-ssh.sock')]){await f.save({...f.profile,serverSshSocketPath});assertUnavailable(await service.status())}
  const target=join(bridge,'server-ssh.sock');await f.save({...f.profile,serverSshSocketPath:target});
  await chmod(bridge,0o750);assert.equal((await service.status()).reasonCode,'unsafe_server_ssh_directory');await chmod(bridge,0o700);
  await writeFile(target,'not a socket',{mode:0o600});assert.equal((await service.status()).reasonCode,'unsafe_server_ssh_socket');await rm(target);
  await symlink(f.socketPath,target);assert.equal((await service.status()).reasonCode,'unsafe_server_ssh_socket');await rm(target);
  const alias=join(f.root,'bridge-alias');await symlink(bridge,alias);await f.save({...f.profile,serverSshSocketPath:join(alias,'server-ssh.sock')});assert.equal((await service.status()).reasonCode,'unsafe_server_ssh_directory');
  await f.save(f.profile);assert.equal((await service.status()).state,'ready');
});
test('private SSH endpoint parent replacement during process verification invalidates the snapshot',async t=>{
  const f=await fixture(t),bridge=join(f.root,'bridge');await mkdir(bridge,{mode:0o700});await f.save({...f.profile,serverSshSocketPath:join(bridge,'server-ssh.sock')});let replaced=false;
  const service=createChatGptDesktopProfileService({profileFile:f.path,inspectProcess:async()=>{if(!replaced){replaced=true;await rename(bridge,bridge+'-old');await mkdir(bridge,{mode:0o700})}return {uid:f.profile.uid,startTicks:f.profile.startTicks!,state:'S'}}});
  assert.equal((await service.status()).reasonCode,'unsafe_server_ssh_directory');
});
