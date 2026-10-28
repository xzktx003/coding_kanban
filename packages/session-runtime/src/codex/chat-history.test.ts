import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import * as channel from "./item-detail-channel.js";
import { readNativeProjection } from "./item-detail.js";
import { ChatHistorySelector } from "./chat-history.js";

const script = String.raw`
const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});
const send=v=>process.stdout.write(JSON.stringify(v)+'\n');
rl.on('line',line=>{const q=JSON.parse(line);fs.appendFileSync(process.argv[1],q.method+'\n');
 if(q.method==='initialize')return send({id:q.id,result:{}});
 if(q.method==='initialized')return;
 if(q.method!=='thread/turns/list')process.exit(99);
 if(q.params.threadId==='wrong-id')return send({id:999,result:{data:[]}});
 if(q.params.threadId==='duplicate-id')return process.stdout.write('{\"id\":2,\"id\":2,\"result\":{\"data\":[]}}\n');
 if(q.params.threadId==='truncated'){process.stdout.write('{\"id\":2,\"result\":');process.exit(0);}
 if(q.params.threadId==='unknown')return send({id:q.id,error:{code:-32601,message:'unsupported'}});
 const output='x'.repeat(40*1024*1024);
 send({id:q.id,result:{data:[{id:'turn',itemsView:'full',status:'completed',items:[
 ...(q.params.threadId==='dense'?Array.from({length:12000},(_,i)=>({type:'commandExecution',id:'dense-'+i,command:'c'.repeat(900),status:'completed',aggregatedOutput:'ignored'})):[]),
 {type:'userMessage',id:'user',content:[{type:'text',text:'preserve user text'}]},
 {type:'commandExecution',id:'tool',command:'fixture-never-execute',status:'completed',aggregatedOutput:output,exitCode:0},
 {type:'agentMessage',id:'answer',text:q.params.threadId==='oversized-message'?output:'preserve final answer',phase:'final_answer'},
 {type:'collabAgentToolCall',id:'subagent',receiverThreadIds:['child'],status:'completed',agentsStates:{child:{status:'completed',message:'done'}}}
 ]}],nextCursor:'next-page',backwardsCursor:null}});
});rl.on('close',()=>process.exit(0));`;

test("large chat history uses only an independent read, preserves messages/cursors/children and discards tool output before buffering", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "chat-history-"));
  const journal = join(root, "methods");
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const register = (
    channel as unknown as {
      registerChatHistoryChannel: (
        app: ReturnType<typeof Fastify>,
        options: unknown,
      ) => void;
    }
  ).registerChatHistoryChannel;
  assert.equal(typeof register, "function");
  register(app, {
    launch: { command: process.execPath, args: ["-e", script, journal] },
  });
  const result = await app.inject({
    method: "POST",
    url: "/api/codex/thread/turns/list?view=chat",
    payload: {
      threadId: "thread",
      cursor: null,
      limit: 10,
      sortDirection: "desc",
      itemsView: "full",
    },
  });
  assert.equal(result.statusCode, 200, result.body);
  const value = result.json();
  assert.equal(value.data[0].items[0].content[0].text, "preserve user text");
  assert.equal(value.data[0].items[1].aggregatedOutput, null);
  assert.equal(value.data[0].items[1].transcriptMetadataOnly, true);
  assert.equal(value.data[0].items[2].text, "preserve final answer");
  assert.deepEqual(value.data[0].items[3].receiverThreadIds, ["child"]);
  assert.equal(value.nextCursor, "next-page");
  assert.ok(result.body.length < 2048);
  assert.deepEqual((await readFile(journal, "utf8")).trim().split("\n"), [
    "initialize",
    "initialized",
    "thread/turns/list",
  ]);
  const invalid = await app.inject({
    method: "POST",
    url: "/api/codex/thread/turns/list?view=chat",
    payload: { threadId: "thread", command: "unsafe" },
  });
  assert.equal(invalid.statusCode, 400);
  const oversized = await app.inject({
    method: "POST",
    url: "/api/codex/thread/turns/list?view=chat",
    payload: { threadId: "oversized-message", limit: 1, itemsView: "full" },
  });
  assert.equal(oversized.statusCode, 413);
  assert.match(oversized.body, /CHAT_HISTORY_LIMIT_EXCEEDED/);
  const unsupported = await app.inject({
    method: "POST",
    url: "/api/codex/thread/turns/list?view=chat",
    payload: { threadId: "unknown", limit: 1 },
  });
  assert.equal(unsupported.statusCode, 501);
  for (const threadId of ["wrong-id", "duplicate-id", "truncated"]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/codex/thread/turns/list?view=chat",
      payload: { threadId, limit: 1 },
    });
    assert.equal(response.statusCode, 502, threadId);
    assert.match(response.body, /PROTOCOL_ERROR/);
  }
});

test("dense projected tool rows retain bounded bytes with transport backpressure and release their owned native reader", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "chat-history-dense-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const read = await readNativeProjection(
    {
      launch: {
        command: process.execPath,
        args: ["-e", script, join(root, "methods")],
      },
    },
    {
      channel: "chat",
      method: "thread/turns/list",
      params: { threadId: "dense", limit: 10 },
      selector: (initialized, ready) =>
        new ChatHistorySelector(initialized, ready),
    },
    new AbortController().signal,
  );
  // Let the native stream meet a paused downstream before draining it.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const chunks: Buffer[] = [];
  for await (const chunk of read.body) chunks.push(chunk);
  await read.finished;
  const body = Buffer.concat(chunks);
  const value = JSON.parse(body.toString());
  assert.equal(value.data[0].items.length, 12004);
  assert.equal(value.data[0].items[12002].text, "preserve final answer");
  assert.ok(read.metrics.inputBytes > 40 * 1024 * 1024);
  assert.ok(body.length < 16 * 1024 * 1024);
  assert.ok(read.metrics.maxInputChunk <= 4096);
  assert.ok(read.metrics.maxParserQueue <= 16);
  assert.ok(read.metrics.maxOutputQueue <= 65536);
  assert.equal(read.metrics.childExited, true);
  console.log("CHAT_HISTORY_METRICS", JSON.stringify(read.metrics));
});

const runningHistoryScript = String.raw`
const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const q=JSON.parse(line);fs.appendFileSync(process.argv[1],q.method+'\n');
 if(q.method==='initialize')return console.log(JSON.stringify({id:q.id,result:{}}));
 if(q.method==='initialized')return;
 if(q.method!=='thread/turns/list')process.exit(99);
 console.log(JSON.stringify({id:q.id,result:{data:[
 {id:'turn-live',status:'interrupted',startedAt:1,completedAt:2,durationMs:1000,items:[
 {type:'commandExecution',id:'tool',status:'completed',aggregatedOutput:'x'.repeat(20*1024*1024)},
 {type:'agentMessage',id:'answer',text:'keep assistant text',phase:'commentary',nested:{id:'turn-live',status:'interrupted',completedAt:2}}
 ]},
 {id:'turn-old',status:'interrupted',startedAt:3,completedAt:4,durationMs:1000,items:[]}
 ],nextCursor:'same-cursor'}}));
});rl.on('close',()=>process.exit(0));`;

async function currentTurnFixture(
  t: { after(fn: () => Promise<void>): void },
  readCurrentTurn?: any,
) {
  const root = await mkdtemp(join(tmpdir(), "chat-history-live-state-"));
  const journal = join(root, "methods");
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const register = channel.registerChatHistoryChannel as any;
  register(
    app,
    {
      launch: {
        command: process.execPath,
        args: ["-e", runningHistoryScript, journal],
      },
    },
    "/api/codex/thread/turns/list",
    undefined,
    readCurrentTurn,
  );
  return {
    app,
    journal,
    send: () =>
      app.inject({
        method: "POST",
        url: "/api/codex/thread/turns/list?view=chat",
        payload: { threadId: "thread-live", itemsView: "full" },
      }),
  };
}

test("current owner execution state replaces only the exact direct turn while large tool bodies stay clipped", async (t) => {
  const calls: string[] = [];
  const f = await currentTurnFixture(
    t,
    async (threadId: string, signal: AbortSignal) => {
      calls.push(threadId);
      assert.equal(signal.aborted, false);
      return {
        id: "turn-live",
        status: "inProgress",
        startedAt: 9,
        completedAt: null,
        durationMs: null,
        items: [{ text: "must not replace items" }],
        unsafeField: "must not copy",
      };
    },
  );
  const response = await f.send();
  assert.equal(response.statusCode, 200, response.body);
  const value = response.json();
  assert.equal(value.data[0].status, "inProgress");
  assert.equal(value.data[0].startedAt, 9);
  assert.equal(value.data[0].completedAt, null);
  assert.equal(value.data[0].durationMs, null);
  assert.equal(value.data[0].unsafeField, undefined);
  assert.equal(value.data[0].items[0].aggregatedOutput, null);
  assert.equal(value.data[0].items[0].transcriptMetadataOnly, true);
  assert.equal(value.data[0].items[1].text, "keep assistant text");
  assert.deepEqual(value.data[0].items[1].nested, {
    id: "turn-live",
    status: "interrupted",
    completedAt: 2,
  });
  assert.deepEqual(value.data[1], {
    id: "turn-old",
    status: "interrupted",
    startedAt: 3,
    completedAt: 4,
    durationMs: 1000,
    items: [],
  });
  assert.equal(value.nextCursor, "same-cursor");
  assert.ok(response.body.length < 2048);
  assert.deepEqual(calls, ["thread-live"]);
  assert.deepEqual((await readFile(f.journal, "utf8")).trim().split("\n"), [
    "initialize",
    "initialized",
    "thread/turns/list",
  ]);
});

test("a running execution snapshot without completion timing clears reconstructed terminal timestamps", async (t) => {
  const f = await currentTurnFixture(t, async () => ({
    id: "turn-live",
    status: "inProgress",
  }));
  const response = await f.send();
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data[0].status, "inProgress");
  assert.equal(response.json().data[0].completedAt, null);
  assert.equal(response.json().data[0].durationMs, null);
});

test("an owner snapshot for a different turn cannot replace historical execution state", async (t) => {
  const f = await currentTurnFixture(t, async () => ({
    id: "not-in-page",
    status: "inProgress",
  }));
  const response = await f.send();
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data[0].status, "interrupted");
  assert.equal(response.json().data[1].status, "interrupted");
});

test("execution lookup failure does not fall back to reconstructed interrupted history", async (t) => {
  const f = await currentTurnFixture(t, async () => {
    throw new Error("owner lookup unavailable");
  });
  const response = await f.send();
  assert.equal(response.statusCode, 502, response.body);
  await assert.rejects(readFile(f.journal), { code: "ENOENT" });
});

test("metadata-only chat history delegates to the provided owner fallback without a reader", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let calls = 0,
    snapshots = 0;
  (channel.registerChatHistoryChannel as any)(
    app,
    { launch: { command: "must-not-spawn", args: [] } },
    "/api/codex/thread/turns/list",
    (request: any, reply: any) => {
      calls++;
      return reply.code(202).send({ ownerMetadata: true, body: request.body });
    },
    async () => {
      snapshots++;
      throw new Error("metadata fallback must own this read");
    },
  );
  const response = await app.inject({
    method: "POST",
    url: "/api/codex/thread/turns/list?view=chat",
    payload: { threadId: "thread-live", itemsView: "notLoaded" },
  });
  assert.equal(response.statusCode, 202, response.body);
  assert.deepEqual(response.json(), {
    ownerMetadata: true,
    body: { threadId: "thread-live", itemsView: "notLoaded" },
  });
  assert.equal(calls, 1);
  assert.equal(snapshots, 0);
});

test("invalid current execution metadata fails before opening an independent reader", async (t) => {
  const f = await currentTurnFixture(t, async () => ({
    id: "turn-live",
    status: "inProgress",
    durationMs: "not-a-timestamp",
  }));
  const response = await f.send();
  assert.equal(response.statusCode, 502, response.body);
  assert.match(response.body, /INVALID_EXECUTION_STATE/);
  await assert.rejects(readFile(f.journal), { code: "ENOENT" });
});

test("shutdown cancels a pending owner snapshot before starting its independent reader", async (t) => {
  let entered!: () => void;
  const called = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let signal!: AbortSignal;
  const f = await currentTurnFixture(
    t,
    async (_threadId: string, currentSignal: AbortSignal) => {
      signal = currentSignal;
      entered();
      return new Promise(() => {}); // Even an uncooperative callback cannot block close.
    },
  );
  const reading = f.send();
  await called;
  await f.app.close();
  assert.equal(signal.aborted, true);
  const response = await reading;
  assert.equal(response.statusCode, 502, response.body);
  assert.match(response.body, /CANCELLED/);
  await assert.rejects(readFile(f.journal), { code: "ENOENT" });
});

test("local registration threads its fourth callback and keeps explicit environment isolated", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "chat-history-local-snapshot-"));
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  let calls = 0;
  channel.registerLocalChatHistoryChannel(
    app,
    root,
    undefined,
    async (threadId, signal) => {
      calls++;
      assert.equal(threadId, "thread-live");
      assert.equal(signal.aborted, false);
      throw new Error("fixture owner check unavailable");
    },
    {
      HOME: root,
      CODEX_HOME: root,
      CODEX_PATH: join(root, "must-not-exist"),
      PATH: "",
    },
  );
  const response = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/thread/turns/list?view=chat",
    payload: { threadId: "thread-live" },
  });
  assert.equal(response.statusCode, 502, response.body);
  assert.equal(calls, 1);
});
