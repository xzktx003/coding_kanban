import { expect, test, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

async function start(
  home: string,
): Promise<{ child: ChildProcess; origin: string }> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      join(process.cwd(), "apps/server/node_modules/tsx/dist/loader.mjs"),
      join(process.cwd(), "tests/e2e/workspace-records-server.ts"),
      home,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "",
    errors = "";
  return new Promise((resolve, reject) => {
    child.stderr!.on("data", (chunk) => {
      errors += chunk;
    });
    child.once("exit", (code) =>
      reject(new Error(`Isolated backend exited ${code}: ${errors}`)),
    );
    child.stdout!.on("data", (chunk) => {
      output += chunk;
      if (output.includes("\n")) {
        const { port } = JSON.parse(output.trim());
        resolve({ child, origin: `http://127.0.0.1:${port}` });
      }
    });
  });
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const load = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => e.name.includes(path))?.name ?? path
      );
    const { useWorkspaceStore: ws } = await load(
      "/src/session-mode/stores/useWorkspaceStore.ts",
    );
    const { useAgentCenterStore: tabs } = await load(
      "/src/session-mode/stores/useAgentCenterStore.ts",
    );
    return {
      projects: ws.getState().projects,
      cwd: ws.getState().cwd,
      sort: ws.getState().projectSort,
      projectPending: ws.getState().pendingProjectOperations.length,
      tabs: tabs.getState().cards.map((c: { id: string }) => c.id),
      tabPending: tabs.getState().pendingTabOperations.length,
    };
  });
}

test("project and tab records survive offline reload, real backend process restart and a new device", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const home = await mkdtemp(join(tmpdir(), "workspace-records-e2e-"));
  await mkdir(join(home, ".codexia"));
  await writeFile(
    join(home, ".codexia/settings.json"),
    JSON.stringify({
      workspace: { projects: ["/project-a", "/project-b"], cwd: "/project-a" },
    }),
  );
  let backend = await start(home),
    phoneOffline = false,
    backendOnline = true;
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
  const desktop = await desktopContext.newPage(),
    phone = await phoneContext.newPage();
  const attach = async (page: Page, isPhone: boolean) => {
    await installSessionUxFixture(page, 2);
    await page.route(
      /\/api\/session\/(tabs|projects|health)(?:\?|$)/,
      async (route) => {
        if (!backendOnline || (isPhone && phoneOffline)) {
          await route.fulfill({
            status: 503,
            json: { error: "isolated offline" },
          });
          return;
        }
        const req = route.request(),
          path = new URL(req.url()).pathname;
        if (path.endsWith("/health")) {
          await route.fulfill({
            json: { status: "ok", instance: "isolated-records" },
          });
          return;
        }
        try {
          const response = await fetch(backend.origin + path, {
            method: req.method(),
            ...(req.method() === "POST"
              ? {
                  headers: { "content-type": "application/json" },
                  body: req.postData()!,
                }
              : {}),
          });
          await route.fulfill({
            status: response.status,
            contentType: "application/json",
            body: await response.text(),
          });
        } catch {
          await route.fulfill({
            status: 503,
            json: { error: "isolated restart" },
          });
        }
      },
    );
  };
  try {
    await desktop.addInitScript(() => {
      if (!localStorage.getItem("kanban.session.agent-center-store"))
        localStorage.setItem(
          "kanban.session.agent-center-store",
          JSON.stringify({
            version: 5,
            state: {
              cards: [{ kind: "codex", id: "ux-0", cwd: "/project-a" }],
              currentAgentCardId: "ux-0",
              currentAgentCardKind: "codex",
              cardsViewMode: "solo",
              cardSizeMap: {},
            },
          }),
        );
    });
    for (const page of [desktop, phone]) {
      await attach(page, page === phone);
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page
        .locator(".session-mode [contenteditable=true]")
        .first()
        .waitFor();
      await seedSessionUx(page, 2);
      await expect
        .poll(async () => (await state(page)).projects)
        .toEqual(["/project-a", "/project-b"]);
      await expect.poll(async () => (await state(page)).tabs).toEqual(["ux-0"]);
    }
    await desktop.evaluate(async () => {
      const { useWorkspaceStore: ws } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) =>
            e.name.includes("/src/session-mode/stores/useWorkspaceStore.ts"),
          )!.name
      );
      ws.getState().setCwd("/project-a");
      ws.getState().addProject("/project-c");
      ws.getState().setProjects(["/project-c", "/project-a", "/project-b"]);
    });
    await expect
      .poll(async () => (await state(phone)).projects)
      .toEqual(["/project-c", "/project-a", "/project-b"]);
    await phone.evaluate(async () => {
      const { useWorkspaceStore: ws } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) =>
            e.name.includes("/src/session-mode/stores/useWorkspaceStore.ts"),
          )!.name
      );
      ws.getState().setCwd("/project-b");
      ws.getState().setProjectSort("name_desc");
      ws.getState().removeProject("/project-a");
    });
    await expect
      .poll(async () => (await state(desktop)).projects)
      .toEqual(["/project-c", "/project-b"]);
    expect((await state(desktop)).cwd).toBe("/project-a");
    expect((await state(phone)).cwd).toBe("/project-b");
    phoneOffline = true;
    await phone.reload({ waitUntil: "domcontentloaded" });
    await expect(
      phone.getByRole("heading", { name: "正在连接，已保存的记录仍可使用" }),
    ).toBeVisible();
    await phone
      .getByRole("textbox", { name: "保存项目路径" })
      .fill("/offline-new");
    await phone.getByRole("button", { name: "添加", exact: true }).click();
    await phone.getByRole("button", { name: "移出关注会话 ux-0" }).click();
    await phone.reload({ waitUntil: "domcontentloaded" });
    await expect(
      phone.getByRole("button", { name: "/offline-new", exact: true }),
    ).toBeVisible();
    expect((await state(phone)).tabPending).toBe(1);
    expect((await state(phone)).projectPending).toBe(1);
    expect((await state(phone)).cwd).toBe("/project-b");
    expect((await state(phone)).sort).toBe("name_desc");
    await desktop.evaluate(async () => {
      const { useWorkspaceStore: ws } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) =>
            e.name.includes("/src/session-mode/stores/useWorkspaceStore.ts"),
          )!.name
      );
      const { useAgentCenterStore: tabs } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) =>
            e.name.includes("/src/session-mode/stores/useAgentCenterStore.ts"),
          )!.name
      );
      ws.getState().addProject("/desktop-new");
      tabs
        .getState()
        .addAgentCard({ kind: "codex", id: "ux-1", cwd: "/project-b" });
    });
    await expect
      .poll(
        async () =>
          (await state(desktop)).projectPending +
          (await state(desktop)).tabPending,
      )
      .toBe(0);
    backendOnline = false;
    await stop(backend.child);
    backend = await start(home);
    backendOnline = true;
    phoneOffline = false;
    await phone.evaluate(() => window.dispatchEvent(new Event("online")));
    await phone.getByRole("button", { name: "重试连接", exact: true }).click();
    const projects = [
      "/project-c",
      "/project-b",
      "/desktop-new",
      "/offline-new",
    ];
    for (const page of [phone, desktop]) {
      await expect
        .poll(async () => (await state(page)).projects)
        .toEqual(projects);
      await expect.poll(async () => (await state(page)).tabs).toEqual(["ux-1"]);
    }
    expect((await state(phone)).cwd).toBe("/project-b");
    expect((await state(desktop)).cwd).toBe("/project-a");
    const fresh = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await fresh.newPage();
      await attach(page, false);
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await expect
        .poll(async () => (await state(page)).projects)
        .toEqual(projects);
      await expect.poll(async () => (await state(page)).tabs).toEqual(["ux-1"]);
      expect((await state(page)).cwd).toBeNull();
    } finally {
      await fresh.close();
    }
    expect(
      JSON.parse(await readFile(join(home, "projects.json"), "utf8")).projects,
    ).toEqual(projects);
    expect(
      JSON.parse(
        await readFile(join(home, "followed-sessions.json"), "utf8"),
      ).cards.map((c: { id: string }) => c.id),
    ).toEqual(["ux-1"]);
    expect(
      (await readFile(join(home, "projects.json.bak"), "utf8")).length,
    ).toBeGreaterThan(0);
  } finally {
    await Promise.allSettled([desktopContext.close(), phoneContext.close()]);
    await stop(backend.child);
    await rm(home, { recursive: true, force: true });
  }
});
