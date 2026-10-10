import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexHostOwnerResolver } from "./codex-host-owner.js";

test("host owner is read-only verified against native thread and captured draft identity", async () => {
  const home = await mkdtemp(join(tmpdir(), "kanban-owner-"));
  const cwd = join(home, "project"), alias = join(home, "alias");
  await mkdir(cwd); await symlink(cwd, alias);
  const requests: Array<{ url: string; body: unknown }> = [];
  const resolver = createCodexHostOwnerResolver({
    origin: () => "http://127.0.0.1:1", projects: async () => [],
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json({ thread: { id: "thread-a", cwd, turns: [] } });
    },
  });
  const owner = { cwd: alias, threadId: "thread-a", draftOwner: JSON.stringify(["codex", "", "session", "thread-a"]) };
  try {
    assert.equal(await resolver.resolve(owner), cwd);
    assert.deepEqual(requests, [{ url: "http://127.0.0.1:1/api/codex/thread/metadata", body: { threadId: "thread-a" } }]);
    for (const draftOwner of [JSON.stringify(["cc", "", "session", "thread-a"]), JSON.stringify(["codex", "", "session", "thread-b"]), JSON.stringify(["codex", "wrong-agent", "session", "thread-a"]), "[]", "invalid"]) {
      await assert.rejects(resolver.resolve({ ...owner, draftOwner }), /草稿|身份/);
    }
    await assert.rejects(resolver.resolve({ ...owner, cwd: home }), /项目/);
    assert.equal(requests.every((r) => r.url.endsWith("/thread/metadata")), true);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("metadata falls back only for missing capabilities; full cloud history remains an explicit separate read", async () => {
  const home = await mkdtemp(join(tmpdir(), "kanban-owner-capability-"));
  const owner = {cwd:home,threadId:"thread-a",draftOwner:JSON.stringify(["codex","","session","thread-a"])};
  const calls: string[] = [];
  const resolver = createCodexHostOwnerResolver({origin:()=>"http://127.0.0.1:1",projects:async()=>[],fetch:async url=>{
    const path=new URL(String(url)).pathname; calls.push(path);
    return path.endsWith("metadata")? new Response("not available",{status:404}):Response.json({thread:{id:"thread-a",cwd:home,turns:[]}});
  }});
  try {
    await resolver.resolve(owner);
    assert.deepEqual(calls,["/api/codex/thread/metadata","/api/codex/thread/read"]);
    calls.length=0; await resolver.readThread("thread-a");
    assert.deepEqual(calls,["/api/codex/thread/read"]);
    const offlineCalls:string[]=[];
    const offline=createCodexHostOwnerResolver({origin:()=>"http://127.0.0.1:1",projects:async()=>[],fetch:async url=>{offlineCalls.push(String(url));return new Response("offline",{status:503});}});
    await assert.rejects(offline.resolve(owner),/核验/);
    assert.equal(offlineCalls.length,1);
    assert.match(offlineCalls[0],/metadata$/);
  } finally {await rm(home,{recursive:true,force:true});}
});

test("new draft requires an exact registered project; no arbitrary path or descendant access", async () => {
  const home = await mkdtemp(join(tmpdir(), "kanban-new-owner-"));
  const cwd = join(home, "project"), sub = join(cwd, "sub"), alias = join(home, "alias");
  await mkdir(sub, { recursive: true }); await symlink(cwd, alias);
  const resolver = createCodexHostOwnerResolver({ origin: () => null, projects: async () => [alias], fetch: async () => { throw new Error("must not read native history for new draft"); } });
  const owner = (path: string) => ({ cwd: path, threadId: null, draftOwner: JSON.stringify(["codex", "", "new", path]) });
  try {
    assert.equal(await resolver.resolve(owner(cwd)), cwd);
    assert.equal(await resolver.resolve(owner(alias)), cwd);
    assert.equal(await resolver.resolve({ ...owner(cwd), draftOwner: owner(alias).draftOwner }), cwd);
    await assert.rejects(resolver.resolve(owner(sub)), /注册|项目/);
    await assert.rejects(resolver.resolve(owner(home)), /注册|项目/);
    await assert.rejects(resolver.resolve({ ...owner(cwd), draftOwner: JSON.stringify(["codex", "", "new", sub]) }), /草稿|身份/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("unavailable or mismatched native identity never grants host authority", async () => {
  const home = await mkdtemp(join(tmpdir(), "kanban-stale-owner-"));
  const owner = { cwd: home, threadId: "thread-a", draftOwner: JSON.stringify(["codex", "", "session", "thread-a"]) };
  try {
    for (const response of [Response.json({ thread: { id: "thread-b", cwd: home } }), Response.json({ thread: { id: "thread-a", cwd: "/missing-project" } }), new Response("offline", { status: 503 })]) {
      const resolver = createCodexHostOwnerResolver({ origin: () => "http://127.0.0.1:1", projects: async () => [], fetch: async () => response });
      await assert.rejects(resolver.resolve(owner), /身份|项目|核验/);
    }
    const offline = createCodexHostOwnerResolver({ origin: () => null, projects: async () => [] });
    await assert.rejects(offline.resolve(owner), /连接|核验/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
