import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  appendFile,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { Dictation } from "./dictation.js";
import { Insights } from "./insights.js";
import { Telemetry } from "./telemetry.js";
import { Publisher } from "./publish.js";
import { DeviceToken } from "./device.js";
import { Desktop } from "./desktop.js";
import type { FastifyRequest } from "fastify";
async function temp() {
  return mkdtemp(join(tmpdir(), "platform-contract-"));
}
async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("condition did not settle");
}
test("download streams atomically, deduplicates, cancels, rejects incomplete models", async () => {
  const home = await temp();
  let calls = 0;
  let mode = "complete";
  const fetcher: typeof fetch = async (_url, options) => {
    calls++;
    options?.signal?.throwIfAborted();
    if (mode === "wait")
      return new Promise((_resolve, reject) =>
        options?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        ),
      );
    return new Response(new Uint8Array(mode === "complete" ? 1048576 : 12));
  };
  const d = new Dictation(home, {}, fetcher);
  try {
    await Promise.all([
      d.download({ modelId: "tiny" }),
      d.download({ modelId: "tiny" }),
    ]);
    await eventually(
      async () => (await d.status({ modelId: "tiny" })).state === "ready",
    );
    assert.equal(calls, 1);
    assert.equal(
      (await readFile(join(home, "dictation/ggml-tiny.bin"))).length,
      1048576,
    );
    await d.remove({ modelId: "tiny" });
    mode = "wait";
    await d.download({ modelId: "tiny" });
    await assert.rejects(d.remove({ modelId: "tiny" }), /Cancel/);
    assert.equal((await d.cancel({ modelId: "tiny" })).state, "missing");
    mode = "short";
    await d.download({ modelId: "tiny" });
    await eventually(
      async () => (await d.status({ modelId: "tiny" })).state === "error",
    );
    assert.equal((await readdir(join(home, "dictation"))).length, 0);
  } finally {
    await d.close();
    await rm(home, { recursive: true, force: true });
  }
});
test("dictation converts signed PCM to WAV and invokes external CLI with literal arguments", async () => {
  const home = await temp();
  await mkdir(join(home, "dictation"));
  await writeFile(join(home, "dictation/ggml-base.bin"), "fixture");
  const executable = join(home, "whisper fixture");
  await writeFile(
    executable,
    `#!/usr/bin/env node\nconst fs=require('fs');const a=process.argv.slice(2);const input=fs.readFileSync(a[a.indexOf('-f')+1]);if(input.toString('utf8',0,4)!=='RIFF'||input.readUInt32LE(24)!==16000)process.exit(3);fs.writeFileSync(a[a.indexOf('-of')+1]+'.json',JSON.stringify({transcription:[{text:' hello'},{text:' 你好 '}]}));`,
    { mode: 0o700 },
  );
  const d = new Dictation(home, {
    ...process.env,
    SESSION_WHISPER_BIN: executable,
  });
  try {
    assert.deepEqual(
      await d.transcribe({
        modelId: "base",
        data: Buffer.alloc(6400).toString("base64"),
      }),
      { text: "hello 你好" },
    );
    await assert.rejects(
      d.transcribe({
        modelId: "base",
        data: Buffer.alloc(6400).toString("base64"),
        language: "en;rm",
      }),
      /language/,
    );
    await assert.rejects(
      d.transcribe({ modelId: "base", data: "!!!!" }),
      /PCM/,
    );
  } finally {
    await d.close();
    await rm(home, { recursive: true, force: true });
  }
});
test("native insights parses Claude/Gemini and cache sees appended/deleted Codex usage", async () => {
  const home = await temp();
  const codex = join(home, ".codex");
  await mkdir(codex);
  const claude = join(home, ".claude/projects/x");
  await mkdir(claude, { recursive: true });
  const gemini = join(home, ".gemini/tmp/x/chats");
  await mkdir(gemini, { recursive: true });
  const path = join(codex, "a.jsonl");
  await writeFile(
    path,
    JSON.stringify({ type: "session_meta", payload: { id: "a", cwd: "/a" } }) +
      "\n",
  );
  await writeFile(
    join(claude, "a.jsonl"),
    JSON.stringify({
      sessionId: "c",
      cwd: "/c",
      message: {
        model: "claude",
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 4,
        },
        content: [{ type: "tool_use", name: "Read" }],
      },
    }),
  );
  await writeFile(join(claude, "agent-ignored.jsonl"), "{}");
  await writeFile(
    join(gemini, "session.json"),
    JSON.stringify({
      sessionId: "g",
      messages: [
        {
          model: "gemini",
          tokens: { input: 8, output: 2, cached: 3, thoughts: 4, total: 10 },
          toolCalls: [{ name: "search" }],
        },
      ],
    }),
  );
  await writeFile(join(gemini, "../.project_root"), "/g\n");
  const insights = new Insights({ HOME: home, CODEX_HOME: codex }, 0);
  try {
    const first = await insights.heatmaps({});
    assert.equal(first.claude?.token_stats.total_tokens, 19);
    assert.equal(first.gemini?.token_stats.reasoning_tokens, 4);
    assert.equal(first.claude?.total_files, 1);
    await appendFile(
      path,
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 7,
              output_tokens: 2,
              total_tokens: 9,
            },
          },
        },
      }),
    );
    assert.equal(
      (await insights.rankings({ agent: "Codex" })).by_session[0].total_tokens,
      9,
    );
    await rm(path);
    assert.equal((await insights.heatmaps({})).codex, null);
    assert.deepEqual((await insights.options()).cwds, ["/c", "/g"]);
    assert.equal((await insights.rankings({ cwd: "/g" })).by_cwd.length, 1);
  } finally {
    await insights.close();
    await rm(home, { recursive: true, force: true });
  }
});
test("telemetry is consent/bot gated, serially deduplicated and payload excludes identity", async () => {
  const home = await temp();
  const bodies: unknown[] = [];
  let bots = false;
  const env = { CODEXIA_TELEMETRY_URL: "http://test.local" };
  const t = new Telemetry(
    home,
    env,
    () => bots,
    "1.0",
    async (_url, init) => {
      bodies.push(JSON.parse(init!.body as string));
      return new Response("{}");
    },
  );
  try {
    await t.track("app_active");
    await t.setConsent("granted");
    await t.track("app_active");
    assert.equal(bodies.length, 0);
    bots = true;
    await Promise.all([
      t.track("app_active"),
      t.track("app_active"),
      t.track("bot_ask"),
    ]);
    assert.equal(bodies.length, 2);
    assert.deepEqual(Object.keys((bodies[0] as any).events[0]).sort(), [
      "arch",
      "name",
      "platform",
      "version",
    ]);
    await t.setConsent("denied");
    await t.track("bot_created");
    assert.equal(bodies.length, 2);
    const blocked = new Telemetry(
      home,
      { ...env, DO_NOT_TRACK: "1" },
      () => true,
      "1.0",
      async () => {
        throw new Error("must not call");
      },
    );
    assert.equal((await blocked.status()).available, false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("pairing rejects DNS rebinding and remote callers without exact token", async () => {
  const home = await temp();
  try {
    const token = await DeviceToken.load(home);
    const request = (
      ip: string,
      host: string,
      authorization?: string,
      url = "/api/pairing",
    ) => ({ ip, headers: { host, authorization }, url }) as FastifyRequest;
    assert(token.permits(request("127.0.0.1", "localhost:1")));
    assert(!token.permits(request("127.0.0.1", "evil.example")));
    assert(!token.permits(request("10.1.2.3", "localhost:1")));
    assert(
      token.permits(request("10.1.2.3", "host", `Bearer ${token.value()}`)),
    );
    assert(
      token.permits(
        request(
          "10.1.2.3",
          "host",
          undefined,
          `/events?token=${token.value()}`,
        ),
      ),
    );
    assert(
      !token.permits(
        request(
          "10.1.2.3",
          "host",
          "Bearer wrong",
          `/events?token=${token.value()}`,
        ),
      ),
    );
    assert.equal((await DeviceToken.load(home)).value(), token.value());
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("publish uses local HTTP device flow, streams only allowed files, reports stages and revokes token", async () => {
  const home = await temp();
  const received: string[] = [];
  let revoked = false;
  let origin = "";
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const b of req) chunks.push(b);
    const body = Buffer.concat(chunks);
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/connect/poll") {
      res.end(JSON.stringify({ token: "fixture-token" }));
    } else if (req.url === "/api/games/whoami") {
      res.statusCode = revoked ? 401 : 200;
      res.end(JSON.stringify({ user: "fixture" }));
    } else if (req.url === "/api/games/publish") {
      assert.equal(req.headers.authorization, "Bearer fixture-token");
      const files = JSON.parse(body.toString()).files;
      assert.deepEqual(
        files.map((f: any) => f.path),
        ["assets/app.js", "index.html"],
      );
      res.end(
        JSON.stringify({
          version: 1,
          uploads: files.map((f: any) => ({
            path: f.path,
            url: origin + "/upload/" + f.path,
            contentType: "text/plain",
          })),
        }),
      );
    } else if (req.url?.startsWith("/upload/")) {
      received.push(body.toString());
      res.end("{}");
    } else if (req.url === "/api/games/publish/complete")
      res.end(
        JSON.stringify({
          version: 1,
          playUrl: "https://play.example",
          pageUrl: "https://page.example",
        }),
      );
    else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const stages: string[] = [];
  const p = new Publisher(home, { PRODUCTSHIP_URL: origin }, (e) =>
    stages.push(String(e.stage)),
  );
  try {
    const start = p.start();
    assert.match(start.confirmCode, /^[A-F0-9]{4}-[A-F0-9]{4}$/);
    assert.deepEqual(await p.poll(start.code), { approved: true });
    assert.deepEqual(await p.whoami(), { account: { user: "fixture" } });
    await mkdir(join(home, "dist/assets"), { recursive: true });
    await writeFile(join(home, "dist/index.html"), "html");
    await writeFile(join(home, "dist/assets/app.js"), "js");
    await writeFile(join(home, "dist/assets/app.js.map"), "ignored");
    await writeFile(join(home, "dist/.env"), "secret");
    const result = await p.publish({
      cwd: home,
      outputDir: "dist",
      slug: "fixture",
      title: "Fixture",
    });
    assert.equal(result.fileCount, 2);
    assert.equal(result.totalBytes, 6);
    assert.deepEqual(received.sort(), ["html", "js"]);
    assert(
      stages.includes("scan") &&
        stages.includes("upload") &&
        stages.includes("finalize"),
    );
    revoked = true;
    assert.deepEqual(await p.whoami(), { account: null });
    assert.deepEqual(await p.whoami(), { account: null });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await rm(home, { recursive: true, force: true });
  }
});
test("open workspace uses argv so shell syntax is never interpreted", async () => {
  const home = await temp();
  const executable = join(home, "editor");
  const record = join(home, "argv.json");
  await writeFile(
    executable,
    `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(record)},JSON.stringify(process.argv.slice(2)));`,
    { mode: 0o700 },
  );
  const desktop = new Desktop({
    ...process.env,
    PATH: home + ":" + process.env.PATH,
  });
  try {
    assert.equal((await desktop.check("editor")).installed, true);
    await desktop.open(home, {
      command: executable,
      args: ["$(touch nope)", "a b"],
    });
    assert.deepEqual(JSON.parse(await readFile(record, "utf8")), [
      "$(touch nope)",
      "a b",
      home,
    ]);
    await assert.rejects(desktop.check("../editor"), /appName/);
  } finally {
    await desktop.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("maximum-length 120-second PCM is accepted without recursive base64 validation", async () => {
  const home = await temp();
  await mkdir(join(home, "dictation"));
  await writeFile(join(home, "dictation/ggml-base.bin"), "fixture");
  const executable = join(home, "whisper-max");
  await writeFile(
    executable,
    `#!/usr/bin/env node\nconst fs=require('fs'),a=process.argv.slice(2);if(fs.statSync(a[a.indexOf('-f')+1]).size!==3840044)process.exit(3);fs.writeFileSync(a[a.indexOf('-of')+1]+'.json',JSON.stringify({transcription:[{text:'full duration'}]}));`,
    { mode: 0o700 },
  );
  const d = new Dictation(home, {
    ...process.env,
    SESSION_WHISPER_BIN: executable,
  });
  try {
    assert.deepEqual(
      await d.transcribe({
        modelId: "base",
        data: Buffer.alloc(3840000).toString("base64"),
      }),
      { text: "full duration" },
    );
  } finally {
    await d.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("sleep inhibitors deduplicate by conversation, release at zero, and retry failed acquisition", async () => {
  if (process.platform !== "linux") return;
  const home = await temp();
  const executable = join(home, "systemd-inhibit");
  const log = join(home, "events");
  const desktop = new Desktop({
    ...process.env,
    PATH: home + ":" + process.env.PATH,
  });
  try {
    await writeFile(executable, "#!/bin/sh\nexit 3\n", { mode: 0o700 });
    await assert.rejects(desktop.prevent("a"), /prevent sleep/);
    await writeFile(
      executable,
      `#!/usr/bin/env node\nconst fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},'start\\n');process.stdout.write('kanban-inhibit-ready\\n');process.stdin.resume();process.stdin.on('end',()=>{fs.appendFileSync(${JSON.stringify(log)},'stop\\n');process.exit(0)});`,
      { mode: 0o700 },
    );
    await Promise.all([
      desktop.prevent("a"),
      desktop.prevent("a"),
      desktop.prevent("b"),
    ]);
    assert.equal(await readFile(log, "utf8"), "start\n");
    await desktop.allow("a");
    assert.equal(await readFile(log, "utf8"), "start\n");
    await desktop.allow("b");
    await eventually(
      async () => (await readFile(log, "utf8")) === "start\nstop\n",
    );
    await desktop.prevent("c");
    await desktop.allow();
    await eventually(
      async () =>
        (await readFile(log, "utf8")) === "start\nstop\nstart\nstop\n",
    );
  } finally {
    await desktop.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("concurrent usage readers share one result and large native history never enters the request thread", async () => {
  const home = await temp();
  const root = join(home, ".codex");
  await mkdir(root);
  const path = join(root, "large.jsonl");
  await writeFile(
    path,
    JSON.stringify({
      type: "session_meta",
      payload: { id: "large", cwd: "/project" },
    }) + "\n",
  );
  // Many sizeable tool bodies exercise native streaming and collection in a worker.
  const line =
    JSON.stringify({
      type: "response_item",
      payload: { type: "function_call_output", output: "x".repeat(128 * 1024) },
    }) + "\n";
  for (let i = 0; i < 128; i++) await appendFile(path, line);
  await appendFile(
    path,
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 12,
            output_tokens: 3,
            total_tokens: 15,
          },
        },
      },
    }) + "\n",
  );
  const insights = new Insights({ HOME: home, CODEX_HOME: root });
  let beats = 0;
  const heartbeat = setInterval(() => beats++, 1);
  try {
    const [heat, rank, options] = await Promise.all([
      insights.heatmaps({}),
      insights.rankings({}),
      insights.options(),
    ]);
    assert.equal(heat.codex?.token_stats.total_tokens, 15);
    assert.equal(rank.by_session[0].total_tokens, 15);
    assert.deepEqual(options.session_ids, ["large"]);
    assert(beats > 5, "request loop must remain responsive while scanning");
    await rm(path);
    assert.deepEqual(
      await insights.options(),
      options,
      "fresh cache survives source deletion until TTL expires",
    );
  } finally {
    clearInterval(heartbeat);
    await insights.close();
    await rm(home, { recursive: true, force: true });
  }
});
