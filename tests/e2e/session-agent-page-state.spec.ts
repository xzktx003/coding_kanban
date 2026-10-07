import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("ACP text and image drafts survive secondary pages while hidden composer menus ignore keys", async ({
  page,
}) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 0);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 0);
  await page.evaluate(async () => {
    const entry = performance
      .getEntriesByType("resource")
      .findLast((e) =>
        e.name.includes("/src/session-mode/stores/useAcpStore.ts"),
      )?.name;
    const { useAcpStore } = await import(
      entry ?? "/src/session-mode/stores/useAcpStore.ts"
    );
    useAcpStore.setState({
      active: true,
      agentId: "fixture-acp",
      connectionId: "fixture-connection",
      sessionId: "fixture-session",
      entries: [],
      connecting: false,
      running: false,
      canInputImages: true,
    });
  });
  const input = page.locator(".session-mode textarea:visible").first();
  await input.fill("ACP跨页面未发送草稿");
  await input.evaluate((el) => {
    const dt = new DataTransfer();
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    dt.items.add(new File([bytes], "草稿图片.png", { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(
    page.getByRole("button", { name: "移除 草稿图片.png" }),
  ).toBeVisible();
  const changeView = async (view: string) =>
    page.evaluate(async (view) => {
      const { useLayoutStore } =
        await import("/src/session-mode/stores/useLayoutStore.ts");
      useLayoutStore.getState().setView(view);
    }, view);
  for (const view of ["plugins", "insights", "settings"]) {
    await changeView(view);
    await expect(input).toBeHidden();
    await changeView("agent");
    await expect(input).toHaveValue("ACP跨页面未发送草稿");
    await expect(
      page.getByRole("button", { name: "移除 草稿图片.png" }),
    ).toBeVisible();
  }
  expect(
    fixture.calls.filter((call) =>
      /\/(acp\/start|acp\/prompt)$/.test(call.path),
    ),
  ).toEqual([]);
  for (const kind of ["codex", "cc"]) {
    await page.evaluate(async (kind) => {
      const entry = performance
        .getEntriesByType("resource")
        .findLast((e) =>
          e.name.includes("/src/session-mode/stores/useAcpStore.ts"),
        )?.name;
      const { useAcpStore } = await import(
        entry ?? "/src/session-mode/stores/useAcpStore.ts"
      );
      const { useAgentSettingsStore } =
        await import("/src/session-mode/stores/useAgentSettingsStore.ts");
      const { useCCStore } =
        await import("/src/session-mode/stores/cc/index.ts");
      useAcpStore.setState({ active: false });
      useAgentSettingsStore.setState({ selectedAgent: kind });
      useCCStore.setState({
        activeSessionId: null,
        isConnected: true,
        isLoading: false,
        input: "",
      });
    }, kind);
    const editor = page
      .locator(
        kind === "codex"
          ? ".session-mode [contenteditable=true]:visible"
          : ".session-mode textarea:visible",
      )
      .first();
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await editor.press("Backspace");
    await editor.pressSequentially("/");
    const menu = page.locator("[data-composer-suggestions]");
    await expect(menu).toBeVisible();
    const before = fixture.calls.length;
    await changeView("plugins");
    await expect(menu).toHaveCount(0);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    expect(
      fixture.calls
        .slice(before)
        .filter((call) =>
          /\/(turn\/start|review|compact|cc\/send)$/.test(call.path),
        ),
    ).toEqual([]);
    await changeView("agent");
    if (kind === "codex") await expect(editor).toHaveText("/");
    else await expect(editor).toHaveValue("/");
    await editor.press("Escape");
  }
  expect(errors).toEqual([]);
});
