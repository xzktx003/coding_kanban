import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("ACP interruption failure preserves identity and draft without restarting the service", async ({
  page,
}) => {
  const calls: Array<{ path: string; body: any }> = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installSessionUxFixture(page, 1);
  await page.route("**/api/session/api/acp/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST")
      calls.push({ path, body: route.request().postDataJSON() });
    if (path.endsWith("/agents"))
      await route.fulfill({
        json: [
          {
            id: "fixture-agent",
            name: "隔离 Agent",
            command: "fixture",
            args: [],
            available: true,
          },
        ],
      });
    else if (path.endsWith("/cancel"))
      await route.fulfill({ status: 503, json: { error: "隔离中断失败" } });
    else if (path.endsWith("/sessions")) await route.fulfill({ json: [] });
    else if (path.endsWith("/new-session"))
      await route.fulfill({ json: { sessionId: "unexpected-new-session" } });
    else await route.fulfill({ json: {} });
  });
  await page.goto("/?mode=session");
  await seedSessionUx(page, 1);
  await page.evaluate(async () => {
    const { useAcpStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) =>
          e.name.includes("/src/session-mode/stores/useAcpStore.ts"),
        )?.name ?? "/src/session-mode/stores/useAcpStore.ts"
    );
    useAcpStore.setState({
      active: true,
      agentId: "fixture-agent",
      connectionId: "fixture-connection",
      sessionId: "fixture-running",
      connecting: false,
      running: true,
      entries: [{ id: "context", role: "agent", text: "正在执行隔离任务" }],
    });
    (window as any).acpFixtureStore = useAcpStore;
  });
  const editor = page.getByRole("textbox", { name: "ACP 消息输入" });
  await editor.fill("不能丢失的草稿");
  await page
    .getByRole("button", { name: "新聊天", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    calls.filter((c) => /\/(cancel|new-session|stop)$/.test(c.path)),
  ).toEqual([]);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).toHaveValue("不能丢失的草稿");
  await page
    .getByRole("button", { name: "新聊天", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "中断并新建", exact: true }).click();
  await expect
    .poll(() => calls.filter((c) => c.path.endsWith("/cancel")).length)
    .toBe(1);
  await expect(editor).toHaveValue("不能丢失的草稿");
  await expect(
    page.getByRole("button", { name: "停止生成", exact: true }),
  ).toBeVisible();
  expect(calls.some((c) => /\/(new-session|stop)$/.test(c.path))).toBe(false);
  expect(
    await page.evaluate(() => {
      const s = (window as any).acpFixtureStore.getState();
      return { sessionId: s.sessionId, running: s.running };
    }),
  ).toEqual({ sessionId: "fixture-running", running: true });
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(editor).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".dev-runtime/session-opt/acp-mobile.png" });
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
