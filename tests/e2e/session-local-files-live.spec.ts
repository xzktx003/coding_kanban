import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const xlsx = createRequire(join(process.cwd(), "apps/web/package.json"))(
  "xlsx",
);

test("browser uses the real gateway only for its owned external file", async ({
  page,
}) => {
  test.skip(
    process.env.KANBAN_LOCAL_FILES_LIVE !== "1",
    "Explicit real-gateway fixture only",
  );
  test.setTimeout(90_000);
  const base = await mkdtemp(join(tmpdir(), "kanban-real-local-e2e-"));
  const project = join(base, "project"),
    outside = join(base, "outside");
  await mkdir(project);
  await mkdir(outside);
  const file = join(outside, "real-gateway.txt");
  const spreadsheet = join(outside, "real-gateway.xlsx");
  await writeFile(file, "owned initial\n");
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(
    workbook,
    xlsx.utils.aoa_to_sheet([["live workbook value"]]),
    "Sheet1",
  );
  await writeFile(
    spreadsheet,
    xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }),
  );
  const realRequests: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const fixture = await installSessionUxFixture(page, 1);
    fixture.threads[0].cwd = project;
    const turn = {
      id: "real-file-turn",
      status: "completed",
      startedAt: 1,
      durationMs: 1000,
      error: null,
      items: [
        {
          id: "real-file-answer",
          type: "agentMessage",
          text: `[真实网关文件](${file}:1)\n\n[真实网关工作簿](${spreadsheet})`,
          phase: "final_answer",
        },
      ],
    };
    fixture.threads[0].turns = [turn] as never[];
    await page.route("**/api/session/projects", (route) =>
      route.fulfill({
        json: {
          initialized: true,
          revision: 1,
          sequence: 0,
          projects: [project],
        },
      }),
    );
    await page.route("**/api/session/local-files/**", async (route) => {
      const request = route.request(),
        action = new URL(request.url()).pathname.split("/").at(-1);
      const body = request.method() === "POST" ? request.postDataJSON() : null;
      if (
        !action ||
        !["resolve", "read", "save"].includes(action) ||
        (body?.path !== file &&
          !(action === "resolve" && body?.path === spreadsheet))
      )
        return route.fulfill({
          status: 403,
          json: { error: "outside owned fixture" },
        });
      realRequests.push(action);
      await route.continue();
    });
    await page.route("**/api/session/api/filesystem/**", async (route) => {
      const request = route.request();
      const action = new URL(request.url()).pathname.split("/").at(-1);
      const body = request.method() === "POST" ? request.postDataJSON() : null;
      const ownedDirectoryRequest =
        action &&
        ["canonicalize-path", "read-directory"].includes(action) &&
        [project, outside].includes(body?.path);
      const ownedBinaryRequest =
        action === "read-file" && body?.filePath === spreadsheet;
      if (!action || (!ownedDirectoryRequest && !ownedBinaryRequest))
        return route.fulfill({
          status: 403,
          json: { error: "outside owned fixture" },
        });
      realRequests.push(`filesystem/${action}:${body.path ?? body.filePath}`);
      await route.continue();
    });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor();
    await seedSessionUx(page, 1);
    await page.evaluate(
      async ({ project, turn }) => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
        const [
          { useCodexStore },
          { useAgentCenterStore },
          { useWorkspaceStore },
          { useLayoutStore },
          { useEditorStore },
        ] = await Promise.all([
          load("/src/session-mode/components/codex/stores/index.ts"),
          load("/src/session-mode/stores/useAgentCenterStore.ts"),
          load("/src/session-mode/stores/useWorkspaceStore.ts"),
          load("/src/session-mode/stores/useLayoutStore.ts"),
          load("/src/session-mode/stores/useEditorStore.ts"),
        ]);
        useEditorStore.getState().resetFiles();
        useWorkspaceStore.setState({ cwd: project, projects: [project] });
        useCodexStore.setState({
          threads: [
            {
              id: "ux-0",
              cwd: project,
              status: { type: "idle" },
              turns: [turn],
            },
          ],
          events: {
            "ux-0": [
              ...turn.items.map((item) => ({
                method: "item/completed",
                params: { threadId: "ux-0", turnId: turn.id, item },
              })),
              { method: "turn/completed", params: { threadId: "ux-0", turn } },
            ],
          },
          historyLoadedMap: { "ux-0": true },
          currentThreadId: "ux-0",
          currentTurnId: null,
        });
        useAgentCenterStore.getState().addAgentCard(
          {
            kind: "codex",
            id: "ux-0",
            cwd: project,
            preview: "Real gateway",
          },
          { activate: true },
        );
        useAgentCenterStore.setState({ cardsViewMode: "solo" });
        useLayoutStore.setState({
          view: "agent",
          isSidebarOpen: false,
          isRightPanelOpen: false,
          openRightPanelTabs: ["files"],
        });
      },
      { project, turn },
    );
    await page.getByRole("link", { name: "真实网关文件" }).click();
    const editor = page.locator(".session-mode .ace_editor:visible");
    await expect
      .poll(() => editor.evaluate((el) => (el as any).env.editor.getValue()))
      .toContain("owned initial");
    await editor.evaluate((el) =>
      (el as any).env.editor.setValue("owned edited\n", -1),
    );
    await page
      .getByRole("button", { name: "保存文件（Ctrl+S）", exact: true })
      .click();
    await expect.poll(() => readFile(file, "utf8")).toBe("owned edited\n");
    const panel = page.getByRole("region", { name: "会话文件管理" });
    await panel.getByLabel("文件浏览路径").fill(outside);
    await panel.getByRole("button", { name: "前往" }).click();
    await expect(panel.getByLabel("文件浏览路径")).toHaveValue(outside);
    await expect(
      panel.getByRole("button", { name: "文件 real-gateway.txt", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "真实网关工作簿" }).click();
    await expect(
      page.getByRole("cell", { name: "live workbook value" }),
    ).toBeVisible();
    expect(realRequests).toEqual(
      expect.arrayContaining([
        "resolve",
        "read",
        "save",
        `filesystem/canonicalize-path:${outside}`,
        `filesystem/read-directory:${outside}`,
        `filesystem/read-file:${spreadsheet}`,
      ]),
    );
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await rm(base, { recursive: true, force: true, maxRetries: 5 });
  }
});
