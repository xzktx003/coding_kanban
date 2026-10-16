// Standalone protection-channel platform test, not an official native UI or performance gate.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isIP } from "node:net";
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import ts from "../../apps/web/node_modules/typescript/lib/typescript.js";
import { chromium } from "../../node_modules/playwright/index.mjs";
import { iphone16Context, mobileEnvironment } from "./codex-refresh-mobile.mjs";
import { registerNativeCodexVisibility } from "../../apps/server/src/routes/native-codex-visibility.ts";
import {
  listenRefreshControl,
  connectRefreshControl,
} from "../../packages/native-codex-host/refresh-prototype/control-channel.mjs";
import { createServer as createViteServer } from "../../apps/web/node_modules/vite/dist/node/index.js";
import { resolveWebDevProxies } from "../../apps/web/src/lib/dev-server-config.ts";
const require = createRequire(
  new URL("../../apps/server/package.json", import.meta.url),
);
const Fastify = require("fastify"),
  websocket = require("@fastify/websocket");
const host = process.env.NATIVE_CODEX_REFRESH_BROWSER_HOST,
  output = process.env.NATIVE_CODEX_REFRESH_BROWSER_OUTPUT;
assert.ok(host && isIP(host) && !host.startsWith("127.") && host !== "0.0.0.0");
assert.ok(output);
await mkdir(resolve(output), { mode: 0o700 });
const root = await mkdtemp(join(tmpdir(), "ck-visible-browser-"));
const fault = process.env.NATIVE_CODEX_REFRESH_VISIBILITY_NEGATIVE === "1";
const profileId = randomUUID(),
  instanceId = randomUUID(),
  threadId = randomUUID(),
  consumers = new Map();
const serviceScope = {
  domain: randomUUID(),
  generation: randomUUID(),
  pid: process.pid,
  startTicks: "0",
};
const manager = {
  serviceScope,
  snapshot: () => ({ ready: true, authorizationBound: true }),
  onInvalidated: () => () => {},
  scopeForThread: async (id) => ({ threadId: id }),
  async open(key, { consumerId }) {
    const ids = consumers.get(consumerId) ?? new Set();
    ids.add(key.threadId);
    consumers.set(consumerId, ids);
  },
  async disconnect(id) {
    consumers.delete(id);
  },
};
let app,
  frontend,
  browser,
  controlServer,
  controlClient,
  releaseHtml,
  holdNext = false,
  heldHtml;
const result = {
  platformOnly: true,
  officialNativeUi: false,
  nativeService: false,
  throughVite: true,
  throughPrivateControl: true,
  managerInSeparateProcess: false,
  measuresRecoveryPerformance: false,
  faultInjected: fault,
  steps: [],
  errors: [],
  passed: false,
};
const wait = async (check, label) => {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error(label);
};
try {
  const controlRoot = join(root, "control");
  await mkdir(controlRoot, { mode: 0o700 });
  controlServer = await listenRefreshControl({
    manager,
    profiles: [profileId],
    runtimeRoot: controlRoot,
    leaseGraceMs: 3000,
  });
  controlClient = await connectRefreshControl({
    runtimeRoot: controlRoot,
    record: controlServer.record,
  });
  await promisify(execFile)("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-keyout",
    join(root, "key.pem"),
    "-out",
    join(root, "cert.pem"),
    "-subj",
    `/CN=${host}`,
    "-addext",
    `subjectAltName=IP:${host}`,
  ]);
  const key = await readFile(join(root, "key.pem")),
    cert = await readFile(join(root, "cert.pem"));
  const spki = createHash("sha256")
    .update(
      new X509Certificate(cert).publicKey.export({
        format: "der",
        type: "spki",
      }),
    )
    .digest("base64");
  const source = await readFile(
    new URL(
      "../../apps/web/src/codex-mode/native-visibility.ts",
      import.meta.url,
    ),
    "utf8",
  );
  let changed = 0;
  const transformer = (context) => {
    const visit = (node) => {
      if (
        fault &&
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        ts.isStringLiteral(node.right) &&
        node.right.text === "reload" &&
        ts.isPropertyAccessExpression(node.left) &&
        node.left.name.text === "type"
      ) {
        changed++;
        return context.factory.createTrue();
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit);
  };
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    transformers: { before: [transformer] },
  }).outputText;
  assert.equal(changed, fault ? 1 : 0);
  app = Fastify();
  await app.register(websocket);
  let origin = "";
  await registerNativeCodexVisibility(app, {
    profileId,
    controller: controlClient.visibility(profileId),
    sameOrigin: (request) => request.headers.origin === origin,
    gateway: {
      runtime: async () => ({ refreshScope: serviceScope }),
      instanceStatus: async (value) => ({
        status: 200,
        active: value.instanceId === instanceId,
      }),
    },
  });
  app.get("/visibility-client.js", async (_request, reply) =>
    reply
      .header("cache-control", "no-store")
      .type("text/javascript")
      .send(compiled),
  );
  const nonce = randomUUID();
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visible lease platform test</title><button id="hide">Hide metadata</button><button id="show">Show metadata</button><script type="module" nonce="${nonce}">import{startNativeVisibilityClient}from'/visibility-client.js';window.__initialLeaseSeen=Boolean(sessionStorage.getItem('kanban.codex.visibility-lease.v1:${profileId}'));window.__client=startNativeVisibilityClient({profileId:'${profileId}',instanceId:'${instanceId}',onState:value=>window.__visibilityState=value});window.__client.setVisible(['${threadId}'],true);document.querySelector('#hide').onclick=()=>window.__client.setVisible(['${threadId}'],false);document.querySelector('#show').onclick=()=>window.__client.setVisible(['${threadId}'],true);</script>`;
  app.get("/", async (_request, reply) => {
    const headers = {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'; connect-src 'self'`,
    };
    if (holdNext) {
      holdNext = false;
      reply.hijack();
      reply.raw.writeHead(200, headers);
      reply.raw.flushHeaders();
      // Commit the next document through the HTTP/2 Vite proxy while withholding its client script.
      const scriptOffset = html.indexOf("<script");
      assert.ok(scriptOffset > 0);
      reply.raw.write(html.slice(0, scriptOffset));
      heldHtml();
      await new Promise((r) => (releaseHtml = r));
      reply.raw.end(html.slice(scriptOffset));
      return;
    }
    for (const [name, value] of Object.entries(headers))
      reply.header(name, value);
    return reply.send(html);
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const upstream = `http://127.0.0.1:${address.port}`,
    webRoot = join(root, "web");
  await mkdir(webRoot, { mode: 0o700 });
  frontend = await createViteServer({
    configFile: false,
    envFile: false,
    root: webRoot,
    cacheDir: join(root, "vite-cache"),
    logLevel: "silent",
    appType: "custom",
    server: {
      host: "0.0.0.0",
      port: 0,
      strictPort: true,
      watch: null,
      https: { key, cert },
      fs: { strict: true, allow: [webRoot] },
      proxy: {
        ...resolveWebDevProxies({
          apiTarget: upstream,
          wsTarget: upstream.replace("http:", "ws:"),
        }),
        "/": { target: upstream, changeOrigin: false },
      },
    },
  });
  await frontend.listen();
  const publicAddress = frontend.httpServer.address();
  assert.ok(publicAddress && typeof publicAddress !== "string");
  origin = `https://${host}:${publicAddress.port}`;
  result.origin = origin;
  browser = await chromium.launch({
    headless: true,
    args: ["--ignore-certificate-errors-spki-list=" + spki],
  });
  result.browserVersion = browser.version();
  const desktop = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await desktop.newPage();
  const observeErrors = (target, label) =>
    target.on("pageerror", (error) => {
      if (result.errors.length < 32)
        result.errors.push(`${label}: ${error.message.slice(0, 200)}`);
    });
  observeErrors(page, "desktop");
  await page.goto(origin);
  await page.waitForFunction(() => window.__visibilityState === "protected");
  const popupEvent = page.waitForEvent("popup");
  await page.evaluate((url) => window.open(url, "_blank"), origin);
  const second = await popupEvent;
  observeErrors(second, "popup");
  await second.waitForFunction(() => window.__visibilityState === "protected");
  assert.equal(await second.evaluate(() => window.__initialLeaseSeen), true);
  await wait(
    () => consumers.size === 2 && controlServer.snapshot().handles === 2,
    "cloned new tab must keep both protection connections",
  );
  assert.equal(
    await page.evaluate(() => window.__visibilityState),
    "protected",
  );
  result.steps.push("new-tab-clone-independent");
  const mobile = await browser.newContext({
      ...iphone16Context,
      ignoreHTTPSErrors: true,
    }),
    phone = await mobile.newPage();
  observeErrors(phone, "mobile");
  await phone.goto(origin);
  await phone.waitForFunction(() => window.__visibilityState === "protected");
  await wait(() => consumers.size === 3, "three page consumers");
  result.mobile = await mobileEnvironment(phone);
  result.steps.push("three-page-protection");
  holdNext = true;
  const started = new Promise((r) => (heldHtml = r)),
    reload = page.reload({ waitUntil: "domcontentloaded" }).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
  await Promise.race([
    started,
    reload.then((outcome) => {
      if (!outcome.ok) throw outcome.error;
      throw Error("reload completed before the held response");
    }),
  ]);
  await wait(
    () => controlServer.snapshot().handles === 2,
    "old reload connection closed",
  );
  assert.equal(consumers.size, 3);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(consumers.size, 3);
  releaseHtml();
  releaseHtml = undefined;
  const reloaded = await reload;
  if (!reloaded.ok) throw reloaded.error;
  await page.waitForFunction(() => window.__visibilityState === "protected");
  await wait(
    () => controlServer.snapshot().handles === 3,
    "reload connection resumed",
  );
  assert.equal(controlServer.snapshot().leases, 3);
  assert.equal(consumers.size, 3);
  result.steps.push("hard-refresh-grace-and-reuse");
  await phone.locator("#hide").tap();
  await wait(
    () => consumers.size === 2,
    "mobile hide releases only its metadata consumer",
  );
  await phone.locator("#show").tap();
  await wait(() => consumers.size === 3, "mobile show restores its consumer");
  result.steps.push("mobile-touch-hide-and-show");
  assert.equal(result.errors.length, 0);
  result.passed = true;
} catch (error) {
  result.errors.push(error.message.slice(0, 1000));
} finally {
  releaseHtml?.();
  const cleanup = async (phase, run) => {
    try {
      return await run();
    } catch (error) {
      result.passed = false;
      result.errors.push(`${phase}: ${error.message.slice(0, 500)}`);
    }
  };
  await cleanup("browser close", () => browser?.close());
  await cleanup("Vite close", () => frontend?.close());
  await cleanup("backend close", () => app?.close());
  await cleanup("control client close", () => controlClient?.close());
  result.cleanup = await cleanup("lease close", () => controlServer?.close());
  await cleanup("private TLS removal", async () => {
    await rm(root, { recursive: true, force: true });
    result.privateTlsRemoved = true;
  });
  await writeFile(
    join(resolve(output), "result.json"),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
}
console.log(
  JSON.stringify({
    passed: result.passed,
    platformOnly: true,
    faultInjected: fault,
    steps: result.steps,
    errors: result.errors,
  }),
);
if (!result.passed) process.exitCode = 1;
