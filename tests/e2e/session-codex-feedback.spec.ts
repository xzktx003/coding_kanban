import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;

async function nativeFeedback(
  page: Page,
  width: number,
  theme: string,
  language = "zh",
) {
  await renderNativeMarkdownReference(page, reference!, "", theme, width);
  await page.evaluate(async (language) => {
    const S = await import(
        /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
      ),
      Auth = await import(
        /* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js"
      ),
      F = await import(
        /* @vite-ignore */ "./native/assets/feedback-submission-dialog-12f6f595aa07.js"
      ),
      Core = await import(
        /* @vite-ignore */ "./native/assets/app-initial-3de816c37e10.js"
      );
    const w = window as any,
      R = w.nativeModules.React;
    w.feedbackSubmissions = [];
    const content = R.createElement(F.FeedbackSubmissionDialog, {
      browserTabsAvailable: false,
      documentAvailable: false,
      processMemoryDiagnosticsAvailable: false,
      onClose: () => {
        w.feedbackClosed = true;
      },
      onSubmit: (data: unknown) => {
        w.feedbackSubmissions.push(data);
        return w.feedbackDeferred
          ? new Promise((resolve) => {
              w.feedbackResolve = resolve;
            })
          : false;
      },
    });
    const localePaths: Record<string, string> = {
      ja: "./native/assets/ja-JP-cccb9b32b90a.js",
      fr: "./native/assets/fr-FR-c8896d04a499.js",
    };
    const messages = localePaths[language]
      ? (await import(/* @vite-ignore */ localePaths[language])).default
      : {};
    const localized =
      language === "zh"
        ? content
        : R.createElement(Core.cyt, { locale: language, messages }, content);
    w.renderNativeElement(S._, {
      children: R.createElement(
        Auth.Rpt.Provider,
        { value: { requiresAuth: false, isLoading: false, authMethod: null } },
        R.createElement(S.H, {}, R.createElement(Auth.ZCt, {}, localized)),
      ),
    });
  }, language);
  await expect(page.getByRole("dialog")).toBeVisible();
}
/** The original generic form may await its callback; the real host handoff is tested separately. */
async function openAsyncFeedback(page: Page) {
  await page.evaluate(async () => {
    const w = window as any;
    const Rm = await import(w.__sessionFixtureDependency("react.js"));
    const Dm = await import(
      w.__sessionFixtureDependency("react-dom_client.js")
    );
    const R = Rm.default ?? Rm;
    const path =
      "/src/session-mode/components/codex/composer/NativeFeedbackDialog.tsx";
    const url =
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { NativeFeedbackDialog } = await import(url);
    const slashPath =
      "/src/session-mode/components/codex/composer/slashCommands.ts";
    const slashUrl =
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === slashPath)?.name ??
      slashPath;
    const { submitSlashFeedback } = await import(slashUrl);
    if (!w.asyncFeedbackRoot) {
      const host = document.createElement("div");
      document.querySelector(".session-mode")!.appendChild(host);
      w.asyncFeedbackRoot = (Dm.default ?? Dm).createRoot(host);
    }
    w.asyncFeedbackRoot.render(
      R.createElement(NativeFeedbackDialog, {
        key: String(++w.asyncFeedbackSequence || (w.asyncFeedbackSequence = 1)),
        threadId: "ux-0",
        submitFeedback: submitSlashFeedback,
        onClose: () => w.asyncFeedbackRoot.render(null),
        returnFocus: () =>
          document
            .querySelector<HTMLElement>(
              ".session-codex-composer [contenteditable=true]",
            )
            ?.focus(),
      }),
    );
  });
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function metrics(page: Page) {
  return page.getByRole("dialog").evaluate((e) => {
    const root = e.getBoundingClientRect();
    const css = (n: Element) => {
      const s = getComputedStyle(n);
      return Object.fromEntries(
        [
          "fontFamily",
          "fontSize",
          "fontWeight",
          "lineHeight",
          "letterSpacing",
          "color",
          "backgroundColor",
          "padding",
          "border",
          "borderRadius",
          "opacity",
          "boxShadow",
          "backdropFilter",
        ].map((k) => [
          k,
          k === "boxShadow"
            ? s.boxShadow
                .split(/,(?![^()]*\))/)
                .filter(
                  (v) =>
                    !v.trim().startsWith("rgba(0, 0, 0, 0) 0px 0px 0px 0px"),
                )
                .map((v) => v.trim())
                .join(", ")
            : (s as any)[k],
        ]),
      );
    };
    return {
      root: { width: root.width, height: root.height, css: css(e) },
      nodes: [
        ...e.querySelectorAll("h2,button,textarea,label"),
        e.querySelector('a[href*="5722486"]')!.parentElement!,
      ].map((n) => {
        const r = n.getBoundingClientRect();
        return {
          tag: n.tagName,
          role: n.getAttribute("role"),
          text: n.textContent || n.getAttribute("aria-label"),
          rect: {
            x: r.x - root.x,
            y: r.y - root.y,
            width: r.width,
            height: r.height,
          },
          css: css(n),
          svg: n.querySelector("svg")?.outerHTML,
          icon: n.querySelector("svg")
            ? {
                viewBox: n.querySelector("svg")!.getAttribute("viewBox"),
                paths: [...n.querySelectorAll("svg path")].map((p) =>
                  Object.fromEntries(
                    [...p.attributes].map((a) => [a.name, a.value]),
                  ),
                ),
                width: parseFloat(
                  getComputedStyle(n.querySelector("svg")!).width,
                ),
                height: parseFloat(
                  getComputedStyle(n.querySelector("svg")!).height,
                ),
                animation:
                  n.textContent === "提交"
                    ? (() => {
                        const spinner = n.querySelector("svg")!.parentElement!,
                          style = getComputedStyle(spinner);
                        return {
                          duration: style.animationDuration,
                          timing: style.animationTimingFunction,
                          iterations: style.animationIterationCount,
                          startTime:
                            spinner.getAnimations()[0]?.startTime ?? null,
                        };
                      })()
                    : null,
              }
            : null,
        };
      }),
    };
  });
}
for (const width of [390, 700])
  for (const theme of ["dark", "light"]) {
    test(`generic feedback callback matches the native form and captured upload (${width} ${theme})`, async ({
      page,
    }, info) => {
      test.skip(!reference, "Original VSIX reference required");
      test.setTimeout(60000);
      await page.setViewportSize({ width, height: 844 });
      const f = await setup(page, false),
        native = await page.context().newPage();
      try {
        await native.setViewportSize({ width, height: 844 });
        await nativeFeedback(native, width, theme);
        await native.screenshot({
          path: info.outputPath("native-feedback.png"),
        });
        const original = await native.getByRole("dialog").evaluate((e) => ({
          html: e.outerHTML,
          styles: [...e.querySelectorAll("h2,button,textarea,label")].map(
            (n) => {
              const s = getComputedStyle(n),
                r = n.getBoundingClientRect();
              return {
                text: n.textContent || n.getAttribute("aria-label"),
                role: n.getAttribute("role"),
                tag: n.tagName,
                rect: { x: r.x, y: r.y, width: r.width, height: r.height },
                css: {
                  font: s.font,
                  color: s.color,
                  background: s.backgroundColor,
                  padding: s.padding,
                  border: s.border,
                  borderRadius: s.borderRadius,
                },
              };
            },
          ),
        }));
        await writeFile(
          info.outputPath("native-form.json"),
          JSON.stringify(original, null, 2),
        );
        await page.evaluate(async (theme) => {
          const path = "/src/session-mode/stores/settings/useThemeStore.ts";
          const url =
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
          const { useThemeStore } = await import(url);
          useThemeStore.getState().setTheme(theme);
        }, theme);
        const editor = page
          .locator(".session-codex-composer [contenteditable=true]")
          .first();
        await openAsyncFeedback(page);
        const form = page.getByRole("dialog");
        await expect(
          form.getByRole("radio", { name: "错误", exact: true }),
        ).toBeVisible();
        await expect(form.getByRole("radio")).toHaveCount(6);
        await expect(
          form.getByRole("button", { name: "提交", exact: true }),
        ).toBeDisabled();
        await page.screenshot({
          path: info.outputPath("product-feedback.png"),
        });
        const pair = {
          native: await metrics(native),
          product: await metrics(page),
        };
        await writeFile(
          info.outputPath("form-metrics.json"),
          JSON.stringify(pair, null, 2),
        );
        await native
          .getByRole("radio", { name: "结果异常", exact: true })
          .click();
        await form
          .getByRole("radio", { name: "结果异常", exact: true })
          .click();
        await native
          .getByRole("textbox")
          .fill("Details from the captured thread");
        await form
          .getByRole("textbox")
          .fill("Details from the captured thread");
        await writeFile(
          info.outputPath("selected-icons.json"),
          JSON.stringify(
            { native: await metrics(native), product: await metrics(page) },
            null,
            2,
          ),
        );
        expect(pair.product.root).toEqual(pair.native.root);
        const nativeNodes = pair.native.nodes;
        const productNodes = pair.product.nodes;
        expect(productNodes.map(({ svg, ...n }) => n)).toEqual(
          nativeNodes.map(({ svg, ...n }) => n),
        );

        const selected = {
          native: await metrics(native),
          product: await metrics(page),
        };
        await writeFile(
          info.outputPath("selected-form.json"),
          JSON.stringify(selected, null, 2),
        );
        expect(selected.product.root).toEqual(selected.native.root);
        expect(selected.product.nodes.map(({ svg, ...n }) => n)).toEqual(
          selected.native.nodes.map(({ svg, ...n }) => n),
        );
        await native.getByRole("checkbox").uncheck();
        await form.getByRole("checkbox").uncheck();
        const uploads: unknown[] = [];
        let release!: (status: number) => void;
        await page.route(
          "**/api/session/api/codex/feedback/upload",
          async (route) => {
            uploads.push(route.request().postDataJSON());
            const status = await new Promise<number>((r) => {
              release = r;
            });
            await route.fulfill({
              status,
              json:
                status === 200
                  ? { threadId: "feedback-fixture" }
                  : { error: "Isolated upload failure" },
            });
          },
        );
        await native.evaluate(() => {
          (window as any).feedbackDeferred = true;
        });
        await native.getByRole("button", { name: "提交", exact: true }).click();
        await form.getByRole("button", { name: "提交", exact: true }).click();
        await expect.poll(() => uploads.length).toBe(1);
        await expect(
          form.getByRole("button", { name: "提交", exact: true }),
        ).toHaveAttribute("aria-busy", "true");
        await form.getByRole("textbox").press("Meta+Enter");
        await native.getByRole("textbox").press("Meta+Enter");
        expect(
          await native.evaluate(
            () => (window as any).feedbackSubmissions.length,
          ),
        ).toBe(1);
        const nativeSubmission = await native.evaluate(
          () => (window as any).feedbackSubmissions[0],
        );
        expect(uploads[0]).toEqual({
          classification: nativeSubmission.classification,
          reason: nativeSubmission.description,
          threadId: "ux-0",
          includeLogs: nativeSubmission.includeLogs,
        });
        expect(uploads).toEqual([
          {
            classification: "bad-result",
            reason: "Details from the captured thread",
            threadId: "ux-0",
            includeLogs: false,
          },
        ]);
        const pending = {
          native: await metrics(native),
          product: await metrics(page),
        };
        await writeFile(
          info.outputPath("pending-form.json"),
          JSON.stringify(pending, null, 2),
        );
        expect(pending.product.root).toEqual(pending.native.root);
        expect(pending.product.nodes.map(({ svg, ...n }) => n)).toEqual(
          pending.native.nodes.map(({ svg, ...n }) => n),
        );
        await native.screenshot({
          path: info.outputPath("native-pending.png"),
        });
        await page.screenshot({ path: info.outputPath("product-pending.png") });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await native.emulateMedia({ reducedMotion: "reduce" });
        for (const target of [native, page])
          await expect
            .poll(() =>
              target
                .getByRole("button", { name: "提交", exact: true })
                .evaluate(
                  (e) =>
                    e.querySelector("svg")!.parentElement!.getAnimations()
                      .length,
                ),
            )
            .toBe(0);
        await page.screenshot({
          path: info.outputPath("product-reduced-pending.png"),
        });
        await native.evaluate(() => (window as any).feedbackResolve(false));
        release(503);
        await expect(
          form.getByRole("button", { name: "提交", exact: true }),
        ).not.toHaveAttribute("aria-busy", "true");
        await expect(form.getByRole("textbox")).toHaveValue(
          "Details from the captured thread",
        );
        await expect(
          form.getByRole("radio", { name: "结果异常", exact: true }),
        ).toHaveAttribute("aria-checked", "true");
        await form.getByRole("button", { name: "提交", exact: true }).click();
        await expect.poll(() => uploads.length).toBe(2);
        release(200);
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(editor).toBeFocused();
        await openAsyncFeedback(page);
        await page.keyboard.press("Escape");
        await native.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(
          await native.evaluate(() => (window as any).feedbackClosed),
        ).toBe(true);
        await openAsyncFeedback(page);
        const beforeBack = page.url();
        await page.goBack();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(page.url()).toBe(beforeBack);
        expect(f.calls).toEqual([]);
        expect(
          f.fixture.calls.filter((c) =>
            /\/turn\/(start|steer|interrupt)|\/thread\/resume|\/stop$/.test(
              c.path,
            ),
          ),
        ).toEqual([]);
        expect(f.errors).toEqual([]);
      } finally {
        await native.close();
        await f.close();
      }
    });
  }

for (const language of ["en", "ja", "fr"]) {
  test(`feedback uses original ${language} text and layout`, async ({
    page,
  }, info) => {
    test.skip(!reference, "Original VSIX reference required");
    await page.setViewportSize({ width: 700, height: 844 });
    const f = await setup(page, false),
      native = await page.context().newPage();
    try {
      await native.setViewportSize({ width: 700, height: 844 });
      await nativeFeedback(native, 700, "dark", language);
      await page.evaluate(async (language) => {
        const path = "/src/session-mode/stores/settings/useLocaleStore.ts";
        const url =
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
        const { useLocaleStore } = await import(url);
        useLocaleStore.getState().setLocale(language);
      }, language);
      await page
        .locator(".session-codex-composer [contenteditable=true]")
        .first()
        .fill("/feedback");
      await page
        .locator('[data-composer-suggestions="commands"]')
        .getByRole("option", { name: /\/feedback/ })
        .click();
      const pair = {
        native: await metrics(native),
        product: await metrics(page),
      };
      await writeFile(
        info.outputPath("localized-form.json"),
        JSON.stringify(pair, null, 2),
      );
      await page.screenshot({ path: info.outputPath("product-localized.png") });
      await native.screenshot({
        path: info.outputPath("native-localized.png"),
      });
      expect(pair.product.root).toEqual(pair.native.root);
      expect(pair.product.nodes.map(({ svg, ...n }) => n)).toEqual(
        pair.native.nodes.map(({ svg, ...n }) => n),
      );
      await page.keyboard.press("Escape");
      expect(f.calls).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      await native.close();
      await f.close();
    }
  });
}

test("a dismissed feedback upload keeps its owner and cannot close the next session's form", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 700, height: 844 });
  const f = await setup(page, false);
  let release!: () => void;
  const uploads: unknown[] = [];
  try {
    await page.route(
      "**/api/session/api/codex/feedback/upload",
      async (route) => {
        uploads.push(route.request().postDataJSON());
        await new Promise<void>((r) => {
          release = r;
        });
        await route.fulfill({ json: { threadId: "feedback-A" } });
      },
    );
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    const open = async () => {
      await editor.fill("/feedback");
      await page
        .locator('[data-composer-suggestions="commands"]')
        .getByRole("option", { name: /\/feedback/ })
        .click();
    };
    await open();
    await page.getByRole("radio", { name: "错误", exact: true }).click();
    await page
      .getByRole("textbox", { name: "填写详情（必填）" })
      .fill("A captured details");
    await page.getByRole("button", { name: "提交", exact: true }).click();
    await expect.poll(() => uploads.length).toBe(1);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator('[role=tab][data-tab-key="codex:ux-1"]').click();
    await open();
    const form = page.getByRole("dialog");
    await form.getByRole("textbox").fill("B unsubmitted feedback");
    release();
    await page.waitForTimeout(400);
    await expect(form).toBeVisible();
    await expect(form.getByRole("textbox")).toHaveValue(
      "B unsubmitted feedback",
    );
    expect(uploads).toEqual([
      {
        classification: "bug",
        reason: "A captured details",
        threadId: "ux-0",
        includeLogs: true,
      },
    ]);
    await page.screenshot({ path: info.outputPath("late-owner-feedback.png") });
    expect(f.calls).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    release?.();
    await f.close();
  }
});
