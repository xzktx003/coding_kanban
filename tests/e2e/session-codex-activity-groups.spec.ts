import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const cwd = "/fixture/项目/very-long-project-path-for-ui-regression";
const item = (
  id: string,
  type: string,
  fields: any,
  method = "item/completed",
) => ({
  method,
  params: {
    threadId: "ux-0",
    turnId: "group-turn",
    startedAtMs: Date.now() - 2000,
    item: { id, type, ...fields },
  },
});
const command = (id: string, status = "completed") =>
  item(
    id,
    "commandExecution",
    {
      command: id,
      commandActions: [],
      cwd,
      status,
      aggregatedOutput:
        status === "completed" ? "checks passed" : "live output",
      durationMs: status === "completed" ? 2000 : null,
      exitCode: status === "completed" ? 0 : null,
    },
    status === "inProgress" ? "item/started" : "item/completed",
  );
const read = item("read", "commandExecution", {
  command: "cat file.ts",
  commandActions: [
    {
      type: "read",
      command: "cat file.ts",
      name: "file.ts",
      path: `${cwd}/file.ts`,
    },
  ],
  cwd,
  status: "completed",
  aggregatedOutput: "source",
  exitCode: 0,
  durationMs: 3,
});
const mcp = item("mcp", "mcpToolCall", {
  server: "fixture",
  tool: "lookup",
  status: "completed",
  arguments: { query: "ownership" },
  result: { content: [{ type: "text", text: "Owned tool result" }] },
  durationMs: 10,
});
const patch = item("patch", "fileChange", {
  status: "completed",
  changes: [
    {
      path: `${cwd}/file.py`,
      kind: { type: "update", move_path: null },
      diff: "@@ -115 +115 @@\n-old = 1\n+new = 2\n",
    },
  ],
});
const start = {
  method: "turn/started",
  params: {
    threadId: "ux-0",
    turn: { id: "group-turn", status: "inProgress", items: [] },
  },
};

async function state(page: Page, theme: string, events: any[]) {
  await page.evaluate(
    async ({ theme, events }) => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
      const { useThemeStore } = await module(
          "/src/session-mode/stores/settings/useThemeStore.ts",
        ),
        { useCodexStore } = await module(
          "/src/session-mode/components/codex/stores/index.ts",
        ),
        { useLayoutStore } = await module(
          "/src/session-mode/stores/useLayoutStore.ts",
        ),
        { useAgentCenterStore } = await module(
          "/src/session-mode/stores/useAgentCenterStore.ts",
        );
      useThemeStore.getState().setTheme(theme);
      useLayoutStore.setState({
        view: "agent",
        isSidebarOpen: false,
        isRightPanelOpen: false,
      });
      useAgentCenterStore.getState().addAgentCard({
        kind: "codex",
        id: "ux-0",
        cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
        preview: "混合活动分组验收",
      });
      useAgentCenterStore.setState({
        currentAgentCardId: "ux-0",
        currentAgentCardKind: "codex",
        cardsViewMode: "solo",
      });
      useCodexStore.setState({
        events: { "ux-0": events },
        historyLoadedMap: { "ux-0": true },
        historyLoadingMap: {},
        currentThreadId: "ux-0",
      });
    },
    { theme, events },
  );
}

for (const width of [1440, 390])
  test.describe(`${width}px native activity groups`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"])
      test(`mixed tools keep state, patch hover and detached input (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await installSessionUxFixture(page);
        await page.setViewportSize({ width, height: 844 });
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-mode [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page);
        const initial = [
          start,
          read,
          mcp,
          patch,
          command("pnpm test", "inProgress"),
        ];
        await state(page, theme, initial);
        const editor = page
          .locator(".session-codex-composer [contenteditable=true]")
          .first();
        const group = page.locator(".codex-native-activity-group").first();
        await expect(group).toHaveAttribute("data-activity-state", "active");
        const header = group.getByRole("button", {
          name: "正在运行 pnpm test",
          exact: true,
        });
        await expect(header).toHaveAttribute("aria-expanded", "false");
        await header.click();
        await expect(
          group.getByRole("link", { name: "file.ts", exact: true }),
        ).toBeVisible();
        await group
          .getByRole("button", { name: "Lookup", exact: true })
          .click();
        await expect(
          group.getByText("Owned tool result", { exact: true }),
        ).toBeVisible();
        const commandRow = group.locator(".codex-command").first();
        await commandRow.locator(".codex-command-summary").click();
        await expect(commandRow.getByTestId("exec-shell-body")).toBeVisible();
        await expect(commandRow.locator(".codex-command-output")).toHaveText(
          "live output",
        );
        const body = group.locator(":scope > .codex-activity-body");
        await expect(body).toBeVisible();
        expect(
          await body.evaluate((el) => el.clientHeight),
        ).toBeLessThanOrEqual(224);
        await page.screenshot({
          path: info.outputPath(`group-active-${width}-${theme}.png`),
          fullPage: true,
        });
        await state(page, theme, [...initial, command("pnpm test")]);
        await expect(group).toHaveAttribute("data-activity-state", "thinking");
        await expect(
          group.getByRole("button", { name: "正在思考", exact: true }),
        ).toHaveAttribute("aria-expanded", "true");
        await expect(
          group.getByText("Owned tool result", { exact: true }),
        ).toBeVisible();
        await expect(commandRow.getByTestId("exec-shell-body")).toBeVisible();
        const end = {
          method: "turn/completed",
          params: {
            threadId: "ux-0",
            turn: {
              id: "group-turn",
              status: "completed",
              items: [],
              completedAt: Date.now() / 1000,
              durationMs: 3000,
              error: null,
            },
          },
        };
        await state(page, theme, [...initial, command("pnpm test"), end]);
        // Completed process rows live behind the actual per-turn work disclosure.
        // The saved-file summary remains available outside that disclosure.
        const work = page.locator(
          'button.codex-turn-work-header[data-turn-work="group-turn"]',
        );
        await expect(work).toBeVisible();
        await expect(work).toHaveAttribute("aria-expanded", "false");
        await expect(group).toHaveCount(0);
        const preview = page.getByRole("button", {
          name: "预览 file.py Diff",
          exact: true,
        });
        await expect(preview).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`group-turn-collapsed-${width}-${theme}.png`),
          fullPage: true,
        });
        if (width === 390) await work.tap();
        else await work.click();
        await expect(work).toHaveAttribute("aria-expanded", "true");
        await expect(group).toHaveAttribute("data-activity-state", "summary");
        await expect(
          group.getByRole("button", {
            name: "已使用 Fixture 集成编辑了多个文件读取文件运行了命令",
            exact: true,
          }),
        ).toHaveAttribute("aria-expanded", "true");
        await expect(
          group.getByText("Owned tool result", { exact: true }),
        ).toBeVisible();
        await expect(
          commandRow.getByText("成功", { exact: true }),
        ).toBeVisible();
        // Existing saved-turn hover remains outside the collapsed tool trace.
        await preview.click();
        await expect(
          page
            .locator(".codex-file-preview .codex-diff-number")
            .filter({ hasText: "115" })
            .first(),
        ).toBeVisible();
        // Inspect the finished popover rather than an in-flight fade-in frame.
        await expect(page.locator(".codex-file-preview").first()).toHaveCSS(
          "opacity",
          "1",
        );
        await page.screenshot({
          path: info.outputPath(`group-summary-${width}-${theme}.png`),
          fullPage: true,
        });
        expect(
          await page.evaluate(() =>
            document.activeElement?.matches(
              "textarea,input,[contenteditable=true]",
            ),
          ),
        ).toBe(false);
        const detached = await page.evaluate(() => {
          const composer = document.querySelector(".session-codex-composer");
          return !composer?.closest(".codex-transcript-surface");
        });
        expect(detached).toBe(true);
        await expect(editor).toBeVisible();
        expect(errors).toEqual([]);
      });
  });
