/** Actual browser DOM/CSS observations; no mocked focus or disabled state. */
import type { Locator, Page } from "@playwright/test";

export const controlNames = [
  "card",
  "cardAction",
  "close",
  "dialog",
  "textarea",
  "tile",
  "cancel",
  "save",
  "objective",
] as const;
export type ControlName = (typeof controlNames)[number];
export type Controls = Partial<Record<ControlName, Locator>>;

export async function hostTheme(page: Page, theme: "dark" | "light") {
  // Same fixture host values as session-goals-reference; no component CSS edit.
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
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    const values =
      theme === "dark"
        ? ["#20211d", "#282a23", "#ccc", "#858585", "#63a8f8"]
        : ["#fff", "#f5f5f3", "#3b3b3b", "#717171", "#1c64c8"];
    [
      "--vscode-editor-background",
      "--vscode-sideBar-background",
      "--vscode-foreground",
      "--vscode-descriptionForeground",
      // Match existing session-theme.css default --ring on both hosts. Theme
      // store changes theme/accent; it does not define this VS Code variable.
      "--vscode-focusBorder",
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

export async function environment(page: Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      url: location.href,
      userAgent: navigator.userAgent,
      secure: isSecureContext,
      viewport: { width: innerWidth, height: innerHeight },
      cornerShapeSupported: CSS.supports("corner-shape", "superellipse(1.5)"),
      windowType: document.documentElement.dataset.codexWindowType ?? null,
      rootFontSize: root.fontSize,
      hostFocusBorder: root.getPropertyValue("--vscode-focusBorder").trim(),
      hover: matchMedia("(hover:hover)").matches,
      forcedColors: matchMedia("(forced-colors:active)").matches,
      rootVariables: Object.fromEntries(
        [
          "--corner-radius-scale",
          "--codex-corner-radius-scale",
          "--codex-corner-shape",
          "--radius-md",
          "--radius-lg",
          "--radius-xl",
          "--radius-2xl",
          "--radius-3xl",
          "--radius-button-toolbar",
        ].map((name) => [name, root.getPropertyValue(name).trim()]),
      ),
    };
  });
}

export async function measure(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element),
      rect = element.getBoundingClientRect();
    const rgba = (value: string) => {
      const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    return {
      tag: element.tagName,
      ariaLabel: element.getAttribute("aria-label"),
      text: element.textContent?.trim().slice(0, 120),
      class: element.getAttribute("class"),
      firstChild: element.matches(":first-child"),
      ancestorClasses: [
        element.parentElement,
        element.parentElement?.parentElement,
      ].map((parent) => parent?.className ?? null),
      disabled: element.matches(":disabled"),
      ariaDisabled: element.getAttribute("aria-disabled"),
      active: document.activeElement === element,
      focus: element.matches(":focus"),
      focusVisible: element.matches(":focus-visible"),
      hover: element.matches(":hover"),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      cornerShape: style.getPropertyValue("corner-shape").trim(),
      corners: {
        topLeft: style.borderTopLeftRadius,
        topRight: style.borderTopRightRadius,
        bottomRight: style.borderBottomRightRadius,
        bottomLeft: style.borderBottomLeftRadius,
      },
      individualCornerShapes: Object.fromEntries(
        ["top-left", "top-right", "bottom-right", "bottom-left"].map(
          (corner) => [
            corner,
            style.getPropertyValue(`corner-${corner}-shape`).trim(),
          ],
        ),
      ),
      background: rgba(style.backgroundColor),
      color: rgba(style.color),
      borderColor: rgba(style.borderTopColor),
      borderWidth: style.borderTopWidth,
      outlineStyle: style.outlineStyle,
      outlineColor: rgba(style.outlineColor),
      outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset,
      boxShadow: style.boxShadow,
      cursor: style.cursor,
      opacity: style.opacity,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      variables: Object.fromEntries(
        [
          "--corner-radius-scale",
          "--codex-corner-radius-scale",
          "--codex-corner-shape",
          "--radius-md",
          "--radius-lg",
          "--radius-xl",
          "--radius-2xl",
          "--radius-3xl",
          "--radius-button-toolbar",
          "--color-ring",
          "--color-text-secondary",
          "--vscode-focusBorder",
        ].map((name) => [name, style.getPropertyValue(name).trim()]),
      ),
      animations: element
        .getAnimations({ subtree: false })
        .map((animation) => ({
          playState: animation.playState,
          currentTime: String(animation.currentTime),
        })),
    };
  });
}

export async function snapshot(controls: Controls) {
  const result: Record<string, unknown> = {};
  for (const [name, locator] of Object.entries(controls)) {
    try {
      const count = await locator!.count();
      if (count !== 1) {
        result[name] = {
          ok: false,
          error: `Expected one actual element; found ${count}`,
        };
        continue;
      }
      result[name] = { ok: true, value: await measure(locator!) };
    } catch (error) {
      // Do not let a missing shape/element hide remaining state evidence.
      result[name] = { ok: false, error: String(error) };
    }
  }
  return result;
}

export async function tabTo(page: Page, target: Locator) {
  const visits: unknown[] = [];
  for (let count = 0; count < 16; count++) {
    await page.keyboard.press("Tab");
    visits.push(
      await page.evaluate(() => {
        const e = document.activeElement;
        return {
          tag: e?.tagName,
          label: e?.getAttribute("aria-label"),
          text: e?.textContent?.trim().slice(0, 80),
          focusVisible: e?.matches(":focus-visible"),
        };
      }),
    );
    if (await target.evaluate((e) => e === document.activeElement))
      return { reached: true, visits };
  }
  return { reached: false, visits };
}

export async function pointerHover(page: Page, target: Locator) {
  const rect = await target.boundingBox();
  if (!rect) throw new Error("Actual hover target has no bounding rectangle");
  // A real pointer move works for disabled controls. No forced click/DOM state.
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.waitForTimeout(200);
}
