import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerLocalItemDetailChannel } from "@agent-orchestrator/session-runtime/item-detail";

test("gateway owns a fixed read-only detail channel without replacing or calling an old session runtime", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "gateway-detail-owned-"));
  const binary = join(directory, "codex-fixture.cjs"),
    data = join(directory, "data"),
    home = join(directory, "home");
  await mkdir(home);
  await writeFile(
    binary,
    `#!${process.execPath}\nconst readline=require('node:readline');const fs=require('node:fs');const log=${JSON.stringify(join(directory, "methods.jsonl"))};const rl=readline.createInterface({input:process.stdin});rl.on('line',line=>{const q=JSON.parse(line);fs.appendFileSync(log,JSON.stringify(q)+'\\n');if(q.method==='initialize')console.log(JSON.stringify({id:1,result:{}}));else if(q.method==='thread/read')console.log(JSON.stringify({id:2,result:{thread:{id:q.params.threadId,turns:[{id:'turn',items:[{type:'commandExecution',id:'item',command:'fixture-never-execute',cwd:'/fixture',status:'completed',aggregatedOutput:'ONLY_SELECTED_OUTPUT',exitCode:0,durationMs:1}]}]}}}));else if(q.method!=='initialized')process.exit(88);});rl.on('close',()=>process.exit(0));\n`,
    { mode: 0o700 },
  );
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  registerLocalItemDetailChannel(app, data, {
    HOME: home,
    CODEX_HOME: join(home, "codex"),
    CODEX_PATH: binary,
    PATH: "/usr/bin:/bin",
  });
  const body = {
    threadId: "thread",
    turnId: "turn",
    itemId: "item",
    expectedType: "commandExecution",
  };
  const invalid = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/thread/item-detail",
    payload: { ...body, path: "/forbidden" },
  });
  assert.equal(invalid.statusCode, 400);
  const query = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/thread/item-detail?view=chat",
    payload: body,
  });
  assert.equal(query.statusCode, 400);
  const result = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/thread/item-detail",
    payload: body,
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.json().item.aggregatedOutput, "ONLY_SELECTED_OUTPUT");
  const { readFile } = await import("node:fs/promises");
  const requests = (await readFile(join(directory, "methods.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    requests.map((q) => q.method),
    ["initialize", "initialized", "thread/read"],
  );
  assert.deepEqual(requests[2].params, {
    threadId: "thread",
    includeTurns: true,
  });
});
