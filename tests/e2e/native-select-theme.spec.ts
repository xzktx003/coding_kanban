import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const terminalCss = readFileSync("apps/web/src/app.css", "utf8");
const sessionCss = readFileSync(
  "apps/web/src/session-mode/session-theme.css",
  "utf8",
);

// Exercise shipped CSS in a real browser without connecting to running Agents.
for (const systemTheme of ["light", "dark"] as const) {
  for (const mode of ["terminal", "light", "dark"] as const) {
    test(`native selects: ${mode} with ${systemTheme} system theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: systemTheme });
      await page.setContent(`
        <style>${terminalCss}\n${sessionCss}</style>
        <main class="${mode === "terminal" ? "" : `session-mode ${mode} accent-default`}">
          <label>工作目录<select class="drawer-input" aria-label="工作目录">
            <option value="">从已有项目选择…</option>
            <optgroup label="项目"><option value="project">/workspace/中文项目</option></optgroup>
            <option disabled>不可用的项目</option>
          </select></label>
          <select class="filter-select" aria-label="筛选"><option>全部状态</option></select>
          <select class="session-group-menu-select" aria-label="分组"><option>工程</option></select>
        </main>
        <select aria-label="外部弹窗"><option>未分组</option></select>
      `);

      const scheme = mode === "light" ? "light" : "dark";
      for (const select of await page.locator("main select").all()) {
        await expect(select).toHaveCSS("color-scheme", scheme);
      }
      await expect(page.getByLabel("外部弹窗")).toHaveCSS(
        "color-scheme",
        "dark",
      );

      // An opaque paired background/foreground prevents inherited light text
      // from landing on an OS-provided white popup, including option groups.
      const expectedBackground =
        mode === "terminal"
          ? "rgb(27, 29, 34)"
          : mode === "light"
            ? "rgb(245, 245, 243)"
            : "rgb(40, 42, 35)";
      for (const option of await page
        .locator("main option:not(:disabled), main optgroup")
        .all()) {
        await expect(option).toHaveCSS("background-color", expectedBackground);
        const contrast = await option.evaluate((element) => {
          const style = getComputedStyle(element);
          const luminance = (color: string) => {
            const rgb = color
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number)
              .map((value) => {
                const channel = value / 255;
                return channel <= 0.04045
                  ? channel / 12.92
                  : ((channel + 0.055) / 1.055) ** 2.4;
              });
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
          };
          const foreground = luminance(style.color);
          const background = luminance(style.backgroundColor);
          return (
            (Math.max(foreground, background) + 0.05) /
            (Math.min(foreground, background) + 0.05)
          );
        });
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      }

      await page.getByLabel("工作目录").selectOption("project");
      await expect(page.getByLabel("工作目录")).toHaveValue("project");
      if (mode !== "terminal") {
        await page.locator("main").evaluate((element) => {
          element.classList.toggle("light");
          element.classList.toggle("dark");
        });
        await expect(page.getByLabel("工作目录")).toHaveCSS(
          "color-scheme",
          scheme === "light" ? "dark" : "light",
        );
        await expect(page.getByLabel("工作目录")).toHaveValue("project");
        await expect(page.getByLabel("外部弹窗")).toHaveCSS(
          "color-scheme",
          "dark",
        );
      }
    });
  }
}
