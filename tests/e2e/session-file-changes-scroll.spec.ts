import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
for (const width of [375, 1440])
  test(`file change list caps rows and preserves all operations (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    const fixture = await installSessionUxFixture(page, 1);
    // Keep the isolated event stream connected: a finite mocked SSE response
    // would otherwise reconnect and overwrite the synthetic history mid-test.
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
    await page.goto("/?mode=session");
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor();
    await seedSessionUx(page, 1);
    const limit = width < 768 ? 4 : 6;
    for (const count of [0, 1, limit, limit + 1, 39]) {
      await page.evaluate(async (count) => {
        const moduleUrl = (p: string) =>
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === p)?.name ?? p;
        const { useCodexStore } = await import(
          moduleUrl("/src/session-mode/components/codex/stores/index.ts")
        );
        const { useAgentCenterStore } = await import(
          moduleUrl("/src/session-mode/stores/useAgentCenterStore.ts")
        );
        const { useWorkspaceStore } = await import(
          moduleUrl("/src/session-mode/stores/useWorkspaceStore.ts")
        );
        const { useSessionSplitStore } = await import(
          moduleUrl("/src/session-mode/stores/useSessionSplitStore.ts")
        );
        const { convertThreadHistoryToEvents } = await import(
          moduleUrl("/src/session-mode/utils/threadHistoryConverter.ts")
        );
        const thread = {
          id: "ux-0",
          cwd: "/fixture",
          status: { type: "idle" },
          turns: [
            {
              id: "file-turn",
              status: "completed",
              error: null,
              items: [
                {
                  type: "userMessage",
                  id: "u",
                  content: [
                    {
                      type: "text",
                      text: "修改文件列表验收",
                      text_elements: [],
                    },
                  ],
                },
                {
                  type: "fileChange",
                  id: "changes",
                  status: "completed",
                  changes: Array.from({ length: count }, (_, i) => ({
                    path: `/fixture/${i === 0 ? "long-directory/".repeat(20) : ""}file-${i}.ts`,
                    kind: { type: "update", move_path: null },
                    diff: "@@ -1 +1 @@\n-before\n+after",
                  })),
                },
                {
                  type: "agentMessage",
                  id: "answer",
                  text: "文件列表验收回复",
                },
              ],
            },
          ],
        };
        useCodexStore.setState({
          currentThreadId: "ux-0",
          threads: [thread],
          events: { "ux-0": convertThreadHistoryToEvents(thread) },
          historyLoadedMap: { "ux-0": true },
          activeThreadIds: ["ux-0"],
          threadStatusMap: { "ux-0": { type: "idle" } },
          turnTimingMap: {},
        });
        useWorkspaceStore.setState({ cwd: "/fixture" });
        useAgentCenterStore.getState().addAgentCard({
          id: "ux-0",
          kind: "codex",
          cwd: "/fixture",
          preview: "文件列表验收",
        });
        useSessionSplitStore
          .getState()
          .place(
            "codex:ux-0",
            useSessionSplitStore.getState().activeGroupId,
            "center",
          );
      }, count);
      const card = page.locator(".session-file-changes");
      if (!count) {
        await expect(card).toHaveCount(0);
        continue;
      }
      await expect(card).toBeVisible();
      const list = card.getByRole("region", { name: "已修改文件列表" });
      await expect(list.locator(".session-file-change-row")).toHaveCount(count);
      await card.scrollIntoViewIfNeeded();
      const geometry = await list.evaluate((el) => ({
        height: el.clientHeight,
        row: el.firstElementChild!.getBoundingClientRect().height,
        scroll: el.scrollHeight,
        width: el.clientWidth,
        fullWidth: el.scrollWidth,
      }));
      expect(
        Math.abs(geometry.height - geometry.row * Math.min(count, limit)),
      ).toBeLessThanOrEqual(1);
      expect(geometry.fullWidth).toBeLessThanOrEqual(geometry.width + 1);
      expect(geometry.scroll > geometry.height + 1).toBe(count > limit);
      if (count === 39) {
        await list.focus();
        await list.press("End");
        await expect
          .poll(() =>
            list.evaluate(
              (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
            ),
          )
          .toBeLessThan(2);
        await expect(card.getByText("已到列表底部")).toBeVisible();
        const header = card.locator(".session-file-changes-header");
        const headerY = (await header.boundingBox())!.y;
        const outer = page
          .locator('.session-window-body [data-slot="scroll-area-viewport"]')
          .first();
        const before = await outer.evaluate((el) => el.scrollTop);
        await list.hover({ position: { x: 2, y: 20 } });
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(150);
        expect(await outer.evaluate((el) => el.scrollTop)).toBe(before);
        expect((await header.boundingBox())!.y).toBe(headerY);
        if (width < 768) {
          const client = await page.context().newCDPSession(page);
          await client.send("Emulation.setTouchEmulationEnabled", {
            enabled: true,
          });
          const b = (await list.boundingBox())!;
          const x = b.x + 10,
            y = b.y + 35;
          await client.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x, y }],
          });
          for (let i = 1; i <= 5; i++)
            await client.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x, y: y + i * 20 }],
            });
          await client.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await expect
            .poll(() =>
              list.evaluate(
                (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
              ),
            )
            .toBeGreaterThan(10);
          await client.detach();
        }
        await list.focus();
        await list.press("End");
        const last = list.locator(".session-file-change-row").last();
        await expect(
          last.getByRole("button", { name: "file-38.ts", exact: true }),
        ).toBeInViewport();
        const callsBefore = fixture.calls.length;
        await last.getByTitle("撤销对此文件的更改").click();
        expect(
          fixture.calls
            .slice(callsBefore)
            .filter((c) => c.path.includes("reverse")),
        ).toEqual([]);
        await card.getByRole("button", { name: "取消", exact: true }).click();
        await page.screenshot({
          path: `.dev-runtime/file-changes-scroll-${width}.png`,
        });
        await last
          .getByRole("button", { name: "file-38.ts", exact: true })
          .click();
        await expect
          .poll(() =>
            page.evaluate(async () => {
              const p = "/src/session-mode/stores/useLayoutStore.ts";
              const { useLayoutStore } = await import(
                performance
                  .getEntriesByType("resource")
                  .findLast((e) => new URL(e.name).pathname === p)?.name ?? p
              );
              return useLayoutStore.getState().activeRightPanelTab;
            }),
          )
          .toBe("diff");
      }
    }
  });
