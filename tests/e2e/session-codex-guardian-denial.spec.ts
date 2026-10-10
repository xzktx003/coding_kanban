import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
for (const width of [1440, 390])
  for (const theme of ["dark", "light"]) {
    test(`guardian capability is explicit and uncertain approval never resends (${width}px ${theme})`, async ({
      page,
    }, info) => {
      test.setTimeout(90_000);
      const fixture = await installSessionUxFixture(page);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page
        .locator(".session-codex-composer [contenteditable=true]")
        .first()
        .waitFor({ timeout: 60_000 });
      await seedSessionUx(page);
      const identity = {
        threadId: "guardian-fixture",
        turnId: "guardian-turn",
        reviewId: `guardian-${width}-${theme}`,
        targetItemId: "actual-item",
        startedAtMs: 10,
        completedAtMs: 20,
      };
      const review = {
        ...identity,
        decisionSource: "agent",
        review: {
          status: "denied",
          riskLevel: "high",
          userAuthorization: "low",
          rationale: "Fixture requires consent",
        },
        action: {
          type: "command",
          source: "shell",
          command: "echo isolated fixture",
          cwd: "/fixture",
        },
      };
      let capable = false,
        recorded = false;
      const calls: Array<{ path: string; body: any }> = [];
      await page.route(
        "**/api/session/api/codex/guardian-denial/**",
        async (route) => {
          const path = new URL(route.request().url()).pathname;
          const body = route.request().postDataJSON();
          calls.push({ path, body });
          if (path.endsWith("/approve")) return route.abort("failed");
          await route.fulfill({
            json: {
              identity,
              runtimeInstance: "fixture-runtime",
              approvalToken: capable && !recorded ? "a".repeat(64) : null,
              canApprove: capable && !recorded,
              canAcceptDirectInput: true,
              state: recorded
                ? "recorded"
                : capable
                  ? "available"
                  : "unavailable",
              review,
            },
          });
        },
      );
      await page.evaluate(
        async ({ theme, review }) => {
          const module = (path: string) =>
            import(
              path.startsWith("/node_modules/.vite/deps/")
                ? (window as any).__sessionFixtureDependency(
                    path.split("/").at(-1),
                  )
                : (performance
                    .getEntriesByType("resource")
                    .findLast((e) => new URL(e.name).pathname === path)?.name ??
                  path)
            );
          const { useThemeStore } = await module(
            "/src/session-mode/stores/settings/useThemeStore.ts",
          );
          useThemeStore.getState().setTheme(theme);
          localStorage.removeItem("codex-guardian-deliveries-v1");
          const { NativeGuardianDeniedAction } = await module(
            "/src/session-mode/features/guardian-denial/NativeGuardianDeniedAction.tsx",
          );
          const react = await module("/node_modules/.vite/deps/react.js"),
            dom = await module("/node_modules/.vite/deps/react-dom_client.js");
          const React = react.default ?? react,
            { createRoot } = dom.default ?? dom;
          const host = document.createElement("div");
          host.id = "guardian-denial-fixture";
          host.className = "codex-presentation";
          host.style.cssText =
            "position:fixed;z-index:90;top:180px;left:16px;max-width:600px;width:calc(100vw - 32px);min-height:0;box-sizing:border-box;padding:16px;background:var(--codex-secondary,var(--background));border:1px solid var(--border);border-radius:8px";
          const session =
            document
              .querySelector(".session-codex-composer")
              ?.closest(".session-mode") ??
            document.querySelector(".session-mode");
          if (!session) throw new Error("Missing fixture session scope");
          session.append(host);
          const root = createRoot(host);
          (window as any).guardianFixture = {
            root,
            render: () =>
              root.render(
                React.createElement(NativeGuardianDeniedAction, {
                  value: review,
                }),
              ),
          };
          (window as any).guardianFixture.render();
        },
        { theme, review },
      );
      await expect.poll(() => calls.length).toBeGreaterThan(0);
      await expect(page.locator(".codex-guardian-denial-action")).toHaveCount(
        0,
      );
      expect(calls.every((call) => call.path.endsWith("/snapshot"))).toBe(true);
      capable = true;
      // Remount an explicit capable caller. Unavailable default never supplies a
      // fake button; this is an isolated adapter fixture, not a enabled-gate claim.
      await page.evaluate(() => {
        (window as any).guardianFixture.root.render(null);
      });
      await page.waitForTimeout(50);
      await page.evaluate(() => {
        (window as any).guardianFixture.render();
      });
      const action = page.locator(".codex-guardian-denial-action"),
        approve = action.getByRole("button", { name: "批准", exact: true });
      await expect(approve).toBeEnabled();
      await expect(action).toContainText("记录对此操作的批准并允许重试一次");
      if (width === 390)
        expect((await approve.boundingBox())!.height).toBeGreaterThanOrEqual(
          44,
        );
      await page.screenshot({
        path: info.outputPath(`guardian-capable-page-${width}-${theme}.png`),
        fullPage: true,
      });
      await approve.click();
      await expect(action).toHaveAttribute("data-state", "uncertain");
      await expect(approve).toBeDisabled();
      const sends = calls.filter((call) => call.path.endsWith("/approve"));
      expect(sends).toHaveLength(1);
      expect(sends[0].body).toEqual({
        identity,
        runtimeInstance: "fixture-runtime",
        approvalToken: "a".repeat(64),
        clientRequestId: expect.any(String),
      });
      expect(sends[0].body).not.toHaveProperty("event");
      await action
        .getByRole("button", { name: "核对状态", exact: true })
        .click();
      await expect(action).toHaveAttribute("data-state", "uncertain");
      await page.screenshot({
        path: info.outputPath(`guardian-uncertain-page-${width}-${theme}.png`),
        fullPage: true,
      });
      recorded = true;
      await action
        .getByRole("button", { name: "核对状态", exact: true })
        .click();
      await expect(action).toHaveCount(0);
      expect(
        calls.filter((call) => call.path.endsWith("/approve")),
      ).toHaveLength(1);
      expect(
        fixture.calls.filter((call) =>
          /\/turn\/(start|steer|interrupt)|\/thread\/resume/.test(call.path),
        ),
      ).toHaveLength(0);
      expect(errors).toEqual([]);
    });
  }
