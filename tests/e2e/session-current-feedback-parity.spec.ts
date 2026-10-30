import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { liveStream } from "./session-sse-fixture";
import { currentFeedbackReference } from "./session-current-feedback-reference";
async function reportMetrics(target: any) {
  await target.bringToFront();
  // Both the original dialog and the adaptation measure their committed body.
  // Compare after the browser has delivered ResizeObserver and the next paint.
  await target.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  // Compare the same explicit keyboard-focus branch of the unchanged button.
  await target
    .getByRole("dialog")
    .getByRole("button", { name: "复制", exact: true })
    .focus();
  await target.keyboard.press("Tab");
  return target.getByRole("dialog").evaluate((e: HTMLElement) => {
    for (const animation of e.getAnimations({ subtree: true })) {
      const end = animation.effect?.getComputedTiming().endTime;
      animation.pause();
      // Finish finite dialog resize/entry transitions; only freeze spinners at zero.
      // Resetting a resize to zero compares the previous upload height with new text.
      animation.currentTime =
        typeof end === "number" && Number.isFinite(end) ? end : 0;
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

const outcomes = [
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
    error: "isolated uncertain receipt",
    title: "反馈上传未确认",
  },
] as const;
for (const width of [700, 393])
  for (const theme of ["dark", "light"] as const)
    test(`current original feedback six states and background completion (${width} ${theme})`, async ({
      page,
      baseURL,
    }, info) => {
      test.setTimeout(90000);
      const reference = process.env.CODEX_GOAL_REFERENCE_URL;
      if (!reference)
        throw new Error("Current unchanged VSIX reference URL required");
      await page.setViewportSize({ width, height: 852 });
      const stream = await liveStream(page, baseURL!),
        f = await setup(page, false),
        native = await page.context().newPage();
      const errors: string[] = [];
      native.on("pageerror", (e) => errors.push(e.message));
      const reads: unknown[] = [],
        writes: unknown[] = [];
      let outcome: (typeof outcomes)[number] = outcomes[0],
        release: (() => void) | undefined;
      await page.route(
        "**/api/session/api/codex/feedback/preflight",
        async (route) => {
          reads.push(route.request().postDataJSON());
          await route.fulfill({
            json: {
              reason: null,
              runtimeInstance: "feedback-native-fixture",
              provenance: {
                config: "fresh",
                requirements: "fresh",
                account: "native",
                workspace: "fresh",
              },
            },
          });
        },
      );
      await page.route(
        "**/api/session/api/codex/feedback/upload",
        async (route) => {
          writes.push(route.request().postDataJSON());
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          await route.fulfill({
            status: outcome.error ? 503 : 200,
            json: outcome.error
              ? { error: outcome.error }
              : { threadId: "feedback-result" },
          });
        },
      );
      try {
        await page.evaluate(async (theme) => {
          const path = "/src/session-mode/stores/settings/useThemeStore.ts";
          const { useThemeStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          useThemeStore.getState().setTheme(theme);
        }, theme);
        const editor = page
          .locator(".session-codex-composer [contenteditable=true]")
          .first();
        for (const state of outcomes) {
          outcome = state;
          release = undefined;
          await page.evaluate(async () => {
            const path =
              "/src/session-mode/features/native-feedback/service.ts";
            const service = await import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
            service.feedbackUploads.clear();
          });
          await currentFeedbackReference(
            native,
            reference,
            width,
            theme,
            "ux-0",
          );
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
          await expect.poll(() => Boolean(release)).toBe(true);
          if (state.name === "uploaded") {
            const pair = {
              native: await reportMetrics(native),
              product: await reportMetrics(page),
            };
            await writeFile(
              info.outputPath("current-uploading.json"),
              JSON.stringify(pair, null, 2),
            );
            expect(pair.product).toEqual(pair.native);
          }
          release!();
          await native.evaluate(
            (error) =>
              error
                ? (window as any).failCurrentFeedback(error)
                : (window as any).finishCurrentFeedback("feedback-result"),
            state.error,
          );
          await expect(
            page.getByRole("dialog", { name: state.title }),
          ).toBeVisible();
          await expect(
            native.getByRole("dialog", { name: state.title }),
          ).toBeVisible();
          const pair = {
            native: await reportMetrics(native),
            product: await reportMetrics(page),
          };
          await writeFile(
            info.outputPath(`current-${state.name}.json`),
            JSON.stringify(pair, null, 2),
          );
          expect(pair.product).toEqual(pair.native);
          await page.screenshot({
            path: info.outputPath(`product-${state.name}.png`),
          });
          await native.screenshot({
            path: info.outputPath(`native-${state.name}.png`),
          });
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "关闭对话框", exact: true })
            .click();
          await expect(page.getByRole("dialog")).toHaveCount(0);
        }
        outcome = outcomes[0];
        release = undefined;
        await page.evaluate(async () => {
          const path = "/src/session-mode/features/native-feedback/service.ts";
          const service = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          service.feedbackUploads.clear();
        });
        await currentFeedbackReference(native, reference, width, theme, "ux-0");
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
        await expect.poll(() => Boolean(release)).toBe(true);
        for (const target of [native, page])
          await target
            .getByRole("dialog")
            .getByRole("button", { name: "关闭对话框", exact: true })
            .click();
        release!();
        await native.evaluate(() =>
          (window as any).finishCurrentFeedback("feedback-result"),
        );
        for (const target of [native, page]) {
          const action = target.getByRole("button", {
            name: "查看上传内容",
            exact: true,
          });
          await expect(action).toHaveCount(1);
          await expect(action).toBeVisible();
          await action.click();
          await expect(
            target.getByRole("dialog", { name: "反馈已提交" }),
          ).toBeVisible();
        }
        const reopened = {
          native: await reportMetrics(native),
          product: await reportMetrics(page),
        };
        await writeFile(
          info.outputPath("background-reopened.json"),
          JSON.stringify(reopened, null, 2),
        );
        expect(reopened.product).toEqual(reopened.native);
        expect(reads).toHaveLength(12);
        expect(writes).toHaveLength(6);
        expect(
          writes.every(
            (v: any) =>
              v.threadId === "ux-0" &&
              v.reason === "Captured diagnostics" &&
              v.includeLogs === false,
          ),
        ).toBe(true);
        expect(errors).toEqual([]);
        expect(f.errors).toEqual([]);
        await writeFile(
          info.outputPath("six-state-workflow.json"),
          JSON.stringify(
            {
              width,
              theme,
              reads,
              writes,
              referenceVersion: "26.51007.21434",
              boundary:
                "Real slash form/preflight/HTTP upload and unchanged original public coordinator. Uploads are isolated, no actual feedback service or account touched.",
            },
            null,
            2,
          ),
        );
      } finally {
        release?.();
        await native.close();
        await f.close();
        await stream.close();
      }
    });
