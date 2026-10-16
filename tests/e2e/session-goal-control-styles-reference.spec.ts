import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fixtureGoal, sampleGoal } from "./session-goal-fixture";
import {
  installNativeBridgeFence,
  installNativeBusyFixture,
  nativeFenceEvidence,
} from "./session-goal-control-style-native";
import {
  environment,
  hostTheme,
  pointerHover,
  snapshot,
  tabTo,
  type Controls,
} from "./session-goal-control-style-evidence";

import {
  captureGoalControlSources,
  compareGoalControlSources,
  loadNativeGoalSources,
  nativeGoalAssetManifest,
  productFixturePostPaths,
  sha256,
} from "./session-goal-control-style-source";

const referenceUrl = process.env.CODEX_GOAL_REFERENCE_URL;
const desiredCapability =
  process.env.GOAL_CONTROL_STYLE_EXPECT_CAPABILITY ?? "auto";
const fixtureObjective = "控制样式验收：仅持有 fixture 保存";
const manifest = { files: nativeGoalAssetManifest };
const errorText = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

function controls(page: Page, native: boolean, replacement = false): Controls {
  const dialog = page.getByRole("dialog");
  const card = native
    ? page.locator("#root > div").first()
    : page.locator(".session-thread-goal");
  return {
    ...(!replacement
      ? {
          card,
          cardAction: card.getByRole("button", {
            name: "编辑目标",
            exact: true,
            // The card is inert behind the actual dialog. This is a computed
            // shape observation, not a click on that inaccessible action.
            includeHidden: true,
          }),
          close: dialog.getByRole("button", {
            // Original Main.V3n/codex.dialog.closeButton + original zh-CN:
            // sr-only text gives the native button this accessible name.
            name: "关闭对话框",
            exact: true,
          }),
          textarea: dialog.getByRole("textbox", { name: "目标", exact: true }),
          tile: native
            ? dialog.locator("svg").first().locator("..")
            : dialog.locator(".session-goal-dialog-icon"),
        }
      : {
          objective: native
            ? dialog.locator("[class*=line-clamp]")
            : dialog.locator(".session-goal-confirm-objective"),
        }),
    dialog,
    cancel: dialog.getByRole("button", { name: "取消", exact: true }),
    save: dialog.getByRole("button", {
      name: replacement ? "替换目标" : "保存",
      exact: true,
    }),
  };
}

async function waitDialog(page: Page) {
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 });
  // Same bounded actual animation settling allowance as existing reference test.
  // Record animations too; a still-running transition is a coverage failure.
  await page.waitForTimeout(350);
}

type EvidenceRow = {
  side: "product" | "native";
  phase: string;
  controls?: any;
  detail?: any;
  error?: string;
};

for (const width of [1440, 390])
  for (const theme of ["dark", "light"] as const) {
    test(`Goal controls actual native CSS/states ${width} ${theme}`, async ({
      page,
      context,
    }, info) => {
      test.skip(
        !referenceUrl,
        "Set CODEX_GOAL_REFERENCE_URL to the isolated unchanged official Goal fixture; skipped is not passed",
      );
      test.setTimeout(90_000);
      page.setDefaultTimeout(5000);
      const reference = await context.newPage();
      reference.setDefaultTimeout(5000);
      const rows: EvidenceRow[] = [];
      const failures: unknown[] = [];
      const network: unknown[] = [];
      const responseTasks: Promise<unknown>[] = [];
      const assetResponses: unknown[] = [];
      const originalOrigin = new URL(referenceUrl!).origin;
      const originalPath = new URL(referenceUrl!).pathname;
      let fatalNative = false;
      let nativeReady = false;
      let productReady = false;
      let cleanupProductHold: (() => void) | undefined;
      let productHeld = false;
      const productGoalCalls: unknown[] = [];
      let f: Awaited<ReturnType<typeof fixtureGoal>> | undefined;

      const recordFailure = (phase: string, error: unknown) => {
        failures.push({ phase, error: errorText(error) });
      };
      const phase = async (
        side: "native" | "product",
        name: string,
        work: () => Promise<unknown>,
      ) => {
        if (side === "native" && fatalNative) {
          rows.push({
            side,
            phase: name,
            detail: { notRun: "native safety fence tripped" },
          });
          return false;
        }
        try {
          const detail = await work();
          rows.push({ side, phase: name, detail });
          if (side === "native") {
            const fence = await nativeFenceEvidence(reference);
            const violations = [
              ...(fence.host?.violations ?? []),
              ...(fence.native?.violations ?? []),
            ];
            if (violations.length) {
              fatalNative = true;
              recordFailure(name, JSON.stringify(violations));
              return false;
            }
          }
          return true;
        } catch (error) {
          rows.push({ side, phase: name, error: errorText(error) });
          recordFailure(`${side}:${name}`, error);
          return false;
        }
      };
      const capture = async (
        side: "native" | "product",
        name: string,
        replacement = false,
      ) => {
        const target = side === "native" ? reference : page;
        rows.push({
          side,
          phase: name,
          controls: await snapshot(
            controls(target, side === "native", replacement),
          ),
        });
      };
      const screenshot = async (side: "native" | "product", name: string) => {
        const target = side === "native" ? reference : page;
        try {
          const path = info.outputPath(`${side}-${name}.png`);
          await target.screenshot({ path });
          await info.attach(`${side}-${name}`, {
            path,
            contentType: "image/png",
          });
        } catch (error) {
          rows.push({
            side,
            phase: `screenshot:${name}`,
            error: errorText(error),
          });
        }
      };
      const diskBefore = captureGoalControlSources();
      let cuSource = "";
      let quSource = "";
      try {
        const sources = loadNativeGoalSources();
        cuSource = sources.Cu;
        quSource = sources.qu;
        if (diskBefore.some((row) => "error" in row))
          throw new Error(
            "A watched source input is unavailable; evidence records the exact path",
          );
        if (!["auto", "supported", "unsupported"].includes(desiredCapability))
          throw new Error("Unknown capability lane");
        await reference.routeWebSocket(/.*/, (socket) => {
          fatalNative = true;
          network.push({
            violation: "native websocket denied",
            url: socket.url(),
          });
          socket.close();
        });
        await reference.route("**/*", async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          const allowed =
            request.method() === "GET" &&
            url.origin === originalOrigin &&
            (url.pathname === originalPath ||
              url.pathname === "/favicon.ico" ||
              url.pathname.endsWith("/native-goal-reference.js") ||
              url.pathname.includes("/assets/"));
          if (!allowed) {
            fatalNative = true;
            network.push({
              violation: "native network denied",
              method: request.method(),
              url: request.url(),
              body: request.postData(),
            });
            await route.abort("blockedbyclient");
            return;
          }
          network.push({ allowed: true, method: "GET", url: request.url() });
          await route.continue();
        });
        reference.on("response", (response) => {
          const basename = new URL(response.url()).pathname.split("/").at(-1)!;
          const expected = manifest.files.find((row: any) =>
            row.path.endsWith(`/assets/${basename}`),
          );
          if (expected)
            responseTasks.push(
              (async () => {
                const body = await response.body();
                assetResponses.push({
                  url: response.url(),
                  status: response.status(),
                  bytes: body.length,
                  sha256: sha256(body),
                  expectedSha256: expected.sha256,
                });
              })(),
            );
        });
        await installNativeBridgeFence(reference);
        // Registered before fixtureGoal's API routes: those routes fulfill all
        // synthetic API traffic; this guard handles every remaining request.
        await page.route("**/*", async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          const base = new URL(info.project.use.baseURL!);
          if (
            request.method() === "GET" &&
            url.origin === base.origin &&
            !url.pathname.startsWith("/api/")
          ) {
            await route.continue();
            return;
          }
          network.push({
            violation: "product request escaped isolated fixture",
            method: request.method(),
            url: request.url(),
            body: request.postData(),
          });
          recordFailure(
            "product-network-fence",
            JSON.stringify({ method: request.method(), url: request.url() }),
          );
          await route.abort("blockedbyclient");
        });
        await page.setViewportSize({ width, height: 900 });
        await reference.setViewportSize({ width, height: 900 });
        await phase("product", "bootstrap", async () => {
          f = await fixtureGoal(page, {
            goal: sampleGoal({ status: "active" }),
          });
          await hostTheme(page, theme);
          // No execution or goal mutation is allowed while collecting ordinary
          // editor/replacement states. The last-registered held route below
          // admits only the one precise fixture GoalSet into a pending state.
          await page.route("**/api/**", async (route) => {
            const request = route.request(),
              path = new URL(request.url()).pathname;
            if (
              request.method() === "GET" ||
              productFixturePostPaths.has(path)
            ) {
              await route.fallback();
              return;
            }
            productGoalCalls.push({
              action: "denied-before-pending",
              path,
              body: request.postDataJSON(),
            });
            recordFailure("product-business-fence", path);
            await route.fulfill({
              status: 403,
              json: {
                error: "fixture denied business mutation",
                deliveryStage: "not-admitted",
              },
            });
          });
          productReady = true;
          return environment(page);
        });
        await phase("native", "bootstrap", async () => {
          await reference.goto(referenceUrl!);
          await reference.waitForFunction(
            () => (window as any).nativeLoaded,
            undefined,
            { timeout: 10000 },
          );
          await hostTheme(reference, theme);
          const result = await installNativeBusyFixture(
            reference,
            cuSource,
            quSource,
            sampleGoal({ status: "active" }),
          );
          await reference.waitForFunction(
            () => (window as any).__goalStyleNative?.state.ready,
            undefined,
            { timeout: 5000 },
          );
          nativeReady = true;
          const productCard = page.locator(".session-thread-goal");
          if (productReady) {
            const box = await productCard.boundingBox();
            if (!box) throw new Error("Product card has no host width");
            await reference.locator("#root").evaluate((root, cardWidth) => {
              Object.assign((root as HTMLElement).style, {
                maxWidth: "none",
                width: `${cardWidth + 32}px`,
              });
            }, box.width);
          }
          const actualCu = await reference.evaluate(() =>
            Function.prototype.toString.call(
              (window as any).nativeGoalCore.Native.Cu,
            ),
          );
          return {
            ...result,
            environment: await environment(reference),
            actualCuSha256: sha256(actualCu),
            expectedCuSha256: sha256(cuSource),
          };
        });

        const sides = [
          { side: "product" as const, page, ready: productReady },
          { side: "native" as const, page: reference, ready: nativeReady },
        ];
        // Complete each independent side before doing comparisons. A style red
        // does not abort keyboard/hover/pending evidence from the other side.
        for (const item of sides) {
          if (!item.ready) continue;
          const side = item.side,
            target = item.page,
            native = side === "native";
          await phase(side, "card-rest", async () => {
            const card = native
              ? target.locator("#root > div").first()
              : target.locator(".session-thread-goal");
            rows.push({
              side,
              phase: "card-rest",
              controls: await snapshot({
                card,
                cardAction: card.getByRole("button", {
                  name: "编辑目标",
                  exact: true,
                  includeHidden: true,
                }),
              }),
            });
          });
          const editorOpened = await phase(side, "open-editor", async () => {
            await target
              .getByRole("button", { name: "编辑目标", exact: true })
              .click();
            await waitDialog(target);
            await capture(side, "editor-initial-auto-focus");
          });
          if (!editorOpened) continue;
          const c = controls(target, native);
          await phase(side, "editor-enabled-rest", async () => {
            await c.textarea!.fill(fixtureObjective);
            await target.getByRole("dialog").getByRole("heading").click();
            await capture(side, "editor-enabled-rest");
          });
          for (const control of ["textarea", "cancel", "save"] as const)
            await phase(side, `keyboard:${control}`, async () => {
              const traversal = await tabTo(target, c[control]!);
              await capture(side, `keyboard-focus-${control}`);
              return traversal;
            });
          for (const control of ["textarea", "cancel", "save"] as const)
            await phase(side, `hover-enabled:${control}`, async () => {
              await target.getByRole("dialog").getByRole("heading").click();
              await pointerHover(target, c[control]!);
              await capture(side, `enabled-hover-${control}`);
            });
          await screenshot(side, "editor-enabled");
          const closed = await phase(
            side,
            "close-editor-before-replacement",
            async () => {
              await c.cancel!.click();
              await target.getByRole("dialog").waitFor({ state: "detached" });
            },
          );
          if (!closed) continue;
          const replacementOpened = await phase(
            side,
            "open-replacement",
            async () => {
              if (native)
                await target.evaluate(() =>
                  (window as any).__goalStyleNative.render("replace"),
                );
              else {
                await target
                  .locator(".session-codex-composer [contenteditable=true]")
                  .first()
                  .fill("/goal 原生与本地一致的替换目标");
                await target
                  .getByRole("button", { name: "发送消息", exact: true })
                  .click();
              }
              await waitDialog(target);
              await target.getByRole("dialog").getByRole("heading").click();
              await capture(side, "replacement-rest", true);
            },
          );
          if (!replacementOpened) continue;
          const replacement = controls(target, native, true);
          for (const control of ["cancel", "save"] as const)
            await phase(side, `replacement-keyboard:${control}`, async () => {
              const traversal = await tabTo(target, replacement[control]!);
              await capture(
                side,
                `replacement-keyboard-focus-${control}`,
                true,
              );
              return traversal;
            });
          for (const control of ["cancel", "save"] as const)
            await phase(side, `replacement-hover:${control}`, async () => {
              await target.getByRole("dialog").getByRole("heading").click();
              await pointerHover(target, replacement[control]!);
              await capture(side, `replacement-enabled-hover-${control}`, true);
            });
          await screenshot(side, "replacement");
          const returned = await phase(side, "cancel-replacement", async () => {
            await replacement.cancel!.click(); // never confirm replacement
            await target.getByRole("dialog").waitFor({ state: "detached" });
          });
          if (!returned) continue;
          const pendingPrepared = await phase(
            side,
            "save-enters-real-pending",
            async () => {
              await target
                .getByRole("button", { name: "编辑目标", exact: true })
                .click();
              await waitDialog(target);
              await controls(target, native).textarea!.fill(fixtureObjective);
              if (!native) {
                let release!: () => void;
                const held = new Promise<void>((resolve) => {
                  release = resolve;
                });
                cleanupProductHold = release;
                await page.route(
                  "**/api/session/api/codex/thread/goal/*",
                  async (route) => {
                    const action = new URL(route.request().url()).pathname
                        .split("/")
                        .at(-1),
                      body = route.request().postDataJSON();
                    if (action === "get") {
                      await route.fallback();
                      return;
                    }
                    productGoalCalls.push({
                      action,
                      body,
                      outcome: "held-until-cleanup",
                    });
                    if (
                      action !== "set" ||
                      productHeld ||
                      body?.threadId !== "ux-0" ||
                      body?.objective !== fixtureObjective ||
                      body?.status !== "active" ||
                      Object.keys(body).some(
                        (key) =>
                          !["threadId", "objective", "status"].includes(key),
                      )
                    ) {
                      recordFailure(
                        "product-goal-fence",
                        JSON.stringify({ action, body }),
                      );
                      await route.fulfill({
                        status: 403,
                        json: {
                          error: "fixture denied unexpected mutation",
                          deliveryStage: "not-admitted",
                        },
                      });
                      return;
                    }
                    productHeld = true;
                    await held;
                    // Teardown-only definite fixture rejection, never fake success.
                    await route
                      .fulfill({
                        status: 409,
                        json: {
                          error:
                            "isolated control-style fixture did not admit GoalSet",
                          deliveryStage: "not-admitted",
                        },
                      })
                      .catch((error) =>
                        recordFailure("cleanup-held-route", error),
                      );
                  },
                );
              }
              await controls(target, native).save!.click(); // actual Cu/local Save
              if (native)
                await target.waitForFunction(
                  () => (window as any).__goalStyleNative?.state.held,
                  undefined,
                  { timeout: 5000 },
                );
              else {
                await new Promise<void>((resolve, reject) => {
                  const timer = setTimeout(() => {
                    clearInterval(interval);
                    reject(
                      new Error(
                        "Product fixture did not receive the actual Save request",
                      ),
                    );
                  }, 5000);
                  const interval = setInterval(() => {
                    if (!productHeld) return;
                    clearTimeout(timer);
                    clearInterval(interval);
                    resolve();
                  }, 20);
                });
              }
              await target.getByRole("dialog").getByRole("heading").click();
              await capture(side, "pending-rest");
            },
          );
          if (!pendingPrepared) continue;
          for (const control of ["textarea", "cancel", "save"] as const)
            await phase(side, `hover-disabled:${control}`, async () => {
              await pointerHover(target, controls(target, native)[control]!);
              await capture(side, `disabled-hover-${control}`);
            });
          await screenshot(side, "editor-pending");
          await phase(side, "pending-keyboard:close", async () => {
            const close = controls(target, native).close!;
            const traversal = await tabTo(target, close);
            await capture(side, "pending-keyboard-focus-close");
            return traversal;
          });
          await phase(side, "pending-dismiss-is-controlled", async () => {
            const dialog = target.getByRole("dialog");
            const originalId = await dialog.getAttribute("id");
            const close = controls(target, native).close!;
            const enabled = await close.isEnabled();
            const checks: unknown[] = [];
            const check = async (gesture: string) => {
              const visible =
                (await dialog.count()) === 1 && (await dialog.isVisible());
              const draft = visible
                ? await controls(target, native).textarea!.inputValue()
                : null;
              const dialogId = visible ? await dialog.getAttribute("id") : null;
              const requestCount = native
                ? (await nativeFenceEvidence(target)).native.calls.length
                : productGoalCalls.length;
              checks.push({
                gesture,
                visible,
                draft,
                originalId,
                dialogId,
                requestCount,
              });
              if (
                !visible ||
                draft !== fixtureObjective ||
                dialogId !== originalId ||
                requestCount !== 1
              )
                recordFailure(
                  `${side}:pending-dismiss:${gesture}`,
                  JSON.stringify({ visible, draft }),
                );
            };
            if (enabled) await close.click();
            else
              recordFailure(
                `${side}:pending-close-pointer`,
                "Close is disabled; a real click was not attempted",
              );
            await check("close");
            await target.keyboard.press("Escape");
            await check("Escape");
            await target.mouse.click(4, 4);
            await check("outside-pointer");
            return { enabled, clicked: enabled, checks };
          });
        }
      } catch (error) {
        recordFailure("setup-or-collection", error);
      } finally {
        // Attach everything before the one final assertion. Cleanup failures are
        // preserved too. No pending native Promise is resolved with success.
        let fence: unknown = null;
        if (!reference.isClosed()) {
          fence = await nativeFenceEvidence(reference).catch((error) => ({
            error: errorText(error),
          }));
          await reference
            .evaluate(() => (window as any).__goalStyleNative?.dispose())
            .catch((error) => recordFailure("native-unmount", error));
        }
        cleanupProductHold?.();
        const responseResults = await Promise.allSettled(responseTasks);
        for (const result of responseResults)
          if (result.status === "rejected")
            recordFailure("asset-response-body", result.reason);
        await reference
          .close()
          .catch((error) => recordFailure("native-close", error));
        // The test-owned product page is closed after the held route is released.
        await page
          .close()
          .catch((error) => recordFailure("product-close", error));
        const diskAfter = captureGoalControlSources();
        const sourceDrift = compareGoalControlSources(diskBefore, diskAfter);
        const comparison = compareAfterCollection(rows);
        failures.push(...comparison.failures);
        if (f?.writes.length)
          failures.push({
            phase: "product-fixture-unexpected-goal-write",
            calls: f.writes,
          });
        const unexpectedFixtureCalls =
          f?.fixture.calls.filter(
            (call) => !productFixturePostPaths.has(call.path),
          ) ?? [];
        if (unexpectedFixtureCalls.length)
          failures.push({
            phase: "product-fixture-unexpected-business-call",
            calls: unexpectedFixtureCalls,
          });
        const nativeBootstrap = rows.find(
          (row) => row.side === "native" && row.phase === "bootstrap",
        )?.detail;
        const actualSupport =
          nativeBootstrap?.environment?.cornerShapeSupported;
        if (
          desiredCapability !== "auto" &&
          actualSupport !== (desiredCapability === "supported")
        )
          failures.push({
            phase: "capability-lane",
            desiredCapability,
            actualSupport,
            classification:
              "requested real capability unavailable; never patch CSS.supports",
          });
        if (fatalNative)
          failures.push({ phase: "native-safety-fence", fatalNative });
        const checkedFence = fence as any;
        if (
          checkedFence?.host?.violations?.length ||
          checkedFence?.native?.violations?.length ||
          checkedFence?.originalErrors?.length
        )
          failures.push({ phase: "native-fence-or-component-error", fence });
        if (
          checkedFence?.native?.calls?.length !== 1 ||
          !checkedFence?.native?.held ||
          !checkedFence?.native?.cuSourceEqual ||
          !checkedFence?.native?.quSourceEqual ||
          !checkedFence?.native?.clientIdentityEqual
        )
          failures.push({
            phase: "native-real-save-or-original-identity-missing",
            native: checkedFence?.native,
          });
        if (sourceDrift.length)
          failures.push({ phase: "source-integrity", sourceDrift });
        for (const asset of assetResponses as any[])
          if (asset.sha256 !== asset.expectedSha256)
            failures.push({ phase: "served-asset-integrity", asset });
        for (const file of manifest.files.filter((row: any) =>
          row.path.includes("/assets/"),
        ))
          if (
            !(assetResponses as any[]).some(
              (asset) => asset.expectedSha256 === file.sha256,
            )
          )
            failures.push({
              phase: "served-asset-integrity",
              reason: "required asset response was not captured",
              path: file.path,
            });
        const payload = {
          referenceAcceptance: "original-component-with-fixture-client",
          width,
          theme,
          desiredCapability,
          browserVersion: context.browser()?.version(),
          requestedChromiumArgs: info.project.use.launchOptions?.args ?? [],
          requestedChromiumExecutable:
            info.project.use.launchOptions?.executablePath ?? null,
          boundary:
            "Original Goal Cu/qu under fixture providers and fixture-held client; not a complete IDE or backend GoalSet acceptance",
          diskBefore,
          diskAfter,
          assetResponses,
          network,
          fence,
          productGoalCalls,
          originalFixtureWrites: f?.writes ?? [],
          originalFixtureCalls: f?.fixture.calls ?? [],
          rows,
          comparison,
          failures,
          cleanup: {
            originalPromise:
              "never resolved; original root unmounted and own page realm closed",
            productRoute: "released only into fixture 409 not-admitted",
            nativePageClosed: reference.isClosed(),
            productPageClosed: page.isClosed(),
          },
        };
        const evidencePath = info.outputPath(
          "goal-control-style-all-evidence.json",
        );
        writeFileSync(evidencePath, JSON.stringify(payload, null, 2));
        await info.attach("goal-control-style-all-evidence", {
          path: evidencePath,
          contentType: "application/json",
        });
      }
      // The first shape difference cannot conceal hover/busy/focus evidence.
      expect(failures, "All evidence is attached before asserting").toEqual([]);
    });
  }

function compareAfterCollection(rows: EvidenceRow[]) {
  const failures: unknown[] = [],
    differences: unknown[] = [];
  const captures = rows.filter((row) => row.controls);
  const phases = [...new Set(captures.map((row) => row.phase))];
  const shapeProperties = ["cornerShape", "corners", "individualCornerShapes"];
  const interactiveProperties = [
    "background",
    "color",
    "borderColor",
    "borderWidth",
    "cursor",
    "opacity",
  ];
  for (const phase of phases) {
    const native = captures.find(
      (row) => row.side === "native" && row.phase === phase,
    )?.controls;
    const product = captures.find(
      (row) => row.side === "product" && row.phase === phase,
    )?.controls;
    if (!native || !product) {
      failures.push({
        phase,
        incompleteSide: { native: !!native, product: !!product },
      });
      continue;
    }
    for (const control of [
      ...new Set([...Object.keys(native), ...Object.keys(product)]),
    ]) {
      const n = native[control],
        p = product[control];
      if (!n?.ok || !p?.ok) {
        failures.push({
          phase,
          control,
          native: n,
          product: p,
          reason: "measurement missing",
        });
        continue;
      }
      const properties = [
        ...shapeProperties,
        ...(control === "close" && phase === "pending-keyboard-focus-close"
          ? ["disabled", ...interactiveProperties]
          : []),
        ...(["textarea", "cancel", "save"].includes(control)
          ? interactiveProperties
          : []),
        ...(phase.includes("keyboard-focus") && phase.endsWith(control)
          ? [
              "active",
              "focusVisible",
              "outlineStyle",
              "outlineWidth",
              "outlineOffset",
              "boxShadow",
            ]
          : []),
      ];
      if (phase.includes("keyboard-focus") && phase.endsWith(control)) {
        const drawable = (style: any) =>
          style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
        // outline-color cannot paint an outline when both outline styles are
        // none or have zero width. Keep its raw value in evidence; compare it
        // whenever either side can draw. Outline style/width/offset/shadow are
        // always compared, so a real outline-vs-ring difference stays visible.
        if (drawable(n.value) || drawable(p.value))
          properties.push("outlineColor");
      }
      for (const property of properties)
        if (
          JSON.stringify(n.value[property]) !==
          JSON.stringify(p.value[property])
        ) {
          const difference = {
            phase,
            control,
            property,
            native: n.value[property],
            product: p.value[property],
          };
          differences.push(difference);
          failures.push(difference);
        }
      if (phase.startsWith("pending") || phase.startsWith("disabled-hover"))
        if (
          ["textarea", "cancel", "save"].includes(control) &&
          (!n.value.disabled || !p.value.disabled)
        )
          failures.push({
            phase,
            control,
            reason: "real pending did not disable both controls",
            native: n.value.disabled,
            product: p.value.disabled,
          });
    }
  }
  for (const side of ["native", "product"] as const) {
    const pending = captures.find(
      (row) => row.side === side && row.phase === "pending-rest",
    )?.controls;
    if (!pending)
      failures.push({ side, reason: "actual Save pending evidence missing" });
    for (const control of ["textarea", "cancel", "save"]) {
      const hovered = captures.find(
        (row) => row.side === side && row.phase === `disabled-hover-${control}`,
      )?.controls?.[control];
      if (!hovered?.ok || !hovered.value.hover)
        failures.push({
          side,
          control,
          reason: "actual disabled pointer hover missing",
        });
      if (pending?.[control]?.ok && hovered?.ok)
        for (const property of ["background", "color", "opacity", "cursor"])
          if (
            JSON.stringify(pending[control].value[property]) !==
            JSON.stringify(hovered.value[property])
          )
            failures.push({
              side,
              control,
              property,
              reason: "disabled hover changed rest style",
              rest: pending[control].value[property],
              hover: hovered.value[property],
            });
      const enabledHover = captures.find(
        (row) => row.side === side && row.phase === `enabled-hover-${control}`,
      )?.controls?.[control];
      if (
        !enabledHover?.ok ||
        !enabledHover.value.hover ||
        enabledHover.value.disabled
      )
        failures.push({
          side,
          control,
          reason: "actual enabled pointer hover missing",
        });
      const focused = captures.find(
        (row) => row.side === side && row.phase === `keyboard-focus-${control}`,
      )?.controls?.[control];
      if (!focused?.ok || !focused.value.active || !focused.value.focusVisible)
        failures.push({
          side,
          control,
          reason: "actual keyboard focus-visible coverage missing",
        });
    }
    for (const row of rows.filter(
      (row) => row.side === side && row.phase.includes("keyboard:"),
    ))
      if (!row.detail?.reached)
        failures.push({
          side,
          phase: row.phase,
          reason: "real Tab traversal did not reach control",
          detail: row.detail,
        });
  }
  if (
    !captures.some(
      (row) => row.side === "native" && row.phase === "replacement-rest",
    )
  )
    failures.push({
      reason: "real native replacement objective evidence missing",
    });
  if (
    !captures.some(
      (row) => row.side === "product" && row.phase === "replacement-rest",
    )
  )
    failures.push({
      reason: "real product replacement objective evidence missing",
    });
  return { differences, failures };
}
