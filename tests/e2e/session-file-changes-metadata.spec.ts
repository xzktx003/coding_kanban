import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const width of [375, 1440]) {
  for (const theme of ["dark", "light"]) {
    test(`projected file changes retain native bounded layout (${width}, ${theme})`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await installSessionUxFixture(page, 1);
      await page.addInitScript(() => {
        class Stream {
          onopen: (() => void) | null = null;
          onmessage: ((event: unknown) => void) | null = null;
          onerror: (() => void) | null = null;
          closed = false;
          constructor() {
            setTimeout(() => {
              if (!this.closed) this.onopen?.();
            }, 30);
          }
          close() {
            this.closed = true;
          }
        }
        (window as any).EventSource = Stream;
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/?mode=session");
      await page
        .locator(".session-mode [contenteditable=true]")
        .first()
        .waitFor();
      await seedSessionUx(page, 1);
      await page.evaluate(async (theme) => {
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
        const { useAgentCenterStore } = await module(
          "/src/session-mode/stores/useAgentCenterStore.ts",
        );
        const { useSessionSplitStore } = await module(
          "/src/session-mode/stores/useSessionSplitStore.ts",
        );
        const { convertThreadHistoryToEvents } = await module(
          "/src/session-mode/utils/threadHistoryConverter.ts",
        );
        useThemeStore.getState().setTheme(theme);
        const thread = {
          id: "ux-0",
          cwd: "/fixture",
          status: { type: "idle" },
          turns: [
            {
              id: "metadata-turn",
              status: "completed",
              error: null,
              items: [
                {
                  id: "metadata-files",
                  type: "fileChange",
                  status: "completed",
                  transcriptMetadataOnly: true,
                  changes: Array.from({ length: 16 }, (_, i) => ({
                    path: `/other-project/${"long-directory/".repeat(8)}file-${i}.ts`,
                    kind: { type: "update", move_path: null },
                    diff: "",
                    transcriptMetadataOnly: true,
                  })),
                },
                {
                  id: "answer",
                  type: "agentMessage",
                  phase: "final_answer",
                  text: "文件修改已完成。",
                },
              ],
            },
          ],
        };
        useCodexStore.setState({
          threads: [thread],
          events: { "ux-0": convertThreadHistoryToEvents(thread) },
          historyLoadedMap: { "ux-0": true },
          historyLoadingMap: {},
          threadStatusMap: { "ux-0": { type: "idle" } },
        });
        useAgentCenterStore
          .getState()
          .addAgentCard(
            {
              id: "ux-0",
              kind: "codex",
              cwd: "/fixture",
              preview: "文件渲染验收",
            },
            { activate: true },
          );
        useSessionSplitStore
          .getState()
          .place(
            "codex:ux-0",
            useSessionSplitStore.getState().activeGroupId,
            "center",
          );
      }, theme);
      const card = page.locator(
        ".session-file-changes.codex-turn-diff-summary",
      );
      await expect(card).toBeVisible();
      const list = card.getByRole("region", { name: "已修改文件列表" });
      await expect(list.locator(".session-file-change-row")).toHaveCount(16);
      await expect(list).toHaveAttribute("data-scrollable", "true");
      await expect(
        card.locator("[data-transcript-details-unloaded]"),
      ).toHaveCount(1);
      await expect(
        card.getByRole("button", { name: "查看", exact: true }),
      ).toHaveCount(0);
      await expect(card.locator(".codex-turn-diff-stats")).toHaveCount(0);
      await expect(card.locator(".codex-turn-diff-icon")).toBeVisible();
      await card.scrollIntoViewIfNeeded();
      const geometry = await list.evaluate((el) => ({
        height: el.clientHeight,
        row: el.firstElementChild!.getBoundingClientRect().height,
        scroll: el.scrollHeight,
        width: el.clientWidth,
        full: el.scrollWidth,
      }));
      expect(
        Math.abs(geometry.height - geometry.row * (width < 768 ? 4 : 6)),
      ).toBeLessThanOrEqual(2);
      expect(geometry.scroll).toBeGreaterThan(geometry.height);
      expect(geometry.full).toBeLessThanOrEqual(geometry.width + 1);
      expect((await card.boundingBox())!.height).toBeLessThan(330);
      await card.locator(".codex-turn-diff-header").hover();
      await expect(
        card.locator("[data-transcript-details-unloaded]"),
      ).toBeVisible();
      await list.focus();
      await list.press("End");
      await expect(
        card.getByText("file-15.ts", { exact: true }),
      ).toBeInViewport();
      await expect(
        card.getByText("已到列表底部", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`projected-files-${width}-${theme}.png`),
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });
  }
}
