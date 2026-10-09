import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

test("late ACP permission failure preserves the current request feedback and retry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installSessionUxFixture(page, 0);
  let count = 0;
  let releaseOld!: () => void;
  await page.route(
    "**/api/session/api/acp/respond-permission",
    async (route) => {
      count++;
      if (count === 1) {
        await new Promise<void>((resolve) => {
          releaseOld = resolve;
        });
        await route.fulfill({ status: 503, json: { error: "旧请求离线" } });
      } else
        await route.fulfill({ status: 503, json: { error: "当前请求离线" } });
    },
  );
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  const select = async (sessionId: string, requestId: string, label: string) =>
    page.evaluate(
      async ({ sessionId, requestId, label }) => {
        const { useLayoutStore } =
          await import("/src/session-mode/stores/useLayoutStore.ts");
        const { useAcpStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) =>
              entry.name.includes("/src/session-mode/stores/useAcpStore.ts"),
            )?.name ?? "/src/session-mode/stores/useAcpStore.ts"
        );
        const { useAgentCenterStore } =
          await import("/src/session-mode/stores/useAgentCenterStore.ts");
        const {useWorkspaceStore}=await import(performance.getEntriesByType("resource").findLast(e=>e.name.includes("stores/useWorkspaceStore.ts"))?.name??"/src/session-mode/stores/useWorkspaceStore.ts");
        useWorkspaceStore.setState({cwd:"/fixture/permission-project"});
        useLayoutStore.setState({ view: "agent", isRightPanelOpen: false });
        useAgentCenterStore.setState({ cards: [], cardsViewMode: "solo" });
        useAcpStore.setState({
          active: true,
          agentId: "fixture",
          connectionId: "fixture-conn",
          sessionId,
          sessionCwd:"/fixture/permission-project",
          entries: [],
          running: false,
          connecting: false,
          permission: {
            requestId,
            title: label,
            options: [{ optionId: "allow", name: label }],
          },
        });
      },
      { sessionId, requestId, label },
    );
  await select("old-session", "old-request", "允许旧请求");
  await page.getByRole("button", { name: "允许旧请求" }).click();
  await expect.poll(() => count).toBe(1);
  await select("new-session", "new-request", "允许当前请求");
  await page.getByRole("button", { name: "允许当前请求" }).click();
  await expect(page.getByRole("alert")).toContainText("当前请求离线");
  releaseOld();
  await page.waitForTimeout(250);
  await expect(page.getByRole("alert")).toContainText("当前请求离线");
  await expect(page.getByRole("alert")).not.toContainText("旧请求离线");
  await expect(
    page.getByRole("button", { name: "允许当前请求" }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const { useAcpStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) =>
          entry.name.includes("/src/session-mode/stores/useAcpStore.ts"),
        )?.name ?? "/src/session-mode/stores/useAcpStore.ts"
    );
    const path = "/fixture/" + "verylongpathcomponent".repeat(10) + "/file.ts";
    useAcpStore.setState({
      entries: [{ id: "long-path", role: "agent", text: path }],
    });
  });
  const history = page.locator("[data-acp-history]");
  await expect(history).toBeVisible();
  const width = await history.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
  expect(errors).toEqual([]);
});
