import { expect, test, type BrowserContext } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerSessionManagementRoutes } from "../../apps/server/src/routes/session-management.ts";
import { registerSessionClientControlRoutes } from "../../apps/server/src/routes/session-client-control.ts";

const serverRequire = createRequire(
  new URL("../../apps/server/package.json", import.meta.url),
);
const webRequire = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const Fastify = serverRequire("fastify");
const { build } = createRequire(webRequire.resolve("vite/package.json"))(
  "esbuild",
);
const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));

function deferred() {
  let resolve!: () => void;
  let settled = false;
  const promise = new Promise<void>((r) => {
    resolve = () => {
      settled = true;
      r();
    };
  });
  return {
    promise,
    resolve,
    get settled() {
      return settled;
    },
  };
}
function port(app: any) {
  return (app.server.address() as { port: number }).port;
}
function lanHost() {
  const host = Object.values(networkInterfaces())
    .flat()
    .find(
      (address) => address?.family === "IPv4" && !address.internal,
    )?.address;
  if (!host) throw new Error("A real LAN IPv4 address is required");
  return host;
}

// The harness renders the real management client, stores and visibility hook.
// It deliberately does not claim to cover the full Workbench/menu/performance UI.
const harness = String.raw`
import React, {useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {startSessionManagementSync,setSharedSessionUnread,markSharedSessionsRead,useSessionManagementSyncStatus} from './src/session-mode/services/sessionManagementClient.ts';
import {useSessionAttentionStore,latestUnread} from './src/session-mode/stores/useSessionAttentionStore.ts';
import {useAgentCenterStore} from './src/session-mode/stores/useAgentCenterStore.ts';
import {useLayoutStore} from './src/session-mode/stores/useLayoutStore.ts';
import {useAgentSettingsStore} from './src/session-mode/stores/useAgentSettingsStore.ts';
import {useAcpStore} from './src/session-mode/stores/useAcpStore.ts';
import {useSessionReadReceipt} from './src/session-mode/hooks/useSessionReadReceipt.ts';
useLayoutStore.setState({view:'settings'});
useAgentCenterStore.setState({cardsViewMode:'grid',currentAgentCardId:'a',currentAgentCardKind:'codex'});
useAgentSettingsStore.setState({selectedAgent:'codex'});useAcpStore.setState({active:false});
const stop=startSessionManagementSync(fetch,60);
const unread=()=>setSharedSessionUnread('codex','a');
const read=()=>markSharedSessionsRead(['a']);
window.managementFixture={unread,read,receipts:()=>useSessionAttentionStore.getState().receipts,status:()=>useSessionManagementSyncStatus.getState()};
window.addEventListener('pagehide',stop,{once:true});
function App(){
 const marker=useRef(null);useSessionReadReceipt('codex','a',marker);
 const receipt=useSessionAttentionStore(s=>s.receipts['codex:a']);
 const run=work=>work().catch(error=>document.querySelector('#error').textContent=error.message);
 return React.createElement('div',{className:'session-mode'},
  React.createElement('h1',null,'共享会话阅读验收'),
  React.createElement('p',{'data-testid':'reply'},receipt?.completed.at(-1)?.id??'waiting'),
  React.createElement('p',{'data-testid':'unread'},String(!!latestUnread(receipt))),
  React.createElement('p',{'data-testid':'manual'},String(receipt?.manualUnreadRevision??0)),
  React.createElement('button',{id:'read',onClick:()=>run(read)},'全部标为已读'),
  React.createElement('button',{id:'unread',onClick:()=>run(unread)},'标记为未读'),
  React.createElement('button',{id:'enter',onClick:()=>useLayoutStore.setState({view:'agent'})},'进入阅读'),
  React.createElement('button',{id:'leave',onClick:()=>useLayoutStore.setState({view:'settings'})},'离开阅读'),
  React.createElement('p',{id:'error',role:'status'}),React.createElement('div',{ref:marker,style:{height:4}},'最新回复'));
}
createRoot(document.querySelector('#app')).render(React.createElement(App));
`;

test("desktop and phone contexts preserve shared manual unread, refresh and account fences through real HTTP", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  const root = await mkdtemp(join(tmpdir(), "session-management-http-"));
  const native = Fastify({ forceCloseConnections: true }),
    app = Fastify({ forceCloseConnections: true });
  let desktop: BrowserContext | undefined, phone: BrowserContext | undefined;
  const releases: Array<() => void> = [];
  let account = "a",
    accountEpoch = 0;
  const revisions: Record<string, number> = { a: 0, b: 0 };
  const nativeWrites: Array<{
    account: string;
    revision: string;
    operation: string;
  }> = [];
  const nativeReads: Array<{ path: string; params: any }> = [];
  let held:
    | {
        entered: ReturnType<typeof deferred>;
        release: ReturnType<typeof deferred>;
      }
    | undefined;
  const scope = () => `scope-${account}-${accountEpoch}`;
  const revision = () => `opaque-${account}-${revisions[account]}`;
  native.get("/api/internal/codex/operation-context", async () => ({
    scope: scope(),
    namespace: `native-${account}`,
  }));
  native.post("/api/codex/thread/metadata", async (request: any) => {
    nativeReads.push({ path: "metadata", params: request.body });
    const captured = {
      thread: { id: "a", status: { type: "idle" } },
      readState: { revision: revision() },
    };
    const gate = held;
    held = undefined;
    if (gate) {
      gate.entered.resolve();
      await gate.release.promise;
    }
    return captured;
  });
  native.post("/api/codex/thread/turns/list", async (request: any) => {
    nativeReads.push({ path: "turns/list", params: request.body });
    expect(request.body).toEqual({
      threadId: "a",
      limit: 1,
      sortDirection: "desc",
      itemsView: "notLoaded",
    });
    return {
      data: [{ id: `reply-${account}`, status: "completed" }],
      nextCursor: null,
    };
  });
  native.post(
    "/api/internal/codex/guarded-read-state",
    async (request: any, reply: any) => {
      const body = request.body;
      if (
        body.expectedScope !== scope() ||
        body.expectedRevision !== revision()
      )
        return reply
          .code(409)
          .send({ error: "Native scope/revision conflict" });
      nativeWrites.push({
        account,
        revision: body.expectedRevision,
        operation: body.operation,
      });
      revisions[account]++;
      return { readState: { revision: revision() } };
    },
  );
  try {
    await native.listen({ host: "127.0.0.1", port: 0 });
    const nativeOrigin = `http://127.0.0.1:${port(native)}`;
    const call = async (path: string, body?: any) => {
      const response = await fetch(nativeOrigin + path, {
        method: body ? "POST" : "GET",
        ...(body
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
        signal: AbortSignal.timeout(10_000),
      });
      const value = await response.json();
      if (!response.ok)
        throw Object.assign(new Error(value.error), {
          statusCode: response.status,
        });
      return value;
    };
    const management = registerSessionManagementRoutes(app, {
      file: join(root, "management.json"),
      accountScope: async () =>
        (await call("/api/internal/codex/operation-context")).namespace,
      nativeRead: async (
        target,
        expectedRevision,
        operation,
        expectedScope,
      ) => {
        await call("/api/internal/codex/guarded-read-state", {
          threadId: target.id,
          expectedRevision,
          operation,
          expectedScope,
        });
      },
    });
    registerSessionClientControlRoutes(app, {
      origin: () => nativeOrigin,
      management,
      write: async (_id, work) => work(),
    });
    const seed = async (label: string) => {
      const snapshot = await management.snapshot();
      await management.apply({
        operationId: `complete-${label}`,
        windowId: snapshot.operationWindow.id,
        target: {
          namespace: snapshot.namespaces.codex!,
          kind: "codex",
          id: "a",
        },
        action: { type: "complete", replyId: `reply-${label}` },
      });
    };
    await seed("a");
    const result = await build({
      stdin: {
        contents: harness,
        resolveDir: webRoot,
        loader: "tsx",
        sourcefile: "management-browser-harness.tsx",
      },
      tsconfig: join(webRoot, "tsconfig.json"),
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
      define: {
        "process.env.NODE_ENV": '"production"',
        "import.meta.hot": "undefined",
      },
      alias: { "@session": join(webRoot, "src/session-mode") },
      logLevel: "silent",
    });
    app.get("/bundle.js", async (_request: unknown, reply: any) =>
      reply.type("application/javascript").send(result.outputFiles[0].text),
    );
    app.get("/", async (_request: unknown, reply: any) =>
      reply
        .type("text/html")
        .send(
          '<!doctype html><meta charset="utf-8"><title>Shared management HTTP acceptance</title><style>body{font:16px system-ui;background:#20211e;color:#eee;margin:24px}button{margin:8px;padding:10px}p{margin:12px}</style><div id="app"></div><script type="module" src="/bundle.js"></script>',
        ),
    );
    await app.listen({ host: "0.0.0.0", port: 0 });
    const url = `http://${lanHost()}:${port(app)}`;
    desktop = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    phone = await browser.newContext({
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
    });
    const a = await desktop.newPage(),
      b = await phone.newPage();
    await Promise.all([a.goto(url), b.goto(url)]);
    try {
      await expect(a.getByTestId("reply")).toHaveText("reply-a");
    } catch (error) {
      console.log(
        "MANAGEMENT_BROWSER_DIAGNOSTIC",
        await a.evaluate(async () => ({
          status: (window as any).managementFixture.status(),
          receipts: (window as any).managementFixture.receipts(),
          server: await (await fetch("/api/session/management")).json(),
        })),
      );
      throw error;
    }
    await expect(b.getByTestId("reply")).toHaveText("reply-a");
    await a.locator("#read").click();
    await expect(a.getByTestId("unread")).toHaveText("false");
    await expect(b.getByTestId("unread")).toHaveText("false");
    await b.locator("#unread").click();
    await expect(a.getByTestId("manual")).toHaveText("1");
    await expect(b.getByTestId("unread")).toHaveText("true");

    // Hold only the first real native metadata read. The second client changes
    // manual unread while the first client's automatic proof is in flight.
    const dwellGate = { entered: deferred(), release: deferred() };
    held = dwellGate;
    releases.push(dwellGate.release.resolve);
    await a.bringToFront();
    await a.locator("#enter").click();
    await expect.poll(() => dwellGate.entered.settled).toBe(true);
    // Separate physical devices do not steal the other device's window focus.
    await b.evaluate(() => (window as any).managementFixture.unread());
    await expect(b.getByTestId("manual")).toHaveText("2");
    dwellGate.release.resolve();
    await expect(a.getByTestId("manual")).toHaveText("2");
    await a.waitForTimeout(500);
    await expect(a.getByTestId("unread")).toHaveText("true");
    expect(nativeWrites.map((write) => write.operation)).toEqual([
      "read",
      "unread",
      "unread",
    ]);
    await a.locator("#leave").click();
    await a.reload();
    await expect(a.getByTestId("manual")).toHaveText("2");
    await expect(a.getByTestId("unread")).toHaveText("true");

    const scopeGate = { entered: deferred(), release: deferred() };
    held = scopeGate;
    releases.push(scopeGate.release.resolve);
    const late = a.evaluate(async () => {
      try {
        await (window as any).managementFixture.unread();
        return "accepted";
      } catch (error) {
        return String(error);
      }
    });
    await expect.poll(() => scopeGate.entered.settled).toBe(true);
    account = "b";
    accountEpoch++;
    await seed("b");
    scopeGate.release.resolve();
    expect(await late).not.toBe("accepted");
    await expect(a.getByTestId("reply")).toHaveText("reply-b");
    await expect(b.getByTestId("reply")).toHaveText("reply-b");
    expect(nativeWrites).toHaveLength(3);
    expect(
      await a.evaluate(() =>
        localStorage.getItem("kanban.session.management.legacy.codex"),
      ),
    ).toContain("reply-a");
    await b.locator("#unread").click();
    await expect(a.getByTestId("manual")).toHaveText("1");
    expect(nativeWrites.at(-1)).toMatchObject({
      account: "b",
      revision: "opaque-b-0",
      operation: "unread",
    });
    await expect(a.locator("#error")).toBeEmpty();
    await expect(b.locator("#error")).toBeEmpty();
    const evidencePath = testInfo.outputPath("shared-management-http.json");
    await writeFile(
      evidencePath,
      JSON.stringify(
        {
          url,
          contexts: 2,
          phoneViewport: "393x852",
          nativeWrites,
          metadataReads: nativeReads.length,
          realHttp: true,
          fullWorkbenchCovered: false,
        },
        null,
        2,
      ),
    );
    await testInfo.attach("shared-management-http.json", {
      contentType: "application/json",
      path: evidencePath,
    });
    for (const [page, name] of [
      [a, "desktop-unread.png"],
      [b, "phone-unread.png"],
    ] as const) {
      const path = testInfo.outputPath(name);
      await page.screenshot({ path });
      await testInfo.attach(name, { contentType: "image/png", path });
    }
  } catch (error) {
    const page = desktop?.pages()[0];
    console.log(
      "MANAGEMENT_HTTP_FAILURE",
      await page
        ?.evaluate(() => ({
          status: (window as any).managementFixture?.status(),
          error: document.querySelector("#error")?.textContent,
          receipts: (window as any).managementFixture?.receipts(),
        }))
        .catch(() => null),
      nativeWrites,
    );
    throw error;
  } finally {
    held?.release.resolve();
    releases.forEach((release) => release());
    await Promise.allSettled([desktop?.close(), phone?.close()]);
    await app.close();
    await native.close();
    await rm(root, { recursive: true, force: true });
  }
});
