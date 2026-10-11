import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { nativeNotifications } from "./session-native-notifications-reference";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
test("Codex feedback progress uses the original native notification card", async ({
  page,
}, info) => {
  test.skip(!reference, "Unchanged native reference required");
  test.setTimeout(60000);
  await page.setViewportSize({ width: 700, height: 844 });
  const f = await setup(page, false),
    native = await page.context().newPage();
  native.on("pageerror", (e) =>
    f.errors.push("Native reference: " + e.message),
  );
  let release!: () => void;
  try {
    await native.setViewportSize({ width: 700, height: 844 });
    await nativeNotifications(native, reference!, 700, "dark");
    await native.evaluate(() =>
      (window as any).showNativeNotice("info", "正在上传反馈", {
        duration: 0,
        action: "查看上传内容",
      }),
    );
    await expect(native.locator("[data-sonner-toast]")).toBeVisible();
    await expect
      .poll(() =>
        native
          .locator("[data-sonner-toast]")
          .evaluate((e) => e.getBoundingClientRect().y),
      )
      .toBe(8);
    await writeFile(
      info.outputPath("native-card.html"),
      await native.locator("[data-sonner-toast]").evaluate((e) => e.outerHTML),
    );
    await native.screenshot({ path: info.outputPath("native-progress.png") });
    await writeFile(
      info.outputPath("native-details.json"),
      JSON.stringify(
        await native.locator("[data-sonner-toast]").evaluate((e) =>
          [...e.querySelectorAll("*")].map((n) => {
            const s = getComputedStyle(n),
              r = n.getBoundingClientRect();
            return {
              tag: n.tagName,
              cls: n.className,
              rect: { x: r.x, y: r.y, w: r.width, h: r.height },
              font: s.font,
              color: s.color,
              bg: s.backgroundColor,
              border: s.border,
              radius: s.borderRadius,
              padding: s.padding,
              gap: s.gap,
              shadow: s.boxShadow,
            };
          }),
        ),
        null,
        2,
      ),
    );
    await page.route(
      "**/api/session/api/codex/feedback/upload",
      async (route) => {
        await new Promise<void>((r) => (release = r));
        await route.fulfill({ json: { threadId: "receipt" } });
      },
    );
    await page.evaluate(async () => {
      const path = "/src/session-mode/features/native-feedback/service.ts",
        url =
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
      (await import(url)).startFeedbackUpload(
        "ux-0",
        "Captured diagnostics",
        { classification: "bug", includeLogs: false },
        "codex:ux-0",
      );
    });
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("[data-sonner-toast]")).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator("[data-sonner-toast]")
          .evaluate((e) => e.getBoundingClientRect().y),
      )
      .toBe(8);
    const measure = async (target: any) =>
      target.locator("[data-sonner-toast]").evaluate((e: HTMLElement) => {
        const root = e.getBoundingClientRect(),
          style = getComputedStyle(e);
        return {
          x: root.x,
          y: root.y,
          width: root.width,
          height: root.height,
          text: e.textContent,
          font: style.font,
          background: style.backgroundColor,
          padding: style.padding,
          border: style.border,
          borderRadius: style.borderRadius,
          html: e.outerHTML,
        };
      });
    const pair = {
      native: await measure(native),
      product: await measure(page),
    };
    await writeFile(
      info.outputPath("progress-metrics.json"),
      JSON.stringify(pair, null, 2),
    );
    await page.screenshot({ path: info.outputPath("product-progress.png") });
    expect({ ...pair.product, html: undefined }).toEqual({
      ...pair.native,
      html: undefined,
    });
    expect(f.errors).toEqual([]);
  } finally {
    release?.();
    await native.close();
    await f.close();
  }
});

async function productNotices(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const path = "/src/session-mode/features/native-notifications/service.tsx";
    const url =
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const service = (await import(url)).nativeNotifications,
      w = window as any;
    w.nativeNoticeActions = [];
    w.nativeNoticeRemovals = 0;
    w.closeNativeNotices = () => service.closeAll();
    w.showNativeNotice = (level: string, title: string, options: any = {}) =>
      service[level](title, {
        ...options,
        onRemove: () => w.nativeNoticeRemovals++,
        primaryAction: options.action
          ? {
              label: options.action,
              onClick: () => w.nativeNoticeActions.push("primary"),
            }
          : undefined,
      });
  });
}
async function settle(page: import("@playwright/test").Page) {
  await expect
    .poll(() =>
      page
        .locator('[data-sonner-toast][data-removed="false"]')
        .last()
        .evaluate((e) => e.getBoundingClientRect().y),
    )
    .toBe(8);
}
async function appearance(page: import("@playwright/test").Page) {
  return page
    .locator('[data-sonner-toast][data-removed="false"]')
    .last()
    .evaluate((e) => {
      const card = e.querySelector(".alert-root, .codex-native-alert")!;
      return [card, ...card.querySelectorAll("button,svg")].map((n) => {
        const s = getComputedStyle(n),
          r = n.getBoundingClientRect();
        return {
          tag: n.tagName,
          text: n.tagName === "svg" ? null : n.textContent,
          rect: [r.x, r.y, r.width, r.height],
          font: s.font,
          color: s.color,
          bg: s.backgroundColor,
          border: s.border,
          radius: s.borderRadius,
          padding: s.padding,
          shadow: s.boxShadow,
          paths: [...n.querySelectorAll("path")].map((p) =>
            p.getAttribute("d"),
          ),
        };
      });
    });
}
for (const theme of ["dark", "light"] as const)
  for (const width of [390, 700]) {
    test(`original notification cards, actions and removal ${theme} ${width}`, async ({
      page,
    }, info) => {
      test.skip(!reference, "Unchanged native provider required");
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 844 });
      const f = await setup(page, false),
        native = await page.context().newPage();
      native.on("pageerror", (e) =>
        f.errors.push("Native reference: " + e.message),
      );
      try {
        if (theme === "light")
          await page.getByRole("button", { name: "切换为浅色模式" }).click();
        await native.setViewportSize({ width, height: 844 });
        await nativeNotifications(native, reference!, width, theme);
        await productNotices(page);
        const cases = [
          {
            name: "info",
            level: "info",
            title: "正在上传反馈",
            options: { action: "查看上传内容" },
          },
          {
            name: "success",
            level: "success",
            title: "已上传反馈",
            options: { action: "查看上传内容" },
          },
          {
            name: "warning",
            level: "warning",
            title: "反馈上传未确认",
            options: {
              description: "请查看上传内容后再重试",
              action: "查看上传内容",
            },
          },
          {
            name: "danger",
            level: "danger",
            title: "无法复制到剪贴板",
            options: { description: "内容未复制。请在 ChatGPT 处于焦点时重试" },
          },
          {
            name: "inline",
            level: "info",
            title: "需重试",
            options: {
              description: "详细信息",
              actionPlacement: "inline",
              action: "重试",
            },
          },
          {
            name: "no-close",
            level: "info",
            title: "持久通知",
            options: { hasCloseButton: false },
          },
        ];
        for (const c of cases) {
          for (const target of [native, page]) {
            await target.evaluate(() => (window as any).closeNativeNotices());
            await expect(target.locator("[data-sonner-toast]")).toHaveCount(0);
            await target.evaluate(
              (c) =>
                (window as any).showNativeNotice(c.level, c.title, {
                  ...c.options,
                  duration: 0,
                }),
              c,
            );
            await settle(target);
          }
          const pair = {
            native: await appearance(native),
            product: await appearance(page),
          };
          await writeFile(
            info.outputPath(`${c.name}-metrics.json`),
            JSON.stringify(pair, null, 2),
          );
          for (const [name, target] of [
            ["native", native],
            ["product", page],
          ] as const)
            await target.screenshot({
              path: info.outputPath(`${name}-${c.name}.png`),
            });
          expect(pair.product).toEqual(pair.native);
          if ("action" in c.options) {
            for (const target of [native, page]) {
              await target
                .locator("[data-sonner-toast]")
                .getByRole("button", { name: c.options.action, exact: true })
                .hover();
            }
            const hover = {
              native: await appearance(native),
              product: await appearance(page),
            };
            await writeFile(
              info.outputPath(`${c.name}-hover-metrics.json`),
              JSON.stringify(hover, null, 2),
            );
            for (const [name, target] of [
              ["native", native],
              ["product", page],
            ] as const)
              await target.screenshot({
                path: info.outputPath(`${name}-${c.name}-hover.png`),
              });
            expect(hover.product).toEqual(hover.native);
            for (const target of [native, page]) {
              await target
                .locator("[data-sonner-toast]")
                .getByRole("button", { name: c.options.action, exact: true })
                .click();
              await expect(target.locator("[data-sonner-toast]")).toHaveCount(
                1,
              );
            }
          }
          if (c.name !== "no-close")
            for (const target of [native, page]) {
              const before = await target.evaluate(
                () => (window as any).nativeNoticeRemovals,
              );
              await target
                .locator("[data-sonner-toast]")
                .getByRole("button", { name: "关闭", exact: true })
                .click();
              await expect(target.locator("[data-sonner-toast]")).toHaveCount(
                0,
              );
              expect(
                await target.evaluate(
                  () => (window as any).nativeNoticeRemovals,
                ),
              ).toBe(before + 1);
            }
        }
        expect(f.errors).toEqual([]);
      } finally {
        await native.close();
        await f.close();
      }
    });
  }

test("native notifications deduplicate, expire after five seconds and swipe right", async ({
  page,
}, info) => {
  test.skip(!reference, "Original provider required");
  test.setTimeout(60000);
  await page.setViewportSize({ width: 700, height: 844 });
  const f = await setup(page, false),
    native = await page.context().newPage();
  native.on("pageerror", (e) =>
    f.errors.push("Native reference: " + e.message),
  );
  try {
    await native.setViewportSize({ width: 700, height: 844 });
    await nativeNotifications(native, reference!, 700, "dark");
    await productNotices(page);
    for (const target of [native, page]) {
      await target.bringToFront();
      await target.evaluate(() => {
        const w = window as any;
        w.showNativeNotice("info", "old", { id: "same", duration: 0 });
        w.showNativeNotice("info", "replacement", { id: "same", duration: 0 });
      });
      await settle(target);
      await expect(
        target.locator('[data-sonner-toast][data-removed="false"]'),
      ).toHaveCount(1);
      expect(
        await target.evaluate(() => (window as any).nativeNoticeRemovals),
      ).toBe(1);
      const box = (await target
        .locator('[data-sonner-toast][data-removed="false"]')
        .boundingBox())!;
      await target.mouse.move(box.x + 8, box.y + box.height / 2);
      await target.mouse.down();
      await target.mouse.move(box.x + 188, box.y + box.height / 2, {
        steps: 12,
      });
      await writeFile(
        info.outputPath(
          `${target === native ? "native" : "product"}-swipe-state.json`,
        ),
        JSON.stringify(
          await target
            .locator('[data-sonner-toast][data-removed="false"]')
            .evaluate((e) => ({
              html: e.outerHTML,
              selection: window.getSelection()?.toString(),
            })),
          null,
          2,
        ),
      );
      await target.screenshot({
        path: info.outputPath(
          `${target === native ? "native" : "product"}-swipe.png`,
        ),
      });
      await target.mouse.up();
      await expect(target.locator("[data-sonner-toast]")).toHaveCount(0);
      expect(
        await target.evaluate(() => (window as any).nativeNoticeRemovals),
      ).toBe(2);
      await target.evaluate(() =>
        (window as any).showNativeNotice("info", "five seconds"),
      );
      await settle(target);
      await target.mouse.move(5, 200);
    }
    // Both real browser clocks are running. No fake timers or assertion threshold changes.
    for (const target of [native, page])
      await expect(target.locator("[data-sonner-toast]")).toHaveCount(0, {
        timeout: 8000,
      });
    for (const target of [native, page])
      expect(
        await target.evaluate(() => (window as any).nativeNoticeRemovals),
      ).toBe(3);
    expect(f.errors).toEqual([]);
  } finally {
    await native.close();
    await f.close();
  }
});
