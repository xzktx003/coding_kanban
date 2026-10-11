import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { nativeNotifications } from "./session-native-notifications-reference";
import { installNativeFeedbackClipboard } from "./session-native-feedback-reference";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
async function metrics(page: Page) {
  return page
    .locator('[data-sonner-toast][data-front="true"]')
    .evaluate((e) => {
      const card = e.querySelector(".alert-root,.codex-native-alert")!;
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
          paths: [...n.querySelectorAll("path")].map((p) =>
            p.getAttribute("d"),
          ),
        };
      });
    });
}
async function settle(page: Page) {
  await expect
    .poll(() =>
      page
        .locator('[data-sonner-toast][data-front="true"]')
        .evaluate((e) => e.getBoundingClientRect().y),
    )
    .toBe(8);
}
async function closeProduct(page: Page) {
  await page.evaluate(async () => {
    const path = "/src/session-mode/features/native-notifications/service.tsx",
      url =
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    (await import(url)).nativeNotifications.closeAll();
  });
}
for (const width of [390, 700])
  test(`code and table clipboard errors render the original native notice ${width}`, async ({
    page,
  }, info) => {
    test.skip(!reference, "Original provider and extension RPC required");
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 844 });
    const f = await setup(page, false),
      native = await page.context().newPage();
    native.on("pageerror", (e) => f.errors.push("Native: " + e.message));
    const markdown =
      "```text\nexact source\n```\n\n| Name | Value |\n| --- | --- |\n| first | second |";
    try {
      f.fixture.threads[0].turns = [
        {
          id: "clipboard",
          status: "completed",
          items: [
            {
              type: "agentMessage",
              id: "clipboard-md",
              phase: "final_answer",
              text: markdown,
            },
          ],
        },
      ] as never;
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async () => {
              throw new Error("isolated clipboard denial");
            },
          },
        }),
      );
      await native.setViewportSize({ width, height: 844 });
      await nativeNotifications(native, reference!, width, "dark", markdown);
      await installNativeFeedbackClipboard(native, true);
      for (const target of [native, page])
        await target.evaluate(() => {
          const w = window as any;
          w.ClipboardItem = class {
            constructor(public data: Record<string, Blob>) {}
          };
          w.richWrites = 0;
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              write: async () => {
                w.richWrites++;
                throw new Error("isolated rich clipboard denial");
              },
              writeText: async () => {
                throw new Error("isolated clipboard denial");
              },
            },
          });
        });
      for (const kind of ["code", "table"] as const) {
        await native.bringToFront();
        if (kind === "table") await native.locator("table").hover();
        await native
          .getByRole("button", {
            name: kind === "code" ? "复制" : "复制表格",
            exact: true,
          })
          .click();
        if (kind === "code") {
          await expect
            .poll(() =>
              native.evaluate(() => (window as any).copyWrites.length),
            )
            .toBe(1);
          await native.evaluate(() =>
            (window as any).failCopy(new Error("isolated clipboard denial")),
          );
        } else
          await expect
            .poll(() => native.evaluate(() => (window as any).richWrites))
            .toBe(1);
        const root = page.locator(
          kind === "code" ? ".codex-native-code-fence" : ".codex-native-table",
        );
        await root.hover();
        await root
          .getByRole("button", {
            name: kind === "code" ? "复制" : "复制表格",
            exact: true,
          })
          .click();
        for (const target of [native, page]) {
          await expect(target.locator("[data-sonner-toast]")).toContainText(
            "无法复制到剪贴板",
          );
          await settle(target);
        }
        const pair = {
          native: await metrics(native),
          product: await metrics(page),
        };
        await writeFile(
          info.outputPath(`${kind}-metrics.json`),
          JSON.stringify(pair, null, 2),
        );
        for (const [name, target] of [
          ["native", native],
          ["product", page],
        ] as const)
          await target.screenshot({
            path: info.outputPath(`${name}-${kind}-error.png`),
          });
        expect(pair.product).toEqual(pair.native);
        expect(await page.getByRole("alert").count()).toBe(
          await native.getByRole("alert").count(),
        );
        expect(
          await native.evaluate(() => (window as any).clipboardErrors.at(-1)),
        ).toEqual({
          titleId: "clipboard.copyError.title",
          descriptionId: "clipboard.copyError.description",
          id: "copy-to-clipboard-error",
        });
        await native.evaluate(() => (window as any).closeNativeNotices());
        await closeProduct(page);
        for (const target of [native, page])
          await expect(target.locator("[data-sonner-toast]")).toHaveCount(0);
      }
      await page.locator(".codex-assistant .codex-native-copy").click();
      await expect(page.locator("[data-sonner-toast]")).toContainText(
        "内容未复制。请在 ChatGPT 处于焦点时重试",
      );
      await settle(page);
      await page.screenshot({
        path: info.outputPath("product-reply-error.png"),
      });
      expect(f.errors).toEqual([]);
      expect(f.calls).toEqual([]);
    } finally {
      await native.close();
      await f.close();
    }
  });

test("custom native card distinguishes content close and user swipe", async ({
  page,
}, info) => {
  test.skip(!reference, "Original custom service required");
  test.setTimeout(60000);
  await page.setViewportSize({ width: 700, height: 844 });
  const f = await setup(page, false),
    native = await page.context().newPage();
  native.on("pageerror", (e) => f.errors.push("Native: " + e.message));
  try {
    await native.setViewportSize({ width: 700, height: 844 });
    await nativeNotifications(native, reference!, 700, "dark");
    await page.evaluate(async () => {
      const cached = (path: string) =>
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
      const service = (
        await import(
          cached("/src/session-mode/features/native-notifications/service.tsx")
        )
      ).nativeNotifications;
      const { NativeNotificationCard: Card } = await import(
        cached(
          "/src/session-mode/features/native-notifications/NativeNotificationCard.tsx",
        )
      );
      const react = performance
        .getEntriesByType("resource")
        .find((e) => new URL(e.name).pathname.endsWith("/react.js"))?.name;
      if (!react) throw new Error("Mounted React not found");
      const R = (await import(react)).default,
        w = window as any;
      w.nativeNoticeActions = [];
      w.nativeNoticeRemovals = 0;
      w.showNativeCustomNotice = (options: any = {}) =>
        service.custom({
          ...options,
          onRemove: () => w.nativeNoticeRemovals++,
          onUserDismiss: () => w.nativeNoticeActions.push("dismiss"),
          content: ({ close, level }: any) =>
            R.createElement(Card, {
              title: "Reconnect MCP server “fixture”",
              description:
                "Authentication expired. Reconnect to keep using this MCP server",
              level,
              onClose: close,
              primaryAction: {
                label: "Reconnect",
                onClick: () => w.nativeNoticeActions.push("reconnect"),
              },
            }),
        });
    });
    for (const target of [native, page])
      await target.evaluate(() =>
        (window as any).showNativeCustomNotice({
          level: "warning",
          duration: 0,
        }),
      );
    for (const target of [native, page]) await settle(target);
    const pair = {
      native: await metrics(native),
      product: await metrics(page),
    };
    await writeFile(
      info.outputPath("custom-card-metrics.json"),
      JSON.stringify(pair, null, 2),
    );
    expect(pair.product).toEqual(pair.native);
    for (const [name, target] of [
      ["native", native],
      ["product", page],
    ] as const) {
      await target.screenshot({
        path: info.outputPath(`${name}-custom-card.png`),
      });
      await target
        .locator("[data-sonner-toast]")
        .getByRole("button", { name: "Reconnect", exact: true })
        .click();
      await expect(target.locator("[data-sonner-toast]")).toHaveCount(1);
      await target
        .locator("[data-sonner-toast]")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await expect(target.locator("[data-sonner-toast]")).toHaveCount(0);
      expect(
        await target.evaluate(() => (window as any).nativeNoticeActions),
      ).toEqual(["reconnect"]);
      expect(
        await target.evaluate(() => (window as any).nativeNoticeRemovals),
      ).toBe(1);
      await target.evaluate(() =>
        (window as any).showNativeCustomNotice({
          level: "warning",
          duration: 0,
        }),
      );
      await settle(target);
      const box = (await target.locator("[data-sonner-toast]").boundingBox())!;
      await target.bringToFront();
      await target.mouse.move(box.x + 8, box.y + 20);
      await target.mouse.down();
      await target.mouse.move(box.x + 188, box.y + 20, { steps: 12 });
      await target.screenshot({
        path: info.outputPath(`${name}-custom-swipe.png`),
      });
      await target.mouse.up();
      await expect(target.locator("[data-sonner-toast]")).toHaveCount(0);
      expect(
        await target.evaluate(() => (window as any).nativeNoticeActions),
      ).toEqual(["reconnect", "dismiss"]);
      expect(
        await target.evaluate(() => (window as any).nativeNoticeRemovals),
      ).toBe(2);
    }
    expect(f.errors).toEqual([]);
  } finally {
    await native.close();
    await f.close();
  }
});
