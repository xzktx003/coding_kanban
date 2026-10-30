import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionDatabase } from "./database.js";
import { RECENT_HISTORY_PAGE_BYTES } from "../core/recent-history.js";

test("escaped tool fields keep a genuine recent page and explicit detail instead of silently hiding history",async()=>{
  const home=await mkdtemp(join(tmpdir(),"acp-escaped-recent-")),db=new SessionDatabase(home);
  try{
    db.upsertSession({sessionId:"escaped",agentId:"fixture",cwd:home});
    db.appendUpdate("escaped",{sessionUpdate:"user_message_chunk",content:{type:"text",text:"retain the question"}});
    const body="\0".repeat(65536),tool:Record<string,unknown>={sessionUpdate:"tool_call",toolCallId:"escaped-tool",status:"completed"};
    for(const key of ["title","content","locations","rawInput","rawOutput"])tool[key]=body;
    db.appendUpdate("escaped",tool);
    const page=await db.getRecentUpdates("escaped");
    assert.equal(page.data.length,2);
    assert.equal(page.data[0].text,"retain the question");
    assert.equal(page.data[1].role,"tool");assert.equal(page.data[1].truncated,true);
    assert.deepEqual(page.data[1].historyDetail,{itemId:page.data[1].id});
    assert.ok(Buffer.byteLength(JSON.stringify(page))<RECENT_HISTORY_PAGE_BYTES);
    const detail=db.getUpdateDetail("escaped",page.data[1].id,{offset:0,limit:65536});
    assert.ok(detail.nextOffset);assert.ok(detail.text.includes("escaped-tool"));
  }finally{db.close();await rm(home,{recursive:true,force:true});}
});

test("an existing oversized projection row remains reachable with a forward cursor and its original tool detail",async()=>{
  const home=await mkdtemp(join(tmpdir(),"acp-existing-oversize-")),db=new SessionDatabase(home);
  try{
    db.upsertSession({sessionId:"existing",agentId:"fixture",cwd:home});
    db.appendUpdate("existing",{sessionUpdate:"user_message_chunk",content:{type:"text",text:"older question"}});
    const sourceId=db.appendUpdate("existing",{sessionUpdate:"tool_call",toolCallId:"existing-tool",title:"exact original tool",rawOutput:"original output",status:"completed"});
    const original=await db.getRecentUpdates("existing"),tool=original.data[1];
    db.db.prepare("UPDATE acp_chat_projection_v1 SET payload=? WHERE session_id=? AND entry_id=?").run(JSON.stringify({...tool,rawOutput:"\0".repeat(400000)}),"existing",tool.id);
    const page=await db.getRecentUpdates("existing",{limit:1});
    assert.equal(page.data.length,1);assert.ok(page.nextCursor);assert.equal(page.data[0].id,tool.id);
    assert.equal(page.data[0].historySourceId,sourceId);assert.equal(page.data[0].truncated,true);
    assert.deepEqual(page.data[0].historyDetail,{itemId:tool.id});
    assert.ok(Buffer.byteLength(JSON.stringify(page))<RECENT_HISTORY_PAGE_BYTES);
    const detail=db.getUpdateDetail("existing",tool.id,{offset:0,limit:65536});assert.match(detail.text,/exact original tool/);assert.match(detail.text,/original output/);
    const older=await db.getRecentUpdates("existing",{cursor:page.nextCursor!});assert.equal(older.data[0].text,"older question");assert.equal(older.nextCursor,null);
  }finally{db.close();await rm(home,{recursive:true,force:true});}
});

test("ACP recent pages coalesce complete chunk/tool baselines, preserve stable IDs and never load a native session", async () => {
  const home = await mkdtemp(join(tmpdir(),"acp-recent-"));
  const db = new SessionDatabase(home);
  try {
    db.upsertSession({sessionId:"one",agentId:"fixture",cwd:home});
    db.appendUpdate("one",{sessionUpdate:"user_message_chunk",content:{type:"text",text:"question"}});
    for (let n=0;n<100;n++) db.appendUpdate("one",{sessionUpdate:"agent_message_chunk",content:{type:"text",text:`part${n}|`}});
    db.appendUpdate("one",{sessionUpdate:"tool_call",toolCallId:"tool-1",title:"read exact source",kind:"read",status:"pending",rawInput:{path:"/source"}});
    db.appendUpdate("one",{sessionUpdate:"tool_call_update",toolCallId:"tool-1",status:"completed",content:[{type:"content",content:{type:"text",text:"complete result"}}]});
    db.appendUpdate("one",{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"final"}});
    const page = await db.getRecentUpdates("one",{limit:2});
    assert.deepEqual(page.data.map(row=>row.role),["tool","agent"]);
    assert.equal(page.data[0].title,"read exact source");
    assert.deepEqual(page.data[0].rawInput,{path:"/source"});
    assert.equal(page.data[0].status,"completed");
    assert.equal(page.data[1].text,"final");
    assert.ok(page.nextCursor);
    const older = await db.getRecentUpdates("one",{cursor:page.nextCursor!,limit:2});
    assert.deepEqual(older.data.map(row=>row.role),["user","agent"]);
    assert.equal(older.data[1].text,Array.from({length:100},(_,n)=>`part${n}|`).join(""));
    assert.equal(older.nextCursor,null);
    assert.deepEqual((await db.getRecentUpdates("one",{limit:2})).data,page.data);
    await assert.rejects(db.getRecentUpdates("other",{cursor:page.nextCursor!}),/does not belong/);
    const revision = (await db.getRecentUpdates("one",{metadataOnly:true})).revision;
    db.appendUpdate("one",{sessionUpdate:"current_mode_update",currentModeId:"plan"});
    const probe = await db.getRecentUpdates("one",{metadataOnly:true});
    assert.deepEqual(probe.data,[]); assert.notEqual(probe.revision,revision);
    assert.equal((await db.getRecentUpdates("one")).metadata?.currentModeId,"plan");
  } finally { db.close(); await rm(home,{recursive:true,force:true}); }
});
test("ACP arbitrarily long text has bounded genuine earlier pages; large tool body has an explicit bounded detail reader", async () => {
  const home = await mkdtemp(join(tmpdir(),"acp-long-recent-"));
  const db = new SessionDatabase(home);
  try {
    db.upsertSession({sessionId:"long",agentId:"fixture",cwd:home});
    const long = "回答🧪".repeat(350_000);
    db.appendUpdate("long",{sessionUpdate:"agent_message_chunk",content:{type:"text",text:long}});
    let cursor: string|undefined; const pages: string[] = [];
    do {
      const page = await db.getRecentUpdates("long",{cursor,limit:256});
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < RECENT_HISTORY_PAGE_BYTES);
      pages.unshift(page.data.map(row=>row.text ?? "").join(""));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(pages.join(""),long);
    db.appendUpdate("long",{sessionUpdate:"tool_call",toolCallId:"big",title:"large output",rawOutput:"x".repeat(3*1024*1024),status:"completed"});
    const page = await db.getRecentUpdates("long",{limit:1});
    assert.equal(page.truncated,true);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < RECENT_HISTORY_PAGE_BYTES);
    const detail = db.getUpdateDetail("long",page.data[0].id,{offset:0,limit:65536});
    assert.match(detail.text,/large output/); assert.ok(detail.nextOffset);
    assert.ok(Buffer.byteLength(JSON.stringify(detail)) < 65536);
    db.deleteSession("long");
    assert.equal((await db.getRecentUpdates("long")).data.length,0);
  } finally { db.close(); await rm(home,{recursive:true,force:true}); }
});
