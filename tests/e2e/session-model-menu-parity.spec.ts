import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

async function setWorkspace(page: Page, cwd?: string) {
  return page.evaluate(async (cwd) => {
    const path = "/src/session-mode/stores/useWorkspaceStore.ts";
    const { useWorkspaceStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path
    );
    const original = useWorkspaceStore.getState().cwd;
    const changedAt = cwd ? performance.now() : undefined;
    if (cwd)
      useWorkspaceStore.setState({
        cwd,
        projects: [...new Set([...useWorkspaceStore.getState().projects, cwd])],
      });
    return { cwd: original as string, changedAt };
  }, cwd);
}

async function expand(page: Page) {
  await page.getByRole("button", { name: "附加文件", exact: true }).click();
  await page.getByRole("button", { name: "展开编辑", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "展开编辑", exact: true }),
  ).toBeVisible();
}

async function keyboardOpen(trigger: Locator, page: Page) {
  await trigger.press("Enter");
  const menu = page.locator(".session-native-model-menu");
  await expect(menu).toBeVisible();
  return menu;
}

for (const width of [1440, 390, 320]) {
  test.describe(`model menu ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: width < 500,
      isMobile: width < 500,
    });
    for (const owner of ["main", "expanded"] as const) {
      test(`${owner} preserves native keyboard navigation, view focus and reset ownership`, async ({
        page,
      }, info) => {
        test.setTimeout(60_000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const fixture = await installSessionUxFixture(page, 0);
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor();
        await seedSessionUx(page, 0);
        await page.evaluate(async () => {
          const path =
            "/src/session-mode/components/codex/stores/useConfigStore.ts";
          const { useConfigStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
          useConfigStore.setState({
            model: "fixture-next",
            reasoningEffort: "high",
          });
        });
        const { cwd: originalCwd } = await setWorkspace(page);
        const originalDraftOwner = await page
          .locator(".session-codex-composer")
          .getAttribute("data-draft-owner");
        expect(originalDraftOwner).toBeTruthy();
        if (owner === "expanded") await expand(page);
        const scope = page.locator(
          owner === "main"
            ? ".session-codex-composer"
            : ".session-composer-sheet.is-full",
        );
        const editor = scope
          .locator(
            owner === "main"
              ? "[contenteditable=true]"
              : ".session-rich-draft textarea",
          )
          .first();
        const trigger = scope.locator(".session-native-model-trigger");
        const draft = `保留 ${width} ${owner} 未发送草稿`;
        await editor.fill(draft);
        const menu = await keyboardOpen(trigger, page);
        const caption = menu.getByRole("menuitem", {
          name: "选择模型",
          exact: true,
        });
        await caption.focus();
        await page.keyboard.press("ArrowDown");
        await expect(menu.getByRole("menuitemcheckbox")).toBeFocused();
        await page.keyboard.press("ArrowDown");
        const power = menu.getByRole("menuitem", { name: "强度", exact: true });
        await expect(power).toBeFocused();
        await expect(power).toHaveAttribute(
          "aria-keyshortcuts",
          "ArrowLeft ArrowRight",
        );
        await page.keyboard.press("ArrowLeft");
        await expect(caption).toContainText("中");
        const track = menu.locator(".session-native-power-slider");
        const bounds = (await track.boundingBox())!;
        const thumbBounds = (await power.boundingBox())!;
        await page.mouse.move(
          thumbBounds.x + thumbBounds.width / 2,
          thumbBounds.y + thumbBounds.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(bounds.x + 13, bounds.y + bounds.height / 2, {
          steps: 5,
        });
        await page.mouse.up();
        await expect(menu).toBeVisible();
        await expect(caption).toContainText("轻度");
        if (width < 500) {
          await page.touchscreen.tap(
            bounds.x + 100,
            bounds.y + bounds.height / 2,
          );
        } else {
          await page.mouse.click(bounds.x + 100, bounds.y + bounds.height / 2);
        }
        await expect(menu).toBeVisible();
        await expect(caption).toContainText("中");
        await power.focus();
        await page.keyboard.press("ArrowDown");
        await expect(caption).toBeFocused();
        await expect(caption).toContainText("中");
        await page.keyboard.press("ArrowUp");
        await expect(power).toBeFocused();
        await page.keyboard.press("Home");
        await expect(caption).toBeFocused();
        await page.keyboard.press("End");
        await expect(power).toBeFocused();
        await expect(caption).toContainText("中");
        await page.keyboard.press("Tab");
        await expect(caption).toBeFocused();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await expect(power).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(menu.getByRole("menuitemcheckbox")).toBeFocused();
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await menu.waitFor({ state: "detached" });
        await expect(editor).toBeFocused();
        if (owner === "main") await expect(editor).toHaveText(draft);
        else await expect(editor).toHaveValue(draft);

        // Pointer view changes preserve the previously verified container focus.
        await trigger.click();
        await caption.click();
        await expect(menu).toBeFocused();
        await page.keyboard.press("Escape");
        await page.waitForTimeout(375);
        await keyboardOpen(trigger, page);
        await caption.focus();
        await page.keyboard.press("Enter");
        const selected = menu.getByRole("menuitemradio", {
          name: "接替模型",
          exact: true,
        });
        await expect(selected).toHaveAttribute("aria-checked", "true");
        await expect(selected).toBeFocused();
        await page.evaluate(
          () =>
            new Promise<void>((done) =>
              requestAnimationFrame(() => requestAnimationFrame(() => done())),
            ),
        );
        await expect(selected).toBeFocused();
        // Geometry describes the settled hit target. The native .98 -> 1
        // entry scale is still running after the keyboard view switch; two
        // animation frames alone can measure a transient sub-44px target.
        // Keep rapid-reopen/reset timing checks below independent of this wait.
        const geometryMotion = await menu.evaluate(async (element) => {
          const before = {
            transform: getComputedStyle(element).transform,
            animations: element.getAnimations().map((animation) => ({
              playState: animation.playState,
              currentTime: animation.currentTime,
            })),
          };
          await Promise.all(
            element
              .getAnimations()
              .map((animation) => animation.finished.catch(() => {})),
          );
          await new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          );
          return {
            before,
            afterTransform: getComputedStyle(element).transform,
            activeAnimations: element
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" || animation.pending,
              ).length,
          };
        });
        const advancedGeometry = await menu.evaluate((element) => {
          const heading = element.querySelector<HTMLElement>(
            ".session-native-model-heading",
          )!;
          const search = element.querySelector<HTMLElement>(
            ".session-native-model-search-toggle",
          )!;
          const recent = [...element.querySelectorAll("button")].find(
            (button) => button.textContent === "打开最近使用的模型",
          )!;
          const headingBox = heading.getBoundingClientRect();
          const searchBox = search.getBoundingClientRect();
          const rowStyle = getComputedStyle(
            element.querySelector('[role="menuitemradio"]')!,
          );
          const recentStyle = getComputedStyle(recent);
          return {
            coarse: matchMedia("(pointer: coarse)").matches,
            headingCenterY: headingBox.y + headingBox.height / 2,
            searchCenterY: searchBox.y + searchBox.height / 2,
            searchWidth: searchBox.width,
            searchHeight: searchBox.height,
            recentHeight: recent.getBoundingClientRect().height,
            recentFontSize: recentStyle.fontSize,
            recentLineHeight: recentStyle.lineHeight,
            rowFontSize: rowStyle.fontSize,
            rowLineHeight: rowStyle.lineHeight,
            horizontalOverflow: element.scrollWidth > element.clientWidth,
          };
        });
        writeFileSync(
          info.outputPath("model-menu-advanced-geometry.json"),
          JSON.stringify({ ...advancedGeometry, geometryMotion }, null, 2),
        );
        expect(geometryMotion.activeAnimations).toBe(0);
        expect(
          Math.abs(
            advancedGeometry.headingCenterY - advancedGeometry.searchCenterY,
          ),
        ).toBeLessThan(1);
        expect(advancedGeometry.recentFontSize).toBe(
          advancedGeometry.rowFontSize,
        );
        expect(advancedGeometry.recentLineHeight).toBe(
          advancedGeometry.rowLineHeight,
        );
        expect(advancedGeometry.horizontalOverflow).toBe(false);
        if (advancedGeometry.coarse) {
          expect(advancedGeometry.searchWidth).toBeGreaterThanOrEqual(44);
          expect(advancedGeometry.searchHeight).toBeGreaterThanOrEqual(44);
          expect(advancedGeometry.recentHeight).toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({
          path: info.outputPath(
            `model-keyboard-selected-${width}-${owner}.png`,
          ),
        });

        const closeStarted = await page.evaluate(() => performance.now());
        await page.keyboard.press("Escape");
        await keyboardOpen(trigger, page);
        const reopenedAt = await page.evaluate(() => performance.now());
        expect(reopenedAt - closeStarted).toBeLessThan(350);
        await expect(selected).toBeVisible();
        await page.waitForTimeout(400);
        await expect(selected).toBeVisible();
        await page.keyboard.press("Escape");
        await page.waitForTimeout(375);
        await keyboardOpen(trigger, page);
        await expect(power).toBeVisible();

        // A new draft owner must release the previous owner's pending reset.
        await caption.click();
        const ownerCloseStarted = await page.evaluate(() => performance.now());
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "detached" });
        const { changedAt: ownerChangedAt } = await setWorkspace(
          page,
          `${originalCwd}/keyboard-owner-second`,
        );
        expect(ownerChangedAt! - ownerCloseStarted).toBeLessThan(350);
        await expect(
          page.locator(".session-codex-composer"),
        ).not.toHaveAttribute("data-draft-owner", originalDraftOwner!);
        if (owner === "expanded") {
          await expect(
            page.getByRole("dialog", { name: "展开编辑", exact: true }),
          ).toHaveCount(0);
          await expand(page);
        }
        await editor.fill("另一份草稿");
        await keyboardOpen(trigger, page);
        await caption.click();
        await page.waitForTimeout(400);
        await expect(selected).toBeVisible();
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        await setWorkspace(page, originalCwd);
        if (owner === "expanded")
          await expect(
            page.getByRole("dialog", { name: "展开编辑", exact: true }),
          ).toBeVisible();
        if (owner === "main") await expect(editor).toHaveText(draft);
        else await expect(editor).toHaveValue(draft);

        const executing = fixture.calls.filter((call) =>
          /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork)|followups\/submit|goal\/(?:set|clear))$/.test(
            call.path,
          ),
        );
        const evidence = {
          width,
          owner,
          rapidReopenMs: reopenedAt - closeStarted,
          ownerChangedAfterCloseMs: ownerChangedAt! - ownerCloseStarted,
          advancedGeometry,
          errors,
          executing,
        };
        const evidencePath = info.outputPath("model-menu-parity.json");
        writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
        await info.attach("model-menu-parity", {
          path: evidencePath,
          contentType: "application/json",
        });
        expect(executing).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
  });
}
