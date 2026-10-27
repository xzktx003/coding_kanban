import assert from "node:assert/strict";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { networkInterfaces } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "../../../apps/server/node_modules/fastify/fastify.js";
import websocket from "../../../apps/server/node_modules/@fastify/websocket/index.js";
import { createServer } from "../../../apps/web/node_modules/vite/dist/node/index.js";
import react from "../../../apps/web/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwind from "../../../apps/web/node_modules/@tailwindcss/vite/dist/index.mjs";
import { chromium } from "../../../node_modules/playwright/index.mjs";
import { CodexService } from "../../../packages/session-runtime/src/codex/client.ts";
import { EventHub } from "../../../packages/session-runtime/src/core/events.ts";
import { registerCodexRoutes } from "../../../packages/session-runtime/src/codex/routes.ts";
import { registerEventRoutes } from "../../../packages/session-runtime/src/transport/events.ts";
import { object } from "../../../packages/session-runtime/src/core/json.ts";
import { sessionCssScope } from "../../session-css-scope.mjs";

const here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, "../../..");
const out = process.env.APPROVAL_OUTPUT!;
const records: any[] = [];
const sourceHashes = new Map<string, string>();
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
for (const name of [
  "codex/client.ts",
  "codex/routes.ts",
  "core/events.ts",
  "transport/rpc.ts",
  "transport/events.ts",
]) {
  const path = resolve(repo, "packages/session-runtime/src", name);
  sourceHashes.set(path, hash(path));
}
function record(kind: string, value: any) {
  const entry = { order: records.length + 1, kind, ...value };
  records.push(entry);
  appendFileSync(resolve(out, "timeline.jsonl"), JSON.stringify(entry) + "\n");
}
async function until(check: () => unknown, label: string, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timeout: " + label);
}
const hub = new EventHub();
const service = new CodexService({
  hub,
  instance: "private-approval-fixture",
  env: process.env,
  sweepIntervalMs: 0,
  launch: {
    command: process.env.APPROVAL_PYTHON!,
    args: [
      process.env.APPROVAL_LAUNCHER!,
      process.env.APPROVAL_CONTROL_SOCKET!,
      process.env.APPROVAL_CLI!,
      resolve(out, "native.network.log"),
    ],
  },
});
const subscription = hub.subscribe({ snapshots: true });
void (async () => {
  for await (const event of subscription) record("hub", { event });
})();
const app = Fastify();
const clientBStreams = new Set<import("node:http").ServerResponse>();
const clientBFrontStreams = new Set<import("node:http").ServerResponse>();
app.addHook("onRequest", async (request, reply) => {
  if (
    request.url.startsWith("/api/events") &&
    request.headers.cookie?.includes("approval_fixture_client=B")
  ) {
    clientBStreams.add(reply.raw);
    record("sse.client-b.open", { url: request.url });
    reply.raw.once("close", () => {
      clientBStreams.delete(reply.raw);
      record("sse.client-b.close", {});
    });
  }
});
let racing = false;
const arrivals: Array<() => void> = [];
app.addHook("preHandler", async (request) => {
  if (!request.url.startsWith("/api/codex/approval/")) return;
  record("http.approval", { body: request.body });
  if (racing) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Two browser approvals did not arrive")),
        10000,
      );
      arrivals.push(() => {
        clearTimeout(timer);
        resolve();
      });
      if (arrivals.length === 2) {
        racing = false;
        arrivals.splice(0).forEach((done) => done());
      }
    });
  }
});
app.setErrorHandler((error: any, _request, reply) =>
  reply
    .code(error.statusCode ?? (/SESSION_/.test(error.message) ? 409 : 500))
    .send({ error: error.message }),
);
await app.register(websocket);
registerCodexRoutes(app, service);
registerEventRoutes(app, hub);
await app.listen({ host: "127.0.0.1", port: 0 });
const backend = app.server.address() as { port: number };
const vite = await createServer({
  configFile: false,
  envFile: false,
  root: resolve(repo, "apps/web"),
  cacheDir: resolve(out, "vite-cache"),
  plugins: [
    react(),
    tailwind(),
    {
      name: "own-approval-fixture",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = decodeURIComponent(
            new URL(req.url ?? "/", "http://fixture").pathname,
          );
          if (
            pathname === "/api/session/api/events" &&
            req.headers.cookie?.includes("approval_fixture_client=B")
          ) {
            clientBFrontStreams.add(res);
            res.once("close", () => clientBFrontStreams.delete(res));
          }
          if (
            pathname.startsWith("/api/session/") &&
            ![
              "/api/session/api/events",
              "/api/session/api/codex/approval/command-execution",
            ].includes(pathname)
          ) {
            res.statusCode = 404;
            res.end("Outside approval fixture scope");
            return;
          }
          const path = pathname.startsWith("/src/")
            ? resolve(repo, "apps/web", pathname.slice(1))
            : pathname.startsWith("/@fs/")
              ? pathname.slice(4)
              : null;
          if (
            path &&
            path.startsWith(repo + "/") &&
            !path.includes("node_modules") &&
            /\.(?:[cm]?[jt]sx?|css)$/.test(path) &&
            existsSync(path) &&
            !sourceHashes.has(path)
          )
            sourceHashes.set(path, hash(path));
          next();
        });
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== "/approval.html") return next();
          res.setHeader("content-type", "text/html");
          res.end(
            await server.transformIndexHtml(
              "/approval.html",
              `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${here}/frontend.tsx"></script></body></html>`,
            ),
          );
        });
      },
    },
  ],
  resolve: {
    alias: { "@session": resolve(repo, "apps/web/src/session-mode") },
  },
  css: { postcss: { plugins: [sessionCssScope()] } },
  server: {
    host: "0.0.0.0",
    port: 0,
    watch: null,
    fs: { allow: [repo] },
    proxy: {
      "/api/session": {
        target: `http://127.0.0.1:${backend.port}`,
        rewrite: (path) => path.replace(/^\/api\/session/, ""),
      },
    },
  },
});
let browser: any;
const browserTmp = await mkdtemp("/tmp/approval-browser-");
let passed = false;
try {
  await service.call("model/list", {});
  const transport = (service as any).transport;
  const original = transport.child.stdin.write.bind(transport.child.stdin);
  transport.child.stdin.write = (chunk: any, ...args: any[]) => {
    record("native.stdin", { frame: JSON.parse(String(chunk)) });
    return original(chunk, ...args);
  };
  transport.child.stdout.on("data", (chunk: Buffer) =>
    appendFileSync(resolve(out, "native.stdout.jsonl"), chunk),
  );
  const metadata = object(
    await service.call("thread/start", {
      cwd: resolve(out, "project"),
      approvalPolicy: "on-request",
      sandbox: "read-only",
      model: "approval-fixture",
    }),
  );
  const threadId = String(object(metadata.thread).id);
  await vite.listen();
  const port = (vite.httpServer!.address() as { port: number }).port;
  const ip = Object.values(networkInterfaces())
    .flat()
    .find((a) => a && a.family === "IPv4" && !a.internal)?.address;
  assert(ip, "LAN IPv4 required");
  const url = `http://${ip}:${port}/approval.html`;
  record("fixture.ready", { url, threadId });
  console.log("FIXTURE", url);
  browser = await chromium.launch({
    executablePath: process.env.APPROVAL_BROWSER!,
    headless: true,
    env: { ...process.env, TMPDIR: browserTmp },
    args: ["--no-sandbox"],
  });
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    browser.newContext({
      viewport: { width: 393, height: 852 },
      hasTouch: true,
      isMobile: true,
    }),
  ]);
  await contexts[1].addCookies([
    { name: "approval_fixture_client", value: "B", url },
  ]);
  for (const context of contexts)
    await context.route("**/*", (route: any) =>
      new URL(route.request().url()).origin === new URL(url).origin
        ? route.continue()
        : route.abort(),
    );
  const pages = await Promise.all(contexts.map((c: any) => c.newPage()));
  const errors: string[] = [];
  for (const p of pages) {
    p.on("pageerror", (e: Error) => errors.push(e.message));
    p.on("console", (m: any) => {
      if (m.type() === "error") record("browser.console", { text: m.text() });
    });
  }
  await Promise.all(
    pages.map((p: any) => p.goto(url, { waitUntil: "domcontentloaded" })),
  );
  await Promise.all(
    pages.map((p: any) =>
      p.waitForFunction(
        () => !!(window as any).approvalFixture,
        {},
        { timeout: 60000 },
      ),
    ),
  );
  const turn = object(
    await service.call("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: "PRIVATE_APPROVAL_A: run the fixture printf with explicit user approval.",
          text_elements: [],
        },
      ],
    }),
  );
  record("fixture.turn", { turn });
  await Promise.all(
    pages.map((p: any) =>
      p.waitForFunction(
        () => (window as any).approvalFixture?.pending.length === 1,
        {},
        { timeout: 20000 },
      ),
    ),
  );
  const first = await pages[0].evaluate(
    () => (window as any).approvalFixture.pending[0],
  );
  assert.deepEqual(
    await pages[1].evaluate(() => (window as any).approvalFixture.pending[0]),
    first,
  );
  assert.equal(first.threadId, threadId);
  assert(first.requestToken && first.turnId && first.itemId);
  for (const p of pages)
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  for (const p of pages) {
    const bounds = await p
      .locator(".codex-approval, .codex-approval button")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            text: element.tagName === "BUTTON" ? element.textContent : "card",
            left: rect.left,
            right: rect.right,
            viewport: innerWidth,
          };
        }),
      );
    assert(
      bounds.length >= 3,
      "Expected actual approval card and reachable actions",
    );
    for (const boundsItem of bounds)
      assert(
        boundsItem.left >= 0 && boundsItem.right <= boundsItem.viewport,
        JSON.stringify(boundsItem),
      );
    record("browser.approval-bounds", { bounds });
  }
  await Promise.all(
    pages.map((p: any, i: number) =>
      p.screenshot({ path: resolve(out, `client-${i}-pending.png`) }),
    ),
  );
  const buttons = await pages[0].locator("button").allTextContents();
  record("fixture.buttons", { buttons });
  racing = true;
  await Promise.all(
    pages.map((p: any) =>
      p
        .getByRole("button", { name: /^允许一次$|^Allow once$|^批准$|^Allow$/ })
        .click(),
    ),
  );
  await Promise.all(
    pages.map((p: any) =>
      p.waitForFunction(
        () => (window as any).approvalFixture.pending.length === 0,
      ),
    ),
  );
  await until(
    () =>
      records.some(
        (e) =>
          e.kind === "hub" &&
          e.event.event === "codex:notification" &&
          e.event.payload.method === "turn/completed",
      ),
    "native completion",
  );
  const replies = records.filter(
    (e) =>
      e.kind === "native.stdin" &&
      e.frame.id === first.requestId &&
      e.frame.result,
  );
  assert.equal(replies.length, 1);
  assert.equal(replies[0].frame.result.decision, "accept");
  const expired = await pages[1].evaluate(async (first: any) => {
    const r = await fetch("/api/session/api/codex/approval/command-execution", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: first.requestId,
        request: first,
        decision: "accept",
      }),
    });
    return { status: r.status, body: await r.text() };
  }, first);
  assert.equal(expired.status, 409);
  assert.equal(
    records.filter(
      (e) =>
        e.kind === "native.stdin" &&
        e.frame.id === first.requestId &&
        e.frame.result,
    ).length,
    1,
  );
  // The second context misses an entire new native request, then recovers it
  // through the real EventSource cursor/snapshot path after transport reconnect.
  await contexts[1].setOffline(true);
  assert(
    clientBStreams.size > 0,
    "Expected an actual connected EventSource for client B",
  );
  assert(
    clientBFrontStreams.size > 0,
    "Expected an actual browser-facing SSE socket for client B",
  );
  for (const stream of clientBFrontStreams) stream.destroy();
  for (const stream of clientBStreams) stream.destroy();
  await until(() => clientBStreams.size === 0, "disconnected client B stream");
  const secondThread = String(
    object(
      object(
        await service.call("thread/start", {
          cwd: resolve(out, "project"),
          approvalPolicy: "on-request",
          sandbox: "read-only",
          model: "approval-fixture",
        }),
      ).thread,
    ).id,
  );
  await service.call("turn/start", {
    threadId: secondThread,
    input: [
      {
        type: "text",
        text: "PRIVATE_APPROVAL_B: run the private fixture printf with explicit approval.",
        text_elements: [],
      },
    ],
  });
  await pages[0].waitForFunction(
    () => (window as any).approvalFixture?.pending.length === 1,
    {},
    { timeout: 20000 },
  );
  const second = await pages[0].evaluate(
    () => (window as any).approvalFixture.pending[0],
  );
  assert.equal(second.threadId, secondThread);
  assert.notEqual(second.requestToken, first.requestToken);
  assert.equal(
    await pages[1].evaluate(
      () => (window as any).approvalFixture.pending.length,
    ),
    0,
  );
  await contexts[1].setOffline(false);
  await pages[1].waitForFunction(
    () => (window as any).approvalFixture?.pending.length === 1,
    {},
    { timeout: 20000 },
  );
  assert.deepEqual(
    await pages[1].evaluate(() => (window as any).approvalFixture.pending[0]),
    second,
  );
  const stale = await pages[1].evaluate(
    async ({ second, first }: any) => {
      const response = await fetch(
        "/api/session/api/codex/approval/command-execution",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            request_id: second.requestId,
            request: { ...second, requestToken: first.requestToken },
            decision: "accept",
          }),
        },
      );
      return { status: response.status, body: await response.text() };
    },
    { second, first },
  );
  assert.equal(stale.status, 409);
  assert.equal(
    records.filter(
      (e) =>
        e.kind === "native.stdin" &&
        e.frame.id === second.requestId &&
        e.frame.result,
    ).length,
    0,
  );
  await pages[1]
    .getByRole("button", { name: /^允许一次$|^Allow once$|^批准$|^Allow$/ })
    .click();
  await Promise.all(
    pages.map((p: any) =>
      p.waitForFunction(
        () => (window as any).approvalFixture.pending.length === 0,
      ),
    ),
  );
  await until(
    () =>
      records.some(
        (e) =>
          e.kind === "hub" &&
          e.event.event === "codex:notification" &&
          e.event.payload.method === "turn/completed" &&
          e.event.payload.params.threadId === secondThread,
      ),
    "second native completion",
  );
  const secondReplies = records.filter(
    (e) =>
      e.kind === "native.stdin" &&
      e.frame.id === second.requestId &&
      e.frame.result,
  );
  assert.equal(secondReplies.length, 1);
  assert.equal(secondReplies[0].frame.result.decision, "accept");
  const resolved = records.filter(
    (e) =>
      e.kind === "hub" &&
      e.event.event === "codex:notification" &&
      e.event.payload.method === "serverRequest/resolved",
  );
  for (const request of [first, second])
    assert.equal(
      resolved.filter(
        (e) =>
          e.event.payload.params.threadId === request.threadId &&
          e.event.payload.params.requestId === request.requestId,
      ).length,
      1,
    );
  const nativeFrames = (
    await readFile(resolve(out, "native.stdout.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const executions = nativeFrames.filter(
    (e) =>
      e.method === "item/completed" &&
      e.params.item.type === "commandExecution",
  );
  assert.equal(executions.length, 2);
  for (const execution of executions) {
    assert.equal(execution.params.item.exitCode, 0);
    assert.equal(execution.params.item.aggregatedOutput, "APPROVAL_FIXTURE_OK");
  }
  const changed = [...sourceHashes]
    .filter(([path, digest]) => hash(path) !== digest)
    .map(([path]) => path);
  await writeFile(
    resolve(out, "source-manifest.json"),
    JSON.stringify(Object.fromEntries(sourceHashes), null, 2),
  );
  assert.deepEqual(
    changed,
    [],
    "Actually served product sources changed during acceptance",
  );
  assert.deepEqual(errors, []);
  passed = true;
  const initialize = records.find(
    (e) => e.kind === "hub" && e.event.event === "codex:initialized",
  )?.event.payload;
  await writeFile(
    resolve(out, "browser-result.json"),
    JSON.stringify(
      {
        passed,
        url,
        threadId,
        first,
        replies,
        expired,
        second,
        secondReplies,
        stale,
        initialize,
        executions,
        errors,
        sourceFiles: sourceHashes.size,
        changed,
        viewports: [
          { width: 1440, height: 1000 },
          { width: 393, height: 852 },
        ],
        boundary:
          "Actual ApprovalItem, SSE bridge, service and native; concurrency barrier only before two HTTP handler entries. Separate browser contexts; real offline/reconnect. Logged stdin frames plus exact native resolved events prove accepted single dispatch; no full workbench, formal gateway, physical phone or ChatGPT account claim.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  await writeFile(
    resolve(out, "browser-result.json"),
    JSON.stringify(
      { passed: false, error: String(error), records: records.slice(-8) },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  subscription.close();
  hub.close();
  await service.close();
  await app.close();
  await vite.close();
  await rm(browserTmp, { recursive: true, force: true });
  if (!passed) process.exitCode = 1;
}
