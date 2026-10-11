import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
for (const width of [1440, 390]) {
  test.describe(`${width}px native requests`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"])
      test(`error source card and unanswered question navigation (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90_000);
        test.skip(
          !reference,
          "The actual enabled VSIX reference harness is required.",
        );
        const fixture = await installSessionUxFixture(page);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        // Chromium clears touch emulation when capturing beyond the viewport.
        // Keep the complete phone fixture inside the viewport so screenshots
        // and interaction checks use the same actual coarse-pointer state.
        const height = width === 390 ? 1200 : 900;
        await page.setViewportSize({ width, height });
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-mode [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60_000 });
        const host = {
          foreground: theme === "dark" ? "#ccc" : "#3b3b3b",
          background: theme === "dark" ? "#20211d" : "#fff",
          secondary: theme === "dark" ? "#282a23" : "#f5f5f3",
        };
        const message =
          "The model could not complete this request. See https://example.invalid/help. **https://example.invalid/strong** _https://example.invalid/em_ ~~https://example.invalid/del~~.";
        await page.evaluate(
          async ({ width, theme, host, message }) => {
            const module = (path: string) =>
              import(
                performance
                  .getEntriesByType("resource")
                  .findLast((entry) => new URL(entry.name).pathname === path)
                  ?.name ?? path
              );
            const dependency = (window as any).__sessionFixtureDependency;
            const react = await import(dependency("react.js"));
            const dom = await import(dependency("react-dom_client.js"));
            const R = react.default ?? react;
            const { createRoot } = dom.default ?? dom;
            const { TurnFailureNotice } = await module(
              "/src/session-mode/components/codex/items/TurnFailureNotice.tsx",
            );
            const { RequestUserInputItem } = await module(
              "/src/session-mode/components/codex/items/RequestUserInputItem.tsx",
            );
            const { ApprovalItem } = await module(
              "/src/session-mode/components/codex/items/ApprovalItem.tsx",
            );
            const { useApprovalStore } = await module(
              "/src/session-mode/components/codex/stores/useApprovalStore.ts",
            );
            const { useRequestUserInputStore } = await module(
              "/src/session-mode/components/codex/stores/useRequestUserInputStore.ts",
            );
            document.getElementById("root")!.style.display = "none";
            document.body.style.margin = "0";
            document.body.style.background = host.background;
            const surface = document.createElement("div");
            surface.id = "native-request-parity";
            surface.className = `session-mode ${theme === "dark" ? "dark" : ""}`;
            surface.style.cssText = `width:${Math.min(width, 672)}px;height:auto;max-height:none;flex:none;overflow:visible;box-sizing:border-box;padding:16px;display:flex;flex-direction:column;gap:20px`;
            for (const [key, value] of Object.entries({
              "font-family": "system-ui",
              "editor-background": host.background,
              "sideBar-background": host.secondary,
              "dropdown-background": host.secondary,
              foreground: host.foreground,
            }))
              surface.style.setProperty(`--vscode-${key}`, value);
            document.body.append(surface);
            useApprovalStore.getState().addApproval({
              type: "commandExecution",
              threadId: "fixture-approval",
              turnId: "approval-turn",
              itemId: "approval-item",
              requestId: 74,
              requestToken: "approval-fixture-instance-token",
              startedAtMs: 1,
              command: "curl https://example.invalid/help",
              cwd: "/fixture/project",
              reason: null,
              networkApprovalContext: {
                host: "example.invalid",
                protocol: "https",
              },
              availableDecisions: [
                "accept",
                "acceptForSession",
                {
                  applyNetworkPolicyAmendment: {
                    network_policy_amendment: {
                      host: "example.invalid",
                      action: "allow",
                    },
                  },
                },
                "decline",
              ],
            });
            useRequestUserInputStore.getState().addRequest({
              threadId: "fixture-questions",
              turnId: "fixture-turn",
              itemId: "fixture-item",
              requestId: 73,
              requestToken: "fixture-instance-token",
              questions: [
                {
                  id: "first",
                  question: "Choose a plan",
                  isOther: true,
                  options: [
                    {
                      label: "Plan A (Recommended)",
                      description: "Short path",
                    },
                    { label: "Plan B", description: "Long path" },
                  ],
                },
                {
                  id: "second",
                  question: "Explain your preference",
                  options: null,
                },
              ],
            });
            createRoot(surface).render(
              R.createElement(
                R.Fragment,
                null,
                R.createElement(TurnFailureNotice, { message }),
                R.createElement(TurnFailureNotice, {
                  message: "Reconnecting... 2/5",
                  willRetry: true,
                  additionalDetails: "Fixture upstream detail",
                }),
                R.createElement(RequestUserInputItem, {
                  currentThreadId: "fixture-questions",
                }),
                R.createElement(ApprovalItem, {
                  currentThreadId: "fixture-approval",
                }),
              ),
            );
          },
          { width, theme, host, message },
        );
        const surface = page.locator("#native-request-parity");
        const card = surface.locator(".codex-native-error-card");
        await expect(card).toHaveText(message);
        await expect(
          card.getByRole("link", { name: "https://example.invalid/help" }),
        ).toHaveAttribute("target", "_blank");
        await expect(card.getByRole("link")).toHaveCount(1);
        const retry = surface.getByRole("button", { name: "Reconnecting 2/5" });
        await expect(retry).toHaveAttribute("aria-expanded", "false");
        await expect(surface.getByText("Fixture upstream detail")).toHaveCount(
          0,
        );
        await retry.click();
        await expect(
          surface.getByText("Fixture upstream detail"),
        ).toBeVisible();
        const next = surface.getByRole("button", {
          name: /下一题|下一问题|Next question|userInput.nextQuestion/,
        });
        await expect(next).toBeEnabled();
        await surface.getByRole("radio", { name: "自行填写" }).click();
        const other = surface.getByRole("textbox", { name: "Choose a plan" });
        await expect(other).toHaveAttribute(
          "placeholder",
          "否，并告诉 ChatGPT 应该如何做得不同",
        );
        await other.fill("Other draft must stay with this question.");
        const pointerState = () =>
          page.evaluate(() => ({
            touch: navigator.maxTouchPoints,
            coarse: matchMedia("(pointer:coarse)").matches,
          }));
        if (width === 390)
          expect(await pointerState()).toEqual({ touch: 1, coarse: true });
        const questionBounds = await surface
          .locator(".session-user-question")
          .evaluate((question) => ({
            bottom: question.getBoundingClientRect().bottom,
            footerBottom: question
              .querySelector(".session-user-question-footer")!
              .getBoundingClientRect().bottom,
          }));
        expect(questionBounds.footerBottom).toBeLessThanOrEqual(
          questionBounds.bottom,
        );
        await page.screenshot({
          path: info.outputPath(`requests-open-other-${width}-${theme}.png`),
          fullPage: true,
        });
        if (width === 390)
          expect(await pointerState()).toEqual({ touch: 1, coarse: true });
        await next.click();
        const answer = surface.getByRole("textbox", {
          name: "Explain your preference",
        });
        await expect(answer).toHaveAttribute("placeholder", "在此输入");
        await answer.fill("Keep this draft without submitting.");
        await page.screenshot({
          path: info.outputPath(`requests-open-freeform-${width}-${theme}.png`),
          fullPage: true,
        });
        await expect(next).toBeDisabled();
        await surface
          .getByRole("button", { name: /上一题|Previous|userInput.previous/ })
          .click();
        await expect(other).toHaveValue(
          "Other draft must stay with this question.",
        );
        await next.click();
        await expect(answer).toHaveValue("Keep this draft without submitting.");
        await surface.locator(".codex-request-card").press("Escape");
        await expect(
          surface
            .locator(".session-user-question-collapsed")
            .getByRole("button"),
        ).toBeVisible();
        const native = await page.context().newPage();
        await native.setViewportSize({ width, height });
        await native.goto(reference!);
        await native.waitForFunction(() => (window as any).nativeLoaded);
        await native.evaluate(
          async ({ width, host, message, theme }) => {
            document.documentElement.dataset.theme = theme;
            document.body.style.margin = "0";
            document.body.style.background = host.background;
            const root = document.getElementById("root")!;
            root.style.cssText = `width:${Math.min(width, 672)}px;box-sizing:border-box;padding:16px`;
            for (const [key, value] of Object.entries({
              "font-family": "system-ui",
              "editor-background": host.background,
              foreground: host.foreground,
            }))
              document.documentElement.style.setProperty(
                `--vscode-${key}`,
                value,
              );
            const notices =
              await import("./native/assets/app-initial-3192ac99b6cd.js");
            const icons =
              await import("./native/assets/app-initial-e98b9eaef8e3.js");
            notices.cX();
            icons.Vd();
            const R = (window as any).nativeModules.React;
            (window as any).renderNativeElement(notices.sX, {
              role: "alert",
              layout: "verticalIcon",
              Icon: icons.Bd,
              content: R.createElement(
                "span",
                { className: "wrap-anywhere" },
                message,
              ),
            });
          },
          { width, host, message, theme },
        );
        const metrics = (element: Element) => {
          const style = getComputedStyle(element),
            svg = element.querySelector("svg")!;
          return {
            radius: style.borderRadius,
            padding: style.padding,
            gap: style.gap,
            font: style.fontSize,
            line: style.lineHeight,
            background: style.backgroundColor,
            border: style.borderColor,
            shadow: style.boxShadow,
            svg: {
              width: getComputedStyle(svg).width,
              height: getComputedStyle(svg).height,
              viewBox: svg.getAttribute("viewBox"),
              paths: Array.from(svg.querySelectorAll("path")).map((path) =>
                path.getAttribute("d"),
              ),
            },
          };
        };
        await expect(native.getByRole("alert")).toBeVisible();
        const actual = await card.evaluate(metrics),
          expected = await native.getByRole("alert").evaluate(metrics);
        await info.attach("native-error-metrics", {
          body: JSON.stringify({ actual, expected }),
          contentType: "application/json",
        });
        expect(actual).toEqual(expected);
        await page.screenshot({
          path: info.outputPath(`requests-product-${width}-${theme}.png`),
          fullPage: true,
        });
        await native.screenshot({
          path: info.outputPath(`error-native-${width}-${theme}.png`),
          fullPage: true,
        });
        const approval = surface.locator("[data-codex-approval-surface]");
        const allowHost = approval
          .locator(".codex-approval-leading-action")
          .getByRole("button");
        await expect(allowHost).toBeVisible();
        await expect(allowHost).toHaveAttribute("title", "example.invalid");
        if (width === 390) {
          expect(await pointerState()).toEqual({ touch: 1, coarse: true });
          expect(
            (await allowHost.boundingBox())!.height,
          ).toBeGreaterThanOrEqual(44);
        }
        await allowHost.click();
        await expect(approval).toHaveCount(0);
        const replies = fixture.calls.filter((call) =>
          call.path.endsWith("/approval/command-execution"),
        );
        expect(replies).toEqual([
          {
            path: "/api/session/api/codex/approval/command-execution",
            body: {
              request_id: 74,
              request: {
                threadId: "fixture-approval",
                requestId: 74,
                turnId: "approval-turn",
                itemId: "approval-item",
                requestToken: "approval-fixture-instance-token",
              },
              decision: {
                applyNetworkPolicyAmendment: {
                  network_policy_amendment: {
                    host: "example.invalid",
                    action: "allow",
                  },
                },
              },
            },
          },
        ]);
        expect(
          fixture.calls.filter((call) =>
            /respond|interrupt|turn\/(start|steer)|thread\/resume/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
        expect(errors).toEqual([]);
      });
  });
}
