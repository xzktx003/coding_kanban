import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerLocalItemDetailChannel } from "@agent-orchestrator/session-runtime/item-detail";

test("gateway owns an explicitly isolated read-only detail fixture without replacing or calling an old session runtime", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "gateway-detail-owned-")),
    binary = join(directory, "codex-fixture.cjs"),
    data = join(directory, "data"),
    home = join(directory, "home"),
    pidFile = join(directory, "owned-pid"),
    log = join(directory, "methods.jsonl");
  await mkdir(home);
  await writeFile(
    binary,
    String.raw`const readline = require('node:readline'), fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  const q = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(q) + '\n');
  if (q.method === 'initialize') console.log(JSON.stringify({id: q.id, result: {}}));
  else if (q.method === 'thread/read') console.log(JSON.stringify({id: q.id, result: {thread: {id: q.params.threadId, turns: [{id: 'turn', items: [{type: 'commandExecution', id: 'item', command: 'fixture-never-execute', cwd: '/fixture', status: 'completed', aggregatedOutput: 'ONLY_SELECTED_OUTPUT', exitCode: 0, durationMs: 1}]}]}}}));
  else if (q.method !== 'initialized') process.exit(88);
});
rl.on('close', () => process.exit(0));
`,
    { mode: 0o700 },
  );
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  registerLocalItemDetailChannel(
    app,
    data,
    {
      HOME: home,
      CODEX_HOME: join(home, "codex"),
      CODEX_PATH: binary,
      PATH: "/usr/bin:/bin",
    },
    { launch: { command: process.execPath, args: [binary] } },
  );
  const body = {
    threadId: "thread",
    turnId: "turn",
    itemId: "item",
    expectedType: "commandExecution",
  };
  for (const payload of [
    { ...body, path: "/forbidden" },
    { ...body, launch: { command: "/forbidden" } },
  ]) {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/api/codex/thread/item-detail",
          payload,
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/session/api/codex/thread/item-detail?view=chat",
        payload: body,
      })
    ).statusCode,
    400,
  );
  const result = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/thread/item-detail",
    payload: body,
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.json().item.aggregatedOutput, "ONLY_SELECTED_OUTPUT");
  const requests = (await readFile(log, "utf8"))
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
  const pid = Number(await readFile(pidFile, "utf8"));
  let alive = true;
  for (let attempt = 0; attempt < 100 && alive; attempt++) {
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (alive) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(
    alive,
    false,
    "the exact owned reader exits after releasing its selected detail",
  );
});
