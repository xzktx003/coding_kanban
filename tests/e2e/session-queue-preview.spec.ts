import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
const out = resolve(".dev-runtime/session-queue-preview-20261027/browser");
const rich =
  "# Check **bold** and `code`\n\nKeep all of this prompt for reading and copying.";
import { theme, diagnose, local, native, startCompositor } from "./session-queue-fixture";
for (const dark of [false, true])
  test(`${dark ? "dark" : "light"} queued prompt preview matches native reading and keyboard behavior`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const reference = process.env.CODEX_GOAL_REFERENCE_URL;
    test.skip(!reference, "Official reference required");
    await mkdir(out, { recursive: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const fixture = await local(page);
    const referencePage = await context.newPage();
    referencePage.on("pageerror", (e) => errors.push(e.message));
    await native(referencePage, reference!);
    const records: Record<string, unknown> = {};
    const screenshots: Record<string, Buffer> = {};
    for (const [kind, target] of [
      ["native", referencePage],
      ["local", page],
    ] as const) {
      await theme(target, dark);
      await target.evaluate((text) => (window as any).renderQueue(text), rich);
      const trigger = target.getByRole("group", {
        name: /^(Preview queued message|预览排队消息) 1/,
      });
      await expect(trigger.locator("strong")).toHaveText("bold");
      await target.evaluate(() => {
        (window as any).previewDragCount = 0;
        document.addEventListener(
          "dragstart",
          () => {
            (window as any).previewDragCount++;
          },
          { once: true },
        );
      });
      const selectBox = await trigger.boundingBox();
      await target.mouse.move(
        selectBox!.x + 2,
        selectBox!.y + selectBox!.height / 2,
      );
      await target.mouse.down();
      await target.mouse.move(
        selectBox!.x + 90,
        selectBox!.y + selectBox!.height / 2,
        { steps: 10 },
      );
      await target.mouse.up();
      const selected = await target.evaluate(() => ({
        text: window.getSelection()?.toString(),
        drags: (window as any).previewDragCount,
      }));
      console.log("SELECTION", kind, JSON.stringify(selected));
      expect(selected.drags).toBe(0);
      expect(selected.text?.length).toBeGreaterThan(0);
      await target.evaluate(() => window.getSelection()?.removeAllRanges());
      await expect(trigger.locator("h1")).toHaveCount(0);
      await trigger.focus();
      const dialog = target.getByRole("dialog", {
        name: /^(Queued message preview|排队消息预览)$/,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveText(rich);
      await expect(dialog).not.toHaveAttribute("aria-modal", "true");
      await expect(trigger).toBeFocused();
      const style = await dialog.evaluate((e) => {
        const s = getComputedStyle(e);
        const c = e.querySelector('[tabindex="0"]')!;
        const p = getComputedStyle(c);
        return {
          width: e.getBoundingClientRect().width,
          top: e.getBoundingClientRect().top,
          left: e.getBoundingClientRect().left,
          height: e.getBoundingClientRect().height,
          background: s.backgroundColor,
          color: s.color,
          radius: s.borderRadius,
          cornerShape: s.getPropertyValue("corner-shape"),
          font: s.fontSize,
          lineHeight: s.lineHeight,
          bodySpace: p.whiteSpace,
          bodyOverflow: p.overflowY,
        };
      });
      const row = await target
        .locator("[data-composer-rail-item]")
        .evaluate((e) => {
          const s = getComputedStyle(e),
            r = e.getBoundingClientRect();
          return {
            background: s.backgroundColor,
            width: r.width,
            top: r.top,
            left: r.left,
            height: r.height,
          };
        });
      const textStyle = await trigger.evaluate((e) => {
        const t = e.querySelector("strong")!;
        const s = getComputedStyle(t);
        return {
          color: s.color,
          fontSize: s.fontSize,
          lineHeight: s.lineHeight,
          trigger: {
            top: e.getBoundingClientRect().top,
            left: e.getBoundingClientRect().left,
            width: e.getBoundingClientRect().width,
            height: e.getBoundingClientRect().height,
          },
        };
      });
      records[kind] = { popup: style, row, text: textStyle };
      console.log("ROW", kind, JSON.stringify({ row, textStyle }));
      console.log(kind, JSON.stringify(style));
      await target.keyboard.press("Tab");
      await expect(dialog.locator('[tabindex="0"]')).toBeFocused();
      await target.keyboard.press("Shift+Tab");
      await expect(trigger).toBeFocused();
      await target.keyboard.press("Tab");
      await expect(dialog.locator('[tabindex="0"]')).toBeFocused();
      await target.keyboard.press("Tab");
      await expect(
        target.getByRole("button", { name: /^(立即引导|引导)$/ }),
      ).toBeFocused();
      await expect(dialog).toHaveCount(0);
      await trigger.focus();
      await expect(dialog).toBeVisible();
      await target.keyboard.press("Tab");
      await expect(dialog.locator('[tabindex="0"]')).toBeFocused();
      await target.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(dialog).toBeVisible();
      await trigger.click();
      await expect(dialog).toBeVisible();
      await target.keyboard.press("Escape");
      await target.mouse.click(900, 100);
      await trigger.hover();
      await target.waitForTimeout(300);
      await expect(dialog).toHaveCount(0);
      await expect(dialog).toBeVisible({ timeout: 1500 });
      screenshots[kind] = await target.screenshot({
        path: resolve(out, `${dark ? "dark" : "light"}-${kind}.png`),
      });
      await writeFile(
        resolve(out, `${dark ? "dark" : "light"}-${kind}-diagnostics.json`),
        JSON.stringify(await diagnose(target), null, 2),
      );
      await target.keyboard.press("Escape");
      await target.evaluate(() => (window as any).renderQueue("Short"));
      await expect(
        target.getByRole("group", {
          name: /^(Preview queued message 1: Short|预览排队消息 1：Short)$/,
        }),
      ).toBeVisible();
      await expect(trigger).toHaveCount(1);
      await expect(trigger).toHaveText("Short");
      await target.waitForTimeout(250);
      await target.mouse.click(900, 100);
      await trigger.focus();
      await trigger.click();
      await target.waitForTimeout(800);
      await expect(dialog).toHaveCount(0);
      await target.evaluate(() =>
        (window as any).renderQueue("```ts\nconst x = 1;\n```"),
      );
      await expect(trigger.filter({ hasText: "const x = 1;" })).toHaveCount(1);
      await expect(trigger).toHaveCount(1);
      await expect(trigger).toContainText("const x = 1;");
      await trigger.click();
      await expect(dialog).toHaveText("```ts\nconst x = 1;\n```");
      await target.keyboard.press("Escape");
      await target.evaluate(() =>
        (window as any).renderQueue(
          "[Open reference](https://example.test/reference)\n\nRead all of this prompt.",
        ),
      );
      const link = trigger.getByRole("link").first();
      await expect(link).toBeVisible();
      await link.evaluate((element) => {
        (window as any).queueLinkClicks = 0;
        element.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            (window as any).queueLinkClicks++;
          },
          true,
        );
      });
      await link.focus();
      await target.keyboard.press("Enter");
      await expect
        .poll(() => target.evaluate(() => (window as any).queueLinkClicks))
        .toBe(1);
      await target.keyboard.press("Escape");
    }
    expect(records.local).toEqual(records.native);
    expect(
      screenshots.local.equals(screenshots.native),
      "Identical full PNG under the actual Session host and native tokens",
    ).toBe(true);
    await page.evaluate((text) => (window as any).renderQueue(text), rich);
    const trigger = page.getByRole("group", { name: /^预览排队消息 1/ });
    await trigger.click();
    await expect(
      page.getByRole("dialog", { name: "排队消息预览" }),
    ).toBeVisible();
    await page.evaluate(
      (text) => (window as any).renderQueue(text, false),
      rich,
    );
    await expect(
      page.getByRole("dialog", { name: "排队消息预览" }),
    ).toHaveCount(0);
    expect(
      await referencePage.evaluate(() => (window as any).queueActions),
    ).toEqual([]);
    expect(
      fixture.calls.filter((c) =>
        /\/(turn\/(start|steer|interrupt)|followups\/(submit|change|stop))$/.test(
          c.path,
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    await writeFile(
      resolve(out, `${dark ? "dark" : "light"}.json`),
      JSON.stringify({ records, errors }, null, 2),
    );
    await referencePage.close();
  });

test("a nested preview link keeps native Enter activation", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const reference = process.env.CODEX_GOAL_REFERENCE_URL;
  test.skip(!reference, "Official reference required");
  const fixture = await local(page);
  const referencePage = await context.newPage();
  await native(referencePage, reference!);
  for (const [kind, target] of [
    ["native", referencePage],
    ["local", page],
  ] as const) {
    await target.route("https://t0.gstatic.com/**", (route) => route.abort());
    await target.evaluate(() =>
      (window as any).renderQueue(
        "[Open reference](https://example.test/reference)\n\nRead all of this prompt.",
      ),
    );
    const link = target
      .getByRole("group", { name: /^(Preview queued message|预览排队消息) 1/ })
      .getByRole("link")
      .first();
    await expect(link).toBeVisible();
    await link.evaluate((element) => {
      (window as any).queueLinkClicks = 0;
      element.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          (window as any).queueLinkClicks++;
        },
        true,
      );
    });
    await link.focus();
    await target.keyboard.press("Enter");
    console.log(
      "KEYBOARD_LINK",
      kind,
      await target.evaluate(() => (window as any).queueLinkClicks),
    );
    await expect
      .poll(() => target.evaluate(() => (window as any).queueLinkClicks))
      .toBe(1);
  }
  expect(
    fixture.calls.filter((c) =>
      /\/(turn\/(start|steer|interrupt)|followups\/(submit|change|stop))$/.test(
        c.path,
      ),
    ),
  ).toEqual([]);
  await referencePage.close();
});

test("icon dragging moves down to the native target index and leaves text selectable", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const reference = process.env.CODEX_GOAL_REFERENCE_URL;
  test.skip(!reference, "Official reference required");
  await local(page);
  const actions: unknown[] = [];
  await page.route("**/api/session/followups/change", (route) => {
    actions.push(route.request().postDataJSON());
    return route.fulfill({ json: { revision: 2, paused: null, items: [] } });
  });
  const referencePage = await context.newPage();
  await native(referencePage, reference!);
  await referencePage.evaluate(() =>
    (window as any).renderQueue("first", true, "second"),
  );
  const handles = referencePage.locator('[aria-roledescription="sortable"]');
  await expect(handles).toHaveCount(2);
  const from = await handles.nth(0).boundingBox(),
    to = await handles.nth(1).boundingBox();
  await referencePage.mouse.move(
    from!.x + from!.width / 2,
    from!.y + from!.height / 2,
  );
  await referencePage.mouse.down();
  await referencePage.mouse.move(
    from!.x + from!.width / 2 + 8,
    from!.y + from!.height / 2,
    { steps: 3 },
  );
  await referencePage.mouse.move(
    to!.x + to!.width / 2,
    to!.y + to!.height / 2,
    { steps: 15 },
  );
  await referencePage.waitForTimeout(100);
  await referencePage.mouse.up();
  await expect
    .poll(() => referencePage.evaluate(() => (window as any).queueActions))
    .toEqual([{ type: "reorder", ids: ["second", "first"] }]);
  await page.evaluate(() =>
    (window as any).renderQueue("first", true, "second"),
  );
  const localHandles = page.locator(".session-queue-drag-handle");
  const localFrom = (await localHandles.nth(0).boundingBox())!,
    localTo = (await localHandles.nth(1).boundingBox())!;
  await page.mouse.move(
    localFrom.x + localFrom.width / 2,
    localFrom.y + localFrom.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    localFrom.x + localFrom.width / 2 + 8,
    localFrom.y + localFrom.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(
    localTo.x + localTo.width / 2,
    localTo.y + localTo.height / 2,
    { steps: 15 },
  );
  await page.mouse.up();
  await expect
    .poll(() => actions)
    .toEqual([
      {
        threadId: "owner",
        revision: 1,
        action: { type: "reorder", ids: ["second", "first"] },
      },
    ]);
  await referencePage.close();
});

test("absolute preview follows a nonzero scrolled host and resize, and closes on outside focus", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await local(page);
  await page.evaluate((text) => {
    const host = document.querySelector<HTMLElement>(".session-mode")!;
    const scroll = document.createElement("section");
    scroll.id = "preview-scroll-host";
    scroll.style.cssText =
      "position:relative;margin:70px 0 0 90px;width:780px;height:550px;overflow:auto;border:2px solid transparent";
    host.before(scroll);
    scroll.append(host);
    host.style.height = "1100px";
    host.style.width = "100%";
    Object.assign(document.getElementById("root")!.style, {
      top: "500px",
      left: "16px",
      width: "calc(100% - 32px)",
    });
    scroll.scrollTop = 100;
    (window as any).renderQueue(text);
  }, rich);
  const trigger = page.getByRole("group", { name: /^预览排队消息 1/ });
  await trigger.focus();
  const popup = page.getByRole("dialog", { name: "排队消息预览" });
  await expect(popup).toBeVisible();
  const align = async () => {
    const a = (await trigger.boundingBox())!,
      p = (await popup.boundingBox())!;
    return {
      dx: p.x - (Math.round(a.x + (a.width - p.width) / 2) + 1),
      dy: p.y - (Math.round(a.y - p.height - 14) + 1),
      top: p.y,
      anchor: a.y,
    };
  };
  await expect
    .poll(async () => {
      const p = await align();
      return [p.dx, p.dy];
    })
    .toEqual([0, 0]);
  const before = await align();
  await page.locator("#preview-scroll-host").evaluate((el) => {
    el.scrollTop = 180;
  });
  await expect
    .poll(async () => {
      const p = await align();
      return [p.dx, p.dy, p.top - before.top];
    })
    .toEqual([0, 0, -80]);
  await page.locator("#preview-scroll-host").evaluate((el) => {
    (el as HTMLElement).style.width = "550px";
  });
  await expect
    .poll(async () => {
      const p = await align();
      return [p.dx, p.dy];
    })
    .toEqual([0, 0]);
  await page.setViewportSize({ width: 900, height: 700 });
  await expect
    .poll(async () => {
      const p = await align();
      return [p.dx, p.dy];
    })
    .toEqual([0, 0]);
  await page.locator("#preview-scroll-host").evaluate((el) => {
    (el as HTMLElement).style.marginLeft = "400px";
  });
  await page.setViewportSize({ width: 800, height: 700 });
  await expect
    .poll(async () => {
      const p = (await popup.boundingBox())!;
      return p.width < 432 && p.x + p.width <= 793;
    })
    .toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator("#preview-scroll-host").evaluate((el) => {
    (el as HTMLElement).style.marginLeft = "90px";
  });
  await expect
    .poll(async () => {
      const p = await align();
      return [p.dx, p.dy];
    })
    .toEqual([0, 0]);
  await page.mouse.click(10, 10);
  await expect(popup).toHaveCount(0);
  await trigger.focus();
  await expect(popup).toBeVisible();
  await page.getByRole("button", { name: "删除排队的消息" }).focus();
  await expect(popup).toHaveCount(0);
});

test("the actual Session workbench opens a selectable preview in its scoped portal", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await startCompositor(page);
  const fixture = await installSessionUxFixture(page, 1);
  await page.route("**/api/session/followups?**", (route) =>
    route.fulfill({
      json: {
        revision: 1,
        paused: null,
        items: [
          {
            id: "full-shell-preview",
            threadId: "ux-0",
            text: rich,
            images: [],
            parameters: {},
            status: "queued",
            mode: "queue",
            createdAt: 1,
            fingerprint: "fixture",
          },
        ],
      },
    }),
  );
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-native-composer").waitFor();
  await seedSessionUx(page, 1);
  const trigger = page
    .locator(".session-native-composer")
    .getByRole("group", { name: /^预览排队消息 1/ });
  await trigger.focus();
  const popup = page.getByRole("dialog", { name: "排队消息预览" });
  await expect(popup).toBeVisible();
  await expect(popup).toHaveText(rich);
  const evidence = await popup.evaluate((element) => ({
    rootPosition: getComputedStyle(element.closest(".session-mode")!).position,
    popupPosition: getComputedStyle(element).position,
    portalRoot: element.parentElement?.className,
    notificationViewport: !!document.querySelector(".codex-native-toast-area"),
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  expect(evidence.rootPosition).toBe("relative");
  expect(evidence.notificationViewport).toBe(true);
  expect(evidence.popupPosition).toBe("absolute");
  expect(evidence.portalRoot).toContain("session-mode");
  expect(evidence.overflow).toBe(false);
  const diagnostics = await diagnose(page);
  await page.keyboard.press("Tab");
  await expect(popup.locator('[tabindex="0"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(
    fixture.calls.filter((c) =>
      /\/(turn\/(start|steer|interrupt)|followups\/(submit|change|stop))$/.test(
        c.path,
      ),
    ),
  ).toEqual([]);
  await writeFile(
    resolve(out, "full-workbench.json"),
    JSON.stringify({ ...evidence, diagnostics }, null, 2),
  );
});
