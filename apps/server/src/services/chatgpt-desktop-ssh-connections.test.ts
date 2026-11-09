import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  mkdir,
  readFile,
  rm,
  lstat,
  chmod,
  symlink,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import {
  createChatGptSshConnections,
  buildChatGptSshConnectionArgs,
  type ChatGptSshConnectionsOptions,
} from "./chatgpt-desktop-ssh-connections.js";
import { startChatGptSshConnectionIpc } from "./chatgpt-desktop-ssh-ipc.js";

const id = "11111111-1111-4111-8111-111111111111",
  generation = "22222222-2222-4222-8222-222222222222";
async function fixture(t: test.TestContext, mode = "ready") {
  const root = await mkdtemp(join(tmpdir(), "kb-ssh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "runtime"), { mode: 0o700 });
  await writeFile(
    join(root, "config"),
    "Host fixture\n HostName not-a-real-server.invalid\n",
    { mode: 0o600 },
  );
  const script = `#!${process.execPath}
const fs=require('node:fs');
fs.writeFileSync(${JSON.stringify(join(root, "argv.json"))},JSON.stringify({args:process.argv.slice(2),envKeys:Object.keys(process.env)}));
let pending='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{
  pending+=chunk;
  while(pending.includes('\\n')){
    const at=pending.indexOf('\\n'),frame=JSON.parse(pending.slice(0,at));pending=pending.slice(at+1);
    fs.appendFileSync(${JSON.stringify(join(root, "frames.jsonl"))},JSON.stringify(frame)+'\\n');
    if(frame.method==='initialize'){
      if(${JSON.stringify(mode)}==='exit'){process.stderr.write('PRIVATE authentication error');process.exit(255)}
      if(${JSON.stringify(mode)}==='bad'){process.stdout.write(JSON.stringify({id:frame.id,result:{ok:true}})+'\\n');continue}
      process.stdout.write(JSON.stringify({id:frame.id,result:{codexHome:'/private/remote/home',platformFamily:'unix',platformOs:'linux',userAgent:'fixture/0.166'}})+'\\n');
    }
    if(frame.method==='getAuthStatus'){
      process.stdout.write(JSON.stringify({id:frame.id,result:{authMethod:null,requiresOpenaiAuth:false}})+'\\n');
    }
    if(frame.method==='thread/list'){
      const text=JSON.stringify({id:frame.id,result:{data:[{id:'fixture-native-thread'}],nextCursor:null}})+'\\n';
      process.stdout.write(text.slice(0,11));setTimeout(()=>process.stdout.write(text.slice(11)),1);
    }
    if(frame.method==='fs/getMetadata')process.stdout.write(JSON.stringify({id:frame.id,result:{createdAtMs:1,modifiedAtMs:2,isDirectory:true,isFile:false,isSymlink:false}})+'\\n');
    if(frame.method==='fs/readDirectory')process.stdout.write(JSON.stringify({id:frame.id,result:{entries:[{name:'fixture-project',path:'fixture-project',type:'directory'}]}})+'\\n');
    if(frame.method==='fs/createDirectory')process.stdout.write(JSON.stringify({id:frame.id,result:{}})+'\\n');
    if(frame.method==='thread/start')process.stdout.write(JSON.stringify({id:frame.id,result:{thread:{id:'fixture-native-thread'}}})+'\\n');
    if(frame.method==='thread/resume')process.stdout.write(JSON.stringify({id:frame.id,result:{thread:{id:'fixture-native-thread'}}})+'\\n');
    if(frame.method==='turn/start'){
      process.stdout.write(JSON.stringify({id:frame.id,result:{turn:{id:'fixture-native-turn',status:'inProgress'}}})+'\\n');
      if(frame.params?.input?.some(item=>item.text==='request approval'))process.stdout.write(JSON.stringify({id:'fixture-approval',method:'item/commandExecution/requestApproval',params:{threadId:'fixture-native-thread',turnId:'fixture-native-turn',itemId:'fixture-command-item',startedAtMs:1,environmentId:null,command:'printf safe',cwd:'/remote/project',availableDecisions:['accept','decline']}})+'\\n');
      if(frame.params?.input?.some(item=>item.text==='request file approval'))process.stdout.write(JSON.stringify({id:'fixture-file-approval',method:'item/fileChange/requestApproval',params:{threadId:'fixture-native-thread',turnId:'fixture-native-turn',itemId:'fixture-file-item',startedAtMs:1,reason:'file changes'}})+'\\n');
      if(frame.params?.input?.some(item=>item.text==='request permissions'))process.stdout.write(JSON.stringify({id:'fixture-permission-approval',method:'item/permissions/requestApproval',params:{threadId:'fixture-native-thread',turnId:'fixture-native-turn',itemId:'fixture-permission-item',startedAtMs:1,environmentId:null,cwd:'/remote/project',reason:'internet access',permissions:{network:{enabled:true},fileSystem:null}}})+'\\n');
      if(frame.params?.input?.some(item=>item.text==='request filtered permissions'))process.stdout.write(JSON.stringify({id:'fixture-filtered-permission-approval',method:'item/permissions/requestApproval',params:{threadId:'fixture-native-thread',turnId:'fixture-native-turn',itemId:'fixture-filtered-permission-item',startedAtMs:1,environmentId:null,cwd:'/remote/project',reason:'file access',permissions:{network:{enabled:true},fileSystem:{read:['/remote/project/legacy-read'],write:null,globScanMaxDepth:3,entries:[{path:{type:'path',path:'/remote/project/input.txt'},access:'read'},{path:{type:'path',path:'/remote/project/output.txt'},access:'write'}]}}}})+'\\n');
    }
    if(!frame.method&&['fixture-approval','fixture-file-approval','fixture-permission-approval','fixture-filtered-permission-approval'].includes(frame.id))process.stdout.write(JSON.stringify({method:'serverRequest/resolved',params:{requestId:frame.id,threadId:'fixture-native-thread'}})+'\\n');
  }
});`;
  await writeFile(join(root, "fake-ssh.cjs"), script, { mode: 0o700 });
  let revision = "scope1",
    scopeWait: Promise<void> | undefined;
  const managerOptions: ChatGptSshConnectionsOptions = {
    configPath: join(root, "config"),
    runtimeRoot: join(root, "runtime"),
    sshBinary: join(root, "fake-ssh.cjs"),
    discovery: {
      discover: () => ({ sshAliases: ["fixture"], configState: "ready" }),
    },
    readScope: async () => {
      if (scopeWait) await scopeWait;
      return { id, generation, identity: revision };
    },
  };
  const manager = createChatGptSshConnections(managerOptions);
  const socketPath = join(root, "control.sock"),
    ipc = await startChatGptSshConnectionIpc({
      socketPath,
      connections: manager,
    });
  t.after(async () => {
    await ipc.close();
    manager.close();
  });
  return {
    root,
    manager,
    socketPath,
    scope: { id, generation },
    createManager() {
      const next = createChatGptSshConnections(managerOptions);
      t.after(() => next.close());
      return next;
    },
    change: () => {
      revision = "changed";
    },
    holdScope: () => {
      let release!: () => void;
      scopeWait = new Promise<void>((r) => {
        release = r;
      });
      return () => {
        scopeWait = undefined;
        release();
      };
    },
  };
}
async function control(
  f: Awaited<ReturnType<typeof fixture>>,
  method: string,
  params: unknown = {},
) {
  const socket = createConnection(f.socketPath);
  await once(socket, "connect");
  const lines = createInterface({ input: socket });
  socket.write(
    JSON.stringify({
      v: 1,
      type: "request",
      id: randomUUID(),
      profileId: id,
      generation,
      method,
      params,
    }) + "\n",
  );
  for await (const line of lines) {
    const reply = JSON.parse(line);
    socket.destroy();
    if (reply.error) throw Object.assign(Error("IPC rejected"), reply.error);
    return reply.result;
  }
  throw Error("No IPC reply");
}
async function openRpc(
  f: Awaited<ReturnType<typeof fixture>>,
  connectionId: string,
) {
  const socket = createConnection(f.socketPath);
  await once(socket, "connect");
  const lines = createInterface({ input: socket }),
    queue: any[] = [],
    waiting: Array<{ resolve(value: any): void; reject(error: Error): void }> = [];
  lines.on("line", (line) => {
    const value = JSON.parse(line);
    const resolve = waiting.shift();
    if (resolve) resolve.resolve(value);
    else queue.push(value);
  });
  socket.on("close", () => {
    for (const waiter of waiting.splice(0)) waiter.reject(new Error("RPC socket closed"));
  });
  const next = () =>
    queue.length
      ? Promise.resolve(queue.shift())
      : new Promise<any>((resolve, reject) => waiting.push({ resolve, reject }));
  socket.write(
    JSON.stringify({
      v: 1,
      type: "open",
      profileId: id,
      generation,
      connectionId,
    }) + "\n",
  );
  assert.equal((await next()).type, "opened");
  return {
    socket,
    next,
    send(text: string) {
      socket.write(JSON.stringify({ v: 1, type: "rpc", text }) + "\n");
    },
  };
}
async function openPermissionRequest(t: test.TestContext, prompt = "request permissions") {
  const f = await fixture(t);
  await control(f, "save", { aliases: ["fixture"] });
  const created = await control(f, "connect", { alias: "fixture" });
  const rpc = await openRpc(f, created.connectionId);
  t.after(() => rpc.socket.destroy());
  rpc.send('{"id":"remote-init","method":"initialize","params":{}}');
  await rpc.next();
  rpc.send(JSON.stringify({
    id: "permission-trigger-turn",
    method: "turn/start",
    params: { threadId: "fixture-native-thread", input: [{ type: "text", text: prompt }] },
  }));
  await rpc.next();
  const request = JSON.parse((await rpc.next()).text);
  assert.equal(request.method, "item/permissions/requestApproval");
  return { f, rpc, request };
}
test(
  "private native IPC transports original initialize and subsequent thread/list over a real child stdio stream",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    assert.equal((await lstat(f.socketPath)).mode & 0o777, 0o600);
    assert.deepEqual(await control(f, "discover"), { sshAliases: ["fixture"] });
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    assert.equal(created.state, "connecting");
    assert.match(created.connectionId, /^[a-f0-9-]{36}$/);
    assert.equal("socketPath" in created, false);
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    rpc.send(
      '{"id":11,"method":"initialize","params":{"clientInfo":{"name":"actual-native-fixture","version":"1"}}}',
    );
    const init = JSON.parse((await rpc.next()).text);
    assert.equal(init.result.userAgent, "fixture/0.166");
    // Adjacent original notifications/requests must stay FIFO across asynchronous guards.
    rpc.send('{"method":"initialized"}');
    const raw = '{"id":12,"method":"thread/list","params":{"limit":1}}';
    rpc.send(raw);
    assert.deepEqual(JSON.parse((await rpc.next()).text), {
      id: 12,
      result: { data: [{ id: "fixture-native-thread" }], nextCursor: null },
    });
    assert.equal(
      (await control(f, "refresh")).connections[0].state,
      "connected",
    );
    assert.doesNotMatch(
      JSON.stringify(await control(f, "refresh")),
      /codexHome|private\/remote|socketPath|params/,
    );
    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.deepEqual(
      frames.map((x) => x.method),
      ["initialize", "initialized", "thread/list"],
    );
    assert.deepEqual(frames[2], JSON.parse(raw));
    const invocation = JSON.parse(
      await readFile(join(f.root, "argv.json"), "utf8"),
    );
    assert.equal(
      invocation.args.some((x: string) => x.startsWith("RemoteCommand=")),
      false,
    );
    assert.ok(invocation.args.includes("StrictHostKeyChecking=yes"));
    assert.ok(invocation.args.includes("ControlMaster=no"));
    assert.ok(invocation.args.includes("ClearAllForwardings=yes"));
    assert.equal(invocation.args.at(-2), "fixture");
    assert.equal(invocation.args.at(-1), "exec codex app-server");
    assert.deepEqual(
      invocation.envKeys.sort(),
      [
        "HOME",
        "PATH",
        "SSH_ASKPASS_REQUIRE",
        ...(process.env.SSH_AUTH_SOCK ? ["SSH_AUTH_SOCK"] : []),
      ].sort(),
    );
    assert.equal(
      invocation.args.some((v: string) =>
        /pkill|killall|StrictHostKeyChecking=no/.test(v),
      ),
      false,
    );
    // Unimplemented account mutation remains a real negative capability and never reaches SSH stdin.
    rpc.send(
      '{"id":13,"method":"account/logout","params":{}}',
    );
    assert.equal(JSON.parse((await rpc.next()).text).error.code, -32601);
    assert.doesNotMatch(
      await readFile(join(f.root, "frames.jsonl"), "utf8"),
      /account\/logout/,
    );
    await control(f, "disconnect", { alias: "fixture" });
    assert.equal(
      (await control(f, "refresh")).connections[0].state,
      "disconnected",
    );
  },
);
test(
  "post-initialize auth status permits exact false/false only and preserves the connection",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    rpc.send(JSON.stringify({id: "initialize", method: "initialize", params: {}}));
    assert.ok(JSON.parse((await rpc.next()).text).result);
    const params = {includeToken: false, refreshToken: false};
    rpc.send(JSON.stringify({id: "post-init", method: "getAuthStatus", params}));
    const reply = JSON.parse((await rpc.next()).text);
    assert.deepEqual(reply, {id: "post-init", result: {authMethod: null, requiresOpenaiAuth: false}});
    assert.equal(Object.hasOwn(reply.result, "authToken"), false);
    const forbidden = [
      {includeToken: true, refreshToken: false},
      {includeToken: false, refreshToken: true},
      {...params, unknown: false},
      {includeToken: false},
    ];
    for (const [index, deniedParams] of forbidden.entries()) {
      const id = `denied-${index}`;
      rpc.send(JSON.stringify({id, method: "getAuthStatus", params: deniedParams}));
      assert.deepEqual(JSON.parse((await rpc.next()).text), {
        id, error: {code: -32601, message: "SSH_METHOD_UNAVAILABLE"},
      });
    }
    rpc.send(JSON.stringify({id: "after-denial", method: "thread/list", params: {limit: 1}}));
    assert.equal(JSON.parse((await rpc.next()).text).id, "after-denial");
    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8")).trim().split("\n").map(s => JSON.parse(s));
    assert.deepEqual(frames.map(frame => frame.method), ["initialize", "getAuthStatus", "thread/list"]);
    assert.deepEqual(frames[1].params, params);
  },
);

test(
  "an explicitly connected original client can browse remote directory metadata without file reads",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    rpc.send(JSON.stringify({ id: "filesystem-init", method: "initialize", params: {} }));
    assert.equal(JSON.parse((await rpc.next()).text).id, "filesystem-init");
    rpc.send('{"method":"initialized"}');

    const metadata = { id: "remote-metadata", method: "fs/getMetadata", params: { path: "/home/remote" } };
    rpc.send(JSON.stringify(metadata));
    assert.deepEqual(JSON.parse((await rpc.next()).text), {
      id: metadata.id,
      result: { createdAtMs: 1, modifiedAtMs: 2, isDirectory: true, isFile: false, isSymlink: false },
    });
    const directory = { id: "remote-directory", method: "fs/readDirectory", params: { path: "/home/remote" } };
    rpc.send(JSON.stringify(directory));
    assert.deepEqual(JSON.parse((await rpc.next()).text), {
      id: directory.id,
      result: { entries: [{ name: "fixture-project", path: "fixture-project", type: "directory" }] },
    });

    for (const [index, params] of [
      { path: "relative" },
      { path: "/home/../etc" },
      { path: "/home//remote" },
      { path: "/home/remote", includeHidden: true },
      { path: "/home/remote\ninvalid" },
    ].entries()) {
      const id = `invalid-filesystem-${index}`;
      rpc.send(JSON.stringify({ id, method: "fs/readDirectory", params }));
      assert.deepEqual(JSON.parse((await rpc.next()).text), {
        id,
        error: { code: -32602, message: "SSH_FILESYSTEM_REQUEST_INVALID" },
      });
    }
    rpc.send('{"id":"file-content","method":"fs/readFile","params":{"path":"/home/remote/secret.txt"}}');
    assert.deepEqual(JSON.parse((await rpc.next()).text), {
      id: "file-content",
      error: { code: -32601, message: "SSH_METHOD_UNAVAILABLE" },
    });

    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(frames.map((frame) => frame.method), ["initialize", "initialized", "fs/getMetadata", "fs/readDirectory"]);
    assert.deepEqual(frames[2], metadata);
    assert.deepEqual(frames[3], directory);
  },
);

test(
  "an explicitly connected original client can create only a requested remote directory",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    rpc.send(JSON.stringify({ id: "mkdir-init", method: "initialize", params: {} }));
    assert.equal(JSON.parse((await rpc.next()).text).id, "mkdir-init");
    rpc.send('{"method":"initialized"}');

    const create = { id: "remote-mkdir", method: "fs/createDirectory", params: { path: "/tmp/kanban-ssh-fixture", recursive: false } };
    rpc.send(JSON.stringify(create));
    assert.deepEqual(JSON.parse((await rpc.next()).text), { id: create.id, result: {} });

    for (const [index, params] of [
      { path: "relative" },
      { path: "/tmp/../etc/unsafe" },
      { path: "/tmp//noncanonical" },
      { path: "/tmp/kanban-ssh-fixture", recursive: "yes" },
      { path: "/tmp/kanban-ssh-fixture", recursive: false, extra: true },
    ].entries()) {
      const id = `invalid-mkdir-${index}`;
      rpc.send(JSON.stringify({ id, method: "fs/createDirectory", params }));
      assert.deepEqual(JSON.parse((await rpc.next()).text), {
        id,
        error: { code: -32602, message: "SSH_FILESYSTEM_REQUEST_INVALID" },
      });
    }

    rpc.send('{"id":"still-connected","method":"thread/list","params":{"limit":1}}');
    assert.equal(JSON.parse((await rpc.next()).text).id, "still-connected");
    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(frames.map((frame) => frame.method), ["initialize", "initialized", "fs/createDirectory", "thread/list"]);
    assert.deepEqual(frames[2], create);
  },
);

test(
  "an explicitly connected original client can create, resume and send on a remote Codex thread",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    rpc.send(
      JSON.stringify({
        id: "remote-init",
        method: "initialize",
        params: { clientInfo: { name: "actual-native-fixture", version: "1" } },
      }),
    );
    assert.equal(JSON.parse((await rpc.next()).text).id, "remote-init");

    const start = {
      id: "remote-thread-start",
      method: "thread/start",
      params: { cwd: "/remote/project", approvalPolicy: "on-request" },
    };
    rpc.send(JSON.stringify(start));
    assert.deepEqual(JSON.parse((await rpc.next()).text), {
      id: start.id,
      result: { thread: { id: "fixture-native-thread" } },
    });

    const resume = {
      id: "remote-thread-resume",
      method: "thread/resume",
      params: { threadId: "fixture-native-thread", cwd: "/remote/project" },
    };
    rpc.send(JSON.stringify(resume));
    assert.deepEqual(JSON.parse((await rpc.next()).text), {
      id: resume.id,
      result: { thread: { id: "fixture-native-thread" } },
    });

    const turn = {
      id: "remote-turn-start",
      method: "turn/start",
      params: {
        threadId: "fixture-native-thread",
        input: [{ type: "text", text: "actual native input", text_elements: [] }],
      },
    };
    rpc.send(JSON.stringify(turn));
    assert.deepEqual(JSON.parse((await rpc.next()).text), {
      id: turn.id,
      result: { turn: { id: "fixture-native-turn", status: "inProgress" } },
    });

    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.deepEqual(frames.slice(1), [start, resume, turn]);
  },
);

test(
  "remote thread actions require a native request ID and object params before SSH write",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    rpc.send('{"id":"remote-init","method":"initialize","params":{}}');
    assert.equal(JSON.parse((await rpc.next()).text).id, "remote-init");
    const closed = once(rpc.socket, "close");
    rpc.send('{"method":"turn/start","params":{"threadId":"fixture-native-thread"}}');
    await closed;
    assert.doesNotMatch(
      await readFile(join(f.root, "frames.jsonl"), "utf8"),
      /turn\/start/,
    );
  },
);

test(
  "original client command approval responses round-trip only for the outstanding server request",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    rpc.send('{"id":"remote-init","method":"initialize","params":{}}');
    assert.equal(JSON.parse((await rpc.next()).text).id, "remote-init");
    rpc.send(JSON.stringify({
      id: "approval-trigger-turn",
      method: "turn/start",
      params: { threadId: "fixture-native-thread", input: [{ type: "text", text: "request approval" }] },
    }));
    assert.equal(JSON.parse((await rpc.next()).text).id, "approval-trigger-turn");
    const request = JSON.parse((await rpc.next()).text);
    assert.equal(request.method, "item/commandExecution/requestApproval");
    assert.deepEqual(request.params.availableDecisions, ["accept", "decline"]);

    rpc.send(JSON.stringify({ id: request.id, result: { decision: "accept" } }));
    assert.deepEqual(JSON.parse((await rpc.next()).text), {
      method: "serverRequest/resolved",
      params: { requestId: request.id, threadId: "fixture-native-thread" },
    });
    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(frames.at(-1), { id: request.id, result: { decision: "accept" } });
    const closed = once(rpc.socket, "close");
    rpc.send(JSON.stringify({ id: request.id, result: { decision: "accept" } }));
    await closed;
    const afterDuplicate = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(afterDuplicate.filter((frame) => frame.id === request.id && frame.result).length, 1);
  },
);

test(
  "original client file approval response round-trips only for its outstanding request",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    rpc.send('{"id":"remote-init","method":"initialize","params":{}}');
    assert.equal(JSON.parse((await rpc.next()).text).id, "remote-init");
    rpc.send(JSON.stringify({
      id: "file-approval-trigger-turn",
      method: "turn/start",
      params: { threadId: "fixture-native-thread", input: [{ type: "text", text: "request file approval" }] },
    }));
    assert.equal(JSON.parse((await rpc.next()).text).id, "file-approval-trigger-turn");
    const request = JSON.parse((await rpc.next()).text);
    assert.equal(request.method, "item/fileChange/requestApproval");
    rpc.send(JSON.stringify({ id: request.id, result: { decision: "accept" } }));
    assert.deepEqual(JSON.parse((await rpc.next()).text), {
      method: "serverRequest/resolved",
      params: { requestId: request.id, threadId: "fixture-native-thread" },
    });
    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(frames.at(-1), { id: request.id, result: { decision: "accept" } });
  },
);

test(
  "original client permission grant response round-trips only for requested permissions and native scope",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    rpc.send('{"id":"remote-init","method":"initialize","params":{}}');
    assert.equal(JSON.parse((await rpc.next()).text).id, "remote-init");
    rpc.send(JSON.stringify({
      id: "permission-trigger-turn",
      method: "turn/start",
      params: { threadId: "fixture-native-thread", input: [{ type: "text", text: "request permissions" }] },
    }));
    assert.equal(JSON.parse((await rpc.next()).text).id, "permission-trigger-turn");
    const request = JSON.parse((await rpc.next()).text);
    assert.equal(request.method, "item/permissions/requestApproval");

    const response = {
      id: request.id,
      result: {
        permissions: { network: { enabled: true } },
        scope: "session",
        strictAutoReview: true,
      },
    };
    rpc.send(JSON.stringify(response));
    assert.deepEqual(JSON.parse((await rpc.next()).text), {
      method: "serverRequest/resolved",
      params: { requestId: request.id, threadId: "fixture-native-thread" },
    });
    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(frames.at(-1), response);
  },
);

test(
  "original permission denial uses the fixed empty turn-scope grant profile",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    rpc.send('{"id":"remote-init","method":"initialize","params":{}}');
    await rpc.next();
    rpc.send(JSON.stringify({
      id: "permission-denial-trigger-turn",
      method: "turn/start",
      params: { threadId: "fixture-native-thread", input: [{ type: "text", text: "request permissions" }] },
    }));
    await rpc.next();
    const request = JSON.parse((await rpc.next()).text);
    const response = { id: request.id, result: { permissions: {}, scope: "turn" } };
    rpc.send(JSON.stringify(response));
    assert.deepEqual(JSON.parse((await rpc.next()).text), {
      method: "serverRequest/resolved",
      params: { requestId: request.id, threadId: "fixture-native-thread" },
    });
    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(frames.at(-1), response);
  },
);

test(
  "original permission-policy grant preserves only an ordered subset of requested filesystem entries",
  { timeout: 4000 },
  async (t) => {
    const { f, rpc, request } = await openPermissionRequest(t, "request filtered permissions");
    const readEntry = request.params.permissions.fileSystem.entries[0];
    const response = {
      id: request.id,
      result: {
        permissions: {
          network: { enabled: true },
          fileSystem: {
            read: null,
            write: null,
            globScanMaxDepth: 3,
            entries: [readEntry],
          },
        },
        scope: "turn",
        strictAutoReview: true,
      },
    };
    rpc.send(JSON.stringify(response));
    assert.deepEqual(JSON.parse((await rpc.next()).text), {
      method: "serverRequest/resolved",
      params: { requestId: request.id, threadId: "fixture-native-thread" },
    });
    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(frames.at(-1), response);
  },
);

test(
  "permission grant cannot add filesystem permissions absent from the original request",
  { timeout: 4000 },
  async (t) => {
    const { f, rpc, request } = await openPermissionRequest(t);
    const closed = once(rpc.socket, "close");
    rpc.send(JSON.stringify({
      id: request.id,
      result: {
        permissions: {
          network: { enabled: true },
          fileSystem: { read: ["/remote/unrequested"], write: null },
        },
        scope: "session",
        strictAutoReview: true,
      },
    }));
    await closed;
    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(frames.some((frame) => frame.id === request.id && frame.result), false);
  },
);

test(
  "permission grant requires the original UI's boolean strictAutoReview field",
  { timeout: 4000 },
  async (t) => {
    const { f, rpc, request } = await openPermissionRequest(t);
    const closed = once(rpc.socket, "close");
    rpc.send(JSON.stringify({
      id: request.id,
      result: {
        permissions: { network: { enabled: true } },
        scope: "turn",
        strictAutoReview: "true",
      },
    }));
    await closed;
    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(frames.some((frame) => frame.id === request.id && frame.result), false);
  },
);

test(
  "command approval response cannot choose a decision absent from the original request",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    rpc.send('{"id":"remote-init","method":"initialize","params":{}}');
    await rpc.next();
    rpc.send(JSON.stringify({
      id: "approval-trigger-turn",
      method: "turn/start",
      params: { threadId: "fixture-native-thread", input: [{ type: "text", text: "request approval" }] },
    }));
    await rpc.next();
    const request = JSON.parse((await rpc.next()).text);
    const closed = once(rpc.socket, "close");
    rpc.send(JSON.stringify({ id: request.id, result: { decision: "acceptForSession" } }));
    await closed;
    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(frames.some((frame) => frame.id === request.id && frame.result), false);
  },
);

test(
  "approval response with an id not owned by a live server request is never forwarded",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    rpc.send('{"id":"remote-init","method":"initialize","params":{}}');
    await rpc.next();
    rpc.send(JSON.stringify({
      id: "approval-trigger-turn",
      method: "turn/start",
      params: { threadId: "fixture-native-thread", input: [{ type: "text", text: "request approval" }] },
    }));
    await rpc.next();
    const request = JSON.parse((await rpc.next()).text);
    const closed = once(rpc.socket, "close");
    rpc.send(JSON.stringify({ id: "not-the-server-request", result: { decision: "accept" } }));
    await closed;
    const frames = (await readFile(join(f.root, "frames.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(frames.some((frame) => frame.id === request.id && frame.result), false);
    assert.equal(frames.some((frame) => frame.id === "not-the-server-request"), false);
  },
);

test(
  "unknown/unsaved alias, stale profile and arbitrary control arguments cannot spawn SSH",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(control(f, "save", { aliases: ["unknown"] }), {
      code: "SSH_ALIAS_UNAVAILABLE",
    });
    await assert.rejects(control(f, "connect", { alias: "fixture" }), {
      code: "SSH_ALIAS_NOT_SAVED",
    });
    await assert.rejects(
      control(f, "connect", { alias: "fixture", command: "echo unsafe" }),
    );
    await assert.rejects(
      f.manager.save(["fixture"], { ...f.scope, generation: id }),
      { code: "SSH_PROFILE_CHANGED" },
    );
    await assert.rejects(readFile(join(f.root, "argv.json")), {
      code: "ENOENT",
    });
  },
);
test(
  "malformed handshake or SSH authentication exit never publishes connected or stderr",
  { timeout: 4000 },
  async (t) => {
    for (const mode of ["bad", "exit"]) {
      const f = await fixture(t, mode);
      await control(f, "save", { aliases: ["fixture"] });
      const created = await control(f, "connect", { alias: "fixture" });
      const rpc = await openRpc(f, created.connectionId);
      const closing = once(rpc.socket, "close");
      rpc.send(
        '{"id":1,"method":"initialize","params":{"clientInfo":{"name":"fixture","version":"1"}}}',
      );
      await closing;
      const state = await control(f, "refresh");
      assert.equal(state.connections[0].state, "failed");
      assert.equal(
        state.connections[0].reasonCode,
        mode === "bad" ? "SSH_PROTOCOL_INVALID" : "SSH_PROCESS_EXITED",
      );
      assert.doesNotMatch(
        JSON.stringify(state),
        /PRIVATE|authentication|codexHome/,
      );
    }
  },
);
test(
  "a full identity revision revokes the original owned connection and cannot be rebound",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    await control(f, "connect", { alias: "fixture" });
    f.change();
    await assert.rejects(control(f, "refresh"), {
      code: "SSH_PROFILE_CHANGED",
    });
  },
);

test(
  "native SDK may omit initialized notification and still continue from its real initialize reply",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    rpc.send(
      '{"id":21,"method":"initialize","params":{"clientInfo":{"name":"native-no-notify","version":"1"}}}',
    );
    assert.equal(JSON.parse((await rpc.next()).text).id, 21);
    rpc.send('{"id":22,"method":"thread/list","params":{"limit":1}}');
    assert.equal(
      JSON.parse((await rpc.next()).text).result.data[0].id,
      "fixture-native-thread",
    );
    assert.equal(
      (await control(f, "refresh")).connections[0].state,
      "connected",
    );
    const frames = await readFile(join(f.root, "frames.jsonl"), "utf8");
    assert.doesNotMatch(frames, /"method":"initialized"/);
  },
);
test(
  "an unclaimed connection cannot be attached twice or rebound to another owner",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    const created = await control(f, "connect", { alias: "fixture" });
    const rpc = await openRpc(f, created.connectionId);
    t.after(() => rpc.socket.destroy());
    await assert.rejects(
      f.manager.attach(created.connectionId, f.scope, {
        send: async () => {},
        close() {},
      }),
      { code: "SSH_CONNECTION_UNAVAILABLE" },
    );
    await assert.rejects(
      f.manager.attach(
        created.connectionId,
        { id, generation: id },
        { send: async () => {}, close() {} },
      ),
      { code: "SSH_PROFILE_CHANGED" },
    );
  },
);
test(
  "oversized native frames and excess pending replies fail closed inside the original fixed budgets",
  { timeout: 4000 },
  async (t) => {
    for (const which of ["frame", "queue"]) {
      const f = await fixture(t);
      await f.manager.save(["fixture"], f.scope);
      const created = await f.manager.connect("fixture", f.scope);
      const transport = await f.manager.attach(created.connectionId, f.scope, {
        send: async () => {},
        close() {},
      });
      if (which === "frame") transport.write(" ".repeat(2 * 1024 * 1024 + 1));
      else
        for (let i = 0; i < 65; i++)
          transport.write(
            JSON.stringify({
              id: i,
              method: "turn/start",
              params: { input: [] },
            }),
          );
      const state = await f.manager.refresh(f.scope);
      assert.equal(state.connections[0].state, "failed");
      assert.equal(
        state.connections[0].reasonCode,
        which === "frame" ? "SSH_FRAME_LIMIT" : "SSH_QUEUE_LIMIT",
      );
    }
  },
);

test(
  "input queue credits include the frame awaiting its real profile/write guard",
  { timeout: 4000 },
  async (t) => {
    const f = await fixture(t);
    await f.manager.save(["fixture"], f.scope);
    const created = await f.manager.connect("fixture", f.scope);
    let initialized!: () => void;
    const ready = new Promise<void>((r) => {
      initialized = r;
    });
    const transport = await f.manager.attach(created.connectionId, f.scope, {
      send: async () => {
        initialized();
      },
      close() {},
    });
    transport.write(
      '{"id":1,"method":"initialize","params":{"clientInfo":{"name":"fixture","version":"1"}}}',
    );
    await ready;
    const release = f.holdScope();
    for (let i = 0; i < 65; i++)
      transport.write(
        JSON.stringify({
          id: i + 2,
          method: "thread/list",
          params: { limit: 1 },
        }),
      );
    release();
    const status = await f.manager.refresh(f.scope);
    assert.equal(status.connections[0].state, "failed");
    assert.equal(status.connections[0].reasonCode, "SSH_QUEUE_LIMIT");
  },
);

test("every fixed OpenSSH option has exactly one value, with no RemoteCommand override", () => {
  const args = buildChatGptSshConnectionArgs("fixture", "/private/config");
  for (let i = 0; i < args.length; i++)
    if (args[i] === "-o") {
      assert.ok(
        args[i + 1] && !args[i + 1].startsWith("-"),
        `missing option value at ${i}`,
      );
      i++;
    }
  assert.equal(
    args.some((x) => x.startsWith("RemoteCommand=")),
    false,
  );
  assert.deepEqual(args.slice(-2), ["fixture", "exec codex app-server"]);
});

test(
  "version IPC accepts a selected alias only and never accepts a remote command",
  { timeout: 3000 },
  async (t) => {
    const f = await fixture(t);
    await control(f, "save", { aliases: ["fixture"] });
    await assert.rejects(
      control(f, "version", { alias: "fixture", command: "arbitrary" }),
    );
    await assert.rejects(control(f, "version", { alias: "unknown" }), {
      code: "SSH_ALIAS_UNAVAILABLE",
    });
    await assert.rejects(readFile(join(f.root, "argv.json")), {
      code: "ENOENT",
    });
  },
);

test("selected SSH aliases survive a manager restart without restoring connections", async t => {
  const f = await fixture(t);
  await f.manager.save(["fixture"], f.scope);
  const first = await f.manager.connect("fixture", f.scope);
  f.manager.close();
  const file = join(f.root, "runtime", "selected-aliases.json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(saved, {version: 1, profileId: id, generation, aliases: ["fixture"]});
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
  const restarted = f.createManager();
  assert.deepEqual(await restarted.refresh(f.scope), {connections: [{alias: "fixture", state: "disconnected"}]});
  await assert.rejects(readFile(join(f.root, "argv.json")), {code: "ENOENT"});
  const clicked = await restarted.connect("fixture", f.scope);
  assert.equal(clicked.state, "connecting");
  assert.notEqual(clicked.connectionId, first.connectionId);
  await restarted.save([], f.scope);
  restarted.close();
  assert.deepEqual(await f.createManager().refresh(f.scope), {connections: []});
});

test("corrupt, wrong-scope or unsafe selected-alias files fail closed", async t => {
  const f = await fixture(t), file = join(f.root, "runtime", "selected-aliases.json");
  await f.manager.save(["fixture"], f.scope);
  f.manager.close();
  const valid = {version: 1, profileId: id, generation, aliases: ["fixture"]};
  for (const invalid of ["{", JSON.stringify({...valid, profileId: randomUUID()}), JSON.stringify({...valid, generation: randomUUID()}), JSON.stringify({...valid, host: "not-allowed"}), JSON.stringify({...valid, aliases: ["fixture", "fixture"]}), JSON.stringify({...valid, aliases: ["bad alias"]})]) {
    await writeFile(file, invalid, {mode: 0o600});
    const manager = f.createManager();
    await assert.rejects(manager.refresh(f.scope), {code: "SSH_SELECTION_UNAVAILABLE"});
    await assert.rejects(manager.save([], f.scope), {code: "SSH_SELECTION_UNAVAILABLE"});
    manager.close();
  }
  await writeFile(file, JSON.stringify(valid), {mode: 0o600});
  await chmod(file, 0o644);
  await assert.rejects(f.createManager().refresh(f.scope), {code: "SSH_SELECTION_UNAVAILABLE"});
  await chmod(file, 0o600);
  const target = join(f.root, "untouched.json");
  await rename(file, target);
  await symlink(target, file);
  await assert.rejects(f.createManager().save([], f.scope), {code: "SSH_SELECTION_UNAVAILABLE"});
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), valid);
});

test("selection writes reject directory or scope drift without replacing saved aliases", async t => {
  const f = await fixture(t), file = join(f.root, "runtime", "selected-aliases.json");
  await f.manager.save(["fixture"], f.scope);
  const saved = await readFile(file, "utf8");
  f.change();
  await assert.rejects(f.manager.save([], f.scope), {code: "SSH_PROFILE_CHANGED"});
  assert.equal(await readFile(file, "utf8"), saved);
  const restarted = f.createManager();
  await restarted.refresh(f.scope);
  await chmod(join(f.root, "runtime"), 0o755);
  await assert.rejects(restarted.save([], f.scope), {code: "SSH_SELECTION_UNAVAILABLE"});
  assert.equal(await readFile(file, "utf8"), saved);
});
