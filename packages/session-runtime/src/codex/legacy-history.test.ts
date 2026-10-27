import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventHub } from "../core/events.js";
import { object } from "../core/json.js";
import { CodexService } from "./client.js";
import { LegacyHistorySelector } from "./legacy-history.js";
import type { Token } from "stream-json/parser.js";

const source = String.raw`
const fs=require('node:fs'), readline=require('node:readline');
const journal=process.argv[1];
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(!m.method)return;
 fs.appendFileSync(journal,JSON.stringify({pid:process.pid,method:m.method,include:!!(m.params&&m.params.includeTurns)})+'\n');
 if(m.method==='initialize'){send({id:m.id,result:{userAgent:'legacy-history'}});return;}
 if(m.method==='initialized')return;
 if(m.method==='thread/read' && !(m.params&&m.params.includeTurns)){
  send({id:m.id,result:{thread:{id:m.params.threadId,historyMode:'legacy',status:{type:'idle'},turns:[]}}});return;
 }
 if(m.method==='thread/read'){
  const text=m.params.threadId==='small'?'kept':'x'.repeat(33*1024*1024);
  send({id:m.id,result:{thread:{id:m.params.threadId,historyMode:'legacy',turns:[{id:'old',status:'completed',items:[{type:'agentMessage',text}]}]}}});return;
 }
 if(m.method==='model/list'){send({id:m.id,result:{pid:process.pid}});return;}
 send({id:m.id,error:{code:-32601,message:'Method not found'}});
});`;

test("legacy history rejects an oversized scalar before retaining its full body", () => {
  const selector = new LegacyHistorySelector(() => {}, () => {}, {
    maxBytes: 8,
  });
  const token = (name: string, value?: string) =>
    ({ name, ...(value === undefined ? {} : { value }) }) as Token;
  selector.consume(token("startObject"));
  selector.consume(token("startKey"));
  selector.consume(token("stringChunk", "field"));
  selector.consume(token("endKey"));
  selector.consume(token("startString"));
  assert.throws(
    () => selector.consume(token("stringChunk", "x".repeat(9))),
    /HISTORY_LIMIT_EXCEEDED: byte limit 8/,
  );
});

test("a legacy transcript larger than one shared frame is read by another process and the live agent survives", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "legacy-history-"));
  const journal = join(root, "requests.jsonl");
  const hub = new EventHub();
  const service = new CodexService({
    hub,
    instance: "legacy-history",
    sweepIntervalMs: 0,
    launch: { command: process.execPath, args: ["-e", source, journal] },
  });
  t.after(async () => {
    await service.close();
    hub.close();
    await rm(root, { recursive: true, force: true });
  });
  const before = object(await service.raw("model/list", {}));
  await assert.rejects(
    service.readHistory("thread"),
    /HISTORY_LIMIT_EXCEEDED/,
  );
  const after = object(await service.raw("model/list", {}));
  assert.equal(after.pid, before.pid);
  const small = object(object(await service.readHistory("small")).thread);
  assert.equal(object((small.turns as { items: { text: string }[] }[])[0].items[0]).text, "kept");
  const calls = (await readFile(journal, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const shared = calls.filter((call) => call.pid === before.pid);
  assert.ok(shared.every((call) => call.method !== "thread/read" || call.include === false));
  assert.ok(calls.some((call) => call.pid !== before.pid && call.method === "thread/read" && call.include === true));
});
