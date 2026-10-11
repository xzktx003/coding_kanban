import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import {
  nativeFeedbackUpload,
  installNativeFeedbackClipboard,
} from "./session-native-feedback-reference";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
test("feedback hands off to the original upload report before HTTP completion", async ({
  page,
}, info) => {
  test.skip(!reference, "Original VSIX reference required");
  test.setTimeout(60000);
  await page.setViewportSize({ width: 700, height: 844 });
  const f = await setup(page, false),
    native = await page.context().newPage();
  native.on("pageerror", (e) =>
    f.errors.push("Native reference: " + e.message),
  );
  const releases: (() => void)[] = [];
  try {
    await native.setViewportSize({ width: 700, height: 844 });
    for (const target of [native, page])
      await target.route(
        "**/api/session/api/codex/feedback/upload",
        async (route) => {
          await new Promise<void>((r) => releases.push(r));
          await route.fulfill({ json: { threadId: "feedback-result" } });
        },
      );
    await nativeFeedbackUpload(native, reference!, 700, "dark", "ux-0");
    await expect(
      native.getByRole("dialog", { name: "正在上传反馈" }),
    ).toBeVisible();
    await native.screenshot({ path: info.outputPath("native-uploading.png") });
    await writeFile(
      info.outputPath("native-uploading.html"),
      await native.getByRole("dialog").evaluate((e) => e.outerHTML),
    );
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    await editor.fill("/feedback");
    await page
      .locator('[data-composer-suggestions="commands"]')
      .getByRole("option", { name: /\/feedback/ })
      .click();
    await page.getByRole("radio", { name: "错误", exact: true }).click();
    await page
      .getByRole("textbox", { name: "填写详情（必填）" })
      .fill("Captured diagnostics");
    await page.getByRole("checkbox").uncheck();
    await page.getByRole("button", { name: "提交", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "正在上传反馈" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "复制", exact: true }),
    ).toBeFocused();
    await page.screenshot({ path: info.outputPath("product-uploading.png") });
    const metrics = async (target: any) =>
      target.getByRole("dialog").evaluate((e: HTMLElement) => {
        const root = e.getBoundingClientRect();
        const css = (n: Element) => {
          const s = getComputedStyle(n);
          return Object.fromEntries(
            [
              "fontFamily",
              "fontSize",
              "fontWeight",
              "lineHeight",
              "color",
              "backgroundColor",
              "padding",
              "border",
              "borderRadius",
              "display",
              "gap",
            ].map((k) => [
              k,
              k === "outline" && s.outlineStyle === "none"
                ? "none"
                : k === "boxShadow"
                  ? s.boxShadow
                      .split(/,(?![^()]*\))/)
                      .filter(
                        (v) =>
                          !v
                            .trim()
                            .startsWith("rgba(0, 0, 0, 0) 0px 0px 0px 0px"),
                      )
                      .map((v) => v.trim())
                      .join(", ") || "none"
                  : (s as any)[k],
            ]),
          );
        };
        return {
          width: root.width,
          height: root.height,
          css: css(e),
          nodes: [
            ...e.querySelectorAll(
              "h2,p,code,button,.text-xs.text-secondary,.feedback-report-id-label",
            ),
          ].map((n) => {
            const r = n.getBoundingClientRect();
            return {
              text: n.textContent || n.getAttribute("aria-label"),
              tag: n.tagName,
              x: r.x - root.x,
              y: r.y - root.y,
              width: r.width,
              height: r.height,
              css: css(n),
            };
          }),
        };
      });
    const pair = {
      native: await metrics(native),
      product: await metrics(page),
    };
    await writeFile(
      info.outputPath("uploading-metrics.json"),
      JSON.stringify(pair, null, 2),
    );
    await writeFile(
      info.outputPath("report-regions.json"),
      JSON.stringify(
        await Promise.all(
          [native, page].map((target) =>
            target.getByRole("dialog").evaluate((e) => {
              const code = e.querySelector("code")!;
              return [
                code.parentElement!.parentElement!,
                e.querySelector("span.h-9") ??
                  e.querySelector(".feedback-report-status-icon")!,
              ].map((n) => {
                const s = getComputedStyle(n);
                return {
                  className: n.className,
                  background: s.backgroundColor,
                  color: s.color,
                  border: s.border,
                  padding: s.padding,
                };
              });
            }),
          ),
        ),
        null,
        2,
      ),
    );
    expect(pair.product).toEqual(pair.native);
    expect(f.errors).toEqual([]);
  } finally {
    for (const release of releases) release();
    await native.close();
    await f.close();
  }
});

async function reportMetrics(target: any) {
  await target.bringToFront();
  return target.getByRole("dialog").evaluate((e: HTMLElement) => {
    for (const animation of e.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = 0;
    }
    const root = e.getBoundingClientRect();
    const css = (n: Element) => {
      const s = getComputedStyle(n);
      return Object.fromEntries(
        [
          "fontFamily",
          "fontSize",
          "fontWeight",
          "lineHeight",
          "color",
          "backgroundColor",
          "padding",
          "border",
          "borderRadius",
          "display",
          "gap",
          "opacity",
          "outline",
          "outlineOffset",
          "boxShadow",
        ].map((k) => [
          k,
          k === "outline" && s.outlineStyle === "none"
            ? "none"
            : k === "boxShadow"
              ? s.boxShadow
                  .split(/,(?![^()]*\))/)
                  .filter(
                    (v) =>
                      !v.trim().startsWith("rgba(0, 0, 0, 0) 0px 0px 0px 0px"),
                  )
                  .map((v) => v.trim())
                  .join(", ") || "none"
              : (s as any)[k],
        ]),
      );
    };
    const nodes = [
      ...e.querySelectorAll(
        "h2,p,code,button,a,.text-xs.text-secondary,.feedback-report-id-label",
      ),
    ];
    const badge =
      e.querySelector("span.h-9") ??
      e.querySelector(".feedback-report-status-icon")!;
    const code = e.querySelector("code");
    if (code) nodes.push(code.parentElement!.parentElement!);
    nodes.push(badge, badge.querySelector("svg")!);
    return {
      width: root.width,
      height: root.height,
      css: css(e),
      nodes: nodes.map((n) => {
        const r = n.getBoundingClientRect();
        const svg =
          n.tagName.toLowerCase() === "svg" ? n : n.querySelector("svg");
        return {
          tag: n.tagName,
          text: n.textContent || n.getAttribute("aria-label"),
          x: r.x - root.x,
          y: r.y - root.y,
          width: r.width,
          height: r.height,
          css: css(n),
          href: n.getAttribute("href"),
          icon: svg
            ? {
                viewBox: svg.getAttribute("viewBox"),
                width: getComputedStyle(svg).width,
                height: getComputedStyle(svg).height,
                paths: [...svg.querySelectorAll("path")].map((p) =>
                  Object.fromEntries(
                    [...p.attributes].map((a) => [a.name, a.value]),
                  ),
                ),
              }
            : null,
        };
      }),
    };
  });
}
const states = [
  { name: "uploaded", error: null, title: "反馈已提交" },
  {
    name: "incomplete",
    error:
      "feedback report was accepted, but some attachments failed to upload",
    title: "反馈已提交",
  },
  {
    name: "disabled",
    error: "sending feedback is disabled by configuration",
    title: "反馈已禁用",
  },
  {
    name: "failed",
    error: "feedback uploads are already in progress",
    title: "反馈上传未成功",
  },
  {
    name: "unconfirmed",
    error: "isolated connection failure",
    title: "反馈上传未确认",
  },
];
for (const width of [390, 700])
  for (const theme of ["dark", "light"]) {
    test(`original upload report states (${width} ${theme})`, async ({
      page,
    }, info) => {
      test.skip(!reference, "Original VSIX reference required");
      test.setTimeout(120000);
      await page.setViewportSize({ width, height: 844 });
      const f = await setup(page, false),
        native = await page.context().newPage();
      native.on("pageerror", (e) =>
        f.errors.push("Native reference: " + e.message),
      );
      let releases: (() => void)[] = [];
      try {
        await native.setViewportSize({ width, height: 844 });
        await page.evaluate(async (theme) => {
          const path = "/src/session-mode/stores/settings/useThemeStore.ts";
          const url =
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
          (await import(url)).useThemeStore.getState().setTheme(theme);
        }, theme);
        for (const state of states) {
          releases = [];
          for (const target of [native, page])
            await target.route(
              "**/api/session/api/codex/feedback/upload",
              async (route) => {
                await new Promise<void>((r) => releases.push(r));
                await route.fulfill({
                  status: state.error ? 503 : 200,
                  json: state.error
                    ? { error: state.error }
                    : { threadId: "feedback-result" },
                });
              },
            );
          await nativeFeedbackUpload(native, reference!, width, theme, "ux-0");
          await page.evaluate(async () => {
            const path =
              "/src/session-mode/features/native-feedback/service.ts";
            const url =
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
              path;
            const service = await import(url);
            service.feedbackUploads.clear();
            service.startFeedbackUpload(
              "ux-0",
              "Captured diagnostics",
              { classification: "bug", includeLogs: false },
              "codex:ux-0",
            );
          });
          await expect.poll(() => releases.length).toBe(2);
          if (state.name === "uploaded") {
            const pair = {
              native: await reportMetrics(native),
              product: await reportMetrics(page),
            };
            await writeFile(
              info.outputPath("uploading-full.json"),
              JSON.stringify(pair, null, 2),
            );
            expect(pair.product).toEqual(pair.native);
          }
          releases.forEach((r) => r());
          for (const target of [native, page])
            await expect(
              target.getByRole("dialog", { name: state.title }),
            ).toBeVisible();
          const pair = {
            native: await reportMetrics(native),
            product: await reportMetrics(page),
          };
          await writeFile(
            info.outputPath(`${state.name}-metrics.json`),
            JSON.stringify(pair, null, 2),
          );
          for (const [name, target] of [
            ["native", native],
            ["product", page],
          ] as const)
            await target.screenshot({
              path: info.outputPath(`${name}-${state.name}.png`),
            });
          expect(pair.product).toEqual(pair.native);
          for (const target of [native, page])
            await target.unroute("**/api/session/api/codex/feedback/upload");
        }
        expect(f.calls).toEqual([]);
        expect(f.errors).toEqual([]);
      } finally {
        releases.forEach((r) => r());
        await native.close();
        await f.close();
      }
    });
  }

test("background upload notification reopens the original final receipt without resending", async ({
  page,
}, info) => {
  test.skip(!reference, "Original VSIX reference required");
  test.setTimeout(60000);
  await page.setViewportSize({ width: 700, height: 844 });
  const f = await setup(page, false),
    native = await page.context().newPage();
  native.on("pageerror", (e) =>
    f.errors.push("Native reference: " + e.message),
  );
  const releases: (() => void)[] = [],
    requests: unknown[] = [];
  try {
    await native.setViewportSize({ width: 700, height: 844 });
    for (const target of [native, page])
      await target.route(
        "**/api/session/api/codex/feedback/upload",
        async (route) => {
          requests.push(route.request().postDataJSON());
          await new Promise<void>((r) => releases.push(r));
          await route.fulfill({ json: { threadId: "feedback-reopened" } });
        },
      );
    await nativeFeedbackUpload(native, reference!, 700, "dark", "ux-0");
    await page.evaluate(async () => {
      const path = "/src/session-mode/features/native-feedback/service.ts";
      const url =
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
    await expect.poll(() => requests.length).toBe(2);
    for (const target of [native, page]) {
      await expect(
        target.getByRole("dialog", { name: "正在上传反馈" }),
      ).toBeVisible();
      await target.keyboard.press("Escape");
      await writeFile(
        info.outputPath(
          target === native ? "native-dismiss.json" : "product-dismiss.json",
        ),
        JSON.stringify(
          await target.evaluate(() => ({
            dialogs: [...document.querySelectorAll("[role=dialog]")].map(
              (e) => e.outerHTML,
            ),
            notifications: (window as any).feedbackNotifications?.map(
              (n: any) => ({
                kind: n.kind,
                message: n.message,
                closed: n.closed,
              }),
            ),
            active: document.activeElement?.outerHTML,
          })),
          null,
          2,
        ),
      );
      await expect(target.getByRole("dialog")).toHaveCount(0);
    }
    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "正在上传反馈",
    );
    releases.forEach((r) => r());
    await expect(
      page.locator('[data-sonner-toast][data-front="true"]'),
    ).toContainText("反馈已提交");
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(1);
    const notices = await native.evaluate(() =>
      (window as any).feedbackNotifications.map((n: any) => ({
        kind: n.kind,
        message: n.message,
        closed: n.closed,
      })),
    );
    expect(notices).toEqual([
      { kind: "info", message: "正在上传反馈", closed: true },
      { kind: "success", message: "反馈已提交", closed: false },
    ]);
    await page.screenshot({
      path: info.outputPath("product-background-receipt.png"),
    });
    await native
      .getByRole("button", { name: "查看上传内容", exact: true })
      .click();
    await page
      .getByRole("button", { name: "查看上传内容", exact: true })
      .click();
    for (const target of [native, page]) {
      await expect(
        target.getByRole("dialog", { name: "反馈已提交" }),
      ).toBeVisible();
      await expect(target.getByRole("dialog").locator("code")).toHaveText(
        "feedback-reopened",
      );
    }
    const pair = {
      native: await reportMetrics(native),
      product: await reportMetrics(page),
    };
    await writeFile(
      info.outputPath("reopened-metrics.json"),
      JSON.stringify(pair, null, 2),
    );
    expect(pair.product).toEqual(pair.native);
    for (const [name, target] of [
      ["native", native],
      ["product", page],
    ] as const) {
      await target.bringToFront();
      if (
        await target
          .getByRole("button", { name: "已复制", exact: true })
          .count()
      ) {
        // Capture both copied states with the same footer focus, avoiding cross-page tooltip blur.
        await target
          .getByRole("dialog")
          .getByRole("button", { name: "关闭", exact: true })
          .focus();
      }
      await target.screenshot({
        path: info.outputPath(`${name}-reopened.png`),
      });
    }
    for (const target of [native, page])
      await target
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(f.calls).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    const state = await page
      .evaluate(async () => {
        const module = async (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
        const { feedbackUploads } = await module(
          "/src/session-mode/features/native-feedback/service.ts",
        );
        const { useCodexStore } = await module(
          "/src/session-mode/components/codex/stores/index.ts",
        );
        const current = useCodexStore.getState();
        return {
          reports: feedbackUploads.getSnapshot(),
          account: current.account,
          namespace: current.accountNamespace,
          focused: document.hasFocus(),
          visibility: document.visibilityState,
          history: history.state,
          dialogs: document.querySelectorAll("[role=dialog]").length,
        };
      })
      .catch(() => null);
    await writeFile(
      info.outputPath("feedback-reopen-state.json"),
      JSON.stringify(state, null, 2),
    );
    releases.forEach((r) => r());
    await native.close();
    await f.close();
  }
});

for (const language of ["en", "ja", "fr"])
  test(`original uploaded report ${language}`, async ({ page }, info) => {
    test.skip(!reference, "Original VSIX reference required");
    await page.setViewportSize({ width: 700, height: 844 });
    const f = await setup(page, false),
      native = await page.context().newPage();
    native.on("pageerror", (e) =>
      f.errors.push("Native reference: " + e.message),
    );
    try {
      await native.setViewportSize({ width: 700, height: 844 });
      for (const target of [native, page])
        await target.route(
          "**/api/session/api/codex/feedback/upload",
          (route) => route.fulfill({ json: { threadId: "feedback-result" } }),
        );
      await nativeFeedbackUpload(
        native,
        reference!,
        700,
        "dark",
        "ux-0",
        language,
      );
      await page.evaluate(async (language) => {
        const paths = [
          "/src/session-mode/stores/settings/useLocaleStore.ts",
          "/src/session-mode/features/native-feedback/service.ts",
        ];
        const modules = await Promise.all(
          paths.map(
            (path) =>
              import(
                performance
                  .getEntriesByType("resource")
                  .findLast((e) => new URL(e.name).pathname === path)?.name ??
                  path
              ),
          ),
        );
        modules[0].useLocaleStore.getState().setLocale(language);
        modules[1].startFeedbackUpload(
          "ux-0",
          "Captured diagnostics",
          { classification: "bug", includeLogs: false },
          "codex:ux-0",
        );
      }, language);
      for (const target of [native, page])
        await expect(target.getByRole("dialog").locator("code")).toHaveText(
          "feedback-result",
        );
      const pair = {
        native: await reportMetrics(native),
        product: await reportMetrics(page),
      };
      await writeFile(
        info.outputPath("localized-report.json"),
        JSON.stringify(pair, null, 2),
      );
      for (const [name, target] of [
        ["native", native],
        ["product", page],
      ] as const)
        await target.screenshot({
          path: info.outputPath(`${name}-localized.png`),
        });
      expect(pair.product).toEqual(pair.native);
      expect(f.errors).toEqual([]);
    } finally {
      await native.close();
      await f.close();
    }
  });

test("missing initial ID, reduced motion and explicit failed-upload retry match the original", async ({
  page,
}, info) => {
  test.skip(!reference, "Original VSIX reference required");
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await setup(page, false),
    native = await page.context().newPage();
  native.on("pageerror", (e) =>
    f.errors.push("Native reference: " + e.message),
  );
  const releases: (() => void)[] = [],
    calls: unknown[][] = [[], []];
  try {
    await native.setViewportSize({ width: 390, height: 844 });
    for (const [index, target] of [native, page].entries()) {
      await target.emulateMedia({ reducedMotion: "reduce" });
      await target.route(
        "**/api/session/api/codex/feedback/upload",
        async (route) => {
          calls[index].push(route.request().postDataJSON());
          if (calls[index].length === 1) {
            await new Promise<void>((r) => releases.push(r));
            await route.fulfill({
              status: 503,
              json: { error: "feedback uploads are already in progress" },
            });
          } else
            await route.fulfill({ json: { threadId: "feedback-retried" } });
        },
      );
    }
    await nativeFeedbackUpload(native, reference!, 390, "dark", null);
    await page.evaluate(async () => {
      const path = "/src/session-mode/features/native-feedback/service.ts",
        url =
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
      (await import(url)).startFeedbackUpload(
        null,
        "Captured diagnostics",
        { classification: "bug", includeLogs: false },
        "codex:ux-0",
      );
    });
    await expect.poll(() => releases.length).toBe(2);
    const pending = {
      native: await reportMetrics(native),
      product: await reportMetrics(page),
    };
    await writeFile(
      info.outputPath("no-id-uploading.json"),
      JSON.stringify(pending, null, 2),
    );
    expect(pending.product).toEqual(pending.native);
    for (const target of [native, page])
      expect(
        await target
          .getByRole("dialog")
          .evaluate((e) => e.getAnimations({ subtree: true }).length),
      ).toBe(0);
    releases.forEach((r) => r());
    for (const target of [native, page])
      await expect(
        target.getByRole("dialog", { name: "反馈上传未成功" }),
      ).toBeVisible();
    const failed = {
      native: await reportMetrics(native),
      product: await reportMetrics(page),
    };
    await writeFile(
      info.outputPath("no-id-failed.json"),
      JSON.stringify(failed, null, 2),
    );
    expect(failed.product).toEqual(failed.native);
    for (const [name, target] of [
      ["native", native],
      ["product", page],
    ] as const) {
      await target.bringToFront();
      if (
        await target
          .getByRole("button", { name: "已复制", exact: true })
          .count()
      ) {
        // Capture both copied states with the same footer focus, avoiding cross-page tooltip blur.
        await target
          .getByRole("dialog")
          .getByRole("button", { name: "关闭", exact: true })
          .focus();
      }
      await target.screenshot({
        path: info.outputPath(`${name}-no-id-failed.png`),
      });
    }
    for (const target of [native, page])
      await target.getByRole("button", { name: "重试", exact: true }).click();
    for (const target of [native, page])
      await expect(target.getByRole("dialog").locator("code")).toHaveText(
        "feedback-retried",
      );
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]).toHaveLength(2);
    expect(calls[1][0]).toEqual(calls[1][1]);
    expect(f.calls).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    releases.forEach((r) => r());
    await native.close();
    await f.close();
  }
});

test("copying the receipt locks pending writes, uses original copied artwork and resets after two seconds", async ({
  page,
}, info) => {
  test.skip(!reference, "Original VSIX reference required");
  test.setTimeout(60000);
  await page.setViewportSize({ width: 700, height: 844 });
  const f = await setup(page, false),
    native = await page.context().newPage();
  native.on("pageerror", (e) =>
    f.errors.push("Native reference: " + e.message),
  );
  try {
    await native.setViewportSize({ width: 700, height: 844 });
    for (const target of [native, page])
      await target.route("**/api/session/api/codex/feedback/upload", (route) =>
        route.fulfill({ json: { threadId: "feedback-copy" } }),
      );
    await nativeFeedbackUpload(native, reference!, 700, "dark", "ux-0");
    await installNativeFeedbackClipboard(native);
    await page.evaluate(async () => {
      (window as any).copyWrites = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (value: string) =>
            new Promise<void>((resolve) => {
              (window as any).copyWrites.push(value);
              (window as any).finishCopy = resolve;
            }),
        },
      });
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
    for (const target of [native, page]) {
      await expect(target.getByRole("dialog").locator("code")).toHaveText(
        "feedback-copy",
      );
      await target.getByRole("button", { name: "复制", exact: true }).click();
      await expect(
        target.getByRole("button", { name: "复制", exact: true }),
      ).toHaveAttribute("aria-busy", "true");
      await target
        .getByRole("button", { name: "复制", exact: true })
        .click({ force: true });
      expect(await target.evaluate(() => (window as any).copyWrites)).toEqual([
        "feedback-copy",
      ]);
    }
    const pending = {
      native: await reportMetrics(native),
      product: await reportMetrics(page),
    };
    await writeFile(
      info.outputPath("copy-pending.json"),
      JSON.stringify(pending, null, 2),
    );
    expect(pending.product).toEqual(pending.native);
    for (const target of [native, page])
      await target.evaluate(() => (window as any).finishCopy());
    for (const target of [native, page])
      await expect(
        target.getByRole("button", { name: "已复制", exact: true }),
      ).toBeVisible();
    const copied = {
      native: await reportMetrics(native),
      product: await reportMetrics(page),
    };
    await writeFile(
      info.outputPath("copy-success.json"),
      JSON.stringify(copied, null, 2),
    );
    expect(copied.product).toEqual(copied.native);
    for (const [name, target] of [
      ["native", native],
      ["product", page],
    ] as const) {
      await target.bringToFront();
      if (
        await target
          .getByRole("button", { name: "已复制", exact: true })
          .count()
      ) {
        // Capture both copied states with the same footer focus, avoiding cross-page tooltip blur.
        await target
          .getByRole("dialog")
          .getByRole("button", { name: "关闭", exact: true })
          .focus();
      }
      await target.screenshot({ path: info.outputPath(`${name}-copied.png`) });
    }
    for (const target of [native, page])
      await expect(
        target.getByRole("button", { name: "复制", exact: true }),
      ).toBeVisible({ timeout: 3500 });
    // Exercise the actual nonsecure LAN HTTP clipboard event after the controlled RPC comparison.
    await page.evaluate(() => {
      delete (navigator as any).clipboard;
      (window as any).feedbackHttpCopies = [];
      window.addEventListener("copy", (e) =>
        (window as any).feedbackHttpCopies.push({
          plain: e.clipboardData?.getData("text/plain"),
          prevented: e.defaultPrevented,
        }),
      );
    });
    expect(
      await page.evaluate(() => ({
        secure: isSecureContext,
        clipboard: typeof navigator.clipboard,
      })),
    ).toEqual({ secure: false, clipboard: "undefined" });
    await page.getByRole("button", { name: "复制", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "已复制", exact: true }),
    ).toBeVisible();
    const copies = await page.evaluate(
      () => (window as any).feedbackHttpCopies,
    );
    expect(copies).toEqual([{ plain: "feedback-copy", prevented: true }]);
    await writeFile(
      info.outputPath("http-feedback-copy.json"),
      JSON.stringify(copies, null, 2),
    );
    await page.screenshot({ path: info.outputPath("product-http-copied.png") });
    expect(f.errors).toEqual([]);
  } finally {
    await native.close();
    await f.close();
  }
});

test("uploaded feedback links open the encoded receipt in an external browser tab", async ({
  page,
}, info) => {
  const f = await setup(page, false);
  try {
    await page.context().route("https://github.com/openai/codex/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<title>Isolated external link</title>",
      }),
    );
    await page.route("**/api/session/api/codex/feedback/upload", (route) =>
      route.fulfill({ json: { threadId: "feedback ID & exact" } }),
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
    await expect(
      page.getByRole("dialog", { name: "反馈已提交" }),
    ).toBeVisible();
    const urls: string[] = [];
    for (const label of ["提交 GitHub 问题", "现有未解决问题"]) {
      const popup = page.waitForEvent("popup");
      await page.getByRole("link", { name: label, exact: true }).click();
      const opened = await popup;
      await opened.waitForLoadState("domcontentloaded");
      urls.push(opened.url());
      expect(await opened.evaluate(() => window.opener)).toBeNull();
      await opened.close();
      await expect(
        page.getByRole("dialog", { name: "反馈已提交" }),
      ).toBeVisible();
    }
    const issue = new URL(urls[0]);
    expect(issue.pathname).toBe("/openai/codex/issues/new");
    expect(issue.searchParams.get("template")).toBe("2-extension.yml");
    expect(issue.searchParams.get("steps")).toBe(
      "Feedback ID: feedback ID & exact",
    );
    expect(urls[1]).toBe("https://github.com/openai/codex/issues");
    await writeFile(
      info.outputPath("external-links.json"),
      JSON.stringify(urls, null, 2),
    );
    await page.screenshot({
      path: info.outputPath("product-external-links.png"),
    });
    expect(f.calls).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("receipt replacement during copy and clipboard error keep the original report workflow", async ({
  page,
}, info) => {
  test.skip(!reference, "Original VSIX reference required");
  test.setTimeout(60000);
  await page.setViewportSize({ width: 700, height: 844 });
  const f = await setup(page, false),
    native = await page.context().newPage();
  native.on("pageerror", (e) =>
    f.errors.push("Native reference: " + e.message),
  );
  const releases: (() => void)[] = [];
  try {
    await native.setViewportSize({ width: 700, height: 844 });
    for (const target of [native, page])
      await target.route(
        "**/api/session/api/codex/feedback/upload",
        async (route) => {
          await new Promise<void>((r) => releases.push(r));
          await route.fulfill({ json: { threadId: "receipt-B" } });
        },
      );
    await nativeFeedbackUpload(native, reference!, 700, "dark", "ux-0");
    await installNativeFeedbackClipboard(native);
    await page.evaluate(async () => {
      const w = window as any;
      w.copyWrites = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (value: string) =>
            new Promise<void>((resolve, reject) => {
              w.copyWrites.push(value);
              w.finishCopy = resolve;
              w.failCopy = reject;
            }),
        },
      });
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
    await expect.poll(() => releases.length).toBe(2);
    for (const target of [native, page]) {
      await target.getByRole("button", { name: "复制", exact: true }).click();
      await expect(
        target.getByRole("button", { name: "复制", exact: true }),
      ).toHaveAttribute("aria-busy", "true");
    }
    releases.forEach((r) => r());
    for (const target of [native, page]) {
      await expect(target.getByRole("dialog").locator("code")).toHaveText(
        "receipt-B",
      );
      await target.evaluate(() => (window as any).finishCopy());
      await expect(
        target.getByRole("button", { name: "已复制", exact: true }),
      ).toBeVisible();
      expect(await target.evaluate(() => (window as any).copyWrites)).toEqual([
        "ux-0",
      ]);
    }
    const pair = {
      native: await reportMetrics(native),
      product: await reportMetrics(page),
    };
    await writeFile(
      info.outputPath("changed-receipt-copy.json"),
      JSON.stringify(pair, null, 2),
    );
    expect(pair.product).toEqual(pair.native);
    for (const [name, target] of [
      ["native", native],
      ["product", page],
    ] as const) {
      await target.bringToFront();
      if (
        await target
          .getByRole("button", { name: "已复制", exact: true })
          .count()
      ) {
        // Capture both copied states with the same footer focus, avoiding cross-page tooltip blur.
        await target
          .getByRole("dialog")
          .getByRole("button", { name: "关闭", exact: true })
          .focus();
      }
      await target.screenshot({
        path: info.outputPath(`${name}-changed-receipt-copied.png`),
      });
    }
    for (const target of [native, page]) {
      await expect(
        target.getByRole("button", { name: "复制", exact: true }),
      ).toBeVisible({ timeout: 3500 });
      await target.getByRole("button", { name: "复制", exact: true }).click();
      await expect(
        target.getByRole("button", { name: "复制", exact: true }),
      ).toHaveAttribute("aria-busy", "true");
      await expect
        .poll(() => target.evaluate(() => (window as any).copyWrites.length))
        .toBe(2);
      await target.evaluate(() =>
        (window as any).failCopy(new Error("isolated clipboard denial")),
      );
      await expect(
        target.getByRole("button", { name: "复制", exact: true }),
      ).not.toHaveAttribute("aria-busy", "true");
    }
    expect(
      await native.evaluate(() => (window as any).clipboardErrors),
    ).toEqual([
      {
        titleId: "clipboard.copyError.title",
        descriptionId: "clipboard.copyError.description",
        id: "copy-to-clipboard-error",
      },
    ]);
    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "无法复制到剪贴板",
    );
    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "内容未复制。请在 ChatGPT 处于焦点时重试",
    );
    for (const [name, target] of [
      ["native", native],
      ["product", page],
    ] as const) {
      await target.bringToFront();
      if (
        await target
          .getByRole("button", { name: "已复制", exact: true })
          .count()
      ) {
        // Capture both copied states with the same footer focus, avoiding cross-page tooltip blur.
        await target
          .getByRole("dialog")
          .getByRole("button", { name: "关闭", exact: true })
          .focus();
      }
      await target.screenshot({
        path: info.outputPath(`${name}-clipboard-error.png`),
      });
    }
    // Native clipboard error notices also outlive the dialog that initiated the write.
    await page.evaluate(async () => {
      const path =
        "/src/session-mode/features/native-notifications/service.tsx";
      const url =
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
      (await import(url)).nativeNotifications.closeAll();
    });
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    for (const target of [native, page]) {
      await target.getByRole("button", { name: "复制", exact: true }).click();
      await expect(
        target.getByRole("button", { name: "复制", exact: true }),
      ).toHaveAttribute("aria-busy", "true");
      await expect
        .poll(() => target.evaluate(() => (window as any).copyWrites.length))
        .toBe(3);
      await target
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await expect(target.getByRole("dialog")).toHaveCount(0);
      await target.evaluate(() =>
        (window as any).failCopy(new Error("isolated late clipboard denial")),
      );
    }
    await expect
      .poll(() => native.evaluate(() => (window as any).clipboardErrors.length))
      .toBe(2);
    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "无法复制到剪贴板",
    );
    await page.screenshot({
      path: info.outputPath("product-clipboard-error-after-close.png"),
    });
    expect(f.calls).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    releases.forEach((r) => r());
    await native.close();
    await f.close();
  }
});

test("same-email workspace switch releases an upload report and ignores its old receipt", async ({
  page,
}) => {
  test.setTimeout(60000);
  const f = await setup(page, false);
  let release: (() => void) | undefined;
  let requests = 0;
  try {
    await page.route(
      "**/api/session/api/codex/feedback/upload",
      async (route) => {
        requests++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        await route.fulfill({ json: { threadId: "old-workspace-feedback" } });
      },
    );
    await page.evaluate(async () => {
      const path = "/src/session-mode/components/codex/stores/index.ts";
      const url =
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
      const { useCodexStore } = await import(url);
      useCodexStore.setState({
        account: {
          type: "chatgpt",
          email: "fixture@example.invalid",
          planType: "pro",
        },
        accountNamespace: "workspace-A",
      });
    });
    await page
      .locator(".session-codex-composer [contenteditable=true]")
      .first()
      .fill("/feedback");
    await page
      .locator('[data-composer-suggestions="commands"]')
      .getByRole("option", { name: /\/feedback/ })
      .click();
    await page.getByRole("radio", { name: "错误", exact: true }).click();
    await page
      .getByRole("textbox", { name: "填写详情（必填）" })
      .fill("Isolated workspace validation");
    await page.getByRole("checkbox").uncheck();
    await page.getByRole("button", { name: "提交", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "正在上传反馈" }),
    ).toBeVisible();
    await expect.poll(() => requests).toBe(1);
    await page.evaluate(async () => {
      const path = "/src/session-mode/components/codex/stores/index.ts";
      const url =
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
      const { useCodexStore } = await import(url);
      useCodexStore.setState({ accountNamespace: "workspace-B" });
    });
    await expect(
      page.getByRole("dialog", { name: "正在上传反馈" }),
    ).not.toBeVisible();
    release!();
    release = undefined;
    await page.waitForTimeout(300);
    await expect(
      page.getByText("old-workspace-feedback", { exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "查看上传结果", exact: true }),
    ).not.toBeVisible();
    expect(requests).toBe(1);
    expect(f.calls).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    release?.();
    await f.close();
  }
});
