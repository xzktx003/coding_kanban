import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const text = "保持中文 **强调** 与代码 `example.name` 的排版一致。";
for (const width of [700, 390]) {
  test.describe(`Codex typography ${width}`, () => {
    test.use({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const theme of ["light", "dark"]) {
      test(`live text keeps the final message font (${theme})`, async ({
        page,
      }) => {
        const fixture = await installSessionUxFixture(page, 1);
        await page.goto("/?mode=session");
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .waitFor();
        await seedSessionUx(page, 1);
        await page.evaluate(
          async ({ theme, text }) => {
            const module = (path: string) =>
              import(
                performance
                  .getEntriesByType("resource")
                  .findLast((entry) => new URL(entry.name).pathname === path)
                  ?.name ?? path
              );
            const [
              { useCodexStore },
              { useThemeStore },
              { useLayoutStore },
              { useAgentCenterStore },
            ] = await Promise.all([
              module("/src/session-mode/components/codex/stores/index.ts"),
              module("/src/session-mode/stores/settings/useThemeStore.ts"),
              module("/src/session-mode/stores/useLayoutStore.ts"),
              module("/src/session-mode/stores/useAgentCenterStore.ts"),
            ]);
            useThemeStore.getState().setTheme(theme);
            useLayoutStore.setState({
              view: "agent",
              isSidebarOpen: false,
              isRightPanelOpen: false,
            });
            const thread = useCodexStore
              .getState()
              .threads.find((thread: any) => thread.id === "ux-0");
            useAgentCenterStore
              .getState()
              .addAgentCard({
                kind: "codex",
                id: "ux-0",
                cwd: thread.cwd,
                preview: thread.preview,
              });
          },
          { theme, text },
        );
        await expect(page.locator(".thread-surface")).toBeVisible();
        await page.evaluate(async (text) => {
          const path = "/src/session-mode/components/codex/stores/index.ts";
          const { useCodexStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
          useCodexStore
            .getState()
            .setStreamingAgentDeltas("ux-0", [
              {
                method: "item/agentMessage/delta",
                params: {
                  threadId: "ux-0",
                  turnId: "typography-turn",
                  itemId: "typography-message",
                  delta: text,
                },
              },
            ]);
        }, text);
        const live = page.locator(
          "[data-codex-live-message] [data-codex-streaming-text]",
        );
        await expect(live).toBeVisible();
        const before = await live.evaluate((node) => {
          const style = getComputedStyle(node);
          const owner = getComputedStyle(node.closest(".codex-presentation")!);
          return {
            size: style.fontSize,
            line: style.lineHeight,
            family: style.fontFamily,
            ownerSize: owner.fontSize,
          };
        });
        expect(before.size).toBe(before.ownerSize);
        await page.evaluate(async (text) => {
          const path = "/src/session-mode/components/codex/stores/index.ts";
          const { useCodexStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
          useCodexStore
            .getState()
            .addEvent("ux-0", {
              method: "item/completed",
              params: {
                threadId: "ux-0",
                turnId: "typography-turn",
                item: {
                  type: "agentMessage",
                  id: "typography-message",
                  text,
                  phase: "final_answer",
                  memoryCitation: null,
                },
              },
            });
        }, text);
        const final = page.locator(
          '.codex-assistant[data-owner-turn="typography-turn"] .codex-paragraph',
        );
        await expect(final).toBeVisible();
        const after = await final.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            size: style.fontSize,
            line: style.lineHeight,
            family: style.fontFamily,
          };
        });
        expect(after).toEqual({
          size: before.size,
          line: before.line,
          family: before.family,
        });
        await expect(final).toHaveAttribute("data-markdown-han-text", "true");
        await expect(final.locator("code")).toHaveAttribute("dir", "ltr");
        expect(
          fixture.calls.filter(({ path }) =>
            /\/(?:turn\/start|turn\/steer|turn\/interrupt|thread\/resume|thread\/fork|review\/start)$/.test(
              path,
            ),
          ),
        ).toEqual([]);
        await page.screenshot({
          path: test.info().outputPath(`typography-${width}-${theme}.png`),
        });
      });
    }
  });
}
