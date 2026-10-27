import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("running changes and queued messages share the desktop rail; mobile keeps its bounded shelf", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixture = await installSessionUxFixture(page);
  await page.route("**/api/session/followups?**", (route) =>
    route.fulfill({
      json: {
        revision: 1,
        paused: null,
        items: [
          {
            id: "rail-queue",
            text: "保留排队消息",
            images: [],
            status: "queued",
          },
        ],
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-native-composer").waitFor();
  await seedSessionUx(page);
  await page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/stores/useCodexStore.ts";
    const url =
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { useCodexStore } = await import(url);
    useCodexStore.setState({
      turnTimingMap: {
        "ux-0": {
          turnId: "rail-turn",
          status: "inProgress",
          startedAtMs: Date.now(),
          durationMs: null,
        },
      },
      events: {
        "ux-0": [
          {
            method: "turn/diff/updated",
            params: {
              threadId: "ux-0",
              turnId: "rail-turn",
              diff: "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n",
            },
          },
        ],
      },
    });
  });
  const rail = page.locator(".session-native-composer > [data-composer-rail]");
  await expect(rail.locator("[data-composer-rail-item]")).toHaveCount(2);
  await expect(
    rail.getByRole("button", { name: /1 个文件已更改/ }),
  ).toBeVisible();
  await expect(rail.getByText("保留排队消息")).toBeVisible();
  const desktop = await rail.evaluate((el) => ({
    position: getComputedStyle(el).position,
    maxHeight: getComputedStyle(el).maxHeight,
    bottom: el.getBoundingClientRect().bottom,
  }));
  const surface = await page
    .locator(".session-native-composer .session-composer-surface")
    .boundingBox();
  expect(desktop.position).toBe("relative");
  expect(desktop.maxHeight).toBe("none");
  const overlap = await rail.evaluate(
    (el) => -parseFloat(getComputedStyle(el).marginBottom),
  );
  expect(Math.abs(desktop.bottom - surface!.y - overlap)).toBeLessThan(1);
  await page
    .locator(".session-native-composer")
    .screenshot({ path: test.info().outputPath("rail-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => rail.evaluate((el) => getComputedStyle(el).position))
    .toBe("absolute");
  expect(
    await rail.evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(160);
  await page.screenshot({ path: test.info().outputPath("rail-mobile.png") });
  expect(
    fixture.calls.filter((c) =>
      /\/(turn\/(start|steer|interrupt)|followups\/(submit|change|stop))$/.test(
        c.path,
      ),
    ),
  ).toEqual([]);
});

test("same rows match the shipped 26.51007 attached rail geometry", async ({
  page,
  context,
}) => {
  const reference = process.env.CODEX_GOAL_REFERENCE_URL;
  test.skip(
    !reference,
    "Set CODEX_GOAL_REFERENCE_URL to the read-only official component fixture",
  );
  test.setTimeout(90_000);
  await installSessionUxFixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-native-composer").waitFor();
  const native = await context.newPage();
  await native.setViewportSize({ width: 1440, height: 1000 });
  await native.goto(reference!);
  await native.waitForFunction(() => (window as any).nativeLoaded);
  await native.evaluate(async () => {
    const main = await import("/assets/app-initial-fee819fe4f22.js");
    main.vf();
    const { R, root, wrap } = (window as any).nativeGoalCore;
    (window as any).renderRailComparison = (width: number) => {
      const host = document.getElementById("root")!;
      Object.assign(host.style, {
        width: `${width}px`,
        maxWidth: "none",
        padding: "0",
      });
      root.render(
        wrap(
          R.createElement(
            R.Fragment,
            null,
            R.createElement(
              main._f,
              null,
              ...["changes", "queue"].map((key) =>
                R.createElement(
                  main._f.Item,
                  { key },
                  R.createElement("div", { style: { height: "36px" } }, key),
                ),
              ),
            ),
            R.createElement("div", {
              id: "comparison-surface",
              style: { height: "100px", position: "relative" },
            }),
          ),
        ),
      );
    };
  });
  await page.evaluate(async () => {
    const dependency = (window as any).__sessionFixtureDependency;
    const reactModule = await import(dependency("react.js"));
    const clientModule = await import(dependency("react-dom_client.js"));
    const R = reactModule.default ?? reactModule;
    const client = clientModule.default ?? clientModule;
    const path = "/src/session-mode/components/codex/composer/ComposerRail.tsx";
    const url =
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { ComposerRail, ComposerRailItem } = await import(url);
    const host = document.createElement("div");
    host.id = "rail-comparison";
    host.className = "session-mode";
    Object.assign(host.style, {
      position: "fixed",
      top: "0",
      left: "0",
      zIndex: "99999",
    });
    document.body.append(host);
    const root = client.createRoot(host);
    (window as any).renderRailComparison = (width: number) => {
      host.style.width = `${width}px`;
      root.render(
        R.createElement(
          R.Fragment,
          null,
          R.createElement(
            ComposerRail,
            null,
            ...["changes", "queue"].map((key) =>
              R.createElement(
                ComposerRailItem,
                { key, visible: true },
                R.createElement("div", { style: { height: "36px" } }, key),
              ),
            ),
          ),
          R.createElement("div", {
            id: "comparison-surface",
            style: { height: "100px", position: "relative" },
          }),
        ),
      );
    };
  });
  for (const width of [600, 320]) {
    for (const target of [native, page])
      await target.evaluate(
        (width) => (window as any).renderRailComparison(width),
        width,
      );
    await expect(native.locator("[data-composer-rail-item]")).toHaveCount(2);
    await expect(
      page.locator("#rail-comparison [data-composer-rail-item]"),
    ).toHaveCount(2);
    const measure = (root: string) => {
      const host = document.querySelector(root)!;
      const rail = host.querySelector("[data-composer-rail]")!;
      const rect = rail.getBoundingClientRect();
      const surface = host
        .querySelector("#comparison-surface")!
        .getBoundingClientRect();
      const style = getComputedStyle(rail);
      return {
        width: rect.width,
        height: rect.height,
        overlap: rect.bottom - surface.top,
        radius: style.borderTopLeftRadius,
        position: style.position,
      };
    };
    const actual = await page.evaluate(measure, "#rail-comparison");
    const expected = await native.evaluate(measure, "#root");
    await test
      .info()
      .attach(`rail-geometry-${width}`, {
        body: JSON.stringify({ actual, expected }),
        contentType: "application/json",
      });
    await native
      .locator("#root")
      .screenshot({ path: test.info().outputPath(`native-${width}.png`) });
    await page
      .locator("#rail-comparison")
      .screenshot({ path: test.info().outputPath(`local-${width}.png`) });
    expect(actual).toEqual(expected);
  }
  expect(await native.evaluate(() => (window as any).nativeErrors)).toEqual([]);
  await native.close();
});
