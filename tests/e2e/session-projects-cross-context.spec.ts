import { expect, test, type Page } from "@playwright/test";
import Fastify from "../../apps/server/node_modules/fastify/fastify.js";
import { registerSessionProjectsRoutes } from "../../apps/server/src/routes/session-projects";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const workspace = (page: Page) =>
  page.evaluate(async () => {
    const url =
      performance
        .getEntriesByType("resource")
        .findLast(
          (entry) =>
            new URL(entry.name).pathname ===
            "/src/session-mode/stores/useWorkspaceStore.ts",
        )?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts";
    const { useWorkspaceStore: store } = await import(url);
    const state = store.getState();
    return {
      projects: state.projects,
      cwd: state.cwd,
      clientId: state.projectSyncClientId,
      pending: state.pendingProjectOperations.length,
    };
  });

const changeWorkspace = (page: Page, action: "add" | "select", path: string) =>
  page.evaluate(
    async ({ action, path }) => {
      const url =
        performance
          .getEntriesByType("resource")
          .findLast(
            (entry) =>
              new URL(entry.name).pathname ===
              "/src/session-mode/stores/useWorkspaceStore.ts",
          )?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts";
      const { useWorkspaceStore: store } = await import(url);
      if (action === "add") store.getState().addProject(path);
      else store.getState().setCwd(path);
    },
    { action, path },
  );

test("separate desktop and phone contexts share projects while keeping local cwd and merging offline edits", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "cross-context-projects-"));
  const server = Fastify();
  registerSessionProjectsRoutes(server, {
    file: join(directory, "projects.json"),
  });
  const initialProject = "/fixture/项目/very-long-project-path-for-ui-regression";
  await server.inject({
    method: "POST",
    url: "/api/session/projects",
    payload: { clientId: "seed", seed: [initialProject], operations: [] },
  });

  const desktopContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const phoneContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const desktop = await desktopContext.newPage();
  const phone = await phoneContext.newPage();
  const fixtures = [] as Awaited<ReturnType<typeof installSessionUxFixture>>[];
  let phoneOffline = false;

  try {
    for (const page of [desktop, phone]) {
      const fixture = await installSessionUxFixture(page, 5);
      fixtures.push(fixture);
      await page.route("**/api/session/projects", async (route) => {
        if (page === phone && phoneOffline) {
          await route.abort();
          return;
        }
        const request = route.request();
        const response = await server.inject({
          method: request.method() as "GET" | "POST",
          url: "/api/session/projects",
          ...(request.method() === "POST"
            ? { payload: request.postDataJSON() }
            : {}),
        });
        await route.fulfill({
          status: response.statusCode,
          contentType: "application/json",
          body: response.body,
        });
      });
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page
        .locator(".session-mode [contenteditable=true]")
        .first()
        .waitFor();
      await seedSessionUx(page, 5);
      await expect.poll(async () => (await workspace(page)).projects).toEqual([
        initialProject,
      ]);
    }

    expect((await workspace(desktop)).clientId).not.toBe(
      (await workspace(phone)).clientId,
    );

    await changeWorkspace(desktop, "add", "/shared/desktop-project");
    await expect
      .poll(async () => (await workspace(phone)).projects)
      .toEqual([initialProject, "/shared/desktop-project"]);
    await changeWorkspace(phone, "add", "/shared/phone-project");
    await expect
      .poll(async () => (await workspace(desktop)).projects)
      .toEqual([
        initialProject,
        "/shared/desktop-project",
        "/shared/phone-project",
      ]);

    await changeWorkspace(desktop, "select", "/shared/desktop-project");
    await changeWorkspace(phone, "select", "/shared/phone-project");

    phoneOffline = true;
    await changeWorkspace(phone, "add", "/offline/phone-project");
    await expect.poll(async () => (await workspace(phone)).pending).toBe(1);
    await changeWorkspace(desktop, "add", "/online/desktop-project");
    await expect
      .poll(async () => (await workspace(desktop)).projects)
      .toEqual([
        initialProject,
        "/shared/desktop-project",
        "/shared/phone-project",
        "/online/desktop-project",
      ]);

    phoneOffline = false;
    await phone.evaluate(() => window.dispatchEvent(new Event("online")));
    const recoveredProjects = [
      initialProject,
      "/shared/desktop-project",
      "/shared/phone-project",
      "/online/desktop-project",
      "/offline/phone-project",
    ];
    await expect
      .poll(async () => (await workspace(phone)).projects)
      .toEqual(recoveredProjects);
    await expect
      .poll(async () => (await workspace(desktop)).projects)
      .toEqual(recoveredProjects);
    expect((await workspace(phone)).pending).toBe(0);
    expect((await workspace(desktop)).cwd).toBe("/shared/desktop-project");
    expect((await workspace(phone)).cwd).toBe("/shared/phone-project");
    for (const fixture of fixtures)
      expect(
        fixture.calls.filter((call) =>
          /\/(turn\/(start|interrupt)|thread\/(start|resume|unsubscribe))$/.test(
            call.path,
          ),
        ),
      ).toEqual([]);
  } finally {
    await desktopContext.close();
    await phoneContext.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
