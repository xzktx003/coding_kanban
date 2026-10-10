import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
test("nonzero browser safe-area reserves bottom controls without clipping or focusing input", async ({
  page,
}, info) => {
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session");
  const composer = page.locator(".session-codex-composer");
  const workbench = page.locator(".session-mode .session-workbench");
  await composer.locator("[contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 1);
  const session = await page.context().newCDPSession(page);
  // Chromium platform override, not a claim about a physical phone/notch.
  await session.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 44, bottom: 34, left: 0, right: 0 },
  });
  await page.screenshot({
    path: info.outputPath("nonzero-safe-area-before-validation.png"),
    fullPage: true,
  });
  await expect
    .poll(() =>
      workbench.evaluate((el) =>
        parseFloat(getComputedStyle(el).paddingBottom),
      ),
    )
    .toBe(34);
  expect(
    await workbench.evaluate((el) =>
      parseFloat(getComputedStyle(el).paddingTop),
    ),
  ).toBe(44);
  const send = composer.getByRole("button", { name: "发送消息", exact: true });
  const box = (await send.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(844 - 34);
  const branch = (await page
    .getByRole("button", { name: /^Git 分支：/ })
    .first()
    .boundingBox())!;
  expect(branch.y + branch.height).toBeLessThanOrEqual(844 - 34);
  expect(
    (await page.locator(".session-mode nav").first().boundingBox())!.y,
  ).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await composer
      .locator("[contenteditable=true]")
      .first()
      .evaluate((el) => document.activeElement === el),
  ).toBe(false);
  await page.screenshot({
    path: info.outputPath("nonzero-safe-area-34.png"),
    fullPage: true,
  });
  await info.attach("safe-area-receipt", {
    body: JSON.stringify({
      insets: { top: 44, bottom: 34 },
      send: box,
      padding: await workbench.evaluate(
        (el) => getComputedStyle(el).paddingBottom,
      ),
    }),
    contentType: "application/json",
  });
  await session.detach();
});
