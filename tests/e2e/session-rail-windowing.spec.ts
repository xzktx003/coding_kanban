import { expect, test } from "@playwright/test";

test("a thousand-prompt rail stays bounded and preserves wheel, sequential keyboard navigation and boundary exits", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // Receive a native HTTP document so LAN imports retain the document's private
  // address space. Suppress only the app bootstrap script; fetch(main.tsx) below
  // still resolves the exact optimized React instance used by this Vite server.
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, (route) =>
    route.request().resourceType() === "script"
      ? route.fulfill({ contentType: "text/javascript", body: "" })
      : route.continue(),
  );
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.goto("/");
  await page.evaluate(async () => {
    const refresh = (await import("/@react-refresh")).default;
    refresh.injectIntoGlobalHook(window);
    (window as any).$RefreshReg$ = () => {};
    (window as any).$RefreshSig$ = () => (type: unknown) => type;
    (window as any).__vite_plugin_react_preamble_installed__ = true;
    const main = await (await fetch("/src/main.tsx")).text();
    const thread = await (
      await fetch("/src/session-mode/components/codex/thread/CodexThread.tsx")
    ).text();
    const dependency = (source: string, name: string) => {
      const path = [...source.matchAll(/from "([^"]+)"/g)]
        .map((match) => match[1]!)
        .find((path) => path.includes(`/deps/${name}.js?`));
      if (!path) throw new Error(`Missing Vite dependency: ${name}`);
      return import(path).then((module) => module.default ?? module);
    };
    const [React, { createRoot }, { flushSync }, { ThreadUserNavigationRail }] =
      await Promise.all([
        dependency(main, "react"),
        dependency(main, "react-dom_client"),
        dependency(thread, "react-dom"),
        import("/src/session-mode/features/thread-workflows/ThreadWorkflowToolbar.tsx"),
      ]);
    const rows = Array.from({ length: 1000 }, (_, index) => ({
      rowId: `row-${index}`,
      itemId: `item-${index}`,
      turnId: `turn-${index}`,
      role: "user",
      text: `prompt ${index}`,
      completed: true,
    }));
    const root = createRoot(document.querySelector("#root")!);
    const renderRows = (currentRows: typeof rows) =>
      flushSync(() =>
        root.render(
          React.createElement(
            "div",
            {
              className: "session-mode",
              style: { height: 600, position: "relative" },
            },
            React.createElement(
              "button",
              { "data-before-rail": true },
              "before",
            ),
            React.createElement(ThreadUserNavigationRail, {
              rows: currentRows,
              onNavigate: (row: any) => {
                (window as any).__railLastItem = row.itemId;
                ((window as any).__railNavigations ??= []).push(row.itemId);
              },
            }),
            React.createElement("button", { "data-after-rail": true }, "after"),
          ),
        ),
      );
    (window as any).__railReplacePrefix = (drop: number) =>
      renderRows(rows.slice(drop));
    renderRows(rows);
  });
  const rail = page.locator("[data-floating-navigation-rail-list]");
  const markers = rail.locator("[data-thread-user-message-navigation-item-id]");
  const marker = (index: number) =>
    rail.locator(
      `[data-thread-user-message-navigation-item-id="item-${index}"]`,
    );
  const bounded = async () =>
    expect(await markers.count()).toBeLessThanOrEqual(100);
  await bounded();
  await marker(0).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("[data-before-rail]")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(marker(0)).toBeFocused();
  for (let index = 1; index <= 100; index++) {
    await page.keyboard.press("Tab");
    await expect(marker(index)).toBeFocused();
  }
  await bounded();
  // Return to the top, then use a real wheel gesture over the rail to reach
  // the middle; the native scroll range still represents all 1000 prompts.
  await rail.evaluate((element) => {
    element.scrollTop = 0;
  });
  await rail.hover();
  await page.mouse.wheel(0, 5000);
  await expect
    .poll(() => rail.evaluate((element) => element.scrollTop))
    .toBeGreaterThanOrEqual(4900);
  await expect(marker(500)).toBeAttached();
  await marker(500).click();

  await expect
    .poll(() => page.evaluate(() => (window as any).__railLastItem))
    .toBe("item-500");
  await bounded();
  await marker(500).evaluate((element) => {
    (window as any).__railFocusedNode = element;
  });
  await page.evaluate(() => (window as any).__railReplacePrefix(200));
  await expect(marker(500)).toBeFocused();
  expect(
    await marker(500).evaluate(
      (element) => element === (window as any).__railFocusedNode,
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(marker(501)).toBeFocused();
  await page.evaluate(() => (window as any).__railReplacePrefix(0));
  await expect(marker(501)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(marker(500)).toBeFocused();

  const box = async (index: number) => {
    const value = await marker(index).boundingBox();
    if (!value) throw new Error(`Missing marker ${index}`);
    return { x: value.x + 18, y: value.y + 5 };
  };
  await rail.evaluate((element) => {
    element.scrollTop = 4800;
  });
  await expect
    .poll(() => rail.evaluate((element) => element.scrollTop))
    .toBe(4800);
  const start = await box(500);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const index of [501, 502]) {
    const target = await box(index);
    await page.mouse.move(target.x, target.y);
  }
  await page.mouse.up();

  expect(await page.evaluate(() => (window as any).__railNavigations)).toEqual([
    "item-500",
    "item-501",
    "item-502",
  ]);
  await marker(502).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");

  expect(await page.evaluate(() => (window as any).__railNavigations)).toEqual([
    "item-500",
    "item-501",
    "item-502",
    "item-502",
    "item-502",
  ]);
  await rail.hover();
  await page.mouse.wheel(0, 100_000);
  await expect
    .poll(() =>
      rail.evaluate((element) => element.scrollTop + element.clientHeight),
    )
    .toBeGreaterThanOrEqual(9990);
  await marker(999).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__railLastItem))
    .toBe("item-999");
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-after-rail]")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(marker(999)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(marker(998)).toBeFocused();
  await bounded();
});
