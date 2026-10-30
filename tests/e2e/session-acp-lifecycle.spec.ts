import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { setupAcpNewConnectionFailure } from "./session-acp-running-fixture";

test("ACP new connection failure preserves the running owner and draft", async ({
  page,
}, testInfo) => {
  const { calls, errors } = await setupAcpNewConnectionFailure(page);
  const editor = page.getByRole("textbox", { name: "ACP 消息输入" });
  await editor.fill("不能丢失的草稿");
  await page.getByRole("button", { name: "新聊天", exact: true }).first().click();
  await expect.poll(() => calls.filter((call) => call.path.endsWith("/start")).length).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).acpFixtureStore.getState().sessionTransition)).toBeNull();
  await expect(page.getByRole("dialog", { name: "中断当前任务并新建会话？" })).toHaveCount(0);
  await expect(editor).toHaveValue("不能丢失的草稿");
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible();
  expect(calls.filter((call) => /\/(cancel|new-session|stop)$/.test(call.path))).toEqual([]);
  expect(await page.evaluate(() => {
    const s = (window as any).acpFixtureStore.getState();
    return { connectionId: s.connectionId, sessionId: s.sessionId, historySessionId: s.historySessionId, running: s.running };
  })).toEqual({ connectionId: "fixture-connection", sessionId: "fixture-running", historySessionId: "acph_fixture_owner_a", running: true });
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(editor).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("acp-original-owner-mobile.png") });
  expect(errors).toEqual([]);
});

test("ACP native directory stays explicit when another project is browsed", async ({
  page,
}) => {
  const fixture = await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session");
  await seedSessionUx(page, 1);
  await page.evaluate(async () => {
    const module = async (suffix: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => e.name.includes(suffix))?.name ??
          `/src/session-mode/${suffix}`
      );
    const { useAcpStore } = await module("stores/useAcpStore.ts");
    const { useWorkspaceStore } = await module("stores/useWorkspaceStore.ts");
    useAcpStore.setState({
      active: true,
      agentId: "fixture",
      connectionId: "native-connection",
      sessionId: "native-session",
      sessionCwd: "/fixture/native-project",
      connecting: false,
      running: false,
      entries: [],
    });
    useWorkspaceStore.setState({ cwd: "/fixture/browsed-project" });
  });
  const editor = page.getByRole("textbox", { name: "ACP 消息输入" });
  await editor.fill("保留原目录草稿");
  await expect(page.locator(".session-input-target")).toHaveAttribute(
    "title",
    /native-project/,
  );
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeDisabled();
  await editor.press("Enter");
  expect(fixture.calls.filter((c) => /acp\/prompt$/.test(c.path))).toEqual([]);
  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => e.name.includes("stores/useWorkspaceStore.ts"))
        ?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts"
    );
    useWorkspaceStore.setState({ cwd: "/fixture/native-project" });
  });
  await expect(editor).toHaveValue("保留原目录草稿");
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeEnabled();
});
