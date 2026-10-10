import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const width of [390, 1440]) {
  test(`empty summaries keep adjacent messages compact and new chats use full access (${width})`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await installSessionUxFixture(page, 1);
    await page.addInitScript(() =>
      localStorage.setItem(
        "kanban.session.codex-config-storage",
        JSON.stringify({
          version: 0,
          state: {
            sandbox: "workspace-write",
            approvalPolicy: "on-request",
            reasoningEffort: "high",
          },
        }),
      ),
    );
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page
      .locator(".session-codex-composer [contenteditable=true]")
      .first()
      .waitFor();
    await seedSessionUx(page, 1);
    await expect(
      page.getByRole("heading", { name: "开始一个会话", exact: true }),
    ).toBeVisible();
    await page.evaluate(async () => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
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
      const { useConfigStore } = await module(
        "/src/session-mode/components/codex/stores/useConfigStore.ts",
      );
      if (
        useConfigStore.getState().sandbox !== "danger-full-access" ||
        useConfigStore.getState().approvalPolicy !== "never"
      )
        throw new Error("legacy defaults were not updated");
      useLayoutStore.setState({
        view: "agent",
        isSidebarOpen: false,
        isRightPanelOpen: false,
      });
      useAgentCenterStore.getState().addAgentCard(
        {
          kind: "codex",
          id: "ux-0",
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          preview: "间距回归",
        },
        { activate: true },
      );
      useAgentCenterStore.setState({ cardsViewMode: "solo" });
      const event = (id: string, item: object) => ({
        method: "item/completed",
        params: { threadId: "ux-0", turnId: "spacing", item: { id, ...item } },
      });
      useCodexStore.setState({
        currentThreadId: "ux-0",
        historyLoadedMap: { "ux-0": true },
        historyLoadingMap: {},
        events: {
          "ux-0": [
            event("first", { type: "agentMessage", text: "第一条可见消息" }),
            ...Array.from({ length: 40 }, (_, i) =>
              event(`hidden-${i}`, {
                type: "reasoning",
                summary: [" \n "],
                content: [],
              }),
            ),
            event("last", { type: "agentMessage", text: "第二条可见消息" }),
          ],
        },
      });
    });
    await expect(
      page.getByText("第一条可见消息", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("第二条可见消息", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-codex-row]")).toHaveCount(2);
    await expect
      .poll(async () =>
        page.locator("[data-codex-row]").evaluateAll((rows) => {
          const first = rows[0].getBoundingClientRect(),
            last = rows[1].getBoundingClientRect();
          return Math.abs(last.top - first.bottom);
        }),
      )
      .toBeLessThan(1);
    await page.evaluate(async () => {
      const path = "/src/session-mode/services/codexService.ts";
      const { codexService } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
      await codexService.threadStart({ shouldActivate: () => false });
    });
    expect(
      fixture.calls.find((call) => call.path.endsWith("/thread/start"))?.body,
    ).toMatchObject({ sandbox: "danger-full-access", approvalPolicy: "never" });
  });
}
