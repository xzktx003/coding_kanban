import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const output = resolve(
  ".dev-runtime/session-rail-theme-20261027",
  process.env.RAIL_EVIDENCE_PHASE ?? "latest",
);
const diff =
  "diff --git a/file.py b/file.py\n--- a/file.py\n+++ b/file.py\n@@ -1 +1,2 @@\n-old\n+new\n+more\n";
const messages = ["检查当前改动并运行相关测试", "修复失败项并说明结果"];
const goal = {
  objective: "完成当前改动的检查",
  status: "active",
  tokensUsed: 1200,
  tokenBudget: 5000,
  timeUsedSeconds: 65,
  createdAt: 1,
  updatedAt: 2,
};

async function theme(page: Page, dark: boolean) {
  await page.evaluate((dark) => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
    for (const element of document.querySelectorAll<HTMLElement>(".session-mode")) {
      element.classList.toggle("dark", dark);
      element.classList.toggle("light", !dark);
      element.style.setProperty("color-scheme", dark ? "dark" : "light");
    }
    const tokens = {
      "--vscode-font-family": "Arial, sans-serif",
      "--vscode-font-size": "13px",
      "--vscode-font-weight": "400",
      "--vscode-editor-font-family": "monospace",
      "--vscode-editor-font-size": "12px",
      "--vscode-editor-font-weight": "400",
      "--vscode-editor-background": dark ? "#20211d" : "#ffffff",
      "--vscode-sideBar-background": dark ? "#282a23" : "#f5f5f3",
      "--vscode-foreground": dark ? "#cccccc" : "#3b3b3b",
      "--vscode-descriptionForeground": dark ? "#858585" : "#717171",
      "--vscode-textLink-foreground": dark ? "#a9c5de" : "#006ab1",
      "--vscode-textLink-activeForeground": dark ? "#a9c5de" : "#006ab1",
      "--vscode-textPreformat-background": dark ? "#42443a" : "#f0f0ed",
      "--vscode-textPreformat-foreground": dark ? "#cccccc" : "#3b3b3b",
      "--vscode-dropdown-background": dark ? "#282a23" : "#f5f5f3",
      "--vscode-dropdown-foreground": dark ? "#cccccc" : "#3b3b3b",
      "--vscode-menu-background": dark ? "#282a23" : "#f5f5f3",
      "--vscode-button-foreground": "#ffffff",
      "--vscode-gitDecoration-addedResourceForeground": dark
        ? "#81b88b"
        : "#587c0c",
      "--vscode-gitDecoration-deletedResourceForeground": dark
        ? "#c74e39"
        : "#ad0707",
    };
    for (const [name, value] of Object.entries(tokens))
      document.documentElement.style.setProperty(name, value);
    document.body.style.background = tokens["--vscode-editor-background"];
    document.documentElement.style.fontSize = "16px";
    (window as any).railHostTokens = tokens;
  }, dark);
}

for (const dark of [false, true])
  for (const coexist of [false, true]) {
    test(`${dark ? "dark" : "light"} real diff and queued rows${coexist ? " with notice and Goal" : ""}`, async ({
      page,
      context,
    }) => {
      test.setTimeout(90_000);
      const reference = process.env.CODEX_GOAL_REFERENCE_URL;
      test.skip(!reference, "Official read-only reference URL required");
      await mkdir(output, { recursive: true });
      const key = `${dark ? "dark" : "light"}-${coexist ? "coexist" : "base"}`;
      const queueMessages = coexist
        ? Array.from({ length: 12 }, (_, i) => `检查第 ${i + 1} 条排队消息`)
        : messages;
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const fixture = await installSessionUxFixture(page);
      await page.route(/\/thread\/goal\/get$/, (route) =>
        route.fulfill({
          json: { goal: coexist ? { ...goal, threadId: "ux-0" } : null },
        }),
      );
      Object.assign(fixture.threads[0], {
        status: { type: "active" },
        turns: [
          { id: "rail-turn", status: "inProgress", startedAt: 1, items: [] },
        ],
      });
      await page.route("**/api/session/followups?**", (route) =>
        route.fulfill({
          json: {
            revision: 1,
            paused: null,
            items: queueMessages.map((text, i) => ({
              id: `q${i}`,
              threadId: "ux-0",
              text,
              images: [],
              parameters: {},
              mode: "queue",
              status: "queued",
              createdAt: i + 1,
              fingerprint: `q${i}`,
            })),
          },
        }),
      );
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page.locator(".session-native-composer").waitFor();
      const dependencies = await page.evaluate(() => ({
        react: (window as any).__sessionFixtureDependency("react.js"),
        client: (window as any).__sessionFixtureDependency(
          "react-dom_client.js",
        ),
      }));
      await page.route("**/rail-theme-fixture", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="fixture" class="session-mode accent-default"><div id="composer-root"></div></main></body></html>',
        }),
      );
      await page.goto("/rail-theme-fixture");
      await page.evaluate(async ({ react, client }) => {
        const refresh = (await import("/@react-refresh")).default;
        refresh.injectIntoGlobalHook(window);
        (window as any).$RefreshReg$ = () => {};
        (window as any).$RefreshSig$ = () => (type: unknown) => type;
        (window as any).__vite_plugin_react_preamble_installed__ = true;
        const R = (await import(react)).default;
        const renderer = (await import(client)).default;
        for (const file of [
          "App.css",
          "session-theme.css",
          "session-composer.css",
          "session-composer-v2.css",
          "session-composer-compact.css",
        ])
          await import(`/src/session-mode/${file}`);
        const { i18n, initializeSessionI18n } = await import(
          "/src/session-mode/lib/i18n.ts"
        );
        await initializeSessionI18n();
        await i18n.changeLanguage("zh");
        const { TooltipProvider } =
          await import("/src/session-mode/components/ui/tooltip.tsx");
        const { Composer } =
          await import("/src/session-mode/components/codex/composer/Composer.tsx");
        renderer
          .createRoot(document.getElementById("composer-root"))
          .render(
            R.createElement(TooltipProvider, null, R.createElement(Composer)),
          );
      }, dependencies);
      await page.locator(".session-native-composer").waitFor();
      await seedSessionUx(page);
      await page.evaluate(
        async ({ diff, goal, coexist }) => {
          const mounted = (path: string) =>
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
          const { useCodexStore } = await import(
            mounted(
              "/src/session-mode/components/codex/stores/useCodexStore.ts",
            )
          );
          const { useAgentCenterStore } = await import(
            mounted("/src/session-mode/stores/useAgentCenterStore.ts")
          );
          useAgentCenterStore.setState({
            cards: [
              {
                kind: "codex",
                id: "ux-0",
                cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
              },
            ],
            currentAgentCardId: "ux-0",
            currentAgentCardKind: "codex",
            cardsViewMode: "solo",
          });
          (window as any).seedRailState = () =>
            useCodexStore.setState({
              currentTurnId: "rail-turn",
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
                    params: { threadId: "ux-0", turnId: "rail-turn", diff },
                  },
                ],
              },
              goalMap: coexist ? { "ux-0": { ...goal, threadId: "ux-0" } } : {},
            });
          (window as any).seedRailState();
          if (coexist) {
            const { useThreadModelStore } = await import(
              mounted("/src/session-mode/stores/useThreadModelStore.ts")
            );
            const old = useThreadModelStore.getState().threads["ux-0"];
            useThreadModelStore.setState({
              threads: {
                ...useThreadModelStore.getState().threads,
                "ux-0": {
                  ...old,
                  notice: {
                    id: 1,
                    from: "fixture-model",
                    to: "fixture-next",
                    dismissed: false,
                  },
                },
              },
            });
          }
        },
        { diff, goal, coexist },
      );
      await theme(page, dark);
      const native = await context.newPage();
      native.on("pageerror", (e) => errors.push(`native: ${e.message}`));
      await native.setViewportSize({ width: 1440, height: 1100 });
      await native.emulateMedia({ reducedMotion: "reduce" });
      await native.goto(reference!);
      await native.waitForFunction(() => (window as any).nativeLoaded);
      await theme(native, dark);
      await native.evaluate(
        async ({ diff, messages, goal, coexist }) => {
          const main = await import("/assets/app-initial-fee819fe4f22.js");
          main.vf();
          const sites =
            await import("/assets/sites-end-resource-733bd1c6da06.js");
          sites.M();
          const queue =
            await import("/assets/queued-message-list-172645190dd2.js");
          const { R, root, wrap, Native } = (window as any).nativeGoalCore;
          const noop = () => {};
          (window as any).railActions = [];
          root.render(
            wrap(
              R.createElement(
                main._f,
                null,
                R.createElement(sites.j, {
                  isInProgress: true,
                  conversationId: "fixture",
                  cwd: "/fixture",
                  item: { unifiedDiff: diff },
                }),
                R.createElement(queue.QueuedMessageList, {
                  messages: messages.map((text, i) => ({
                    id: `q${i}`,
                    text,
                    context: {
                      imageAttachments: [],
                      fileAttachments: [],
                      commentAttachments: [],
                    },
                    submission: { status: "queued" },
                  })),
                  isMessagePaused: () => false,
                  isInterrupted: false,
                  isSendNowDisabled: false,
                  isResponseInProgress: true,
                  isQueueingEnabled: true,
                  hostId: "local",
                  onEditMessage: (id: string) =>
                    (window as any).railActions.push({ type: "edit", id }),
                  onDeleteMessage: noop,
                  onSendNowMessage: noop,
                  onReorderMessages: noop,
                  onQueueingChange: noop,
                  onResumeInterruptedQueue: noop,
                }),
                coexist
                  ? R.createElement(Native.Cu, {
                      conversationId: "fixture",
                      hostId: "local",
                      goal,
                    })
                  : null,
              ),
            ),
          );
        },
        { diff, messages: queueMessages, goal, coexist },
      );
      await expect(native.locator("[data-composer-rail-item]")).toHaveCount(
        coexist ? 3 : 2,
      );
      const local = page.locator(".session-native-composer");
      await expect(local.locator(".session-queue-row")).not.toHaveCount(0);
      const samples: unknown[] = [];
      for (const width of [640, 360]) {
        await page.evaluate(() => (window as any).seedRailState());
        await expect(local.locator(".codex-running-changes")).toBeVisible();
        await local.evaluate(
          (el, width) =>
            Object.assign((el as HTMLElement).style, {
              width: `${width}px`,
              maxWidth: "none",
            }),
          width,
        );
        await native.locator("#root").evaluate(
          (el, width) =>
            Object.assign((el as HTMLElement).style, {
              width: `${width}px`,
              maxWidth: "none",
              padding: "4px 0",
            }),
          width,
        );
        await local.screenshot({
          path: resolve(output, `${key}-${width}-local.png`),
        });
        await native
          .locator("#root")
          .screenshot({ path: resolve(output, `${key}-${width}-native.png`) });
        await local
          .locator("[data-composer-rail-item]")
          .first()
          .screenshot({
            path: resolve(output, `${key}-${width}-diff-local.png`),
          });
        await native
          .locator("[data-composer-rail-item]")
          .first()
          .screenshot({
            path: resolve(output, `${key}-${width}-diff-native.png`),
          });
        await local
          .locator(".session-followup-queue")
          .locator("xpath=ancestor::*[@data-composer-rail-item][1]")
          .screenshot({
            path: resolve(output, `${key}-${width}-queue-local.png`),
            animations: "allow",
          });
        await native
          .locator("[data-composer-rail-item]")
          .nth(1)
          .screenshot({
            path: resolve(output, `${key}-${width}-queue-native.png`),
            animations: "allow",
          });
        const capture = (selector: string) => {
          const host = document.querySelector(selector)!;
          const metrics = (el: Element) => {
            const s = getComputedStyle(el),
              r = el.getBoundingClientRect();
            return {
              tag: el.tagName,
              role: el.getAttribute("role"),
              text: el.textContent?.trim(),
              height: r.height,
              width: r.width,
              font: s.fontFamily,
              fontSize: s.fontSize,
              lineHeight: s.lineHeight,
              color: s.color,
              background: s.backgroundColor,
              padding: s.padding,
              gap: s.gap,
              border: s.border,
              textAlign: s.textAlign,
              borderRadius: s.borderRadius,
            };
          };
          const rail = host.querySelector("[data-composer-rail]")!;
          const items = Array.from(
            rail.querySelectorAll("[data-composer-rail-item]"),
          );
          const queue =
            host.querySelector(".session-followup-queue") ??
            host.querySelector(".vertical-scroll-fade-mask");
          const queueLayers = [];
          for (
            let element = queue as HTMLElement | null;
            element && element !== host;
            element = element.parentElement
          ) {
            const style = getComputedStyle(element);
            queueLayers.push({
              tag: element.tagName,
              className: element.className,
              opacity: style.opacity,
              background: style.backgroundColor,
              maskImage: style.maskImage,
              filter: style.filter,
              backdropFilter: style.backdropFilter,
              animationName: style.animationName,
            });
          }
          const queueContents = Array.from(queue?.querySelectorAll("*") ?? []).map(
            (element) => {
              const style = getComputedStyle(element);
              return {
                tag: element.tagName,
                className: (element as HTMLElement).className,
                opacity: style.opacity,
                background: style.backgroundColor,
                backgroundImage: style.backgroundImage,
                maskImage: style.maskImage,
                webkitMaskImage: style.getPropertyValue("-webkit-mask-image"),
                webkitMask: style.getPropertyValue("-webkit-mask"),
                filter: style.filter,
                transform: style.transform,
                animationName: style.animationName,
              };
            },
          );
          return {
            dpr: devicePixelRatio,
            tokens: (window as any).railHostTokens,
            rail: metrics(rail),
            items: items.map((el) => ({
              box: metrics(el),
              counters: Array.from(
                el.querySelectorAll(
                  ".codex-change-added,.codex-change-removed,.text-codex-git-added,.text-codex-git-deleted",
                ),
              ).map((counter) => ({
                ...metrics(counter),
                top:
                  counter.getBoundingClientRect().top -
                  el.getBoundingClientRect().top,
                left:
                  counter.getBoundingClientRect().left -
                  el.getBoundingClientRect().left,
              })),
              buttons: Array.from(el.querySelectorAll("button")).map(metrics),
              children: Array.from(el.children).map(metrics),
            })),
            queueRows: host.querySelectorAll(".session-queue-row").length,
            queueLayers,
            queueContents,
            html: rail.outerHTML,
            goal: host.querySelector(".session-thread-goal")
              ? metrics(host.querySelector(".session-thread-goal")!)
              : null,
          };
        };
        const actual = await page.evaluate(capture, ".session-native-composer");
        const expected = await native.evaluate(capture, "#root");
        const readQueueScroll = async (
          target: Page,
          root: string,
          fadeProperty: string,
        ) =>
          target.evaluate(
            ({ root, fadeProperty }) => {
              const element = document.querySelector(root) as HTMLElement;
              const style = getComputedStyle(element);
              return {
                tagName: element.tagName,
                overflowY: style.overflowY,
                scrollHeight: element.scrollHeight,
                clientHeight: element.clientHeight,
                hasOverflow: element.scrollHeight > element.clientHeight,
                dataOverflowing: element.getAttribute("data-overflowing"),
                maskImage: style.maskImage,
                webkitMaskImage: style.getPropertyValue("-webkit-mask-image"),
                animationName: style.animationName,
                animationTimeline: style.animationTimeline,
                topFade: style
                  .getPropertyValue(
                    fadeProperty === "--bottom-fade"
                      ? "--top-fade"
                      : "--session-queue-top-fade",
                  )
                  .trim(),
                bottomFade: style.getPropertyValue(fadeProperty).trim(),
              };
            },
            { root, fadeProperty },
          );
        const actualQueueScroll = await readQueueScroll(
          page,
          ".session-followup-queue .session-queue-list",
          "--session-queue-bottom-fade",
        );
        const expectedQueueScroll = await readQueueScroll(
          native,
          ".vertical-scroll-fade-mask",
          "--bottom-fade",
        );
        expect(actualQueueScroll.tagName).toBe(expectedQueueScroll.tagName);
        expect(actualQueueScroll.hasOverflow).toBe(expectedQueueScroll.hasOverflow);
        expect(actualQueueScroll.hasOverflow).toBe(coexist);
        expect(actualQueueScroll.dataOverflowing).toBe(
          coexist ? "true" : null,
        );
        expect(actualQueueScroll.maskImage).toBe(
          coexist ? expectedQueueScroll.maskImage : "none",
        );
        if (coexist) {
          expect(actualQueueScroll.topFade).toBe(expectedQueueScroll.topFade);
          expect(actualQueueScroll.bottomFade).toBe(
            expectedQueueScroll.bottomFade,
          );
        } else {
          expect(actualQueueScroll.topFade).toBe("0px");
          expect(actualQueueScroll.bottomFade).toBe("0px");
        }
        const setQueueScrollPosition = async (
          target: Page,
          root: string,
          atBottom: boolean,
        ) =>
          target.evaluate(
            async ({ root, atBottom }) => {
              const element = document.querySelector(root) as HTMLElement;
              element.scrollTop = atBottom
                ? element.scrollHeight - element.clientHeight
                : 0;
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
              );
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
              );
            },
            { root, atBottom },
          );
        if (coexist) {
          for (const atBottom of [false, true]) {
            await Promise.all([
              setQueueScrollPosition(
                page,
                ".session-followup-queue .session-queue-list",
                atBottom,
              ),
              setQueueScrollPosition(
                native,
                ".vertical-scroll-fade-mask",
                atBottom,
              ),
            ]);
            const actualOverflow = await readQueueScroll(
              page,
              ".session-followup-queue .session-queue-list",
              "--session-queue-bottom-fade",
            );
            const expectedOverflow = await readQueueScroll(
              native,
              ".vertical-scroll-fade-mask",
              "--bottom-fade",
            );
            expect(actualOverflow.hasOverflow).toBe(true);
            expect(actualOverflow.dataOverflowing).toBe("true");
            expect(actualOverflow.maskImage).toBe(expectedOverflow.maskImage);
            expect(actualOverflow.topFade).toBe(expectedOverflow.topFade);
            expect(actualOverflow.bottomFade).toBe(expectedOverflow.bottomFade);
          }
        }
        samples.push({
          width,
          actual,
          expected,
          queueScroll: {
            actual: actualQueueScroll,
            expected: expectedQueueScroll,
          },
        });
      }
      await writeFile(
        resolve(output, `${key}.json`),
        JSON.stringify(
          {
            samples,
            errors,
            nativeErrors: await native.evaluate(
              () => (window as any).nativeErrors,
            ),
            calls: fixture.calls,
          },
          null,
          2,
        ),
      );
      expect(errors).toEqual([]);
      expect(await native.evaluate(() => (window as any).nativeErrors)).toEqual(
        [],
      );
      // Real rows, not fixed-height placeholders: the first item has a separate
      // diff target and action; every queued message remains visible on desktop.
      const painted = (item: any) =>
        Object.fromEntries(
          [
            "text",
            "height",
            "width",
            "font",
            "fontSize",
            "lineHeight",
            "color",
            "background",
            "padding",
            "gap",
            "textAlign",
            "borderRadius",
          ].map((key) => [key, item[key]]),
        );
      for (const sample of samples as any[]) {
        const { actual, expected } = sample;
        expect(actual.tokens).toEqual(expected.tokens);
        expect(actual.dpr).toBe(expected.dpr);
        expect(actual.items[0].box.text).toContain("1 个文件已更改");
        expect(actual.items[0].buttons.map(painted)).toEqual(
          expected.items[0].buttons.map(painted),
        );
        for (let i = 0; i < expected.items[0].counters.length; i++) {
          const counter = actual.items[0].counters[i],
            referenceCounter = expected.items[0].counters[i];
          const { width: actualWidth, ...actualPaint } = painted(counter);
          const { width: expectedWidth, ...expectedPaint } =
            painted(referenceCounter);
          expect(actualPaint).toEqual(expectedPaint);
          expect(counter.top).toBe(referenceCounter.top);
          // Preserve raw floats in JSON. The two independent renderers differ
          // by up to 2 layout subpixels (1/32 CSS px) in shaped digit advances.
          expect(
            Math.abs(Number(actualWidth) - Number(expectedWidth)),
          ).toBeLessThanOrEqual(1 / 16);
          expect(
            Math.abs(counter.left - referenceCounter.left),
          ).toBeLessThanOrEqual(1 / 16);
        }
        expect(actual.items[0].box.height).toBe(expected.items[0].box.height);
        expect(actual.items[0].box.background).toBe(
          expected.items[0].box.background,
        );
        const actualQueue = actual.items.find((item: any) =>
          item.box.text.includes(queueMessages[0]),
        );
        expect(actualQueue.box.height).toBe(expected.items[1].box.height);
        expect(actualQueue.box.background).toBe(
          expected.items[1].box.background,
        );
        expect(
          actualQueue.buttons
            .filter((button: any) => !queueMessages.includes(button.text))
            .map(painted),
        ).toEqual(expected.items[1].buttons.map(painted));
        expect(actual.queueRows).toBe(queueMessages.length);
        if (coexist) {
          expect(actual.items.at(-1).box.height).toBe(
            expected.items.at(-1).box.height,
          );
          expect(actual.items.at(-1).buttons.map(painted)).toEqual(
            expected.items.at(-1).buttons.map(painted),
          );
        }
      }
      await local
        .getByRole("button", { name: "查看变更", exact: true })
        .click();
      const target = await page.evaluate(
        async () =>
          (
            await import("/src/session-mode/stores/useSavedTurnReviewStore.ts")
          ).useSavedTurnReviewStore.getState().target,
      );
      expect(target).toMatchObject({ threadId: "ux-0", turnId: "rail-turn" });
      await native
        .getByRole("button", { name: "查看变更", exact: true })
        .click();
      expect(
        await native.evaluate(() =>
          JSON.stringify((window as any).nativeMessages),
        ),
      ).toContain("show-diff");
      if (coexist) {
        await page.setViewportSize({ width: 390, height: 844 });
        await local.evaluate((el) =>
          Object.assign((el as HTMLElement).style, {
            position: "fixed",
            bottom: "8px",
            left: "0",
            width: "390px",
          }),
        );
        const rail = local.locator("[data-composer-rail]");
        await expect
          .poll(() => rail.evaluate((el) => getComputedStyle(el).position))
          .toBe("absolute");
        expect(
          await rail.evaluate((el) => el.getBoundingClientRect().height),
        ).toBeLessThanOrEqual(160);
        const editor = local.locator(
          ".session-native-editor-slot [contenteditable=true]",
        );
        await editor.fill("保留未发送草稿");
        await local.locator(".session-goal-open").click();
        await expect(page.locator(".session-goal-dialog")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(editor).toHaveText("保留未发送草稿");
        await local
          .getByRole("button", {
            name: `还有 ${queueMessages.length - 1} 条待发送`,
          })
          .click();
        await expect(
          page
            .locator(".session-composer-sheet")
            .getByText(queueMessages[1], { exact: true }),
        ).toBeVisible();
        await page.getByRole("button", { name: "关闭面板" }).click();
        await expect(editor).toHaveText("保留未发送草稿");
        await page.screenshot({ path: resolve(output, `${key}-mobile.png`) });
      }
      expect(
        fixture.calls.filter((call) =>
          /\/(turn\/(start|steer|interrupt)|followups\/(submit|change|stop)|goal\/(set|clear))$/.test(
            call.path,
          ),
        ),
      ).toEqual([]);
      await native.close();
    });
  }
