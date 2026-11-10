import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 375, height: 667 },
]) {
  test(
    viewport.width <= 480
      ? "mobile terminal return restores the unsent Session draft"
      : `mode header releases hidden Session dialog and restores draft at ${viewport.width}px`,
    async ({ page }) => {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(10_000));
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.routeWebSocket("**/*", (socket) => {
      socket.onMessage(() => {});
    });
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes("/events"))
        return route.fulfill({
          contentType: "text/event-stream",
          body: ": fixture\n\n",
        });
      let json: unknown = {};
      if (path.endsWith("/health"))
        json = { status: "ok", instance: "isolation-test" };
      else if (path === "/api/agent-sessions")
        json = { items: [], activeAgentSessionId: null, updatedAt: "fixture" };
      else if (
        path.endsWith("/codex/plugin/list") ||
        path.endsWith("/codex/plugin/installed")
      )
        json = { marketplaces: [] };
      else if (path.endsWith("/codex/skills/list")) json = { data: [] };
      else if (path.endsWith("/codex/thread/list"))
        json = { data: [], nextCursor: null };
      else if (path.includes("/bots")) json = [];
      else if (
        path.endsWith("/sessions") ||
        path.includes("/plugins/") ||
        path.includes("/skills/")
      )
        json = [];
      return route.fulfill({ json });
    });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page.locator(".session-workbench").waitFor();
    if (viewport.width <= 480) {
      const composer = page.locator(
        ".session-composer-form [contenteditable='true']",
      );
      await expect(composer).toBeVisible();
      await composer.fill("移动端保留的未发送草稿");
      await page.getByRole("button", { name: "终端", exact: true }).click();
      await expect(page.locator(".mobile-workbench-page")).toBeVisible();
      await page.getByRole("link", { name: "会话", exact: true }).click();
      const restoredComposer = page.locator(
        ".session-composer-form [contenteditable='true']",
      );
      await expect(restoredComposer).toHaveText("移动端保留的未发送草稿");
      expect(errors).toEqual([]);
      return;
    }
    await page.evaluate(async () => {
      const loadedDependency = (name: string) => performance.getEntriesByType("resource").findLast(entry => new URL(entry.name).pathname.endsWith(`/deps/${name}.js`))?.name ?? `/node_modules/.vite/deps/${name}.js`;
      const reactModule = await import(loadedDependency("react"));
      const React = reactModule.default ?? reactModule;
      const domModule =
        await import(loadedDependency("react-dom_client"));
      const { createRoot } = domModule.default ?? domModule;
      const { Dialog, DialogContent, DialogTitle, DialogDescription } =
        await import("/src/session-mode/components/ui/dialog.tsx");
      const host = document.createElement("div");
      document.querySelector(".session-mode")!.append(host);
      function Fixture() {
        const [draft, setDraft] = React.useState("未保存草稿");
        return React.createElement(
          Dialog,
          { open: true },
          React.createElement(
            DialogContent,
            {},
            React.createElement(DialogTitle, {}, "模式隔离测试"),
            React.createElement(DialogDescription, {}, "隔离测试数据"),
            React.createElement("input", {
              "aria-label": "隔离草稿",
              value: draft,
              onChange: (e: any) => setDraft(e.target.value),
            }),
          ),
        );
      }
      createRoot(host).render(React.createElement(Fixture));
    });
    await expect(page.getByRole("textbox", { name: "隔离草稿" })).toBeVisible();
    await page.getByRole("textbox", { name: "隔离草稿" }).fill("保留中文草稿");
    // Exercise the real header handler as an external mode change. A modal
    // intentionally blocks pointer clicks on the header until it is dismissed.
    await page.evaluate(() => {
      history.replaceState(null, "", "/?mode=terminal");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.locator(".session-mode")).toHaveAttribute("hidden", "");
    await expect
      .poll(() => page.evaluate(() => document.body.style.pointerEvents))
      .not.toBe("none");
    const returnToSession = page.getByRole("button", {
      name: "会话",
      exact: true,
    });
    await returnToSession.focus();
    await page.keyboard.press("Escape");
    await expect(returnToSession).toBeFocused();
    await returnToSession.click();
    await expect(page.getByRole("textbox", { name: "隔离草稿" })).toHaveValue(
      "保留中文草稿",
    );
    await expect(page.getByRole("textbox", { name: "隔离草稿" })).toBeFocused();
    expect(errors).toEqual([]);
    },
  );
}
