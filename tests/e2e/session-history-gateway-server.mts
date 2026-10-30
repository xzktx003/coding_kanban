import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSessionModeRoutes } from "../../apps/server/src/routes/session-mode";
import { registerChatHistoryChannel } from "../../packages/session-runtime/src/codex/chat-history-channel";

const require = createRequire(resolve("apps/server/package.json"));
const Fastify: typeof import("../../apps/server/node_modules/fastify").default = require("fastify");

/** Actual app gateway and production readonly reader; private fake native, no login/Agent IPC. */
export async function historyGateway(delayMs = 900) {
  const root = await mkdtemp(join(tmpdir(), "session-ux-reader-"));
  const log = join(root, "reads.jsonl");
  const app = Fastify();
  const requests: Array<{ id: string; priority: unknown; at: number }> = [];
  const source = `const fs=require('node:fs');const log=${JSON.stringify(log)};
const ticks=()=>fs.readFileSync('/proc/self/stat','utf8').split(') ').at(-1).split(' ')[19];
const record=(value)=>fs.appendFileSync(log,JSON.stringify({...value,pid:process.pid,startTicks:ticks(),at:Date.now()})+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const q=JSON.parse(line);
 if(q.method==='initialize')console.log(JSON.stringify({id:q.id,result:{}}));
 else if(q.method==='thread/turns/list'){
  if(Object.keys(q.params).some(key=>/priority/i.test(key)))process.exit(98);
  const id=q.params.threadId;record({id,method:q.method});
  setTimeout(()=>console.log(JSON.stringify({id:q.id,result:{data:[{id:'turn-'+id,status:'completed',items:[{id:'reply-'+id,type:'agentMessage',text:'recent page '+id}],error:null}],nextCursor:null}})),id==='ux-0'||id==='ux-1'?${delayMs}:0);
 }else if(q.method!=='initialized')process.exit(99);
}).on('close',()=>process.exit(0));`;
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:1",
    attachmentRoot: join(root, "uploads"),
    loadDetailChannel: async () => ({
      registerLocalItemDetailChannel: () => {},
      registerLocalChatHistoryChannel: (scope, _data, fallback) =>
        registerChatHistoryChannel(
          scope,
          { launch: { command: process.execPath, args: ["-e", source] } },
          "/api/session/api/codex/thread/turns/list",
          fallback,
        ),
    }),
    fetch: async () => new Response("{}"),
  });
  app.addHook("preHandler", async (request) => {
    requests.push({
      id: (request.body as { threadId: string }).threadId,
      priority: request.headers["x-session-read-priority"],
      at: Date.now(),
    });
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const reads = async () => {
    try {
      return (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  };
  return {
    origin: app.listeningOrigin,
    requests,
    reads,
    async close() {
      await app.close();
      const records = await reads();
      const alive: number[] = [];
      for (const record of records) {
        try {
          const stat = await readFile(`/proc/${record.pid}/stat`, "utf8");
          if (stat.split(") ").at(-1)!.split(" ")[19] === record.startTicks)
            alive.push(record.pid);
        } catch {
          /* Owned child has exited. */
        }
      }
      await rm(root, { recursive: true, force: true });
      return { records, alive };
    },
  };
}

const gateway = await historyGateway(Number(process.argv[2] ?? 900));
process.stdout.write(
  JSON.stringify({ ready: true, origin: gateway.origin }) + "\n",
);
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const { id, method } = JSON.parse(line);
  const value =
    method === "reads"
      ? await gateway.reads()
      : method === "requests"
        ? gateway.requests
        : await gateway.close();
  process.stdout.write(JSON.stringify({ id, value }) + "\n");
  if (method === "close") {
    lines.close();
    process.exit(0);
  }
}
