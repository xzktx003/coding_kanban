import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventHub } from "../core/events.js";
import { createClaudeService } from "./service.js";
import type {
  Query,
  Options,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
class Stream<T> implements AsyncIterableIterator<T> {
  values: T[] = [];
  waiting?: (v: IteratorResult<T>) => void;
  ended = false;
  [Symbol.asyncIterator]() {
    return this;
  }
  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value) return Promise.resolve({ value, done: false });
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => (this.waiting = resolve));
  }
  push(value: T) {
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = undefined;
      w({ value, done: false });
    } else this.values.push(value);
  }
  close() {
    this.ended = true;
    this.waiting?.({ value: undefined, done: true });
  }
}
test("Claude streams to caller identity; overlap is rejected; modes update hook; prompt reply belongs to live turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-service-"));
  const hub = new EventHub();
  let opts: Options | undefined;
  let input: AsyncIterable<SDKUserMessage> | undefined;
  const output = new Stream<SDKMessage>();
  const service = createClaudeService({
    hub,
    dataHome: dir,
    env: { HOME: dir, PATH: process.env.PATH },
    queryFactory: (params) => {
      opts = params.options;
      input = params.prompt as AsyncIterable<SDKUserMessage>;
      return Object.assign(output, {
        initializationResult: async () => ({}),
        setPermissionMode: async () => {},
        interrupt: async () => {},
        close: () => Stream.prototype.close.call(output),
      }) as unknown as Query;
    },
  });
  try {
    const id = await service.newSession({ cwd: dir });
    assert.deepEqual(service.activitySnapshot(), { connections: 1, activeTurns: 0, pendingRequests: 0 });
    await service.send(id, "hello", []);
    assert.deepEqual(service.activitySnapshot(), { connections: 1, activeTurns: 1, pendingRequests: 0 });
    assert.ok(input);
    assert.equal(opts?.sessionId,id);
    assert.equal(
      (await input[Symbol.asyncIterator]().next()).value?.session_id,
      id,
    );
    await assert.rejects(service.send(id, "overlap", []), /already running/);
    const hook = opts!.hooks!.PreToolUse![0].hooks[0];
    const signal = new AbortController().signal;
    const approval = hook(
      {
        hook_event_name: "PreToolUse",
        session_id: "native",
        transcript_path: "",
        cwd: dir,
        tool_name: "Bash",
        tool_input: { command: "pwd" },
        tool_use_id: "t",
      },
      "t",
      { signal },
    );
    await new Promise((r) => setTimeout(r, 5));
    const events = hub.subscribe({ since: 0 }).backlog;
    const request = events.find((e) => e.event === "cc-permission-request")!;
    assert.equal(service.activitySnapshot().pendingRequests, 1);
    assert.equal(request.payload.sessionId, id);
    await service.resolvePermission(
      String(request.payload.requestId),
      "allow_project",
    );
    assert.equal(service.activitySnapshot().pendingRequests, 0);
    assert.equal(
      ((await approval) as any).hookSpecificOutput.permissionDecision,
      "allow",
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(dir, ".claude/settings.json"), "utf8"))
        .permissions.allow,
      ["Bash"],
    );
    await assert.rejects(
      service.resolvePermission(String(request.payload.requestId), "allow"),
      /not found/,
    );
    output.push({
      type: "result",
      subtype: "success",
      session_id: "native",
      is_error: false,
    } as SDKMessage);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(
      hub.subscribe({ since: 0 }).backlog.find((e) => e.event === "cc-message")
        ?.payload.session_id,
      id,
    );
    await service.setPermissionMode(id, "dontAsk");
    assert.equal(
      (
        (await hook(
          {
            hook_event_name: "PreToolUse",
            session_id: "native",
            transcript_path: "",
            cwd: dir,
            tool_name: "Bash",
            tool_input: {},
            tool_use_id: "t",
          },
          "t",
          { signal },
        )) as any
      ).hookSpecificOutput.permissionDecision,
      "deny",
    );
    await service.send(id, "next", []);
  } finally {
    await service.close();
    hub.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude startup failure emits terminal result and releases execution ownership", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-failure-"));
  const hub = new EventHub();
  const service = createClaudeService({
    hub,
    dataHome: dir,
    env: { HOME: dir },
    queryFactory: () => {
      throw new Error("fixture startup failure");
    },
  });
  try {
    const id = await service.newSession({ cwd: dir });
    await assert.rejects(
      service.sendAndWait(id, "hello"),
      /fixture startup failure/,
    );
    assert.equal(service.activeCount, 0);
    const result = hub
      .subscribe({ since: 0 })
      .backlog.find((e) => e.payload.type === "result");
    assert.equal(result?.payload.is_error, true);
    assert.equal(result?.payload.session_id, id);
  } finally {
    await service.close();
    hub.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude readonly session and pending-permission snapshots preserve the live Query and expose bounded exact details", async () => {
  const dir=await mkdtemp(join(tmpdir(),"cc-readonly-recovery-")),hub=new EventHub();
  const output=new Stream<SDKMessage>();let opts:Options|undefined,queries=0;
  const service=createClaudeService({hub,dataHome:dir,runtimeInstance:"scope-one",env:{HOME:dir,SECRET:"private-value"},queryFactory:params=>{
    queries++;opts=params.options;
    return Object.assign(output,{initializationResult:async()=>({}),interrupt:async()=>{},close:()=>Stream.prototype.close.call(output)}) as unknown as Query;
  }});
  try {
    const id=await service.newSession({cwd:dir,model:"native-model",permissionMode:"manual",settings:"private-settings"});
    const initial=service.sessionSnapshot(id,"scope-one",dir);
    assert.equal(initial.running,false);assert.equal(initial.connected,false);assert.equal(queries,0);
    assert.deepEqual(initial.options,{model:"native-model",permissionMode:"manual"});
    assert.ok(!JSON.stringify(initial).includes("private-"));
    assert.throws(()=>service.sessionSnapshot(id,"old-scope",dir),/instance/);
    assert.throws(()=>service.sessionSnapshot(id,"scope-one","/different"),/directory/);
    await service.send(id,"hello",[]);
    assert.equal(queries,1);
    const native="12345678-1234-4234-8234-123456789abc";
    output.push({type:"system",subtype:"init",session_id:native} as SDKMessage);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(await service.historySessionId(id),native);assert.equal(await service.historySessionId(native),native);
    assert.equal(await service.historySessionId("unloaded-history"),"unloaded-history");assert.equal(queries,1);
    await assert.rejects(service.deleteSession(native),/running/);
    await assert.rejects(service.resume(native,{cwd:dir}),/already running/);assert.equal(queries,1);
    const hook=opts!.hooks!.PreToolUse![0].hooks[0];
    const input={command:"echo preview",payload:"x".repeat(100_000),unicode:"💚\u0000".repeat(20_000)};
    const permission=hook({hook_event_name:"PreToolUse",session_id:"native",transcript_path:"",cwd:dir,tool_name:"Bash",tool_input:input,tool_use_id:"native-tool"},"native-tool",{signal:new AbortController().signal});
    await new Promise(resolve=>setImmediate(resolve));
    const snapshot=service.sessionSnapshot(id,"scope-one",dir);
    assert.equal(snapshot.connected,true);assert.equal(snapshot.running,true);assert.equal(queries,1);
    assert.equal(snapshot.permissions.length,1);
    const request=snapshot.permissions[0];
    assert.equal(request.toolInputTruncated,true);assert.equal(request.inputAvailable,true);
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot))<2*1024*1024);
    assert.throws(()=>service.permissionDetail(id,String(request.requestId),"old-scope",{offset:0,limit:65536}),/instance/);
    let offset=0,text="",revision:string|undefined;
    do {
      const detail=service.permissionDetail(id,String(request.requestId),"scope-one",{offset,limit:65536,expectedItemRevision:revision});
      assert.ok(Buffer.byteLength(JSON.stringify(detail))<65536);
      assert.ok(!revision||detail.itemRevision===revision);revision=detail.itemRevision;text+=detail.text;
      if(detail.nextOffset===null)break;offset=detail.nextOffset;
    }while(true);
    assert.deepEqual(JSON.parse(text),input);
    const other=await service.newSession({cwd:dir});
    assert.throws(()=>service.permissionDetail(other,String(request.requestId),"scope-one",{offset:0,limit:65536}),/expired/);
    await assert.rejects(service.resolvePermission(String(request.requestId),"allow",{runtimeInstance:"scope-one",sessionId:id,executionId:"old-turn"}),/ownership/);
    input.payload+="changed";
    assert.throws(()=>service.permissionDetail(id,String(request.requestId),"scope-one",{offset:0,limit:65536}),/revision/);
    await assert.rejects(service.resolvePermission(String(request.requestId),"allow"),/revision/);
    await service.resolvePermission(String(request.requestId),"deny");await permission;
    assert.equal(service.sessionSnapshot(id,"scope-one").permissions.length,0);
    assert.throws(()=>service.permissionDetail(id,String(request.requestId),"scope-one",{offset:0,limit:65536}),/expired/);
    assert.equal(queries,1);
    const huge={command:"echo large",payload:"x".repeat(8*1024*1024)};
    const controller=new AbortController();
    const oversized=hook({hook_event_name:"PreToolUse",session_id:"native",transcript_path:"",cwd:dir,tool_name:"Bash",tool_input:huge,tool_use_id:"huge"},"huge",{signal:controller.signal});
    await new Promise(resolve=>setImmediate(resolve));
    const unavailable=service.sessionSnapshot(id,"scope-one").permissions[0];
    assert.equal(unavailable.inputAvailable,false);assert.ok(unavailable.inputError);
    assert.throws(()=>service.permissionDetail(id,String(unavailable.requestId),"scope-one",{offset:0,limit:65536}),/budget/);
    await assert.rejects(service.resolvePermission(String(unavailable.requestId),"allow"),/unavailable/);
    assert.equal(service.activitySnapshot().pendingRequests,1);
    controller.abort();await oversized;
    assert.equal(service.activitySnapshot().pendingRequests,0);
    assert.throws(()=>service.permissionDetail(id,String(unavailable.requestId),"scope-one",{offset:0,limit:65536}),/expired/);
    await service.close();
    const restored=createClaudeService({hub,dataHome:dir,runtimeInstance:"scope-two",env:{HOME:dir},queryFactory:()=>{throw new Error("Readonly identity restoration must not start a Query");}});
    try{
      assert.equal(await restored.historySessionId(id),native);
      await restored.resume(id,{cwd:dir,resume:id,permissionMode:"manual"});
      assert.equal(await restored.historySessionId(id),native);
      assert.equal(restored.sessionSnapshot(id,"scope-two").connected,false);
    }finally{await restored.close();}
  }finally{await service.close();hub.close();await rm(dir,{recursive:true,force:true});}
});

test("Claude pending input source budget is aggregate, releases on cancellation, and never drops request identity",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"cc-permission-budget-")),hub=new EventHub({replayBytes:1});
  const output=new Stream<SDKMessage>();let opts:Options|undefined;
  const service=createClaudeService({hub,dataHome:dir,runtimeInstance:"budget-runtime",env:{HOME:dir},queryFactory:params=>{opts=params.options;return Object.assign(output,{initializationResult:async()=>({}),interrupt:async()=>{},close:()=>Stream.prototype.close.call(output)}) as unknown as Query;}});
  const controllers:AbortController[]=[],waiting:Promise<unknown>[]=[];
  try{
    const id=await service.newSession({cwd:dir,permissionMode:"manual"});await service.send(id,"hello");
    const hook=opts!.hooks!.PreToolUse![0].hooks[0];
    const add=()=>{const controller=new AbortController();controllers.push(controller);waiting.push(Promise.resolve(hook({hook_event_name:"PreToolUse",session_id:id,transcript_path:"",cwd:dir,tool_name:"Bash",tool_input:{command:"fixture",payload:"x".repeat(6*1024*1024)},tool_use_id:String(controllers.length)},"tool",{signal:controller.signal})));};
    add();add();add();await new Promise(resolve=>setImmediate(resolve));
    const before=service.sessionSnapshot(id,"budget-runtime").permissions;
    assert.equal(before.length,3);assert.deepEqual(before.map(p=>p.inputAvailable),[true,true,false]);
    await service.resolvePermission(before[0].requestId,"deny");await waiting[0];add();await new Promise(resolve=>setImmediate(resolve));
    const after=service.sessionSnapshot(id,"budget-runtime").permissions;assert.equal(after.length,3);assert.equal(after.at(-1)?.inputAvailable,true);
    controllers.forEach(controller=>controller.abort());await Promise.all(waiting);assert.equal(service.activitySnapshot().pendingRequests,0);
  }finally{controllers.forEach(controller=>controller.abort());await service.close();hub.close();await rm(dir,{recursive:true,force:true});}
});

test("Claude resume aliases share one canonical owner even before native initialization",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"cc-resume-alias-")),hub=new EventHub(),output=new Stream<SDKMessage>();let queries=0;
  const service=createClaudeService({hub,dataHome:dir,env:{HOME:dir},queryFactory:()=>{queries++;return Object.assign(output,{initializationResult:async()=>({}),interrupt:async()=>{},close:()=>Stream.prototype.close.call(output)}) as unknown as Query;}});
  try{
    await Promise.all([service.resume("logical-a",{cwd:dir,resume:"native-target"}),service.resume("logical-b",{cwd:dir,resume:"native-target"})]);
    assert.equal(service.sessionSnapshot("logical-a").eventSessionId,service.sessionSnapshot("logical-b").eventSessionId);
    await service.send("logical-a","hello");await assert.rejects(service.send("logical-b","duplicate"),/already running/);
    await assert.rejects(service.resume("logical-b",{cwd:dir,resume:"native-target"}),/already running/);
    await assert.rejects(service.deleteSession("logical-b"),/running/);assert.equal(queries,1);
  }finally{await service.close();hub.close();await rm(dir,{recursive:true,force:true});}
});

test("Claude rejects invalid options before spawning and does not spawn a process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-input-"));
  const hub = new EventHub();
  let starts = 0;
  const service = createClaudeService({
    hub,
    dataHome: dir,
    env: { HOME: dir },
    queryFactory: () => {
      starts++;
      throw new Error("unexpected spawn");
    },
  });
  try {
    await assert.rejects(
      service.newSession({ cwd: dir, maxTurns: -2 }),
      /maxTurns/,
    );
    await assert.rejects(
      service.newSession({ cwd: dir, allowedTools: [3] }),
      /allowedTools/,
    );
    assert.equal(starts, 0);
  } finally {
    await service.close();
    hub.close();
    await rm(dir, { recursive: true, force: true });
  }
});
