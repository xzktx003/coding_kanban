import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerChatHistoryChannel } from "@agent-orchestrator/session-runtime/item-detail";
import { registerSessionModeRoutes } from "./session-mode.js";

const script = String.raw`
const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const q=JSON.parse(line);fs.appendFileSync(process.argv[1],q.method+'\n');
 const send=result=>process.stdout.write(JSON.stringify({id:q.id,result})+'\n');
 if(q.method==='initialize')return send({});
 if(q.method==='initialized')return;
 if(q.method!=='thread/turns/list')return process.exit(91);
 send({data:[{id:'live-turn',status:'interrupted',startedAt:1,completedAt:2,durationMs:1000,items:[
 {id:'public',type:'agentMessage',phase:'commentary',text:'Still working'},
 {id:'tool',type:'commandExecution',command:'never-run-this-fixture-command',status:'completed',aggregatedOutput:'x'.repeat(20*1024*1024)}]}],nextCursor:null});
});rl.on('close',()=>process.exit(0));`;

test("production gateway uses owner state for independent chat history and metadata without tool body ingress", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "activity-gateway-"));
  const app = Fastify(),
    journal = join(root, "reader-methods");
  const calls: Array<{ path: string; body: any }> = [];
  const scope = { status: "active", turn: "inProgress" };
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:1234",
    attachmentRoot: join(root, "uploads"),
    loadDetailChannel: async () => ({
      registerLocalItemDetailChannel: () => {},
      registerLocalChatHistoryChannel: (
        instance,
        _dataDir,
        fallback,
        readCurrentTurn,
      ) => {
        registerChatHistoryChannel(
          instance,
          {
            launch: {
              command: process.execPath,
              args: ["-e", script, journal],
            },
          },
          "/api/session/api/codex/thread/turns/list",
          fallback,
          readCurrentTurn,
        );
      },
    }),
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname,
        body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ path, body });
      if (path === "/api/internal/codex/queue-holds")
        return new Response(null, { status: 404 });
      if (path === "/health") return Response.json({ instance: "fixture" });
      if (path === "/api/events")
        throw new Error("No production event stream in this fixture");
      if (path === "/api/codex/thread/metadata")
        return Response.json({
          thread: {
            id: body.threadId,
            status: { type: scope.status, activeFlags: [] },
          },
        });
      if (path === "/api/codex/thread/turns/list") {
        assert.deepEqual(body, {
          threadId: "fixture-thread",
          limit: 1,
          sortDirection: "desc",
          itemsView: "notLoaded",
        });
        return Response.json({
          data: [
            {
              id: "live-turn",
              status: scope.turn,
              startedAt: 1,
              completedAt: null,
              durationMs: null,
            },
          ],
          nextCursor: null,
        });
      }
      throw new Error(`Unexpected owner operation: ${path}`);
    },
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/thread/turns/list?view=chat",
    payload: { threadId: "fixture-thread", limit: 1, itemsView: "full" },
  });
  assert.equal(response.statusCode, 200, response.body);
  const turn = response.json().data[0];
  assert.equal(turn.status, "inProgress");
  assert.equal(turn.completedAt, null);
  assert.equal(turn.durationMs, null);
  assert.equal(turn.items[0].text, "Still working");
  assert.equal(turn.items[1].aggregatedOutput, null);
  assert.ok(response.body.length < 2048);
  const methods = (await readFile(journal, "utf8")).trim().split("\n");
  assert.deepEqual(methods, ["initialize", "initialized", "thread/turns/list"]);
  const metadata = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/thread/turns/list?view=chat",
    payload: {
      threadId: "fixture-thread",
      limit: 1,
      sortDirection: "desc",
      itemsView: "notLoaded",
    },
  });
  assert.equal(metadata.statusCode, 200, metadata.body);
  assert.equal(metadata.json().data[0].status, "inProgress");
  assert.equal(metadata.json().data[0].items, undefined);
  assert.equal((await readFile(journal, "utf8")).trim().split("\n").length, 3);
  const activity = await app.inject({
    method: "POST",
    url: "/api/session/codex/activity",
    payload: { threadId: "fixture-thread" },
  });
  assert.equal(activity.statusCode, 200, activity.body);
  assert.equal(activity.json().turn.id, "live-turn");
  assert.equal(activity.json().status.type, "active");
  scope.status = "idle";
  scope.turn = "completed";
  const completed = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/thread/turns/list?view=chat",
    payload: { threadId: "fixture-thread", limit: 1, itemsView: "full" },
  });
  assert.equal(completed.json().data[0].status, "completed");
  assert.equal(
    calls.some((c) =>
      /resume|access|acquire|start|interrupt|steer/.test(c.path),
    ),
    false,
  );
});
