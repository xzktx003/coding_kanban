import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const mode of ["session", "terminal", "codex"])
  test(`early entry preloads only the selected session without running application effects (${mode})`, async ({
    page,
  }) => {
    await installSessionUxFixture(page, 0);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let appModules = 0;
    const api: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/src/session-mode/App.tsx") appModules++;
      if (path.startsWith("/api/")) api.push(path);
    });
    await page.route(/\/src\/main\.tsx(?:\?|$)/, async (route) => {
      await held;
      await route.continue();
    });
    try {
      await page.goto(`/?mode=${mode}`, { waitUntil: "commit" });
      if (mode === "session")
        await expect.poll(() => appModules).toBeGreaterThan(0);
      else {
        await page.waitForTimeout(500);
        expect(appModules).toBe(0);
      }
      expect(api).toEqual([]);
      expect(
        await page
          .locator("#root")
          .evaluate((element) => element.childElementCount),
      ).toBe(0);
    } finally {
      release();
    }
  });
