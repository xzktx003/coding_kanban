import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { EventHub } from "../core/events.js";
import {
  createAcpService,
  registerAcpRoutes,
  type AcpHistory,
} from "./index.js";

const fixture = String.raw`
const readline = require('node:readline'); let n=0, opening=false;
const send=(v)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...v})+'\n');
const reply=(m,result)=>send({id:m.id,result});
const update=(sessionId,text)=>send({method:'session/update',params:{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
let waiters=new Map();
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line),p=m.params||{};
 if(!m.method){const orig=waiters.get(String(m.id)); if(orig){waiters.delete(String(m.id));reply(orig,m.result??{error:m.error})}return;}
 if(m.method==='initialize')return reply(m,{protocolVersion:1,agentCapabilities:{loadSession:true,promptCapabilities:{image:process.env.IMAGES!=='0'}},_meta:{'keke.dev/mcp-policy':process.env.POLICY||'client-only'}});
 if(m.method==='session/new'||m.method==='session/load') {if(opening)return send({id:m.id,error:{code:-1,message:'overlap'}});opening=true;setTimeout(()=>{opening=false;const id=p.sessionId||'s'+(++n); if(p.sessionId)update(id,'replay');reply(m,{sessionId:id,mcpServers:p.mcpServers})},25);return;}
 if(m.method==='session/prompt'){const text=p.prompt.find(x=>x.type==='text')?.text;
  if(text==='huge-permission'){waiters.set('80',m);send({id:80,method:'session/request_permission',params:{sessionId:p.sessionId,options:[{optionId:'x'.repeat(2*1024*1024),kind:'allow_once'}]}});return;}
  if(text==='permission'){waiters.set('77',m);send({id:77,method:'session/request_permission',params:{sessionId:p.sessionId,toolCall:{kind:'read'},options:[{optionId:'yes',kind:'allow_once'},{optionId:'no',kind:'reject_once'}]}});return;}
  if(text==='fs'){waiters.set('78',m);send({id:78,method:'fs/read_text_file',params:{sessionId:p.sessionId,path:process.env.READ_FILE,line:2,limit:1}});return;}
  if(text==='write'){waiters.set('79',m);send({id:79,method:'fs/write_text_file',params:{sessionId:p.sessionId,path:process.env.READ_FILE,content:'modified'}});return;}
  if(text==='wait'){waiters.set(p.sessionId,m);return;}
  update(p.sessionId,'answer');return reply(m,{stopReason:'end_turn',received:p});}
 if(m.method==='session/cancel'){const orig=waiters.get(p.sessionId);if(orig){waiters.delete(p.sessionId);reply(orig,{stopReason:'cancelled'})}return;}
 return reply(m,p);
});`;

function history(): AcpHistory & { updates: Map<string, unknown[]> } {
  const updates = new Map<string, unknown[]>();
  const sessions = new Map<string, any>();
  return {
    updates,
    upsertSession(record) {
      sessions.set(record.sessionId, record);
    },
    appendUpdate(id, value) {
      updates.set(id, [...(updates.get(id) || []), value]);
    },
    setTitleIfEmpty(id, title) {
      const row = sessions.get(id);
      if (row && !row.title) row.title = title;
    },
    listSessions() {
      return [...sessions.values()];
    },
    getUpdates(id) {
      return updates.get(id) || [];
    },
    deleteSession(id) {
      sessions.delete(id);
      updates.delete(id);
    },
  };
}
async function setup(extra: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "ts-acp-"));
  const hub = new EventHub();
  const db = history();
  const service = createAcpService({
    hub,
    dataHome: dir,
    env: { ...process.env, ...extra },
    history: db,
  });
  const custom = {
    id: "fixture",
    name: "Fixture",
    command: process.execPath,
    args: ["-e", fixture, "--"],
    env: extra,
  };
  const start = await service.start({ agent_id: "fixture", cwd: dir, custom });
  return {
    dir,
    hub,
    db,
    service,
    start,
    custom,
    async cleanup() {
      await service.close();
      hub.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("ACP initializes real stdio process, serializes new/load, preserves history and exact sessions", async () => {
  const f = await setup();
  try {
    assert.equal(f.start.sessionId, "s1");
    const [second, loaded] = await Promise.all([
      f.service.newSession(f.start.connectionId, f.dir),
      f.service.loadSession(f.start.connectionId, "s1", f.dir),
    ]);
    assert.equal((second as any).sessionId, "s2");
    assert.equal((loaded as any).sessionId, "s1");
    assert.deepEqual(f.db.getUpdates("s1"), []);
    const result: any = await f.service.prompt(
      f.start.connectionId,
      "s2",
      "hello",
    );
    assert.equal(result.received.sessionId, "s2");
    assert.equal(f.db.getUpdates("s2").length, 2);
    assert.equal((f.db.getUpdates("s2")[0] as any).content.text, "hello");
    await assert.rejects(
      f.service.prompt(f.start.connectionId, "foreign", "oops"),
      /unknown ACP session/,
    );
    const a: any = await f.service.setConfigOption(
      f.start.connectionId,
      "s2",
      "toggle",
      true,
    );
    assert.equal(a.type, "boolean");
    assert.equal(a.value, true);
    const b: any = await f.service.setModel(
      f.start.connectionId,
      "s2",
      "model",
      "high",
    );
    assert.deepEqual(b._meta, { reasoningEffort: "high" });
    const c: any = await f.service.authenticate(f.start.connectionId, "oauth");
    assert.equal(c._meta.persist, false);
  } finally {
    await f.cleanup();
  }
});
test("permission replies validate connection, session and option and can only resolve once", async () => {
  const f = await setup();
  const sub = f.hub.subscribe({ agents: "acp" });
  try {
    const pending = f.service.prompt(f.start.connectionId, "s1", "permission");
    const event = await sub.next();
    assert.equal(event.value.payload.kind, "permission");
    const id = event.value.payload.requestId as string;
    await assert.rejects(
      f.service.respondPermission(f.start.connectionId, id, "invalid"),
      /option/,
    );
    await assert.rejects(
      f.service.respondPermission(f.start.connectionId, id, "yes", "foreign"),
      /session/,
    );
    await f.service.respondPermission(f.start.connectionId, id, "yes", "s1");
    assert.deepEqual(await pending, {
      outcome: { outcome: "selected", optionId: "yes" },
    });
    await assert.rejects(
      f.service.respondPermission(f.start.connectionId, id, "yes"),
      /unknown permission/,
    );
  } finally {
    sub.close();
    await f.cleanup();
  }
});
test("images are signature checked, confined to uploads and negotiated before dispatch", async () => {
  const f = await setup();
  try {
    const uploads = join(f.dir, "uploads");
    await mkdir(uploads);
    const img = join(uploads, "ok.png");
    await writeFile(img, Buffer.from("\x89PNG\r\n\x1a\n", "latin1"));
    const result: any = await f.service.prompt(f.start.connectionId, "s1", "", [
      img,
    ]);
    assert.equal(result.received.prompt[0].mimeType, "image/png");
    const outside = join(f.dir, "outside.png");
    await writeFile(outside, Buffer.from("\x89PNG\r\n\x1a\n", "latin1"));
    await symlink(outside, join(uploads, "escape.png"));
    await assert.rejects(
      f.service.prompt(f.start.connectionId, "s1", "", [
        join(uploads, "escape.png"),
      ]),
      /附件目录/,
    );
    await writeFile(join(uploads, "fake.png"), "fake");
    await assert.rejects(
      f.service.prompt(f.start.connectionId, "s1", "", [
        join(uploads, "fake.png"),
      ]),
      /PNG/,
    );
  } finally {
    await f.cleanup();
  }
  const no = await setup({ IMAGES: "0" });
  try {
    await mkdir(join(no.dir, "uploads"));
    const img = join(no.dir, "uploads", "ok.png");
    await writeFile(img, Buffer.from("\x89PNG\r\n\x1a\n", "latin1"));
    await assert.rejects(
      no.service.prompt(no.start.connectionId, "s1", "", [img]),
      /不支持图片/,
    );
  } finally {
    await no.cleanup();
  }
});
test("cancel targets a session without waiting for its pending prompt; stop owns only its process", async () => {
  const f = await setup();
  try {
    const pending = f.service.prompt(f.start.connectionId, "s1", "wait");
    await new Promise((r) => setTimeout(r, 25));
    await f.service.cancel(f.start.connectionId, "s1");
    assert.deepEqual(await pending, { stopReason: "cancelled" });
    await f.service.stop(f.start.connectionId);
    await assert.rejects(
      f.service.prompt(f.start.connectionId, "s1", "x"),
      /unknown ACP connection/,
    );
  } finally {
    await f.cleanup();
  }
});
test("all ACP HTTP routes run against service and read/delete transcript without process creation", async () => {
  const f = await setup();
  const app = Fastify();
  registerAcpRoutes(app, f.service);
  try {
    const resp = await app.inject({
      method: "POST",
      url: "/api/acp/prompt",
      payload: {
        connection_id: f.start.connectionId,
        session_id: "s1",
        text: "http",
      },
    });
    assert.equal(resp.statusCode, 200);
    const list = await app.inject({
      method: "POST",
      url: "/api/acp/sessions",
      payload: {},
    });
    assert.equal(list.json().length, 1);
    const get = await app.inject({
      method: "POST",
      url: "/api/acp/session",
      payload: { session_id: "s1" },
    });
    assert.equal(get.json().length, 2);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/acp/delete-session",
          payload: { session_id: "s1" },
        })
      ).statusCode,
      200,
    );
    assert.deepEqual(f.db.getUpdates("s1"), []);
  } finally {
    await app.close();
    await f.cleanup();
  }
});

test("strict bot initialization fails closed before sessions and revokes capabilities", async () => {
  const f = await setup();
  let revoked = 0;
  try {
    await assert.rejects(
      f.service.connect({
        agent: { ...f.custom, env: { POLICY: "merge" } },
        cwd: f.dir,
        botId: "bot",
        policy: {
          strictMcp: true,
          onClose() {
            revoked++;
          },
        },
      }),
      /strict MCP isolation/,
    );
    assert.equal(revoked, 1);
    let serial = 0;
    const { client } = await f.service.connect({
      agent: f.custom,
      cwd: f.dir,
      botId: "bot",
      policy: {
        strictMcp: true,
        sessionMcpServers() {
          return [{ name: "x", token: String(++serial) }];
        },
        onClose() {
          revoked++;
        },
      },
    });
    const a: any = await client.newSession(f.dir);
    const b: any = await client.loadSession(a.sessionId, f.dir);
    assert.equal(a.mcpServers[0].token, "1");
    assert.equal(b.mcpServers[0].token, "2");
    await f.service.stop(client.connectionId);
    assert.equal(revoked, 2);
  } finally {
    await f.cleanup();
  }
});
test(
  "unattended runner records blocked permissions and publishes compatible bot activity",
  { timeout: 2000 },
  async () => {
    const f = await setup();
    let revoked = 0;
    const sub = f.hub.subscribe({ agents: "bot" });
    f.service.setBotResolver(async () => ({
      agent: f.custom,
      cwd: f.dir,
      policy: {
        strictMcp: true,
        unattended: { allowAll: false, approvedTools: [], blocked: false },
        onClose() {
          revoked++;
        },
      },
    }));
    try {
      const result = await f.service.runBotUnattended("bot", "permission");
      assert.equal(result.blocked, true);
      assert.equal(revoked, 1);
      const first = await sub.next();
      assert.equal(first.value.event, "bot:activity");
      assert.equal(first.value.payload.status, "working");
      const last = await sub.next();
      assert.equal(last.value.payload.status, "blocked");
    } finally {
      sub.close();
      await f.cleanup();
    }
  },
);
test("unattended readonly client rejects filesystem write and serves read window", async () => {
  const f = await setup();
  const path = join(f.dir, "read.txt");
  await writeFile(path, "first\nsecond\nthird\n");
  try {
    const custom = { ...f.custom, env: { READ_FILE: path } };
    const { client } = await f.service.connect({
      agent: custom,
      cwd: f.dir,
      policy: { readOnly: true },
    });
    await client.newSession(f.dir);
    assert.deepEqual(await client.prompt("s1", "fs"), { content: "second" });
    // Check the real peer's response path directly; this fixture maps error responses to a result envelope.
    let failure: any;
    const peer = new Promise<void>((resolve) => {
      const original = client.rpc.respondError.bind(client.rpc);
      client.rpc.respondError = async (id, code, message) => {
        failure = { id, code, message };
        await original(id, code, message);
        resolve();
      };
    });
    const writing = client.prompt("s1", "write").catch(() => {});
    await peer;
    assert.match(failure.message, /read-only/);
    await client.close();
    await writing;
    assert.equal(
      await import("node:fs/promises").then((fs) => fs.readFile(path, "utf8")),
      "first\nsecond\nthird\n",
    );
  } finally {
    await f.cleanup();
  }
});
test("session mutation timeout forbids silently replaying an ambiguous create", async () => {
  const f = await setup();
  try {
    const silent = {
      ...f.custom,
      args: [
        "-e",
        String.raw`require('node:readline').createInterface({input:process.stdin}).on('line',line=>{let m=JSON.parse(line);if(m.method==='initialize')process.stdout.write(JSON.stringify({id:m.id,result:{}})+'\n')})`,
      ],
    };
    const { client } = await f.service.connect({ agent: silent, cwd: f.dir });
    const request = client.request.bind(client);
    client.request = (method, params) => request(method, params, 20);
    await assert.rejects(client.newSession(f.dir), /DELIVERY_UNKNOWN/);
    await assert.rejects(
      client.newSession(f.dir),
      /explicit stop and reconnect/,
    );
  } finally {
    await f.cleanup();
  }
});

test("pending permission identities have a byte bound independent of replay history", async () => {
  const f = await setup();
  try {
    const result: any = await f.service
      .get(f.start.connectionId)
      .prompt("s1", "huge-permission", [], 250);
    assert.match(result.error.message, /permission.*limit/i);
  } finally {
    await f.cleanup();
  }
});

test("a delayed permission response cannot approve a later turn reusing a native RPC id", async () => {
  const f = await setup();
  const sub = f.hub.subscribe({ agents: "acp" });
  try {
    const first = f.service.prompt(f.start.connectionId, "s1", "permission");
    const firstEvent = await sub.next();
    const oldId = firstEvent.value.payload.requestId as string;
    await f.service.respondPermission(f.start.connectionId, oldId, "no");
    await first;
    const second = f.service.prompt(f.start.connectionId, "s1", "permission");
    void second.catch(() => {});
    const secondEvent = await sub.next();
    const newId = secondEvent.value.payload.requestId as string;
    assert.notEqual(newId, oldId);
    await assert.rejects(
      f.service.respondPermission(f.start.connectionId, oldId, "yes"),
      /unknown permission/,
    );
    await f.service.respondPermission(f.start.connectionId, newId, "no");
    await second;
  } finally {
    sub.close();
    await f.cleanup();
  }
});

test("native process exit releases only the exited connection and keeps another connection usable", async () => {
  const f = await setup();
  try {
    const second = await f.service.start({
      agent_id: "fixture",
      cwd: f.dir,
      custom: f.custom,
    });
    const child = f.service.get(f.start.connectionId).rpc.child;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
    assert.throws(
      () => f.service.get(f.start.connectionId),
      /unknown ACP connection/,
    );
    const result: any = await f.service.prompt(
      second.connectionId,
      "s1",
      "still working",
    );
    assert.equal(result.stopReason, "end_turn");
  } finally {
    await f.cleanup();
  }
});

test("aborting an unattended run stops only its owned process and rejects the running prompt", async () => {
  const f = await setup();
  const controller = new AbortController();
  let revoked = 0;
  f.service.setBotResolver(async () => ({
    agent: f.custom,
    cwd: f.dir,
    policy: {
      strictMcp: true,
      unattended: { allowAll: false, approvedTools: [], blocked: false },
      onClose() {
        revoked++;
      },
    },
  }));
  try {
    await assert.rejects(
      Promise.race([
        f.service.runBotUnattended(
          "bot",
          "wait",
          undefined,
          true,
          () => setTimeout(() => controller.abort(), 25),
          controller.signal,
        ),
        new Promise((_, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("test timed out")),
            1000,
          );
          timeout.unref();
        }),
      ]),
      /closed|aborted/,
    );
    assert.equal(revoked, 1);
    const unaffected: any = await f.service.prompt(
      f.start.connectionId,
      "s1",
      "still working",
    );
    assert.equal(unaffected.stopReason, "end_turn");
  } finally {
    await f.cleanup();
  }
});

test("ACP sessions and raw updates survive a real SQLite restart and reads launch no process", async () => {
  const { SessionDatabase } = await import("../storage/database.js");
  const dir = await mkdtemp(join(tmpdir(), "acp-sqlite-"));
  const dataDir = join(dir, ".codexia");
  const hub = new EventHub();
  let db = new SessionDatabase(dataDir);
  let service = createAcpService({ hub, dataHome: dir, history: db });
  try {
    const start = await service.start({
      agent_id: "fixture",
      cwd: dir,
      custom: {
        id: "fixture",
        name: "Fixture",
        command: process.execPath,
        args: ["-e", fixture, "--"],
      },
    });
    await service.prompt(start.connectionId, start.sessionId!, "persist me");
    await service.close();
    db.close();
    db = new SessionDatabase(dataDir);
    service = createAcpService({ hub, dataHome: dir, history: db });
    const records: any[] = service.listSessions();
    assert.equal(records.length, 1);
    assert.equal(records[0].title, "persist me");
    assert.equal(records[0].agentTitle, "Fixture");
    assert.equal(service.getSession(start.sessionId!).length, 2);
    assert.throws(
      () => service.get(start.connectionId),
      /unknown ACP connection/,
    );
    service.deleteSession(start.sessionId!);
    assert.deepEqual(service.listSessions(), []);
    assert.deepEqual(service.getSession(start.sessionId!), []);
  } finally {
    await service.close();
    db.close();
    hub.close();
    await rm(dir, { recursive: true, force: true });
  }
});
