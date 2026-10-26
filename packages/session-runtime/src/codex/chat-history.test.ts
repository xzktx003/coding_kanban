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
