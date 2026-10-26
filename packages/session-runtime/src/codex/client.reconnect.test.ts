import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventHub } from "../core/events.js";
import { object, type JsonObject } from "../core/json.js";
import { CodexService } from "./client.js";

const source = String.raw`
const fs=require('node:fs'), readline=require('node:readline');
const journal=process.argv[1], failInitialize=process.argv[2]==='fail';
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(!m.method)return;
 fs.appendFileSync(journal,JSON.stringify({pid:process.pid,method:m.method})+'\n');
 if(m.method==='initialize'){
  const starts=fs.readFileSync(journal,'utf8').trim().split('\n').map(JSON.parse).filter(x=>x.method==='initialize').length;
  if(failInitialize&&starts===1)process.exit(24);
  send({id:m.id,result:{userAgent:'reconnect-fixture'}});return;
 }
 if(m.method==='initialized')return;
 if(m.method==='turn/start')process.exit(23);
 if(m.method==='fixture/oversized'){
  send({id:m.id,result:{text:'x'.repeat(33*1024*1024)}});return;
 }
 send({id:m.id,result:{data:[],pid:process.pid}});
});`;

async function fixture(t: TestContext, failInitialize = false) {
  const root = await mkdtemp(join(tmpdir(), "codex-reconnect-"));
  const journal = join(root, "requests.jsonl");
  const hub = new EventHub();
  const service = new CodexService({
    hub,
    instance: "reconnect-test",
    sweepIntervalMs: 1000,
    launch: {
      command: process.execPath,
      args: ["-e", source, journal, failInitialize ? "fail" : "ok"],
    },
  });
  t.after(async () => {
    await service.close();
    hub.close();
    await rm(root, { recursive: true, force: true });
  });
  const records = async () =>
    (await readFile(journal, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { pid: number; method: string });
  return { service, hub, records };
}

test("a dead native connection recovers on the next read, coalesces callers and never replays an uncertain turn", async (t) => {
  const { service, records } = await fixture(t);
  const before = object(await service.raw("model/list", {}));
  await assert.rejects(
    service.raw("turn/start", { threadId: "fixture" }),
    /DELIVERY_UNKNOWN/,
  );
  const results = await Promise.all(
    Array.from({ length: 8 }, () => service.raw("thread/list", {})),
  );
  const pids = results.map((result) => object(result).pid);
  assert.notEqual(pids[0], before.pid);
  assert.equal(new Set(pids).size, 1);
  const calls = await records();
  assert.equal(calls.filter((call) => call.method === "initialize").length, 2);
  assert.equal(calls.filter((call) => call.method === "turn/start").length, 1);
});

test("a rejected initialization does not poison all later read requests", async (t) => {
  const { service, records } = await fixture(t, true);
  await assert.rejects(service.raw("model/list", {}), /DELIVERY_UNKNOWN/);
  const replies = await Promise.all([
    service.raw("model/list", {}),
    service.raw("thread/list", {}),
  ]);
  assert.equal(object(replies[0]).pid, object(replies[1]).pid);
  assert.equal(
    (await records()).filter((call) => call.method === "initialize").length,
    2,
  );
});

test("environment discovery failure can recover without restarting the runtime", async (t) => {
  const { service } = await fixture(t);
  let attempts = 0;
  service.options.resolveEnv = async () => {
    if (++attempts === 1) throw new Error("temporary environment failure");
    return process.env;
  };
  await assert.rejects(
    service.raw("model/list", {}),
    /temporary environment failure/,
  );
  assert.deepEqual(object(await service.raw("model/list", {})).data, []);
  assert.equal(attempts, 2);
});

test("an oversized native reply cannot permanently poison the cached connection, including legacy exit handling", async (t) => {
  const { service, hub, records } = await fixture(t);
  service.options.resolveEnv = async () => process.env;
  await service.raw("model/list", {});
  const old = (
    service as unknown as { transport: { options: { onExit: () => void } } }
  ).transport;
  // The deployed legacy exit callback invalidates ownership but keeps the
  // settled starting promise and transport reference.
  old.options.onExit = () => {
    service.ownership.invalidate();
    hub.invalidatePending("codex");
  };
  await assert.rejects(
    service.raw("fixture/oversized", {}),
    /RPC frame exceeded byte limit/,
  );
  const replies = await Promise.all(
    Array.from({ length: 8 }, () => service.raw("thread/list", {})),
  );
  assert.equal(new Set(replies.map((reply) => object(reply).pid)).size, 1);
  assert.equal(
    (await records()).filter((call) => call.method === "fixture/oversized")
      .length,
    1,
  );
  assert.equal(
    (await records()).filter((call) => call.method === "initialize").length,
    2,
  );
});

test("late callbacks from the old native process cannot invalidate or approve work on its replacement", async (t) => {
  const { service, hub, records } = await fixture(t);
  await service.raw("model/list", {});
  const old = (
    service as unknown as {
      transport: {
        options: {
          onExit: () => void;
          onNotification: (value: JsonObject) => void;
          onRequest: (value: {
            id: string;
            method: string;
            params: JsonObject;
          }) => Promise<void>;
        };
      };
    }
  ).transport;
  await assert.rejects(
    service.raw("turn/start", { threadId: "fixture" }),
    /DELIVERY_UNKNOWN/,
  );
  const next = object(await service.raw("model/list", {}));
  const snapshot = hub.subscribe({ since: 0 });
  const before = snapshot.backlog.length;
  snapshot.close();
  old.options.onExit();
  old.options.onNotification({ method: "account/updated", params: {} });
  await old.options.onRequest({
    id: "old",
    method: "item/commandExecution/requestApproval",
    params: { threadId: "fixture", turnId: "old" },
  });
  const after = hub.subscribe({ since: 0 });
  assert.equal(after.backlog.length, before);
  after.close();
  await assert.rejects(
    service.respond("commandExecution", {
      request_id: "old",
      decision: "accept",
    }),
    /SESSION_RPC_EXPIRED/,
  );
  assert.equal(object(await service.raw("model/list", {})).pid, next.pid);
  assert.equal(
    (await records()).filter((call) => call.method === "initialize").length,
    2,
  );
  await service.close();
  await assert.rejects(service.raw("model/list", {}), /service closed/);
  assert.equal(
    (await records()).filter((call) => call.method === "initialize").length,
    2,
  );
});
