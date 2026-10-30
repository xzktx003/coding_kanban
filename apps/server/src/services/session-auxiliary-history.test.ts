import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { globalAgent } from "node:http";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test, { type TestContext } from "node:test";
import Fastify from "fastify";
import { registerSessionModeRoutes } from "../routes/session-mode.js";
import { SessionAuxiliaryHistory } from "./session-auxiliary-history.js";

async function fixture(t: TestContext, overrides: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "owned-auxiliary-runtime-"));
  const dataHome = join(root, "data"),
    home = join(root, "native"),
    config = join(home, ".claude"),
    script = join(root, "legacy.cjs");
  await mkdir(join(dataHome, ".codexia"), { recursive: true, mode: 0o700 });
  await mkdir(config, { recursive: true, mode: 0o700 });
  if (overrides.SESSION_DATA_HOME === "__other__") {
    overrides = { ...overrides, SESSION_DATA_HOME: join(root, "other-data") };
    await mkdir(overrides.SESSION_DATA_HOME!, { mode: 0o700 });
  }
  if (overrides.CLAUDE_CONFIG_DIR === "__overlap__") {
    overrides = {
      ...overrides,
      CLAUDE_CONFIG_DIR: join(dataHome, ".auxiliary-history"),
    };
    await mkdir(overrides.CLAUDE_CONFIG_DIR!, { mode: 0o700 });
  }
  await writeFile(
    script,
    `const http=require('node:http'),fs=require('node:fs');const s=http.createServer((q,r)=>{r.setHeader('content-type','application/json');if(q.url==='/health')r.end(JSON.stringify({status:'ok',instance:process.env.SESSION_RUNTIME_INSTANCE}));else if(q.url==='/api/cc/session-snapshot'){const p=process.env.SESSION_DATA_HOME+'/fixture-snapshot.json';if(fs.existsSync(p))r.end(fs.readFileSync(p));else{r.statusCode=404;r.end('{}');}}else if(q.url.startsWith('/api/cc/')||q.url.startsWith('/api/acp/')){fs.appendFileSync(process.env.SESSION_DATA_HOME+'/raw-hits','1');r.end(JSON.stringify([{content:'PRIVATE_LEGACY_BODY'+'x'.repeat(3*1024*1024)}]));}else r.end('{}');});s.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:s.address().port})));process.on('SIGTERM',()=>s.close(()=>process.exit(0)));`,
  );
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: {
      HOME: home,
      CLAUDE_CONFIG_DIR: config,
      PATH: process.env.PATH,
      SESSION_DATA_HOME: dataHome,
      SESSION_RUNTIME_INSTANCE: "owned-private-fixture",
      ...overrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let startTicks: string | undefined;
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      if (startTicks) {
        const value = await readFile(`/proc/${child.pid}/stat`, "utf8");
        assert.equal(
          value.slice(value.lastIndexOf(")") + 2).split(" ")[19],
          startTicks,
        );
      }
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    assert.ok(
      child.exitCode !== null || child.signalCode !== null,
      "owned fixture child must exit",
    );
    console.log(
      "OWNED_AUXILIARY_FIXTURE_CLEANUP",
      JSON.stringify({ pid: child.pid, startTicks, exited: true }),
    );
    await rm(root, { recursive: true, force: true });
  });
  const lines = createInterface({ input: child.stdout! });
  const ready = await once(lines, "line");
  lines.close();
  const procStat = await readFile(`/proc/${child.pid}/stat`, "utf8");
  startTicks = procStat.slice(procStat.lastIndexOf(")") + 2).split(" ")[19];
  const port = JSON.parse(String(ready[0])).port;
  const record = {
    pid: child.pid!,
    port,
    instance: "owned-private-fixture",
    binary: process.execPath,
    entrypoint: script,
  };
  const recordPath = join(dataHome, "runtime.json");
  await writeFile(recordPath, JSON.stringify(record), { mode: 0o600 });
  let origin = `http://127.0.0.1:${port}`;
  return {
    dataHome,
    home,
    config,
    root,
    child,
    record,
    recordPath,
    origin: () => origin,
    setOrigin: (value: string) => {
      origin = value;
    },
    async noRawHits() {
      await assert.rejects(readFile(join(dataHome, "raw-hits")), {
        code: "ENOENT",
      });
    },
  };
}
function library(read?: () => Promise<void>) {
  const created: any[] = [],
    calls: any[] = [];
  return {
    created,
    calls,
    load: async () =>
      ({
        createAuxiliaryHistoryReader(options: any) {
          created.push(options);
          return {
            async readRecent(
              provider: string,
              id: string,
              value: any,
              signal: AbortSignal,
            ) {
              await options.verifySource(signal);
              await read?.();
              calls.push({ provider, id, value });
              return {
                data: value.metadataOnly
                  ? []
                  : [
                      {
                        uuid: "answer",
                        session_id: id,
                        message: {
                          content: [
                            { type: "text", text: "local readonly answer" },
                          ],
                        },
                      },
                    ],
                projection: "cc-messages",
                nextCursor: null,
                revision: "a".repeat(64),
                truncated: false,
              };
            },
            async readDetail() {
              return {
                text: "local detail",
                nextOffset: null,
                format: "json",
                itemRevision: "b".repeat(64),
                revision: "a".repeat(64),
              };
            },
            async readImage() {
              return {
                bytes: Buffer.from("private image"),
                mimeType: "image/png",
                extension: "png",
                width: 1,
                height: 1,
                revision: "c".repeat(64),
              };
            },
          };
        },
        historyImageHeaders(image: any) {
          return { "content-type": image.mimeType };
        },
      }) as any,
  };
}

test("verified owned runtime pins source environment and uses an independent reader without raw requests", async (t) => {
  const f = await fixture(t),
    l = library();
  const service = new SessionAuxiliaryHistory({
    attachmentRoot: join(f.dataHome, "uploads"),
    origin: f.origin,
    loadLibrary: l.load,
  });
  const response = await service.recent(
    "cc",
    "fixture",
    { metadataOnly: true },
    new AbortController().signal,
  );
  assert.equal(response.status, 200);
  assert.equal(l.created.length, 1);
  assert.equal(l.created[0].dataHome, f.dataHome);
  assert.equal(l.created[0].nativeEnv.HOME, f.home);
  assert.equal(l.created[0].nativeEnv.CLAUDE_CONFIG_DIR, f.config);
  assert.equal(l.created[0].nativeEnv.NODE_OPTIONS, undefined);
  assert.equal(l.created[0].nativeEnv.ANTHROPIC_API_KEY, undefined);
  assert.match(l.created[0].sourceScope, /^[a-f0-9]{64}$/);
  assert.ok(
    l.created[0].cacheHome.startsWith(join(f.dataHome, ".auxiliary-history")),
  );
  await f.noRawHits();
});

for (const changed of [
  "origin",
  "instance",
  "pid",
  "port",
  "entrypoint",
  "startTicks",
  "record-mode",
  "record-symlink",
] as const) {
  test(`source anchor rejects a changed ${changed} before a local history read and never rebinds`, async (t) => {
    const f = await fixture(t),
      l = library();
    const service = new SessionAuxiliaryHistory({
      attachmentRoot: join(f.dataHome, "uploads"),
      origin: f.origin,
      loadLibrary: l.load,
    });
    await service.recent("cc", "fixture", {}, new AbortController().signal);
    if (changed === "origin") f.setOrigin("http://127.0.0.1:1");
    else if (changed === "record-mode") await chmod(f.recordPath, 0o644);
    else if (changed === "record-symlink") {
      await rm(f.recordPath);
      await writeFile(join(f.root, "other.json"), JSON.stringify(f.record));
      await symlink(join(f.root, "other.json"), f.recordPath);
    } else
      await writeFile(
        f.recordPath,
        JSON.stringify({
          ...f.record,
          [changed]:
            changed === "pid"
              ? process.pid
              : changed === "port"
                ? 1
                : "changed",
        }),
      );
    await assert.rejects(
      service.recent("cc", "fixture", {}, new AbortController().signal),
      (error: any) => error.statusCode === 501,
    );
    assert.equal(l.calls.length, 1);
    assert.equal(l.created.length, 1);
    await f.noRawHits();
  });
}

test("source binding rejects the runtime environment's unrelated data directory and missing HOME", async (t) => {
  const environments: Array<Record<string, string>> = [
    { SESSION_DATA_HOME: "__other__" },
    { HOME: "" },
  ];
  for (const env of environments) {
    const f = await fixture(t, env),
      l = library();
    const service = new SessionAuxiliaryHistory({
      attachmentRoot: join(f.dataHome, "uploads"),
      origin: f.origin,
      loadLibrary: l.load,
    });
    await assert.rejects(
      service.recent("cc", "fixture", {}, new AbortController().signal),
      (error: any) => error.statusCode === 501,
    );
    assert.equal(l.created.length, 0);
    await f.noRawHits();
  }
});

test("a source change while the independent reader is running prevents publication", async (t) => {
  const f = await fixture(t),
    l = library(async () => {
      await writeFile(
        f.recordPath,
        JSON.stringify({ ...f.record, instance: "new-instance" }),
      );
    });
  const service = new SessionAuxiliaryHistory({
    attachmentRoot: join(f.dataHome, "uploads"),
    origin: f.origin,
    loadLibrary: l.load,
  });
  await assert.rejects(
    service.recent("cc", "fixture", {}, new AbortController().signal),
    (error: any) => error.statusCode === 501,
  );
  assert.equal(l.calls.length, 1);
  await f.noRawHits();
});

test("Claude identity resolution accepts only the exact verified snapshot and leaves unsupported aliases to readonly source evidence", async (t) => {
  const f = await fixture(t),
    l = library();
  const service = new SessionAuxiliaryHistory({
    attachmentRoot: join(f.dataHome, "uploads"),
    origin: f.origin,
    loadLibrary: l.load,
  });
  await service.recent("cc", "managed", {}, new AbortController().signal);
  const resolve = l.created[0].resolveClaudeSession;
  assert.equal(
    await resolve("managed", new AbortController().signal),
    undefined,
  );
  const value = {
    runtimeInstance: f.record.instance,
    sessionId: "managed",
    eventSessionId: "managed",
    nativeSessionId: "native",
    cwd: f.home,
  };
  const write = (data: unknown) =>
    writeFile(join(f.dataHome, "fixture-snapshot.json"), JSON.stringify(data));
  await write(value);
  assert.equal(
    await resolve("managed", new AbortController().signal),
    "native",
  );
  for (const invalid of [
    { ...value, runtimeInstance: "other" },
    { ...value, sessionId: "other" },
    { ...value, nativeSessionId: {} },
    { ...value, eventSessionId: "" },
  ]) {
    await write(invalid);
    await assert.rejects(
      resolve("managed", new AbortController().signal),
      (error: any) => error.statusCode === 409,
    );
  }
  assert.equal(l.created[0].claudeIdentityRoot, f.config);
  await f.noRawHits();
});

test("a matching health instance on another owned process cannot replace exact PID socket ownership", async (t) => {
  const f = await fixture(t),
    other = await fixture(t),
    l = library();
  f.setOrigin(other.origin());
  await writeFile(
    f.recordPath,
    JSON.stringify({ ...f.record, port: other.record.port }),
  );
  const service = new SessionAuxiliaryHistory({
    attachmentRoot: join(f.dataHome, "uploads"),
    origin: f.origin,
    loadLibrary: l.load,
  });
  await assert.rejects(
    service.recent("cc", "fixture", {}, new AbortController().signal),
    (error: any) => error.statusCode === 501,
  );
  assert.equal(l.created.length, 0);
  await f.noRawHits();
  await other.noRawHits();
});

test("cache/source overlap is rejected before the source receives any derivative directory", async (t) => {
  const f = await fixture(t, { CLAUDE_CONFIG_DIR: "__overlap__" });
  const service = new SessionAuxiliaryHistory({
    attachmentRoot: join(f.dataHome, "uploads"),
    origin: f.origin,
    loadLibrary: async () =>
      ({
        createAuxiliaryHistoryReader() {
          throw new Error("Rejected cache/source overlap");
        },
      }) as any,
  });
  await assert.rejects(
    service.recent("cc", "fixture", {}, new AbortController().signal),
    (error: any) => error.statusCode === 501,
  );
  assert.deepEqual(await readdir(join(f.dataHome, ".auxiliary-history")), []);
  await f.noRawHits();
});

test("source metadata bypasses the gateway global HTTP agent and its proxy configuration", async (t) => {
  const f = await fixture(t),
    l = library();
  // Node uses this runtime method internally; its public Agent type omits it.
  const original: unknown = Reflect.get(globalAgent, "addRequest");
  assert.ok(typeof original === "function");
  const agent = globalAgent as typeof globalAgent & {
    addRequest: (...args: unknown[]) => unknown;
  };
  let calls = 0;
  t.mock.method(
    agent,
    "addRequest",
    function (this: typeof agent, ...args: unknown[]) {
      calls++;
      return Reflect.apply(original, this, args);
    },
  );
  const service = new SessionAuxiliaryHistory({
    attachmentRoot: join(f.dataHome, "uploads"),
    origin: f.origin,
    loadLibrary: l.load,
  });
  await service.recent("cc", "fixture", {}, new AbortController().signal);
  assert.equal(
    calls,
    0,
    "source metadata must not use a gateway-global proxy/connection pool",
  );
  await f.noRawHits();
});

test("a missing source record and pre-cancelled read never use an upstream history fallback", async (t) => {
  const f = await fixture(t),
    l = library();
  await rm(f.recordPath);
  const service = new SessionAuxiliaryHistory({
    attachmentRoot: join(f.dataHome, "uploads"),
    origin: f.origin,
    loadLibrary: l.load,
  });
  await assert.rejects(
    service.recent("cc", "fixture", {}, new AbortController().signal),
    (error: any) => error.statusCode === 501,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    service.recent("cc", "fixture", {}, controller.signal),
    (error: any) => error.name === "AbortError",
  );
  assert.equal(l.created.length, 0);
  await f.noRawHits();
  assert.equal((await fetch(f.origin() + "/health")).status, 200);
});

test("configured gateway reads recent, detail and image from the verified independent library before the old runtime", async (t) => {
  const f = await fixture(t),
    l = library(),
    app = Fastify();
  registerSessionModeRoutes(app, {
    origin: f.origin(),
    attachmentRoot: join(f.dataHome, "uploads"),
    loadAuxiliaryHistory: l.load,
  } as any);
  t.after(() => app.close());
  const recent = await app.inject({
    method: "POST",
    url: "/api/session/api/cc/session-messages?view=recent",
    payload: { session_id: "fixture" },
  });
  assert.equal(recent.statusCode, 200, recent.body.slice(0, 512));
  assert.equal(
    recent.json().data[0].message.content[0].text,
    "local readonly answer",
  );
  const detail = await app.inject({
    method: "POST",
    url: "/api/session/api/cc/session-message-detail",
    payload: {
      session_id: "fixture",
      item_id: "answer",
      offset: 0,
      limit: 65536,
    },
  });
  assert.equal(detail.statusCode, 200, detail.body.slice(0, 512));
  assert.equal(detail.json().text, "local detail");
  const image = await app.inject({
    method: "POST",
    url: "/api/session/api/cc/session-message-image",
    payload: { session_id: "fixture", item_id: "answer", image_index: 0 },
  });
  assert.equal(image.statusCode, 200, image.body.slice(0, 512));
  assert.equal(image.body, "private image");
  await f.noRawHits();
});
