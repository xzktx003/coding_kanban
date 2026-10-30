import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import Fastify from "fastify";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventHub } from "../core/events.js";
import { SessionDatabase } from "../storage/database.js";
import { createAcpService, registerAcpRoutes } from "./index.js";
const fixture = String.raw`
const rl=require('node:readline');const fs=require('node:fs');const send=v=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...v})+'\n');let pending;
rl.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(process.env.TRACE_FILE)fs.appendFileSync(process.env.TRACE_FILE,JSON.stringify(m.method||('reply:'+m.id))+'\n');
 if(!m.method){if(m.id===707&&pending){send({id:pending.id,result:{stopReason:'end_turn'}});pending=undefined;}return;}
 if(m.method==='initialize')return send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
 if(m.method==='session/new')return send({id:m.id,result:{sessionId:'source:one',modes:{currentModeId:'code',availableModes:[{id:'code',name:'Code'},{id:'plan',name:'Plan'}]},models:{currentModelId:'a',availableModels:[{modelId:'a',name:'A'},{modelId:'b',name:'B'}]},configOptions:[{id:'effort',name:'Effort',type:'select',currentValue:'high',options:[{value:'low',name:'Low'},{value:'high',name:'High'}]}]}});
 if(m.method==='session/prompt'&&m.params.prompt[0].text==='permission'){pending=m;send({id:707,method:'session/request_permission',params:{sessionId:'source:one',toolCall:{toolCallId:'approve-tool',title:'Read fixture',kind:'read'},options:[{optionId:'yes',name:'Allow once',kind:'allow_once'},{optionId:'no',name:'Reject',kind:'reject_once'}]}});return;}
 if(m.method==='session/prompt'){for(const text of ['first ','second'])send({method:'session/update',params:{sessionId:'source:one',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});return send({id:m.id,result:{stopReason:'end_turn',received:m.params}});}
 send({id:m.id,result:{}});
});`;
test("ACP live envelopes and readonly projection share actual persistent source IDs and snapshot boundary", async () => {
  const home = await mkdtemp(join(tmpdir(), "acp-source-")),
    db = new SessionDatabase(home),
    hub = new EventHub();
  const service = createAcpService({
    hub,
    dataHome: home,
    history: db,
    env: { ...process.env, HOME: home, TRACE_FILE: join(home, "rpc.log") },
  });
  const subscription = hub.subscribe({ agents: "acp", since: 0 });
  try {
    const start = await service.start({
      agent_id: "fixture",
      cwd: home,
      custom: {
        id: "fixture",
        name: "Fixture",
        command: process.execPath,
        args: ["-e", fixture, "--"],
      },
    });
    assert.equal(start.sessionId, "source:one");
    const result = (await service.prompt(
      start.connectionId,
      start.sessionId!,
      "question",
      [],
      "submission-1",
    )) as any;
    assert.equal(result.received.clientMessageId, undefined);
    assert.equal(result.received.client_message_id, undefined);
    const updates = [];
    let persisted: any;
    while (updates.length < 2) {
      const next = await subscription.next();
      assert.equal(next.done, false);
      const payload = next.value!.payload as any;
      if (payload.kind === "update") updates.push(payload);
      if (payload.kind === "prompt-persisted") persisted = payload;
    }
    assert.equal(persisted?.clientMessageId, "submission-1");
    assert.equal(persisted?.connectionId, start.connectionId);
    assert.equal(persisted?.sessionId, "source:one");
    assert.equal(persisted?.historySessionId, start.historySessionId);
    assert.equal(updates[0].historySessionId, start.historySessionId);
    assert.equal(updates[1].runtimeInstance, start.runtimeInstance);
    assert.deepEqual(persisted?.sourceRows, [
      { historySourceId: persisted?.historySourceId, partIndex: 0 },
    ]);
    assert.ok(Number.isSafeInteger(updates[0].historySourceId));
    assert.ok(updates[1].historySourceId > updates[0].historySourceId);
    const page = await db.getRecentUpdates(start.historySessionId!);
    assert.equal(page.data[0].clientMessageId, "submission-1");
    assert.equal(page.data[0].partIndex, 0);
    assert.equal(page.data[0].historySourceId, persisted.historySourceId);
    assert.equal(page.data[1].id, `acp-${updates[0].historySourceId}-0`);
    assert.equal(page.data[1].historySourceId, updates[1].historySourceId);
    assert.equal(page.data[1].text, "first second");
    assert.equal(page.metadata?.historySourceId, updates[1].historySourceId);
    const beforeRaw = JSON.stringify(db.getUpdates(start.historySessionId!));
    const beforeRpc = await readFile(join(home, "rpc.log"), "utf8");
    const snapshot = service.connectionSnapshot(
      start.connectionId,
      start.sessionId!,
      start.runtimeInstance!,
    );
    assert.equal(snapshot.sessionId, "source:one");
    assert.equal(snapshot.cwd, home);
    assert.equal(snapshot.running, false);
    assert.equal(snapshot.runtimeInstance, start.runtimeInstance);
    assert.equal(snapshot.agentId, "fixture");
    assert.equal(
      JSON.stringify(db.getUpdates(start.historySessionId!)),
      beforeRaw,
    );
    assert.equal(await readFile(join(home, "rpc.log"), "utf8"), beforeRpc);
    assert.throws(
      () =>
        service.connectionSnapshot(
          start.connectionId,
          start.sessionId!,
          "previous-runtime",
        ),
      /runtime.*changed/i,
    );
    assert.throws(
      () =>
        service.connectionSnapshot(
          start.connectionId,
          "different-session",
          start.runtimeInstance!,
        ),
      /unknown ACP session/,
    );
    const app = Fastify();
    registerAcpRoutes(app, service);
    try {
      const body = {
        connection_id: start.connectionId,
        session_id: start.sessionId,
        expected_runtime_instance: start.runtimeInstance,
      };
      const response = await app.inject({
        method: "POST",
        url: "/api/acp/connection-snapshot",
        payload: body,
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().sessionId, start.sessionId);
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/acp/connection-snapshot",
            payload: { ...body, expected_runtime_instance: "stale" },
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/acp/connection-snapshot",
            payload: { ...body, connection_id: "another" },
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/acp/connection-snapshot",
            payload: { ...body, session_id: "other" },
          })
        ).statusCode,
        409,
      );
      assert.equal(await readFile(join(home, "rpc.log"), "utf8"), beforeRpc);
    } finally {
      await app.close();
    }
    await service.setMode(start.connectionId, start.sessionId!, "plan");
    await service.setModel(start.connectionId, start.sessionId!, "b");
    await service.setConfigOption(
      start.connectionId,
      start.sessionId!,
      "effort",
      "low",
    );
    const changed = service.connectionSnapshot(
      start.connectionId,
      start.sessionId!,
      start.runtimeInstance!,
    );
    assert.equal((changed.session.modes as any).currentModeId, "plan");
    assert.equal((changed.session.models as any).currentModelId, "b");
    assert.equal((changed.session.configOptions as any)[0].currentValue, "low");
    const turn = service.prompt(
      start.connectionId,
      start.sessionId!,
      "permission",
    );
    let permission: any;
    do {
      const event = await subscription.next();
      if (event.done) throw new Error("No permission event");
      permission = event.value.payload;
    } while (permission.kind !== "permission");
    const waiting = service.connectionSnapshot(
      start.connectionId,
      start.sessionId!,
      start.runtimeInstance!,
    );
    assert.equal(waiting.running, true);
    assert.equal(waiting.permissions.length, 1);
    assert.equal(waiting.permissions[0].requestId, permission.requestId);
    assert.deepEqual(waiting.permissions[0].options, permission.options);
    await service.respondPermission(
      start.connectionId,
      permission.requestId,
      "yes",
      start.sessionId!,
    );
    await turn;
    assert.equal(
      service.connectionSnapshot(
        start.connectionId,
        start.sessionId!,
        start.runtimeInstance!,
      ).permissions.length,
      0,
    );
  } finally {
    subscription.close();
    await service.close();
    hub.close();
    db.close();
    await rm(home, { recursive: true, force: true });
  }
});
