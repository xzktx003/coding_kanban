import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { CodexService } from "./client.js";
import { registerCodexRoutes } from "./routes.js";
import { EventHub } from "../core/events.js";

// Dynamic URL keeps the runtime production build's rootDir local, while this durable
// test executes the real gateway module under the repository's existing tsx runner.
const { registerSessionItemDetail } = await import(
  new URL(
    "../../../../apps/server/src/routes/session-item-detail.ts",
    import.meta.url,
  ).href
);
const endpoint = "/api/session/api/codex/thread/item-detail";
const script = String.raw`
const fs=require('node:fs'),{once}=require('node:events'),readline=require('node:readline');
const audit=process.argv[1];let bytes=0;const record=(event,extra={})=>fs.appendFileSync(audit,JSON.stringify({event,pid:process.pid,at:Date.now(),bytes,...extra})+'\n');
record('spawn');process.on('exit',()=>record('exit'));process.stdout.on('error',()=>{});
async function out(text){bytes+=Buffer.byteLength(text);if(!process.stdout.write(text)){record('drainStart');await once(process.stdout,'drain');record('drainEnd');}}
const rl=readline.createInterface({input:process.stdin});let chain=Promise.resolve();
rl.on('line',line=>{chain=chain.then(async()=>{const req=JSON.parse(line);record('request',{method:req.method,threadId:req.params?.threadId});
 if(req.method==='initialize')await out('{"id":1,"result":{}}\n');
 else if(req.method==='initialized'){}
 else if(req.method==='thread/read'){
  if(req.params.threadId==='before')return;
  await out('{"id":2,"result":{"thread":{"id":'+JSON.stringify(req.params.threadId)+',"turns":[{"id":"turn","items":[{"type":"commandExecution","id":"item","aggregatedOutput":"');
  if(req.params.threadId==='body'){for(let i=0;i<32768;i++)await out('x'.repeat(4096));}else await out('next-success');
  await out('"}]}]}}}');record('tailSent');
 }else process.exit(88);
}).catch(()=>{});});
rl.on('close',()=>{record('stdinEOF');setTimeout(()=>process.exit(0),1000);});
`;
interface Audit {
  event: string;
  pid: number;
  at: number;
  bytes: number;
  threadId?: string;
  method?: string;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until<T>(
  read: () => Promise<T | undefined>,
  label: string,
  timeout = 10000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await sleep(20);
  }
  throw Error("Timed out: " + label);
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw e;
  }
}

for (const mode of ["before", "body"] as const)
  test(
    `two-hop HTTP abandonment ${mode} reaches runtime child exit before next admission`,
    { timeout: 20000 },
    async (t) => {
      const directory = await mkdtemp(join(tmpdir(), "detail-http-owned-")),
        file = join(directory, "reader.jsonl");
      const audit = async (): Promise<Audit[]> => {
        try {
          return (await readFile(file, "utf8"))
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw e;
        }
      };
      const runtime = Fastify({ forceCloseConnections: true }),
        gateway = Fastify({ forceCloseConnections: true });
      const service = new CodexService({
        hub: new EventHub(),
        instance: "two-hop-owned",
        env: { PATH: "/usr/bin:/bin" },
        launch: { command: process.execPath, args: ["-e", script, file] },
        sweepIntervalMs: 0,
      });
      let sharedCalls = 0;
      Object.assign(service, {
        raw: async () => {
          sharedCalls++;
          throw Error("shared transport forbidden");
        },
      });
      const events: Array<{ event: string; at: number }> = [];
      runtime.addHook("onRequest", async (_req, reply) => {
        reply.raw.once("close", () =>
          events.push({ event: "runtimeResponseClose", at: Date.now() }),
        );
      });
      registerCodexRoutes(runtime, service);
      const upstream = await runtime.listen({ host: "127.0.0.1", port: 0 });
      registerSessionItemDetail(
        gateway,
        () => upstream,
        (
          url: Parameters<typeof fetch>[0],
          init: Parameters<typeof fetch>[1],
        ) => {
          init?.signal?.addEventListener(
            "abort",
            () => events.push({ event: "gatewayFetchAbort", at: Date.now() }),
            { once: true },
          );
          return fetch(url, init);
        },
      );
      const address = await gateway.listen({ host: "127.0.0.1", port: 0 });
      const payload = (threadId: string) =>
        JSON.stringify({
          threadId,
          turnId: "turn",
          itemId: "item",
          expectedType: "commandExecution",
        });
      let response: IncomingMessage | undefined;
      let received = "";
      let responseEnded = false;
      const client = httpRequest(
        address + endpoint,
        { method: "POST", headers: { "content-type": "application/json" } },
        (res) => {
          response = res;
          res.on("end", () => {
            responseEnded = true;
          });
          res.once("data", (chunk) => {
            received += chunk.toString();
            res.pause();
          });
        },
      );
      client.on("error", () => {});
      t.after(async () => {
        client.destroy();
        response?.destroy();
        await gateway.close();
        await runtime.close();
        await service.close();
        const rows = await audit();
        for (const pid of new Set(rows.map((r) => r.pid)))
          assert.equal(alive(pid), false);
        await rm(directory, { recursive: true, force: true });
      });
      client.end(payload(mode));
      const started = await until(
        async () =>
          (await audit()).find(
            (r) =>
              r.event === "request" &&
              r.method === "thread/read" &&
              r.threadId === mode,
          ),
        "reader thread/read",
      );
      let stall: unknown = null;
      if (mode === "before") assert.equal(response, undefined);
      else {
        await until(
          async () => (received ? true : undefined),
          "first selected response bytes",
        );
        const before = await until(async () => {
          const rows = (await audit()).filter((r) => r.pid === started.pid);
          const last = rows.at(-1);
          return last?.event === "drainStart" ? last : undefined;
        }, "real stdout drain wait");
        let stable = before;
        await until(async () => {
          const rows = (await audit()).filter((r) => r.pid === started.pid);
          const last = rows.at(-1);
          if (last?.event !== "drainStart") return undefined;
          if (last.bytes !== stable.bytes) {
            stable = last;
            return undefined;
          }
          return Date.now() - last.at >= 250 ? true : undefined;
        }, "stable producer backpressure");
        const after = (await audit())
          .filter((r) => r.pid === started.pid)
          .at(-1)!;
        assert.equal(after.event, "drainStart");
        assert.equal(after.bytes, stable.bytes);
        assert(after.bytes < 128 * 1024 * 1024);
        assert(!responseEnded);
        assert.throws(() => JSON.parse(received));
        stall = {
          attemptedNativeBytes: after.bytes,
          stableMs: Date.now() - after.at,
          clientBytes: Buffer.byteLength(received),
        };
      }
      events.push({ event: "clientDestroyed", at: Date.now() });
      client.destroy();
      response?.destroy();
      const eof = await until(
        async () =>
          (await audit()).find(
            (r) => r.pid === started.pid && r.event === "stdinEOF",
          ),
        "owned child stdin EOF",
      );
      assert(
        alive(started.pid),
        "child must still be alive during delayed EOF cleanup",
      );
      assert(
        events.some(
          (event) => event.event === "gatewayFetchAbort" && event.at <= eof.at,
        ),
      );
      assert(
        events.some(
          (event) =>
            event.event === "runtimeResponseClose" && event.at <= eof.at,
        ),
      );
      const busy = await fetch(address + endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload("after"),
      });
      assert.equal(busy.status, 429);
      assert.equal(((await busy.json()) as any).error, "DETAIL_BUSY");
      assert.equal(
        (await audit()).filter((r) => r.event === "spawn").length,
        1,
      );
      await until(
        async () => (!alive(started.pid) ? true : undefined),
        "actual held child exit",
      );
      const next = await fetch(address + endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload("after"),
      });
      assert.equal(next.status, 200);
      assert.equal(
        ((await next.json()) as any).item.aggregatedOutput,
        "next-success",
      );
      await until(async () => {
        const rows = await audit();
        const pids = rows.filter((r) => r.event === "spawn").map((r) => r.pid);
        return pids.length === 2 && pids.every((pid) => !alive(pid))
          ? true
          : undefined;
      }, "next reader exit");
      const rows = await audit();
      for (const pid of new Set(rows.map((row) => row.pid)))
        assert.deepEqual(
          rows
            .filter((row) => row.pid === pid && row.event === "request")
            .map((row) => row.method),
          ["initialize", "initialized", "thread/read"],
        );
      assert(
        !rows.some((r) => r.pid === started.pid && r.event === "tailSent"),
      );
      assert(events.some((r) => r.event === "gatewayFetchAbort"));
      assert(events.some((r) => r.event === "runtimeResponseClose"));
      assert.equal(sharedCalls, 0);
      assert.equal(responseEnded, false);
      console.log(
        "DETAIL_HTTP_ABANDONMENT",
        JSON.stringify({
          mode,
          forceCloseConnections: true,
          headersReceived: response !== undefined,
          firstPid: started.pid,
          stall,
          events,
          childEOF: eof,
          childExit: rows.find(
            (r) => r.pid === started.pid && r.event === "exit",
          ),
          busyStatus: busy.status,
          nextStatus: next.status,
          spawns: rows.filter((r) => r.event === "spawn"),
          allChildrenExited: true,
          interruptedTailSent: false,
        }),
      );
    },
  );
