import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { request as httpRequest } from "node:http";
import { createSecureServer } from "node:http2";
import type { ServerHttp2Session, ServerHttp2Stream } from "node:http2";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { registerSessionModeRoutes } from "../../apps/server/src/routes/session-mode";
import { registerChatHistoryChannel } from "../../packages/session-runtime/src/codex/chat-history-channel";

const require = createRequire(resolve("apps/server/package.json"));
const Fastify: typeof import("../../apps/server/node_modules/fastify").default = require("fastify");
const root = await mkdtemp(join(tmpdir(), "session-dual-page-reader-"));
const nativeLog = join(root, "native.jsonl");
const allowedOrigin = new URL(process.argv[2]).origin;
const certificate = join(root, "fixture-cert.pem");
const privateKey = join(root, "fixture-key.pem");
const generated = spawnSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    privateKey,
    "-out",
    certificate,
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ],
  { stdio: "pipe" },
);
if (generated.status !== 0)
  throw new Error("Owned HTTP/2 fixture certificate generation failed");
// Two real pages must be able to reach the original 17-request channel cap.
// HTTP/1.1's per-origin browser socket pool would stop them before that cap.
const app = Fastify();
const requests: Array<Record<string, unknown>> = [];
const source = `
const fs = require('node:fs');
const root = ${JSON.stringify(root)}, log = ${JSON.stringify(nativeLog)};
const startTicks = fs.readFileSync('/proc/self/stat', 'utf8').split(') ').at(-1).split(' ')[19];
const record = (value) => fs.appendFileSync(log, JSON.stringify({ ...value, pid: process.pid, startTicks, at: Date.now() }) + '\\n');
record({ event: 'spawn' });
process.on('exit', code => record({ event: 'exit', code }));
process.on('SIGTERM', () => { record({ event: 'SIGTERM' }); process.exit(0); });
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const q = JSON.parse(line);
  record({ event: 'method', method: q.method, ...(q.params?.threadId ? { id: q.params.threadId, params: q.params } : {}) });
  if (q.method === 'initialize') console.log(JSON.stringify({ id: q.id, result: {} }));
  else if (q.method === 'thread/turns/list') {
    if (Object.keys(q.params).some(key => /priority/i.test(key))) process.exit(98);
    const id = q.params.threadId;
    const timer = setInterval(() => {
      if (!fs.existsSync(root + '/' + id + '.release')) return;
      clearInterval(timer);
      record({ event: 'response', id });
      console.log(JSON.stringify({ id: q.id, result: { data: [{ id: 'turn-' + id, status: 'completed', items: [{ id: 'reply-' + id, type: 'agentMessage', text: 'recent page ' + id }], error: null }], nextCursor: null } }));
    }, 10);
  } else if (q.method !== 'initialized') process.exit(99);
}).on('close', () => process.exit(0));
`;

// Native browser fetch uses the owned H2 front door and real H1 app gateway.
// There is no Playwright route.fetch whose lifetime could outlive browser abort.
app.addHook("onRequest", async (request, reply) => {
  if (request.headers.origin === allowedOrigin)
    reply.header("access-control-allow-origin", allowedOrigin);
  reply.header("vary", "Origin");
  if (request.method === "OPTIONS")
    return reply
      .header("access-control-allow-methods", "POST")
      .header(
        "access-control-allow-headers",
        "content-type,x-session-read-priority",
      )
      .code(204)
      .send();
});
app.addHook("preHandler", async (request, reply) => {
  if (request.method !== "POST") return;
  const entry: Record<string, unknown> = {
    requestId: request.id,
    id: (request.body as { threadId?: string })?.threadId,
    priority: request.headers["x-session-read-priority"],
    receivedAt: Date.now(),
    httpVersion: request.raw.httpVersion,
  };
  requests.push(entry);
  reply.raw.once("close", () => {
    entry.closedAt = Date.now();
    entry.aborted = !reply.raw.writableFinished;
    if (!entry.aborted) entry.status = reply.statusCode;
  });
});
registerSessionModeRoutes(app, {
  origin: "http://127.0.0.1:1",
  attachmentRoot: join(root, "uploads"),
  loadDetailChannel: async () => ({
    registerLocalItemDetailChannel: () => {},
    registerLocalChatHistoryChannel: (scope, _data, fallback) =>
      registerChatHistoryChannel(
        scope,
        {
          env: { PATH: process.env.PATH },
          launch: { command: process.execPath, args: ["-e", source] },
        },
        "/api/session/api/codex/thread/turns/list",
        fallback,
      ),
  }),
  fetch: async () => new Response("{}"),
});
await app.listen({ host: "127.0.0.1", port: 0 });
const endpoint = "/api/session/api/codex/thread/turns/list?view=chat";
const proxyRecords: Array<Record<string, unknown>> = [];
const sessions = new Set<ServerHttp2Session>();
const proxy = createSecureServer({
  key: await readFile(privateKey),
  cert: await readFile(certificate),
  allowHTTP1: false,
});
proxy.on("session", (session) => {
  sessions.add(session);
  session.once("close", () => sessions.delete(session));
});
proxy.on("stream", (stream, headers) => {
  if (
    headers[":path"] !== endpoint ||
    !["POST", "OPTIONS"].includes(String(headers[":method"]))
  ) {
    (stream as ServerHttp2Stream).respond({ ":status": 404 });
    stream.end();
    return;
  }
  const entry: Record<string, unknown> = {
    streamId: stream.id,
    method: headers[":method"],
    httpVersion: "2.0",
    receivedAt: Date.now(),
  };
  proxyRecords.push(entry);
  let upstreamEnded = false;
  // A fixed, owned HTTP/2 front door avoids browser socket saturation while
  // retaining the actual HTTP/1 app gateway contract. Abort is forwarded by
  // destroying this exact upstream request, never by a synthetic handler call.
  const upstream = httpRequest(
    app.listeningOrigin + endpoint,
    {
      method: String(headers[":method"]),
      headers: Object.fromEntries(
        Object.entries(headers).filter(([key]) =>
          ["content-type", "x-session-read-priority", "origin"].includes(key),
        ),
      ),
    },
    (response) => {
      if (stream.closed || stream.destroyed) {
        response.destroy();
        return;
      }
      entry.status = response.statusCode;
      (stream as ServerHttp2Stream).respond({
        ":status": response.statusCode ?? 502,
        ...Object.fromEntries(
          Object.entries(response.headers).filter(
            ([key]) =>
              !["connection", "keep-alive", "transfer-encoding"].includes(key),
          ),
        ),
      });
      response.once("end", () => {
        upstreamEnded = true;
        entry.upstreamEndedAt = Date.now();
      });
      response.on("error", () => {
        if (!stream.closed) stream.close();
      });
      response.pipe(stream);
    },
  );
  upstream.on("error", (error: NodeJS.ErrnoException) => {
    entry.upstreamError = error.code;
    if (!stream.closed && !stream.destroyed) {
      (stream as ServerHttp2Stream).respond({ ":status": 502 });
      stream.end();
    }
  });
  stream.once("close", () => {
    entry.closedAt = Date.now();
    if (!upstreamEnded) {
      entry.abortForwardedAt = Date.now();
      upstream.destroy();
    }
  });
  stream.on("error", () => {});
  stream.pipe(upstream);
});
await new Promise<void>((resolve) => proxy.listen(0, "0.0.0.0", resolve));
const browserOrigin = new URL(allowedOrigin);
browserOrigin.protocol = "https:";
browserOrigin.port = String((proxy.address() as { port: number }).port);
async function closeFixture() {
  for (const session of sessions) session.destroy();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
  await app.close();
}

async function identity(pid: number) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.split(") ").at(-1)!.split(" ");
    return { pid, startTicks: fields[19], state: fields[0] };
  } catch (error: any) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return null;
    throw error;
  }
}
async function snapshot() {
  const records: Array<Record<string, any>> = await readFile(nativeLog, "utf8")
    .then((value) =>
      value
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    )
    .catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  const owned = [
    ...new Map(records.map((record) => [record.pid, record])).values(),
  ];
  const identities = await Promise.all(
    owned.map((record) => identity(record.pid)),
  );
  return {
    requests,
    records,
    proxyRecords,
    alive: identities.filter(
      (value, index) => value?.startTicks === owned[index].startTicks,
    ),
  };
}

process.stdout.write(
  JSON.stringify({
    ready: true,
    origin: browserOrigin.origin,
    root,
    identity: await identity(process.pid),
  }) + "\n",
);
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const { id, method, target } = JSON.parse(line);
  try {
    let value: unknown;
    if (method === "release") {
      if (typeof target !== "string" || !/^[a-z0-9-]{1,80}$/.test(target))
        throw new Error("Invalid owned fixture target");
      await writeFile(join(root, `${target}.release`), "ready\n", {
        mode: 0o600,
      });
      value = true;
    } else if (method === "snapshot") value = await snapshot();
    else if (method === "close") {
      await closeFixture();
      value = await snapshot();
    } else throw new Error("Unknown owned fixture control method");
    process.stdout.write(JSON.stringify({ id, value }) + "\n");
    if (method === "close") {
      lines.close();
      process.exit(0);
    }
  } catch (error) {
    process.stdout.write(JSON.stringify({ id, error: String(error) }) + "\n");
  }
}
// Parent/test interruption closes stdin. Release only this owned gateway's
// readers even when no explicit close command could be delivered.
await closeFixture();
