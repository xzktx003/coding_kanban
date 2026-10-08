import { expect, test, type Page } from "@playwright/test";
import Fastify from "../../apps/server/node_modules/fastify/fastify.js";
import { registerSessionProjectsRoutes } from "../../apps/server/src/routes/session-projects";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSessionUxFixture } from "./session-ux-fixture";

async function workspace(page: Page, sort?: string) {
  return page.evaluate(async (sort) => {
    const url =
      performance
        .getEntriesByType("resource")
        .findLast(
          (entry) =>
            new URL(entry.name).pathname ===
            "/src/session-mode/stores/useWorkspaceStore.ts",
        )?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts";
    const { useWorkspaceStore: store } = await import(url);
    if (sort) store.getState().setProjectSort(sort);
    return {
      projects: store.getState().projects,
      pending: store.getState().pendingProjectOperations.length,
    };
  }, sort);
}

test("same-browser project additions survive stale pages, offline refresh, server restart and response replay", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const dir = await mkdtemp(join(tmpdir(), "same-browser-projects-"));
  const file = join(dir, "projects.json");
  let app = Fastify();
  registerSessionProjectsRoutes(app, { file });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const pages = [await context.newPage(), await context.newPage()];
  const offline = new Set<Page>();
  const posts: any[] = [];
  const serverProjects = async () =>
    (await app.inject("/api/session/projects")).json().projects;
  try {
    await app.inject({
      method: "POST",
      url: "/api/session/projects",
      payload: { clientId: "seed", seed: ["/existing"], operations: [] },
    });
    await context.addInitScript(() => {
      if (!localStorage.getItem("kanban.session.workspace"))
        localStorage.setItem(
          "kanban.session.workspace",
          JSON.stringify({
            version: 1,
            state: {
              projects: ["/existing"],
              cwd: "/existing",
              projectSyncClientId: "same-browser",
              nextProjectSequence: 1,
              pendingProjectOperations: [],
              projectsInitialized: true,
            },
          }),
        );
    });
    for (const page of pages) {
      await installSessionUxFixture(page, 1);
      // Keep the metadata UI available without involving any live Agent runtime.
      await page.route("**/api/session/health", (route) =>
        route.fulfill({ status: 503, json: {} }),
      );
      await page.route("**/api/session/projects", async (route) => {
        if (offline.has(page)) return route.abort();
        const req = route.request();
        const payload =
          req.method() === "POST" ? req.postDataJSON() : undefined;
        if (payload) posts.push(payload);
        const response = await app.inject({
          method: req.method() as "GET" | "POST",
          url: "/api/session/projects",
          ...(payload ? { payload } : {}),
        });
        await route.fulfill({
          status: response.statusCode,
          contentType: "application/json",
          body: response.body,
        });
      });
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("textbox", { name: "保存项目路径" }),
      ).toBeVisible();
    }
    const add = async (page: Page, path: string) => {
      await page.getByRole("textbox", { name: "保存项目路径" }).fill(path);
      await page.getByRole("button", { name: "添加", exact: true }).click();
    };
    await add(pages[0], "/first");
    await expect.poll(serverProjects).toEqual(["/existing", "/first"]);
    await add(pages[1], "/second");
    await expect
      .poll(serverProjects)
      .toEqual(["/existing", "/first", "/second"]);
    await pages[1].reload({ waitUntil: "domcontentloaded" });
    await expect(
      pages[1].getByRole("button", { name: "/second", exact: true }),
    ).toBeVisible();
    offline.add(pages[0]);
    offline.add(pages[1]);
    await add(pages[0], "/offline-new");
    await workspace(pages[1], "name_desc");
    await pages[0].reload({ waitUntil: "domcontentloaded" });
    await expect(
      pages[0].getByRole("button", { name: "/offline-new", exact: true }),
    ).toBeVisible();
    offline.clear();
    await pages[0].evaluate(() => window.dispatchEvent(new Event("online")));
    await expect
      .poll(serverProjects)
      .toEqual(["/existing", "/first", "/second", "/offline-new"]);
    await pages[0]
      .getByRole("button", { name: "移出项目 /first", exact: true })
      .click();
    await expect
      .poll(serverProjects)
      .toEqual(["/existing", "/second", "/offline-new"]);
    await app.close();
    app = Fastify();
    registerSessionProjectsRoutes(app, { file });
    const originalAdd = posts.find((body) =>
      body.operations.some(
        (op: any) => op.action.type === "add" && op.action.path === "/first",
      ),
    );
    expect(originalAdd).toBeTruthy();
    await app.inject({
      method: "POST",
      url: "/api/session/projects",
      payload: originalAdd,
    });
    expect(await serverProjects()).toEqual([
      "/existing",
      "/second",
      "/offline-new",
    ]);
    for (const page of pages) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(async () => (await workspace(page)).projects)
        .toEqual(["/existing", "/second", "/offline-new"]);
      await expect.poll(async () => (await workspace(page)).pending).toBe(0);
    }
  } finally {
    await context.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
