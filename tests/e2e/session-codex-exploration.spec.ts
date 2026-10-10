import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const cwd = "/fixture/captured-owner";
const command = (id: string, action: any, status = "completed") => ({
  method: status === "inProgress" ? "item/started" : "item/completed",
  params: {
    threadId: "ux-0",
    turnId: "exploration-turn",
    startedAtMs: Date.now(),
    item: {
      type: "commandExecution",
      id,
      command: action.command,
      commandActions: [action],
      cwd,
      status,
      aggregatedOutput: null,
      exitCode: status === "completed" ? 0 : null,
    },
  },
});
const read = (name: string) => ({
  type: "read",
  name,
  path: `${cwd}/${name}`,
  command: `cat ${name}`,
});
const reply = {
  method: "item/completed",
  params: {
    threadId: "ux-0",
    turnId: "exploration-turn",
    item: { type: "agentMessage", id: "reply", text: "核对已完成。" },
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
      );
      const { useCodexStore } = await module(
        "/src/session-mode/components/codex/stores/index.ts",
      );
      const { useLayoutStore } = await module(
        "/src/session-mode/stores/useLayoutStore.ts",
      );
      const { useAgentCenterStore } = await module(
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
        preview: "探索活动验收",
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
  test.describe(`${width}px exploration`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"])
      test(`native rows, live disclosure and captured file ownership (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await installSessionUxFixture(page);
        const reads: { root: string; path: string }[] = [];
        await page.route(
          "**/api/session/workspace-files/read",
          async (route) => {
            const request = route.request().postDataJSON();
            reads.push(request);
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                path: request.path,
                content: "# 文件跳转验收正文\n\nFixture file content.\n",
                version: "fixture-v1",
                size: 64,
              }),
            });
          },
        );
        await page.setViewportSize({ width, height: 844 });
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page);
        const events = [
          command("read", read("100%done:a.md")),
          command("search", {
            type: "search",
            query: "<path>foo</path>",
            path: "src",
            command: "rg",
          }),
          command("list", {
            type: "listFiles",
            path: "src",
            command: "ls src",
          }),
          reply,
        ];
        await state(page, theme, events);
        const header = page.getByRole("button", {
          name: "已读取文件",
          exact: true,
        });
        await expect(header).toHaveAttribute("aria-expanded", "false");
        await expect(
          page.getByRole("link", { name: "100%done:a.md" }),
        ).toHaveCount(0);
        await header.click();
        await expect(
          page.getByRole("link", { name: "100%done:a.md" }),
        ).toBeVisible();
        await expect(page.locator('[data-command-action="search"]')).toHaveText(
          "已在 src 中搜索“<path>foo</path>”",
        );
        await expect(
          page.locator('[data-command-action="listFiles"]'),
        ).toHaveText("已列出 src 中的文件");
        expect(
          await page.locator(".codex-activity-body [data-slot=badge]").count(),
        ).toBe(0);
        const lineHeight = await page
          .locator(".codex-exploration")
          .first()
          .evaluate((el) => getComputedStyle(el).lineHeight);
        expect(lineHeight).toBe("19.5px");
        const updated = [
          ...events.slice(0, -1),
          ...Array.from({ length: 20 }, (_, i) =>
            command(`extra-${i}`, read(`extra-${i}.ts`)),
          ),
          reply,
          command("pending", read("pending.ts"), "inProgress"),
        ];
        await state(page, theme, updated);
        await expect(header).toHaveAttribute("aria-expanded", "true");
        await expect(
          page.locator('.codex-cadenced-shimmer').filter({ hasText: "正在读取 pending.ts" }),
        ).toBeVisible();
        await expect(
          page
            .locator('[data-command-action="read"]')
            .filter({ hasText: "pending.ts" }),
        ).toHaveCount(0);
        const body = page.locator(".codex-activity-body").first();
        const dims = await body.evaluate((el) => ({
          height: el.clientHeight,
          total: el.scrollHeight,
          mask: getComputedStyle(el).maskImage,
        }));
        expect(dims.height).toBeLessThanOrEqual(224);
        expect(dims.total).toBeGreaterThan(dims.height);
        expect(dims.mask).not.toBe("none");
        await body.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await expect(
          page.getByRole("link", { name: "extra-19.ts", exact: true }),
        ).toBeVisible();
        await body.evaluate((el) => {
          el.scrollTop = 0;
        });
        await page.screenshot({
          path: info.outputPath(`exploration-${width}-${theme}.png`),
          fullPage: true,
        });
        const before = await page.evaluate(async () => {
          const { useWorkspaceStore } =
            await import("/src/session-mode/stores/useWorkspaceStore.ts");
          return useWorkspaceStore.getState().cwd;
        });
        // Vite can keep a timestamped import and a bare test import as separate
        // modules. Observe the store actually imported by the mounted renderer.
        await page.evaluate(async () => {
          const resource =
            performance
              .getEntriesByType("resource")
              .findLast(
                (entry) =>
                  new URL(entry.name).pathname ===
                  "/src/session-mode/components/codex/items/CommandActionItem.tsx",
              )?.name ??
            "/src/session-mode/components/codex/items/CommandActionItem.tsx";
          const source = await (await fetch(resource)).text();
          const dependency = source.match(
            /import \{ useEditorStore \} from "([^"]+)"/,
          )?.[1];
          if (!dependency)
            throw new Error(
              "Mounted command renderer editor dependency missing",
            );
          (window as any).ownedEditorDependency = dependency;
          const { useEditorStore } = await import(dependency);
          (window as any).ownedReveals = [];
          useEditorStore.subscribe((state) => {
            if (state.revealLocation)
              (window as any).ownedReveals.push(state.revealLocation);
          });
        });
        await page
          .getByRole("link", { name: "100%done:a.md", exact: true })
          .click();
        const target = await page.evaluate(async () => {
          const { useEditorStore } = await import(
            (window as any).ownedEditorDependency
          );
          const { useWorkspaceStore } =
            await import("/src/session-mode/stores/useWorkspaceStore.ts");
          const { useCodexStore } =
            await import("/src/session-mode/components/codex/stores/index.ts");
          const s = useEditorStore.getState();
          return {
            file: s.activeFile,
            root: s.roots[s.activeFile!],
            line: (window as any).ownedReveals.at(-1)?.line,
            project: useWorkspaceStore.getState().cwd,
            thread: useCodexStore.getState().currentThreadId,
            focused: document.activeElement?.getAttribute("contenteditable"),
          };
        });
        expect(target).toMatchObject({
          file: `${cwd}/100%done:a.md`,
          root: cwd,
          line: 1,
          project: before,
          thread: "ux-0",
        });
        expect(target.focused).not.toBe("true");
        await expect
          .poll(() => reads)
          .toContainEqual({ root: cwd, path: `${cwd}/100%done:a.md` });
        await expect(
          page.getByRole("status").filter({ hasText: "正在加载文件" }),
        ).toHaveCount(0);
        await expect(page.locator(".ace_editor:visible")).toContainText(
          "文件跳转验收正文",
        );
        if (width === 390)
          expect(
            await page.evaluate(() =>
              document.activeElement?.matches(
                "textarea,input,[contenteditable=true]",
              ),
            ),
          ).toBe(false);
        expect(errors).toEqual([]);
      });
  });
