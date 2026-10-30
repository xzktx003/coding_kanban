import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { request as httpRequest } from "node:http";
import { createServer as httpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const sha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const ticks = (stat: string) =>
  stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/)[19];
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
function crc32(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
// A valid 1x1 PNG with a benign ancillary text chunk exceeds the inline-image
// budget, so both providers must use the real explicit binary reader.
const imageMetadata = Buffer.from(
  "Comment\0" + "private source image metadata ".repeat(5_000),
);
const metadataChunk = Buffer.alloc(imageMetadata.length + 12);
metadataChunk.writeUInt32BE(imageMetadata.length, 0);
metadataChunk.write("tEXt", 4);
imageMetadata.copy(metadataChunk, 8);
metadataChunk.writeUInt32BE(
  crc32(metadataChunk.subarray(4, -4)),
  metadataChunk.length - 4,
);
export const sourceImage = Buffer.concat([
  tinyPng.subarray(0, -12),
  metadataChunk,
  tinyPng.subarray(-12),
]);

/** Requires an explicit immutable candidate. Never imports the changing checkout's product code. */
export async function auxiliaryHistoryCompatibilityFixture() {
  const candidate = process.env.SESSION_AUXILIARY_HISTORY_CANDIDATE_ROOT;
  assert.ok(
    candidate && candidate.startsWith("/"),
    "Set SESSION_AUXILIARY_HISTORY_CANDIDATE_ROOT to the reviewed candidate",
  );
  const require = createRequire(join(candidate, "apps/server/package.json"));
  const gatewayModule = join(
    candidate,
    "apps/server/dist/routes/session-mode.js",
  );
  const library =
    require.resolve("@agent-orchestrator/session-runtime/auxiliary-history");
  assert.equal(
    library,
    join(
      candidate,
      "packages/session-runtime/dist/auxiliary-history-channel.js",
    ),
  );
  const { registerSessionModeRoutes } = await import(
    pathToFileURL(gatewayModule).href
  );
  const Fastify = require("fastify"),
    Database = require("better-sqlite3");
  const root = await mkdtemp(join(tmpdir(), "aux-browser-20261030-"));
  const data = join(root, "data"),
    home = join(root, "native"),
    claude = join(home, ".claude"),
    cwd = join(root, "project");
  const ccNativeId = randomUUID(),
    ccAlias = randomUUID(),
    acpId = `aux-browser-${randomUUID()}`;
  const ccTitle = "Auxiliary compatibility Claude source",
    acpTitle = "Auxiliary compatibility ACP source";
  const folder = join(claude, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  await Promise.all([
    mkdir(join(data, ".codexia"), { recursive: true, mode: 0o700 }),
    mkdir(folder, { recursive: true, mode: 0o700 }),
    mkdir(cwd, { mode: 0o700 }),
  ]);
  let parent: string | null = null;
  const ccRows = Array.from({ length: 270 }, (_, index) => {
    const uuid = randomUUID(),
      type = index % 2 ? "assistant" : "user";
    const text =
      index === 269
        ? "CC_RECENT_FINAL_FROM_PRIVATE_SDK"
        : index === 268
          ? "CC_EXACT_LONG_ORIGINAL_FROM_PRIVATE_SDK " +
            "sdk-original-content ".repeat(9_000)
          : `CC_OLDER_${String(index).padStart(3, "0")}_FROM_PRIVATE_SDK`;
    const row = {
      type,
      uuid,
      parentUuid: parent,
      sessionId: ccNativeId,
      cwd,
      timestamp: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
      message: {
        role: type,
        content: [
          { type: "text", text },
          ...(index === 268
            ? [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: sourceImage.toString("base64"),
                  },
                },
              ]
            : []),
        ],
      },
    };
    parent = uuid;
    return row;
  });
  const ccFile = join(folder, `${ccNativeId}.jsonl`);
  await writeFile(
    ccFile,
    ccRows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    { mode: 0o600 },
  );
  const aliases = join(data, ".codexia/cc-session-identities", sha(claude));
  await mkdir(aliases, { recursive: true, mode: 0o700 });
  const aliasFile = join(aliases, `${ccAlias}.json`);
  await writeFile(
    aliasFile,
    JSON.stringify({
      version: 1,
      sessionId: ccAlias,
      nativeSessionId: ccNativeId,
    }),
    { mode: 0o600 },
  );
  const dbPath = join(data, ".codexia/cache.db"),
    db = new Database(dbPath);
  db.exec(
    "CREATE TABLE acp_sessions(session_id TEXT PRIMARY KEY);CREATE TABLE acp_session_updates(id INTEGER PRIMARY KEY,session_id TEXT,payload TEXT,created_at TEXT);",
  );
  db.prepare("INSERT INTO acp_sessions VALUES(?)").run(acpId);
  const insert = db.prepare("INSERT INTO acp_session_updates VALUES(?,?,?,?)");
  const acpUpdates = Array.from({ length: 270 }, (_, index) => {
    if (index === 267)
      return {
        sessionUpdate: "tool_call",
        toolCallId: "aux-private-tool",
        title: "Private SQLite original tool",
        status: "completed",
        rawOutput:
          "ACP_EXACT_LONG_ORIGINAL_FROM_PRIVATE_SQLITE " +
          "sqlite-original-content ".repeat(9_000),
      };
    if (index === 268)
      return {
        sessionUpdate: "user_message_chunk",
        content: {
          type: "image",
          mimeType: "image/png",
          data: sourceImage.toString("base64"),
        },
      };
    return {
      sessionUpdate: index % 2 ? "agent_message_chunk" : "user_message_chunk",
      content: {
        type: "text",
        text:
          index === 269
            ? "ACP_RECENT_FINAL_FROM_PRIVATE_SQLITE"
            : `ACP_OLDER_${String(index).padStart(3, "0")}_FROM_PRIVATE_SQLITE`,
      },
    };
  });
  acpUpdates.forEach((update, index) =>
    insert.run(
      index + 1,
      acpId,
      JSON.stringify(update),
      new Date(1_700_000_000_000 + index * 1_000).toISOString(),
    ),
  );
  db.close();
  const sourceSnapshot = async () => {
    const source = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      return {
        cc: sha(await readFile(ccFile)),
        alias: sha(await readFile(aliasFile)),
        sqlite: sha(await readFile(dbPath)),
        tables: source
          .prepare(
            "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name",
          )
          .all(),
        sessionRows: source
          .prepare("SELECT * FROM acp_sessions ORDER BY session_id")
          .all(),
        updateRowsSha: sha(
          JSON.stringify(
            source
              .prepare("SELECT * FROM acp_session_updates ORDER BY id")
              .all(),
          ),
        ),
      };
    } finally {
      source.close();
    }
  };
  const before = await sourceSnapshot();
  const script = join(root, "legacy-http-shape.cjs"),
    instance = `aux-browser-${randomUUID()}`;
  // This is an owned HTTP model of the old protocol, not an old binary or a live runtime.
  // The body sources are actual SDK-compatible JSONL and readonly SQLite files.
  await writeFile(
    script,
    `
const http=require('node:http');let hold=false,seq=0;const pending=new Map(),events=[];
const metadata=${JSON.stringify({ ccAlias, ccNativeId, acpId, cwd, ccTitle, acpTitle })};
const reply=(r,status,body)=>{r.writeHead(status,{'content-type':'application/json'});r.end(JSON.stringify(body));};
const server=http.createServer(async(q,r)=>{let raw='';for await(const chunk of q)raw+=chunk;let body;try{body=raw?JSON.parse(raw):null}catch{};
 const path=new URL(q.url,'http://fixture').pathname,id=++seq;events.push({id,path,body,at:Date.now()});
 if(path==='/__fixture/events')return reply(r,200,{events,pending:[...pending.keys()]});
 if(path==='/__fixture/hold'){hold=body.hold;if(!hold){for(const [id,entry]of pending){pending.delete(id);entry.finish();}}return reply(r,200,{hold});}
 if(path==='/health'){const finish=()=>reply(r,200,{status:'ok',instance:process.env.SESSION_RUNTIME_INSTANCE});if(!hold)return finish();pending.set(id,{finish});r.once('close',()=>{if(pending.delete(id)&&!r.writableFinished)events.push({id,path:'health-cancelled',at:Date.now()})});return;}
 if(path==='/api/events'){r.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});r.write(': owned legacy fixture connected\\n\\n');const heartbeat=setInterval(()=>r.write(': alive\\n\\n'),250);r.once('close',()=>clearInterval(heartbeat));return;}
 if(path==='/api/cc/session-snapshot')return reply(r,404,{});
 if(path==='/api/cc/sessions')return reply(r,200,{sessions:[{session_id:metadata.ccAlias,summary:metadata.ccTitle,cwd:metadata.cwd,last_modified:1700000270000}],total:1});
 if(path==='/api/acp/sessions')return reply(r,200,[{sessionId:metadata.acpId,agentId:'aux-browser-agent',agentTitle:'Private ACP',cwd:metadata.cwd,title:metadata.acpTitle,createdAt:'2026-10-30T00:00:00Z',updatedAt:'2026-10-30T00:00:00Z',historyScope:'legacy'}]);
 if(path==='/api/acp/agents')return reply(r,200,[]);
 if(path==='/api/cc/session-messages'||path==='/api/acp/session'){events.push({id,path:'RAW_HISTORY_CALLED',source:path,at:Date.now()});return reply(r,418,{error:'Automatic raw history is forbidden by this acceptance test'});}
 if(q.method!=='GET'&&/\\/(start|load-session|new-session|prompt|send|send-message|resume|resume-session|interrupt|stop|close|cancel|authenticate|respond-permission|resolve-permission|delete-session|set-mode|set-model|set-config-option|set-permission-mode|settings)$/.test(path)){events.push({id,path:'WRITE_CALLED',source:path,at:Date.now()});return reply(r,409,{error:'Read-only navigation must not write to an Agent'});}
 return reply(r,200,path.includes('skills')||path.includes('commands')||path.includes('sessions')?[]:{});
});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
process.on('SIGTERM',()=>{for(const entry of pending.values())entry.finish();pending.clear();server.closeAllConnections();server.close(()=>process.exit(0));});
`,
    { mode: 0o600 },
  );
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: {
      HOME: home,
      CLAUDE_CONFIG_DIR: claude,
      PATH: process.env.PATH,
      SESSION_DATA_HOME: data,
      SESSION_RUNTIME_INSTANCE: instance,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (bytes) => {
    stderr = (stderr + bytes).slice(-4_000);
  });
  const lines = createInterface({ input: child.stdout });
  const ownedPid = child.pid!,
    ownedTicks = ticks(await readFile(`/proc/${child.pid}/stat`, "utf8"));
  const failedStartupCleanup: Array<() => Promise<unknown>> = [
    async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      assert.equal(
        ticks(await readFile(`/proc/${ownedPid}/stat`, "utf8")),
        ownedTicks,
      );
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    },
  ];
  try {
    const started = await Promise.race([
      once(lines, "line", { signal: AbortSignal.timeout(10_000) }).then(
        ([line]) => JSON.parse(String(line)),
      ),
      once(child, "exit").then(([code]) => {
        throw new Error(`Owned legacy HTTP fixture exited ${code}: ${stderr}`);
      }),
    ]);
    lines.close();
    const pid = child.pid!,
      startTicks = ticks(await readFile(`/proc/${pid}/stat`, "utf8")),
      runtimeOrigin = `http://127.0.0.1:${started.port}`;
    assert.equal(await readlink(`/proc/${pid}/cwd`), root);
    const record = {
      pid,
      startTicks,
      port: started.port,
      instance,
      binary: process.execPath,
      entrypoint: script,
    };
    const recordPath = join(data, "runtime.json");
    await writeFile(recordPath, JSON.stringify(record), { mode: 0o600 });
    const gateway = Fastify();
    failedStartupCleanup.push(() => gateway.close());
    const requests: Array<{
      path: string;
      body: any;
      status?: number;
      bytes?: number;
      aborted?: boolean;
    }> = [];
    gateway.addHook("onRequest", async (request: any, reply: any) => {
      const item: any = { path: request.raw.url };
      requests.push(item);
      reply.raw.once("close", () => {
        if (!reply.raw.writableFinished) item.aborted = true;
      });
      request.auxCompatibilityRecord = item;
    });
    gateway.addHook("preHandler", async (request: any) => {
      request.auxCompatibilityRecord.body = request.body;
    });
    gateway.addHook(
      "onSend",
      async (request: any, reply: any, payload: any) => {
        Object.assign(request.auxCompatibilityRecord, {
          status: reply.statusCode,
          bytes:
            typeof payload === "string"
              ? Buffer.byteLength(payload)
              : Buffer.isBuffer(payload)
                ? payload.length
                : undefined,
        });
        return payload;
      },
    );
    registerSessionModeRoutes(gateway, {
      origin: runtimeOrigin,
      attachmentRoot: join(data, "uploads"),
    });
    await gateway.listen({ host: "127.0.0.1", port: 0 });
    const httpOrigin = gateway.listeningOrigin;
    const keyPath = join(root, "fixture.key"),
      certPath = join(root, "fixture.crt");
    await promisify(execFile)("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ]);
    const proxyRequests: Array<{
      path: string;
      aborted?: boolean;
      status?: number;
    }> = [];
    const frontDoor = httpsServer(
      { key: await readFile(keyPath), cert: await readFile(certPath) },
      (request, reply) => {
        const item = {
          path: request.url ?? "",
        } as (typeof proxyRequests)[number];
        proxyRequests.push(item);
        const cors = {
          "access-control-allow-origin": request.headers.origin ?? "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers":
            request.headers["access-control-request-headers"] ??
            "content-type, authorization, x-session-read-priority",
          "access-control-expose-headers":
            "content-length, x-history-image-width, x-history-image-height, x-history-image-revision",
          "access-control-allow-private-network": "true",
        };
        if (request.method === "OPTIONS") {
          reply.writeHead(204, cors);
          reply.end();
          return;
        }
        if (
          !/^\/api\/session\/api\/(?:(?:cc|acp)\/|events(?:\?|$))/.test(
            item.path,
          )
        ) {
          reply.writeHead(404, cors);
          reply.end();
          return;
        }
        // A native streaming reverse proxy, rather than route.fetch()/fulfill().
        // Browser cancellation destroys the actual HTTP/1 gateway connection even
        // when the gateway is still waiting for the runtime's metadata headers.
        const upstream = httpRequest(
          new URL(item.path, httpOrigin),
          {
            method: request.method,
            headers: { ...request.headers, host: new URL(httpOrigin).host },
            agent: false,
          },
          (response) => {
            item.status = response.statusCode;
            reply.writeHead(response.statusCode ?? 502, {
              ...response.headers,
              ...cors,
            });
            response.pipe(reply);
          },
        );
        const cancel = () => {
          item.aborted = true;
          upstream.destroy();
        };
        request.once("aborted", cancel);
        reply.once("close", () => {
          if (!reply.writableFinished) cancel();
        });
        upstream.once("error", () => {
          if (!reply.destroyed && !reply.writableEnded) {
            if (!reply.headersSent) reply.writeHead(502, cors);
            reply.end();
          }
        });
        request.pipe(upstream);
      },
    );
    failedStartupCleanup.push(async () => {
      frontDoor.closeAllConnections();
      await new Promise<void>((accept) => frontDoor.close(() => accept()));
    });
    await new Promise<void>((accept) =>
      frontDoor.listen(0, "127.0.0.1", accept),
    );
    const origin = `https://127.0.0.1:${(frontDoor.address() as { port: number }).port}`;
    const control = async (path: string, body?: unknown) => {
      const response = await fetch(runtimeOrigin + path, {
        method: body === undefined ? "GET" : "POST",
        ...(body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
      assert.equal(response.status, 200);
      return response.json() as Promise<any>;
    };
    let closed = false;
    return {
      origin,
      httpOrigin,
      proxyRequests,
      cwd,
      ccAlias,
      ccNativeId,
      acpId,
      ccTitle,
      acpTitle,
      ccItemId: ccRows[268].uuid,
      acpToolItemId: `acp-tool-${sha("aux-private-tool").slice(0, 24)}`,
      acpImageItemId: "source-269",
      requests,
      provenance: {
        candidate: resolve(candidate),
        gatewayModule,
        gatewaySha: sha(await readFile(gatewayModule)),
        library,
        librarySha: sha(await readFile(library)),
        runtime: {
          ...record,
          cwd: root,
          nativeHome: home,
          claudeConfigDir: claude,
        },
        transport:
          "Browser HTTPS -> owned HTTPS front door -> native streaming http.request -> candidate HTTP/1 Fastify -> verified private legacy HTTP metadata and actual file reader",
        boundary:
          "Owned old-protocol HTTP simulation, not an old runtime binary or a live legacy deployment. Actual private SDK JSONL and readonly source SQLite feed the candidate production gateway and compiled auxiliary reader.",
      },
      events: () => control("/__fixture/events"),
      holdHealth: (hold: boolean) => control("/__fixture/hold", { hold }),
      invalidateSource: () =>
        writeFile(
          recordPath,
          JSON.stringify({ ...record, instance: "wrong-source-instance" }),
          { mode: 0o600 },
        ),
      assertSourcesUnchanged: async () => {
        const after = await sourceSnapshot();
        assert.deepEqual(after, before);
        return { before, after, byteIdentical: true };
      },
      async close() {
        if (closed) return;
        closed = true;
        await control("/__fixture/hold", { hold: false });
        const runtimeEvents = await control("/__fixture/events");
        frontDoor.closeAllConnections();
        await new Promise<void>((accept) => frontDoor.close(() => accept()));
        await gateway.close();
        if (child.exitCode === null && child.signalCode === null) {
          assert.equal(
            ticks(await readFile(`/proc/${pid}/stat`, "utf8")),
            startTicks,
            "Only stop the exact owned fixture process",
          );
          const exited = once(child, "exit");
          child.kill("SIGTERM");
          await exited;
        }
        const result = {
          runtimeEvents,
          proxyRequests,
          ownedProcess: {
            pid,
            startTicks,
            exited: child.exitCode !== null || child.signalCode !== null,
          },
        };
        await rm(root, { recursive: true, force: true });
        return result;
      },
    };
  } catch (error) {
    lines.close();
    const failures: unknown[] = [];
    for (const cleanup of failedStartupCleanup.reverse()) {
      try {
        await cleanup();
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (!failures.length) await rm(root, { recursive: true, force: true });
    throw failures.length
      ? new AggregateError(
          [error, ...failures],
          "Owned auxiliary fixture startup and cleanup failed",
        )
      : error;
  }
}
