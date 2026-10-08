import { test } from "node:test";
import assert from "node:assert/strict";
import { CodexFollowups } from "./codex-followups.js";
import type { FollowupSubmit } from "@agent-orchestrator/shared";

function fixture() {
  let status = "active";
  const calls: any[] = [];
  const queue = new CodexFollowups({
    statuses: async () => ({ a: status }),
    call: async (method, params) => {
      calls.push({ method, params });
      return { turn: { id: "sent", status: "inProgress" } };
    },
  });
  const data: FollowupSubmit = { id: "one", threadId: "a", text: "request", images: ["/image.png"], mode: "queue", parameters: { model: "original", effort: "high" }, contexts: [{ id: "ref", kind: "quote", name: "引用的回答", text: "frozen source", sourceThreadId: "a" }] };
  return { queue, calls, data, idle: () => { status = "idle"; } };
}
test("delete undo restores the original position, context and settings without dispatching", async () => {
  const { queue: q, data, calls } = fixture();
  await q.submit(data);let s=await q.submit({...data,id:"two"});
  s=await q.change("a",s.revision,{type:"delete",id:"one"});
  assert.ok(s.undo?.token);
  s=await q.change("a",s.revision,{type:"undo",token:s.undo!.token});
  assert.deepEqual(s.items.map(m=>m.id),["one","two"]);
  assert.equal(s.items[0].status,"queued");
  assert.deepEqual(s.items[0].parameters,data.parameters);
  assert.deepEqual(s.items[0].contexts,data.contexts);
  assert.equal(calls.length,0);
});
test("edit undo cannot resurrect a message accepted by the runtime", async () => {
  const f=fixture(),q=f.queue;let s=await q.submit(f.data);
  s=await q.change("a",s.revision,{type:"edit",id:"one",text:"edited"});
  assert.ok(s.undo?.token);const token=s.undo!.token;
  f.idle();await q.tick();s=await q.get("a");
  await assert.rejects(q.change("a",s.revision,{type:"undo",token}),/发送|撤销/);
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].params.input[0].text.includes("frozen source"),true);
  assert.equal(f.calls[0].params.model,"original");
});
test("undo cannot overwrite a later edit and does not cross thread boundaries", async () => {
  const f=fixture(),q=f.queue;let s=await q.submit(f.data);
  s=await q.change("a",s.revision,{type:"edit",id:"one",text:"first edit"});
  const token=s.undo!.token;
  s=await q.change("a",s.revision,{type:"edit",id:"one",text:"second edit"});
  await assert.rejects(q.change("a",s.revision,{type:"undo",token}));
  await assert.rejects(q.change("b",0,{type:"undo",token:s.undo!.token}));
  assert.equal((await q.get("a")).items[0].text,"second edit");
});
