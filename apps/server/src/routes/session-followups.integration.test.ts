import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerSessionFollowupRoutes } from "./session-followups.js";
async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 8000;
  while (!(await check())) {
    if (Date.now() > end) throw Error("background dispatch timed out");
    await new Promise((r) => setTimeout(r, 30));
  }
}
test(
  "production HTTP adapter dispatches without a browser and only one gateway owns the journal",
  { timeout: 20000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "followup-http-")),
      file = join(root, "queue.json");
    const calls: any[] = [];
    const streams = new Set<ServerResponse>();
    let status = "idle",
      seq = 0;
    const emit = (method: string, turn: any) => {
      const frame = `data: ${JSON.stringify({ seq: ++seq, event: "codex:notification", payload: { method, params: { threadId: "owned-thread", turn } } })}\n\n`;
      for (const s of streams) s.write(frame);
    };
    const upstream = createServer(async (req, res) => {
      if (req.url === "/health") {
        res.end(JSON.stringify({ instance: "fixture-runtime" }));
        return;
      }
      if (req.url?.startsWith("/api/events")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": connected\n\n");
        streams.add(res);
        req.on("close", () => streams.delete(res));
        return;
      }
      let raw = "";
      for await (const c of req) raw += c;
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === "/api/codex/thread/list") {
        res.end(
          JSON.stringify({
            data: [{ id: "owned-thread", status: { type: status } }],
            nextCursor: null,
          }),
        );
        return;
      }
      if (req.url === "/api/codex/turn/start") {
        calls.push(body);
        status = "active";
        const turn = {
          id: "run-" + body.clientUserMessageId,
          status: "inProgress",
        };
        emit("turn/started", turn);
        res.end(JSON.stringify({ turn }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const address = upstream.address();
    if (!address || typeof address === "string") throw Error("address");
    const origin = () => `http://127.0.0.1:${address.port}`;
    const app = Fastify(),
      contender = Fastify();
    const q = registerSessionFollowupRoutes(app, {
      origin,
      file,
      completionNotifier: {
        cursor: async () => undefined,
        observe: async () => {
          throw new Error("notification storage unavailable");
        },
        close: async () => {},
      },
    });
    registerSessionFollowupRoutes(contender, {
      origin,
      file,
      autoStart: false,
    });
    try {
      await app.ready();
      await until(() => streams.size === 1);
      for (const id of ["one", "two"])
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/session/followups/submit",
              payload: {
                id,
                threadId: "owned-thread",
                mode: "queue",
                text: id,
                images: [],
                parameters: { model: "snapshot" },
              },
            })
          ).statusCode,
          200,
        );
      await until(() => calls.length === 1);
      assert.equal(calls[0].model, "snapshot");
      assert.equal(
        (
          await contender.inject({
            url: "/api/session/followups?threadId=owned-thread",
          })
        ).statusCode,
        500,
      );
      status = "idle";
      emit("turn/completed", { id: "run-one", status: "completed" });
      await until(() => calls.length === 2);
      assert.equal(calls[1].input[0].text, "two");
      // A sequence gap must pause outstanding work instead of trusting an incomplete history.
      await q.submit({
        id: "three",
        threadId: "owned-thread",
        mode: "queue",
        text: "three",
        images: [],
        parameters: {},
      });
      seq += 2;
      emit("turn/completed", { id: "run-two", status: "completed" });
      status = "idle";
      await until(async () => Boolean((await q.get("owned-thread")).paused));
      await q.tick();
      assert.equal(calls.length, 2);
    } finally {
      await contender.close();
      await app.close();
      for (const s of streams) s.end();
      upstream.closeAllConnections();
      await new Promise<void>((r) => upstream.close(() => r()));
      await rm(root, { recursive: true, force: true });
    }
  },
);
