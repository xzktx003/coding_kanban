import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

async function commandState(
  page: Page,
  theme: string,
  command: Record<string, unknown>,
) {
  await page.evaluate(
    async ({ theme, command }) => {
      const { startedAtMs, ...snapshot } = command;
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
        preview: "命令呈现验收",
      });
      useAgentCenterStore.setState({
        currentAgentCardId: "ux-0",
        currentAgentCardKind: "codex",
        cardsViewMode: "solo",
      });
      useCodexStore.setState({
        events: {
          "ux-0": [
            {
              method: "item/started",
              params: {
                threadId: "ux-0",
                turnId: "command-turn",
                startedAtMs,
                item: {
                  type: "commandExecution",
                  id: "native-command",
                  commandActions: [],
                  cwd: "/fixture/owner",
                  ...snapshot,
                },
              },
            },
          ],
        },
        historyLoadedMap: { "ux-0": true },
        historyLoadingMap: {},
        currentThreadId: "ux-0",
      });
    },
    { theme, command },
  );
}

for (const width of [1440, 390])
  test.describe(`${width}px native commands`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"])
      test(`live output, exit footer, expansion, copy and scroll (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await installSessionUxFixture(page);
        await page.addInitScript(() =>
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: async (text: string) => {
                (window as any).copiedCommandText = text;
              },
            },
          }),
        );
        await page.setViewportSize({ width, height: 1000 });
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page);
        const command = "/bin/zsh -lc 'first\nsecond\nthird'";
        const raw =
          "\u001b[32mchecks passed\u001b[0m\n" +
          Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
        await commandState(page, theme, {
          command,
          status: "inProgress",
          aggregatedOutput: null,
        });
        await page.locator(".codex-native-activity-header button[aria-expanded=false]").click();
        const shell = page.locator(".codex-command").first();
        const summary = shell.locator(".codex-command-summary");
        await expect(summary).toHaveText("正在运行命令");
        await expect(summary).toHaveAttribute("aria-expanded", "false");
        await summary.click();
        await expect(shell.getByTestId("exec-shell-body")).toBeVisible();
        await commandState(page, theme, {
          command,
          status: "inProgress",
          aggregatedOutput: raw,
        });
        await expect(summary).toHaveAttribute("aria-expanded", "true");
        const output = shell.locator(".codex-command-output");
        expect(
          await output.evaluate((el) => el.clientHeight),
        ).toBeLessThanOrEqual(144);
        expect(await output.innerText()).not.toContain("\u001b");
        await output.evaluate((el) => {
          el.scrollTop = -100;
        });
        await page.waitForTimeout(100);
        const reading = await output.evaluate(
          (el) => el.scrollHeight - el.clientHeight + el.scrollTop,
        );
        await commandState(page, theme, {
          command,
          status: "inProgress",
          aggregatedOutput: raw + "\nlate output",
        });
        expect(
          Math.abs(
            (await output.evaluate(
              (el) => el.scrollHeight - el.clientHeight + el.scrollTop,
            )) - reading,
          ),
        ).toBeLessThanOrEqual(1);
        const savedScroll = await output.evaluate((el) => el.scrollTop);
        await summary.click();
        await summary.click();
        expect(await output.evaluate((el) => el.scrollTop)).toBeCloseTo(
          savedScroll,
          0,
        );
        const line = shell.locator(".codex-command-line");
        await expect(line).toHaveAttribute("data-expanded", "false");
        await line.click();
        await expect(line).toHaveAttribute("data-expanded", "true");
        await commandState(page, theme, {
          command,
          status: "completed",
          aggregatedOutput: raw,
          durationMs: 9400,
          exitCode: 0,
        });
        await expect(summary).toHaveText("命令已在 9s 内运行完成");
        await expect(shell.locator(".codex-command-footer")).toHaveText("成功");
        if (width === 1440)
          await shell.locator(".codex-command-output-wrap").hover();
        await shell
          .getByRole("button", { name: "复制输出", exact: true })
          .click();
        await expect
          .poll(() => page.evaluate(() => (window as any).copiedCommandText))
          .toBe(raw);
        if (width === 390)
          expect(
            await shell
              .getByRole("button", { name: "复制命令", exact: true })
              .evaluate((el) => el.getBoundingClientRect().height),
          ).toBeGreaterThanOrEqual(44);
        const bounds = await shell.boundingBox();
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(
          await page.evaluate(() =>
            document.activeElement?.getAttribute("contenteditable"),
          ),
        ).not.toBe("true");
        await page.screenshot({
          path: info.outputPath(`command-${width}-${theme}.png`),
          fullPage: true,
        });
        await commandState(page, theme, {
          command,
          status: "failed",
          aggregatedOutput: "failure",
          exitCode: 7,
        });
        await expect(shell.locator(".codex-command-footer")).toHaveText(
          "退出码 7",
        );
        await commandState(page, theme, {
          command,
          status: "completed",
          aggregatedOutput: "",
          exitCode: null,
        });
        await expect(shell.locator(".codex-command-footer")).toHaveText(
          "退出码 未知",
        );
        await expect(output).toHaveText("无输出");
        await commandState(page, theme, {
          command,
          status: "inProgress",
          aggregatedOutput: "live timer",
          startedAtMs: Date.now() - 2000,
        });
        await expect(summary).toContainText("命令正在运行（已用时");
        const timing = await summary.innerText();
        await expect.poll(() => summary.innerText()).not.toBe(timing);
        await commandState(page, theme, {
          command,
          status: "completed",
          aggregatedOutput: "done",
          durationMs: 1500,
          exitCode: 0,
        });
        await expect(summary).toHaveText("命令已在 1s 内运行完成");
        expect(errors).toEqual([]);
      });
  });
