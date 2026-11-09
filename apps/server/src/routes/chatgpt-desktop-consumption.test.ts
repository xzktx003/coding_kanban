import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createConnection, createServer, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import {
  encodeWireValue,
  decodeWireValue,
} from "@agent-orchestrator/chatgpt-desktop-host/wire-value";
import { registerChatGptDesktopBridgeRoutes } from "./chatgpt-desktop-bridge.js";
import type { ChatGptDesktopProfile } from "../services/chatgpt-desktop-profile.js";
import type { DesktopControlConnection } from "@agent-orchestrator/chatgpt-desktop-host/control-client";

function profile(): ChatGptDesktopProfile {
  return {
    version: 1,
    id: randomUUID(),
    generation: randomUUID(),
    pid: 1234,
    startTicks: "55",
    uid: process.getuid!(),
    macAsarPath: "/private/mac.asar",
    macAsarSha256: "a".repeat(64),
    linuxAsarPath: "/private/linux.asar",
    linuxAsarSha256: "b".repeat(64),
    controlSocketPath: "/private/control.sock",
  };
}
async function nativeOutputFixture(t: test.TestContext, acknowledgeOpen = false) {
  const directory = await mkdtemp(join(tmpdir(), "desktop-gateway-output-"));
  const p = { ...profile(), pid: process.pid, startTicks: "12345", controlSocketPath: join(directory, "control.sock") };
  const nativeSockets = new Set<Socket>();
  let nativeSocket: Socket | undefined, scope: unknown;
  const nativeRequests: Record<string, unknown>[] = [];
  const native = createServer((peer) => {
    nativeSockets.add(peer); nativeSocket = peer;
    peer.on("error", () => {}); peer.on("close", () => nativeSockets.delete(peer));
    let buffer = "";
    peer.on("data", (data) => {
      buffer += data.toString("utf8");
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const frame = decodeWireValue(buffer.slice(0, at)) as Record<string, unknown>;
        buffer = buffer.slice(at + 1);
        if (frame.type === "hello") peer.write(encodeWireValue({ v: 1, type: "hello", profileId: p.id, generation: p.generation, pid: p.pid, startTicks: p.startTicks }) + "\n");
        else if (frame.type === "call" || frame.type === "portPost" || frame.type === "openPort") {
          nativeRequests.push(frame);
          if(acknowledgeOpen && frame.type==='openPort') peer.write(encodeWireValue({v:1,scope,seq:1,type:'return',id:frame.id,value:undefined})+'\n');
        }
        else if (frame.type === "createView") {
          scope = { profileId: p.id, generation: p.generation, viewId: frame.viewId };
          peer.write(encodeWireValue({ v: 1, type: "bootstrap", scope, bootstrap: { windowType: "electron", getters: {}, sharedObjects: {} } }) + "\n");
        }
      }
    });
  });
  native.listen(p.controlSocketPath);
  await once(native, "listening");
  const app = Fastify();
  await app.register(websocket);
  let valid = true, reads = 0, nextGuard: (() => Promise<void>) | undefined;
  await app.register(registerChatGptDesktopBridgeRoutes, {
    profileService: { readValidated: async () => {
      reads++;
      const guard = nextGuard; nextGuard = undefined;
      if (guard) await guard();
      await delay(3);
      return valid ? { status: { state: "ready", profileId: p.id, generation: p.generation, reasonCode: "identity_ready" }, profile: p } : { status: { state: "unavailable", reasonCode: "profile_changed" } };
    } },
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(address.replace("http:", "ws:") + `/chatgpt-desktop/${p.id}/${p.generation}/bridge`, { origin: address });
  t.after(async () => {
    socket.terminate();
    for (const peer of nativeSockets) peer.destroy();
    await app.close(); await new Promise<void>((resolve) => native.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const [bootstrapBytes] = await once(socket, "message");
  const rawBootstrap = bootstrapBytes.toString();
  return {
    rawBootstrap, nativeRequests,
    get scope() { return scope; },
    socket,
    get reads() { return reads; },
    revoke() { valid = false; },
    holdNextGuard(guard: () => Promise<void>) { nextGuard = guard; },
    emitEncoded(encoded: string) { assert.ok(nativeSocket); nativeSocket.write(encoded + "\n"); },
    emit(start: number, count: number) {
      assert.ok(nativeSocket && scope);
      const frames = Array.from({ length: count }, (_, index) => encodeWireValue({ v: 1, type: "theme", scope, seq: start + index, value: "light" }));
      nativeSocket.write(frames.join("\n") + "\n");
    },
  };
}


function unpack(value: string) {
 const at=value.indexOf('\n'), head=/^KBC1:([a-f0-9-]{36}):([0-9]+)$/.exec(value.slice(0,at));
 assert.ok(head,'explicit browser consumption transport version');
 return {view:head[1]!,delivery:Number(head[2]),frame:decodeWireValue(value.slice(at+1)) as Record<string,unknown>};
}
async function until(predicate:()=>boolean){for(let n=0;n<200&&!predicate();n++)await delay(2);assert.equal(predicate(),true,'bounded progress');}
function start(f:Awaited<ReturnType<typeof nativeOutputFixture>>){const boot=unpack(f.rawBootstrap);assert.equal(boot.delivery,0);f.socket.send('KBA1:'+boot.view+':0');return boot.view;}
test('kernel callbacks cannot release any of the eight browser delivery slots', {timeout:5000},async t=>{
 const f=await nativeOutputFixture(t),versioned=f.rawBootstrap.startsWith('KBC1:'),view=versioned?start(f):'legacy',received:number[]=[];
 f.socket.on('message',d=>received.push(versioned?unpack(d.toString()).delivery:Number((decodeWireValue(d.toString()) as {seq:number}).seq)));
 f.emit(1,16);await until(()=>received.length>=8);await delay(30);assert.equal(received.length,8,'no ninth output before a browser receipt');
 f.socket.send('KBA1:'+view+':4');await until(()=>received.length===9);await delay(20);assert.equal(received.length,9,'one exact out-of-order receipt releases one slot');
 const closed=once(f.socket,'close');f.socket.send('KBA1:'+view+':4');assert.equal((await closed)[0],1008,'a repeated receipt is not another credit');
});
test('receipt metadata never enters native, and a stale view receipt cannot confirm this view', {timeout:5000},async t=>{
 const f=await nativeOutputFixture(t),view=start(f);f.emit(1,1);await once(f.socket,'message');
 assert.equal(f.nativeRequests.length,0);
 const closed=once(f.socket,'close');f.socket.send('KBA1:'+randomUUID()+':1');assert.equal((await closed)[0],1008);assert.equal(f.nativeRequests.length,0);
 assert.ok(view);
});
test('unknown delivery and old native-only transport are rejected before a native write', {timeout:5000},async t=>{
 for(const mode of ['unknown','old','noncanonical','high-bit']){
  const f=await nativeOutputFixture(t);const boot=unpack(f.rawBootstrap);
  if(mode!=='old')f.socket.send('KBA1:'+boot.view+':0');
  const closed=once(f.socket,'close');
  if(mode==='old')f.socket.send(encodeWireValue({v:1,scope:f.scope,seq:1,type:'call',id:1,method:'sendMessageFromView',args:[]}));
  else if(mode==='high-bit'){const bytes=Buffer.from('KBA1:'+boot.view+':1');bytes[7]=bytes[7]!|128;f.socket.send(bytes,{binary:false});}
  else f.socket.send('KBA1:'+boot.view+':'+(mode==='unknown'?'99':'01'));
  assert.equal((await closed)[0],mode==='high-bit'?1007:1008);assert.equal(f.nativeRequests.length,0);
 }
});
test('fresh authorization still blocks an acknowledged refill before its actual output write', {timeout:5000},async t=>{
 const f=await nativeOutputFixture(t),view=start(f),received:number[]=[];f.socket.on('message',d=>received.push(unpack(d.toString()).delivery));f.emit(1,16);await until(()=>received.length===8);
 let release=()=>{},entered=()=>{};const started=new Promise<void>(r=>{entered=r});f.holdNextGuard(async()=>{entered();await new Promise<void>(r=>{release=r})});
 f.socket.send('KBA1:'+view+':1');await started;const closed=once(f.socket,'close');f.revoke();release();await closed;assert.equal(received.length,8);
});

test('eight deferred SDK frames cannot deadlock a later real portPost receipt', {timeout:5000},async t=>{
 const f=await nativeOutputFixture(t,true),view=start(f);
 const {installDesktopBridge}=await import(new URL('../../../../packages/chatgpt-desktop-host/src/browser-bridge.mjs',import.meta.url).href);
 const callbacks=new Map<string,(event:unknown)=>void>(),handlers=new Map<string,(event:unknown)=>void>(),delivered:unknown[]=[];
 let receive:(encoded:string)=>unknown=()=>{},failure:unknown;
 const win={performance:{timeOrigin:1},setTimeout,clearTimeout,addEventListener(k:string,fn:(event:unknown)=>void){handlers.set(k,fn)},removeEventListener(k:string){handlers.delete(k)}};
 const bridge=installDesktopBridge({window:win,scope:f.scope,bootstrap:{windowType:'electron',getters:{},sharedObjects:{}},transport:{async send(encoded:string){f.socket.send(encoded)},subscribe(fn:(encoded:string)=>unknown){receive=fn;return()=>{}},close(){}},onFailure(error:unknown){failure=error}});
 t.after(()=>bridge.dispose());
 f.socket.on('message',d=>{const raw=d.toString(),message=unpack(raw),body=raw.slice(raw.indexOf('\n')+1);Promise.resolve(receive(body)).then(()=>{if(f.socket.readyState===WebSocket.OPEN)f.socket.send('KBA1:'+view+':'+message.delivery)},()=>{});});
 const port={start(){},close(){},addEventListener(k:string,fn:(event:unknown)=>void){callbacks.set(k,fn)},postMessage(data:unknown){delivered.push(data)}};
 handlers.get('message')!({source:win,data:{type:'connect-app-host',port}});
 await until(()=>f.nativeRequests.some(x=>x.type==='openPort'));await delay(10);
 for(let n=0;n<48;n++)callbacks.get('message')!({data:{request:n}});
 await until(()=>f.nativeRequests.filter(x=>x.type==='portPost').length===32);
 const first=f.nativeRequests.find(x=>x.type==='portPost')!;
 for(let n=0;n<8;n++)f.emitEncoded(encodeWireValue({v:1,scope:f.scope,seq:n+2,type:'portMessage',portId:'app-host-1',data:{reply:n}}));
 f.emitEncoded(encodeWireValue({v:1,scope:f.scope,seq:10,type:'return',id:first.id,value:undefined}));
 await until(()=>f.nativeRequests.filter(x=>x.type==='portPost').length===33);
 assert.ok(delivered.length>0 && delivered.length<8,'bounded progress frees a reader slot; real receipt bypasses the remaining deferred SDK data');
 assert.equal(failure,undefined);assert.equal(f.nativeRequests.filter(x=>String(x.type).startsWith('KBA')).length,0);
});
test('transport prefix is charged inside the unchanged eight MiB output budget', {timeout:5000},async t=>{
 const f=await nativeOutputFixture(t);start(f);let received=0;f.socket.on('message',()=>received++);
 const value={v:1,scope:f.scope,seq:1,type:'viewMessage',data:'x'.repeat(8*1024*1024-1024)};
 let encoded=encodeWireValue(value);value.data+='x'.repeat(8*1024*1024-Buffer.byteLength(encoded));encoded=encodeWireValue(value);assert.equal(Buffer.byteLength(encoded),8*1024*1024);
 const closed=once(f.socket,'close');f.emitEncoded(encoded);assert.equal((await closed)[0],1009);assert.equal(received,0);
});
