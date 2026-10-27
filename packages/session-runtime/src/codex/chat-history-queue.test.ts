import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerChatHistoryChannel } from "./chat-history-channel.js";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
test(
  "cancelled queued history reads release admission without overtaking the active reader",
  { timeout: 15000 },
  async (t) => {
    const app = Fastify();
    let seen = 0;
    app.addHook("preHandler", async () => {
      seen++;
    });
    const script = `const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',l=>{const q=JSON.parse(l);if(q.method==='initialize')console.log(JSON.stringify({id:q.id,result:{}}));if(q.method==='thread/turns/list'&&q.params.threadId!=='held')console.log(JSON.stringify({id:q.id,result:{data:[],nextCursor:'kept'}}));});rl.on('close',()=>process.exit(0));`;
    registerChatHistoryChannel(app, {
      launch: { command: process.execPath, args: ["-e", script] },
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const url = `${app.listeningOrigin}/api/codex/thread/turns/list?view=chat`;
    const controllers = Array.from({ length: 17 }, () => new AbortController());
    t.after(async () => {
      controllers.forEach((c) => c.abort());
      await app.close();
    });
    const send = (id: string, signal?: AbortSignal) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: id }),
        signal,
      });
    const held = send("held", controllers[0]!.signal).catch(() => null);
    while (seen < 1) await sleep(10);
    const waiting = controllers
      .slice(1)
      .map((c) => send("queued", c.signal).catch(() => null));
    while (seen < 17) await sleep(10);
    await sleep(30);
    controllers.slice(1).forEach((c) => c.abort());
    await Promise.all(waiting);
    await sleep(100);
    let status: number | undefined;
    const next = send("next").then(async (r) => {
      status = r.status;
      return { status: r.status, body: await r.json() };
    });
    await sleep(100);
    const beforeRelease = status;
    controllers[0]!.abort();
    await held;
    const result = await next;
    assert.equal(
      beforeRelease,
      undefined,
      "new read must wait for active native cleanup, not receive 429 from cancelled queue entries",
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.nextCursor, "kept");
  },
);
