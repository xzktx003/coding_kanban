import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtureGoal, sampleGoal } from "./session-goal-fixture";
import type { ThreadGoalStatus } from "../../apps/web/src/session-mode/bindings/v2";

const referenceUrl = process.env.CODEX_GOAL_REFERENCE_URL;
const statuses: ThreadGoalStatus[] = [
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
];

async function measure(locator: Locator) {
  return locator.evaluate((element) => {
    const r = element.getBoundingClientRect(),
      s = getComputedStyle(element);
    const rgba = (value: string) => {
      const context = document.createElement("canvas").getContext("2d")!;
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    return {
      width: r.width,
      height: r.height,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      fontWeight: s.fontWeight,
      padding: s.padding,
      gap: s.gap,
      radius: s.borderRadius,
      color: rgba(s.color),
      background: rgba(s.backgroundColor),
      border: rgba(s.borderTopColor),
      borderWidth: s.borderTopWidth,
      outline: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      backdropFilter: s.backdropFilter,
      boxShadow: s.boxShadow,
      resize: s.resize,
      overflowX: s.overflowX,
      overflowY: s.overflowY,
      colorScheme: s.colorScheme,
      icons: Array.from(element.querySelectorAll("svg")).map((svg) => ({
        viewBox: svg.getAttribute("viewBox"),
        paths: Array.from(svg.querySelectorAll("path")).map((path) =>
          path.getAttribute("d"),
        ),
      })),
    };
  });
}

async function hostTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate(async (theme) => {
    if (!document.querySelector(".session-mode")) return;
    const path = "/src/session-mode/stores/settings/useThemeStore.ts";
    const { useThemeStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path
    );
    useThemeStore.getState().setTheme(theme);
  }, theme);
  await page.waitForFunction((theme) => {
    const root = document.querySelector(".session-mode");
    return (
      !root ||
      (root.classList.contains(theme) &&
        getComputedStyle(root).colorScheme === theme)
    );
  }, theme);
  await page.evaluate((theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    const values =
      theme === "dark"
        ? ["#20211d", "#282a23", "#ccc", "#858585"]
        : ["#fff", "#f5f5f3", "#3b3b3b", "#717171"];
    const root = document.documentElement;
    [
      "--vscode-editor-background",
      "--vscode-sideBar-background",
      "--vscode-foreground",
      "--vscode-descriptionForeground",
    ].forEach((name, i) => root.style.setProperty(name, values[i]));
    for (const name of [
      "--vscode-menu-background",
      "--vscode-dropdown-background",
    ])
      root.style.setProperty(name, values[1]);
    root.style.setProperty("--vscode-dropdown-foreground", values[2]);
    root.style.setProperty("--vscode-font-family", "system-ui");
    root.style.setProperty("--vscode-font-size", "13px");
    document.body.style.background = values[0];
    document.body.style.color = values[2];
  }, theme);
}

for (const width of [1440, 390])
  for (const theme of ["dark", "light"] as const) {
    test(`Goal original-component geometry and icons ${width} ${theme}`, async ({
      page,
      context,
    }, info) => {
      test.skip(
        !referenceUrl,
        "Set CODEX_GOAL_REFERENCE_URL to the unchanged official Goal component harness",
      );
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 900 });
      const f = await fixtureGoal(page, {
        goal: sampleGoal({ status: "active" }),
      });
      await hostTheme(page, theme);
      const reference = await context.newPage();
      await reference.setViewportSize({ width, height: 900 });
      await reference.goto(referenceUrl!);
      await reference.waitForFunction(() => (window as any).nativeLoaded);
      await hostTheme(reference, theme);
      const product = page.locator(".session-thread-goal");
      const original = reference.locator("#root > div").first();
      const cardWidth = (await product.boundingBox())!.width;
      // Match only the host width. All native and product component CSS stays intact.
      await reference.locator("#root").evaluate(
        (root, width) =>
          Object.assign((root as HTMLElement).style, {
            maxWidth: "none",
            width: `${width + 32}px`,
          }),
        cardWidth,
      );
      const evidence: unknown[] = [];
      for (const status of statuses) {
        const goal = sampleGoal({ status });
        await f.emit(goal);
        await reference.evaluate(
          (goal) => (window as any).renderNativeGoal(goal),
          goal,
        );
        await expect(product).toHaveAttribute("data-goal-status", status);
        await expect(original).toContainText(
          status === "active"
            ? "进行中的目标"
            : status === "complete"
              ? "已达成目标"
              : status === "paused"
                ? "已暂停的目标"
                : status === "blocked"
                  ? "目标已停滞"
                  : status === "usageLimited"
                    ? "目标使用受限"
                    : "目标受限",
        );
        const actual = await measure(product),
          expected = await measure(original);
        evidence.push({ status, actual, expected });
        if (actual.height !== expected.height) {
          const controls = await product
            .locator("button")
            .evaluateAll((buttons) =>
              buttons.map((button) => {
                const s = getComputedStyle(button);
                return {
                  class: button.className,
                  height: s.height,
                  minHeight: s.minHeight,
                  padding: s.padding,
                  boxSizing: s.boxSizing,
                };
              }),
            );
          throw new Error(
            JSON.stringify({ actual, expected, controls }, null, 2),
          );
        }
        expect(actual.height).toBe(expected.height);
        expect(actual.radius).toBe(expected.radius);
        expect(actual.background).toEqual(expected.background);
        expect(actual.color).toEqual(expected.color);
        expect(actual.icons).toEqual(expected.icons);
        const actualRow = await measure(product.locator(".session-goal-row"));
        const originalRow = await measure(
          original.locator(":scope > div").first(),
        );
        expect(actualRow).toMatchObject({
          height: originalRow.height,
          padding: originalRow.padding,
          gap: originalRow.gap,
          fontSize: originalRow.fontSize,
          lineHeight: originalRow.lineHeight,
        });
        expect(await product.innerText()).toBe(await original.innerText());
      }
      await f.emit(sampleGoal({ status: "paused" }));
      await reference.evaluate(
        (goal) => (window as any).renderNativeGoal(goal),
        sampleGoal({ status: "paused" }),
      );
      await product.screenshot({
        path: info.outputPath("session-goal-card.png"),
      });
      await original.screenshot({
        path: info.outputPath("native-goal-card.png"),
      });
      await product
        .getByRole("button", { name: "编辑目标", exact: true })
        .click();
      await original
        .getByRole("button", { name: "编辑目标", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "编辑目标" });
      const nativeDialog = reference.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(nativeDialog).toBeVisible();
      // Both dialogs animate; wait for their actual transitions before measuring.
      await page.waitForTimeout(300);
      await reference.waitForTimeout(300);
      const actualDialog = await measure(dialog),
        expectedDialog = await measure(nativeDialog);
      const actualOverlay = await measure(
          page.locator('[data-slot="dialog-overlay"]'),
        ),
        expectedOverlay = await measure(
          reference.locator(".codex-dialog-overlay"),
        );
      evidence.push({
        dialog: { actual: actualDialog, expected: expectedDialog },
        overlay: { actual: actualOverlay, expected: expectedOverlay },
      });
      await info.attach("native-component-metrics", {
        body: JSON.stringify(evidence, null, 2),
        contentType: "application/json",
      });
      expect(actualDialog.width).toBeCloseTo(expectedDialog.width, 1);
      expect(actualDialog.height).toBeCloseTo(expectedDialog.height, 1);
      expect(actualDialog.radius).toBe(expectedDialog.radius);
      for (const selector of ["textarea", "h2"]) {
        const actual = await measure(dialog.locator(selector)),
          expected = await measure(nativeDialog.locator(selector));
        expect(actual).toMatchObject({
          width: expected.width,
          height: expected.height,
          fontSize: expected.fontSize,
          lineHeight: expected.lineHeight,
          fontWeight: expected.fontWeight,
          ...(selector === "textarea"
            ? {
                resize: expected.resize,
                overflowX: expected.overflowX,
                overflowY: expected.overflowY,
                colorScheme: expected.colorScheme,
              }
            : {}),
        });
        if (expected.borderWidth !== "0px")
          expect(actual.border).toEqual(expected.border);
        expect(actual.outline).toEqual(expected.outline);
      }
      expect(actualDialog.background).toEqual(expectedDialog.background);
      expect(actualDialog.backdropFilter).toEqual(
        expectedDialog.backdropFilter,
      );
      expect(actualOverlay.background).toEqual(expectedOverlay.background);
      expect(actualDialog.icons).toEqual(expectedDialog.icons);
      const actualTile = await measure(
        dialog.locator(".session-goal-dialog-icon"),
      );
      const expectedTile = await measure(
        nativeDialog.locator("svg").first().locator(".."),
      );
      expect(actualTile).toMatchObject({
        width: expectedTile.width,
        height: expectedTile.height,
        padding: expectedTile.padding,
        radius: expectedTile.radius,
        background: expectedTile.background,
      });
      await dialog.screenshot({
        path: info.outputPath("session-goal-editor.png"),
      });
      await nativeDialog.screenshot({
        path: info.outputPath("native-goal-editor.png"),
      });
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await nativeDialog
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(nativeDialog).toHaveCount(0);
      await page
        .locator(".session-codex-composer [contenteditable=true]")
        .first()
        .fill("/goal 原生与本地一致的替换目标");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await reference.evaluate(() =>
        (window as any).renderNativeGoalConfirmation("replace", {
          confirmation: { draft: { objective: "原生与本地一致的替换目标" } },
          onClose() {},
          onConfirm() {},
        }),
      );
      expect(
        await reference.evaluate(() => (window as any).nativeErrors),
      ).toEqual([]);
      const confirmation = page.getByRole("dialog", {
        name: "替换当前目标吗？",
      });
      await expect(confirmation).toBeVisible();
      await expect(nativeDialog).toBeVisible();
      await page.waitForTimeout(300);
      await reference.waitForTimeout(300);
      const actualConfirmation = await measure(confirmation),
        expectedConfirmation = await measure(nativeDialog);
      const actualConfirmationOverlay = await measure(
          page.locator('[data-slot="dialog-overlay"]'),
        ),
        expectedConfirmationOverlay = await measure(
          reference.locator(".codex-dialog-overlay"),
        );
      await info.attach("confirmation-metrics", {
        body: JSON.stringify({
          actual: actualConfirmation,
          expected: expectedConfirmation,
          overlay: {
            actual: actualConfirmationOverlay,
            expected: expectedConfirmationOverlay,
          },
        }),
        contentType: "application/json",
      });
      expect(await confirmation.innerText()).toBe(
        await nativeDialog.innerText(),
      );
      expect(actualConfirmation.width).toBeCloseTo(
        expectedConfirmation.width,
        1,
      );
      expect(actualConfirmationOverlay.background).toEqual(
        expectedConfirmationOverlay.background,
      );
      if (actualConfirmation.height !== expectedConfirmation.height) {
        const detail = (element: Element) =>
          Array.from(element.querySelectorAll("*"))
            .filter((e) => !e.children.length && e.textContent?.trim())
            .map((e) => {
              const s = getComputedStyle(e),
                r = e.getBoundingClientRect();
              return {
                tag: e.tagName,
                text: e.textContent,
                width: r.width,
                height: r.height,
                font: s.font,
                padding: s.padding,
                margin: s.margin,
                whiteSpace: s.whiteSpace,
                className: e.className,
              };
            });
        throw new Error(
          JSON.stringify(
            {
              actual: await confirmation.evaluate(detail),
              expected: await nativeDialog.evaluate(detail),
            },
            null,
            2,
          ),
        );
      }
      expect(actualConfirmation.height).toBeCloseTo(
        expectedConfirmation.height,
        1,
      );
      const actualObjective = await measure(
        confirmation.locator(".session-goal-confirm-objective"),
      );
      const expectedObjective = await measure(
        nativeDialog.locator("[class*=line-clamp]"),
      );
      expect(actualObjective).toMatchObject({
        width: expectedObjective.width,
        height: expectedObjective.height,
        fontSize: expectedObjective.fontSize,
        lineHeight: expectedObjective.lineHeight,
        radius: expectedObjective.radius,
        color: expectedObjective.color,
        background: expectedObjective.background,
      });
      await confirmation.screenshot({
        path: info.outputPath("session-goal-replacement.png"),
      });
      await nativeDialog.screenshot({
        path: info.outputPath("native-goal-replacement.png"),
      });
      expect(
        await reference.evaluate(() => (window as any).nativeErrors),
      ).toEqual([]);
      await reference.close();
    });
  }
