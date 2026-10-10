import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EventHub } from "../core/events.js";
import { createClaudeService } from "./service.js";
import { ClaudeHistory } from "./history.js";

test("official Claude SDK speaks real stream-json child process protocol over multiple turns", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-native-"));
  const cli = join(home, "fixture.cjs");
  const log = join(home, "wire.jsonl");
  const hub = new EventHub();
  await writeFile(
    cli,
    `#!${process.execPath}\nconst fs=require('fs');const rl=require('readline').createInterface({input:process.stdin});const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');let hook;rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(process.env.FIXTURE_LOG,line+'\\n');if(m.type==='control_request'){if(m.request.subtype==='initialize')hook=m.request.hooks?.PreToolUse?.[0]?.hookCallbackIds?.[0];send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{commands:[],agents:[],models:[],account:{}}}});}if(m.type==='user'){send({type:'system',subtype:'init',session_id:'native-fixture',cwd:process.cwd(),tools:[],mcp_servers:[],model:'fixture',permissionMode:'default',apiKeySource:'none',claude_code_version:'fixture',slash_commands:[],uuid:'init'});send({type:'assistant',session_id:'native-fixture',message:{role:'assistant',content:[{type:'text',text:'fixture answer'}]},parent_tool_use_id:null,uuid:'reply'});send({type:'result',subtype:'success',session_id:'native-fixture',result:'fixture answer',duration_ms:1,duration_api_ms:1,is_error:false,num_turns:1,total_cost_usd:0,usage:{},modelUsage:{},permission_denials:[],uuid:'result'});}});`,
  );
  await chmod(cli, 0o700);
  const service = createClaudeService({
    hub,
    dataHome: home,
    env: {
      HOME: home,
      PATH: process.env.PATH,
      SESSION_CLAUDE_BIN: cli,
      FIXTURE_LOG: log,
    },
  });
  try {
    const id = await service.newSession({
      cwd: home,
      model: "fixture",
      maxTurns: 3,
    });
    await service.sendAndWait(id, "one");
    await service.setPermissionMode(id, "acceptEdits");
    await service.sendAndWait(id, "two");
    const events = hub.subscribe({ since: 0 }).backlog;
    assert.equal(events.filter((e) => e.payload.type === "result").length, 2);
    assert.ok(events.every((e) => e.payload.session_id === id));
    const wire = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(wire.filter((m) => m.type === "user").length, 2);
    assert.ok(wire.some((m) => m.request?.subtype === "set_permission_mode"));
  } finally {
    await service.close();
    hub.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("official SDK reads and deletes isolated native history without creating CLI or touching another home", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-history-"));
  const cwd = join(home, "project");
  await mkdir(cwd);
  const root = join(
    home,
    ".claude",
    "projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  await mkdir(root, { recursive: true });
  const id = randomUUID();
  const first = randomUUID(),
    second = randomUUID();
  const file = join(root, `${id}.jsonl`);
  const rows = [
    {
      type: "user",
      uuid: first,
      parentUuid: null,
      sessionId: id,
      cwd,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "History prompt" },
    },
    {
      type: "assistant",
      uuid: second,
      parentUuid: first,
      sessionId: id,
      cwd,
      timestamp: new Date().toISOString(),
      message: {
        role: "assistant",
        content: [{ type: "text", text: "History answer" }],
      },
    },
  ];
  await writeFile(file, rows.map((v) => JSON.stringify(v)).join("\n") + "\n");
  const history = new ClaudeHistory(home, {
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: process.env.PATH,
  });
  try {
    const list = await history.list(cwd);
    assert.equal(list.total, 1);
    assert.equal(list.sessions[0].session_id, id);
    assert.equal(((await history.messages(id)) as unknown[]).length, 2);
    await history.delete(id);
    await assert.rejects(readFile(file));
    assert.equal((await history.list(cwd)).total, 0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("official SDK PreToolUse approval round-trip and automation native identity", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-hook-"));
  const cli = join(home, "fixture.cjs");
  const hub = new EventHub();
  await writeFile(
    cli,
    `#!${process.execPath}\nconst rl=require('readline').createInterface({input:process.stdin});const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');let hook;const done=()=>send({type:'result',subtype:'success',session_id:'native-approved',result:'approved',duration_ms:1,duration_api_ms:1,is_error:false,num_turns:1,total_cost_usd:0,usage:{},modelUsage:{},permission_denials:[],uuid:'result'});rl.on('line',line=>{const m=JSON.parse(line);if(m.type==='control_request'){if(m.request.subtype==='initialize')hook=m.request.hooks?.PreToolUse?.[0]?.hookCallbackIds?.[0];send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{commands:[],agents:[],models:[],account:{}}}});}if(m.type==='user'){send({type:'system',subtype:'init',session_id:'native-approved',tools:[],mcp_servers:[],model:'fixture',uuid:'init'});send({type:'control_request',request_id:'approval',request:{subtype:'hook_callback',callback_id:hook,input:{hook_event_name:'PreToolUse',session_id:'native-approved',cwd:process.cwd(),tool_name:'Bash',tool_input:{command:'pwd'},tool_use_id:'tool'},tool_use_id:'tool'}});}if(m.type==='control_response'&&m.response.request_id==='approval'){if(m.response.response?.hookSpecificOutput?.permissionDecision==='allow')done();else process.exit(3);}});`,
  );
  await chmod(cli, 0o700);
  const service = createClaudeService({
    hub,
    dataHome: home,
    env: { HOME: home, PATH: process.env.PATH, SESSION_CLAUDE_BIN: cli },
  });
  const sub = hub.subscribe();
  try {
    const id = await service.newSession({ cwd: home });
    const done = service.sendAndWait(id, "permission test");
    let request: Record<string, unknown> | undefined;
    for await (const event of sub) {
      if (event.event === "cc-permission-request") {
        request = event.payload;
        break;
      }
    }
    assert.equal(request?.sessionId, id);
    await service.resolvePermission(String(request?.requestId), "allow");
    await done;
    await service.disconnect(id);
    let nativeId = "";
    assert.equal(
      await service.runAutomation({
        cwd: home,
        model: "fixture",
        prompt: "automation",
        onStarted: (id) => {
          nativeId = id;
        },
        signal: new AbortController().signal,
      }),
      "finished",
    );
    assert.equal(nativeId, "native-approved");
  } finally {
    sub.close();
    await service.close();
    hub.close();
    await rm(home, { recursive: true, force: true });
  }
});
