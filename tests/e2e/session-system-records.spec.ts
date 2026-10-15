import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const width of [1440, 390])
  for (const theme of ["dark", "light"] as const) {
    test.describe(`${width}-${theme}`, () => {
      test.use({ hasTouch: width === 390, isMobile: width === 390 });
      test(`thread closed records stay in the corner (${width}, ${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        await page.setViewportSize({ width, height: 1000 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const fixture = await installSessionUxFixture(page, 2);
        await page.goto("/?mode=session");
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page, 2);
        await page.evaluate(async (theme) => {
          const module = (path: string) =>
            import(
              /* @vite-ignore */ performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
          const [
            { useCodexStore },
            { useAgentCenterStore },
            { useLayoutStore },
            { useThemeStore },
          ] = await Promise.all([
            module("/src/session-mode/components/codex/stores/index.ts"),
            module("/src/session-mode/stores/useAgentCenterStore.ts"),
            module("/src/session-mode/stores/useLayoutStore.ts"),
            module("/src/session-mode/stores/settings/useThemeStore.ts"),
          ]);
          useThemeStore.getState().setTheme(theme);
          useLayoutStore.setState({
            view: "agent",
            isSidebarOpen: false,
            isRightPanelOpen: false,
          });
          const threads = useCodexStore.getState().threads;
          for (const thread of threads)
            useAgentCenterStore.getState().addAgentCard(
              {
                kind: "codex",
                id: thread.id,
                cwd: thread.cwd,
                preview: thread.name,
              },
              { activate: thread.id === "ux-0" },
            );
          useAgentCenterStore.setState({ cardsViewMode: "solo" });
          const answer = (threadId: string) => ({
            method: "item/completed",
            params: {
              threadId,
              turnId: "turn",
              item: {
                id: "answer",
                type: "agentMessage",
                phase: "final_answer",
                text: "草图已完成。系统记录已收进角落，聊天正文保持清晰。",
              },
            },
          });
          const closed = (threadId: string) => ({
            method: "thread/closed",
            params: { threadId },
          });
          useCodexStore.setState({
            events: {
              "ux-0": [
                answer("ux-0"),
                closed("ux-0"),
                closed("ux-0"),
                closed("ux-1"),
                {
                  method: "warning",
                  params: { threadId: "ux-0", message: "需要关注的警告" },
                },
              ],
              "ux-1": [answer("ux-1"), closed("ux-1")],
            },
            historyLoadedMap: { "ux-0": true, "ux-1": true },
            historyLoadingMap: {},
            threadStatusMap: {
              "ux-0": { type: "idle" },
              "ux-1": { type: "idle" },
            },
          });
          (window as any).switchRecordThread = () => {
            const card = useAgentCenterStore
              .getState()
              .cards.find((card: any) => card.id === "ux-1");
            useAgentCenterStore
              .getState()
              .addAgentCard(card, { activate: true });
            useCodexStore.setState({ currentThreadId: "ux-1" });
          };
          (window as any).restoreRecordSnapshot = () =>
            useCodexStore.setState({
              events: { "ux-1": [answer("ux-1"), closed("ux-1")] },
            });
          (window as any).clearRecordSnapshot = () =>
            useCodexStore.setState({ events: { "ux-1": [answer("ux-1")] } });
        }, theme);
        const transcript = page.locator('[data-codex-transcript-shell="ux-0"]');
        const entry = page.getByRole("button", { name: "系统记录，2条" });
        await expect(entry).toBeVisible();
        await expect(transcript).toContainText("需要关注的警告");
        await expect(transcript.locator("[data-codex-row]")).toHaveCount(2);
        await expect(transcript).not.toContainText("thread/closed");
        const box = (await entry.boundingBox())!;
        expect(box.height).toBeLessThanOrEqual(44);
        expect(box.width).toBeLessThan(180);
        const beforeActions = fixture.calls.length;
        await page.screenshot({
          path: info.outputPath(`system-records-closed-${width}-${theme}.png`),
        });
        await entry.click();
        const panel = page.getByRole("dialog", { name: "系统记录" });
        await expect(panel).toBeVisible();
        await expect(panel.getByText("会话运行实例已关闭")).toHaveCount(1);
        await expect(panel).toContainText("× 2");
        await expect(panel.locator("details")).not.toHaveAttribute("open");
        await panel.getByText("查看协议与会话 ID").click();
        await expect(
          panel.getByText("thread/closed", { exact: true }),
        ).toBeVisible();
        await expect(panel.getByText("ux-0", { exact: true })).toBeVisible();
        const panelBox = (await panel.boundingBox())!;
        expect(panelBox.x).toBeGreaterThanOrEqual(0);
        expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: info.outputPath(`system-records-open-${width}-${theme}.png`),
        });
        await page.keyboard.press("Escape");
        await expect(panel).toHaveCount(0);
        await expect(entry).toBeFocused();
        await entry.click();
        await transcript.getByText("需要关注的警告", { exact: true }).click();
        await expect(panel).toHaveCount(0);
        await entry.click();
        await panel.getByRole("button", { name: "关闭系统记录" }).click();
        await expect(panel).toHaveCount(0);
        await entry.click();
        await page.evaluate(() => (window as any).switchRecordThread());
        await expect(panel).toHaveCount(0);
        const other = page.getByRole("button", { name: "系统记录，1条" });
        await expect(other).toBeVisible();
        await other.click();
        await expect(panel.getByText("× 1")).toBeVisible();
        await page.evaluate(() => (window as any).clearRecordSnapshot());
        await expect(panel).toHaveCount(0);
        await expect(other).toHaveCount(0);
        await page.evaluate(() => (window as any).restoreRecordSnapshot());
        await expect(other).toBeVisible();
        await expect(panel).toHaveCount(0);
        expect(
          fixture.calls
            .slice(beforeActions)
            .filter((call) =>
              /\/turn\/(start|interrupt)|\/thread\/resume|approval.*respond|followups\/submit/.test(
                call.path,
              ),
            ),
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(errors).toEqual([]);
      });
    });
  }
