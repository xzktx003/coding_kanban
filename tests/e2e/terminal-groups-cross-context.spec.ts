import { expect, test, type Page } from "@playwright/test";
import Fastify from "../../apps/server/node_modules/fastify/fastify.js";
import { registerSessionGroupsRoutes } from "../../apps/server/src/routes/session-groups";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("two devices merge pending group edits through delayed initialization and offline reload", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const dir = await mkdtemp(join(tmpdir(), "terminal-groups-e2e-"));
  const server = Fastify();
  registerSessionGroupsRoutes(server, { file: join(dir, "groups.json") });
  const contexts = await Promise.all([1440, 1440, 390].map((width) => browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    viewport: { width, height: width === 390 ? 844 : 900 },
    ...(width === 390 ? { isMobile: true, hasTouch: true } : {}),
  })));
  const [desktopA, desktopB, phone] = await Promise.all(contexts.map((context) => context.newPage()));
  const desktopMirror = await contexts[0].newPage();
  const record = {
    id: "fixture-session", workspaceId: "default", sourceType: "local",
    agentKind: "shell", displayName: "Fixture Session",
    connectionState: "online", interactionState: "idle",
  };
  const sessions = { activeAgentSessionId: record.id, items: [record], updatedAt: new Date().toISOString() };
  let offline = false;
  let firstBSeen = false;
  let releaseFirstB!: () => void;
  const firstB = new Promise<void>((resolve) => { releaseFirstB = resolve; });
  const forbidden: string[] = [];

  async function install(page: Page) {
    await page.routeWebSocket(/.*/, (socket) => {
      if (new URL(socket.url()).pathname === "/ws/agent-sessions")
        socket.send(JSON.stringify({ type: "snapshot", payload: sessions }));
      else socket.close();
    });
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (/\/(turn\/(start|interrupt)|thread\/(start|resume|unsubscribe))$/.test(path)) forbidden.push(path);
      if (path === "/api/session-groups") {
        if (page === desktopB && offline) { await route.abort(); return; }
        if (page === desktopB && !firstBSeen) {
          firstBSeen = true;
          await firstB;
        }
        const response = await server.inject({
          method: request.method() as "GET" | "POST",
          url: path,
          ...(request.method() === "POST" ? { payload: request.postDataJSON() } : {}),
        });
        await route.fulfill({ status: response.statusCode, contentType: "application/json", body: response.body });
      } else if (path === "/api/agent-sessions") {
        await route.fulfill({ json: sessions });
      } else {
        await route.fulfill({ json: {} });
      }
    });
  }
  async function add(page: Page, name: string) {
    page.once("dialog", (dialog) => void dialog.accept(name));
    await page.getByRole("button", { name: "＋ 新建分组" }).click();
  }
  const names = async () => (await server.inject("/api/session-groups")).json().groups.map((group: { name: string }) => group.name).sort();
  try {
    await Promise.all([desktopA, desktopB, desktopMirror, phone].map(install));
    await Promise.all([
      desktopA.goto("/?mode=terminal"),
      desktopB.goto("/?mode=terminal"),
      desktopMirror.goto("/?mode=terminal"),
      phone.goto("/?mode=terminal&view=mobile"),
    ]);
    await expect.poll(() => firstBSeen).toBe(true);
    await add(desktopB, "延迟期间创建");
    await add(desktopA, "另一设备创建");
    releaseFirstB();
    await expect.poll(names).toEqual(["另一设备创建", "延迟期间创建"].sort());

    await Promise.all([add(desktopA, "本机第一页创建"), add(desktopMirror, "本机另一页创建")]);
    await expect.poll(names).toEqual(["另一设备创建", "延迟期间创建", "本机第一页创建", "本机另一页创建"].sort());

    offline = true;
    await add(desktopB, "离线创建");
    await desktopB.reload();
    await add(desktopA, "在线创建");
    await expect.poll(names).toContain("在线创建");
    offline = false;
    await desktopB.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(names, { timeout: 15000 }).toEqual(["另一设备创建", "延迟期间创建", "本机第一页创建", "本机另一页创建", "离线创建", "在线创建"].sort());
    await phone.locator(".mobile-session-picker-trigger").click();
    await expect(phone.locator(".mobile-session-picker-group-header").filter({ hasText: "离线创建" })).toBeVisible({ timeout: 10000 });
    expect(forbidden).toEqual([]);
  } finally {
    releaseFirstB();
    await Promise.all(contexts.map((context) => context.close()));
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
