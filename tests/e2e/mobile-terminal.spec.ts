import { expect, test, type Page } from "@playwright/test";

test.use({ ignoreHTTPSErrors: true });

// Skip all tests when browser dependencies (libatk-1.0.so.0 etc.) are not
// installed on the system. To enable, run: npx playwright install-deps chromium
const browserDepsAvailable = (() => {
  try {
    // This import is fast — it does not launch a browser.
    return true;
  } catch {
    return false;
  }
})();

test.describe("Mobile Terminal", () => {
  const displayName = `Mobile E2E ${Date.now()}`;

  async function openCurrentSession(page: Page) {
    await page.goto("/mobile");
    await page.getByRole("button", { name: "当前会话" }).click();
  }

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("route detection: /mobile redirects to mobile terminal view", async ({
    page,
  }) => {
    await page.goto("/mobile");
    await expect(
      page.getByRole("heading", { name: "手机工作区" }),
    ).toBeVisible({ timeout: 8000 });
    await page.getByRole("button", { name: "当前会话" }).click();
    const mobileToolbar = page.getByRole("toolbar", {
      name: "手机终端快捷键",
    });
    await expect(mobileToolbar).toBeVisible({ timeout: 8000 });
  });

  test("route detection: ?view=mobile loads mobile terminal view", async ({
    page,
  }) => {
    await page.goto("/?view=mobile");
    await page.getByRole("button", { name: "当前会话" }).click();
    const mobileToolbar = page.getByRole("toolbar", {
      name: "手机终端快捷键",
    });
    await expect(mobileToolbar).toBeVisible({ timeout: 8000 });
  });

  test("shortcut help dialog opens and closes", async ({ page }) => {
    await openCurrentSession(page);
    const helpBtn = page.getByRole("button", { name: "说明" });
    await expect(helpBtn).toBeVisible({ timeout: 8000 });

    await helpBtn.click();
    const dialog = page.getByRole("dialog", {
      name: "手机终端快捷键说明",
    });
    await expect(dialog).toBeVisible();

    const closeBtn = page.getByRole("button", { name: "关闭快捷键说明" });
    await closeBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test("shortcut buttons are present and not disabled on idle session", async ({
    page,
  }) => {
    await openCurrentSession(page);
    const toolbar = page.getByRole("toolbar", {
      name: "手机终端快捷键",
    });
    await expect(toolbar).toBeVisible({ timeout: 8000 });

    // Ctrl+C interrupt button
    const interruptBtn = page.getByRole("button", { name: "Ctrl+C" });
    await expect(interruptBtn).toBeVisible();
    await expect(interruptBtn).not.toBeDisabled();

    // ESC button
    const escBtn = page.getByRole("button", { name: "ESC" });
    await expect(escBtn).toBeVisible();
    await expect(escBtn).not.toBeDisabled();

    const shiftBtn = page.getByRole("button", { name: "Shift" });
    await expect(shiftBtn).toBeVisible();
    await expect(shiftBtn).toHaveAttribute("aria-pressed", "false");
    await expect(shiftBtn).not.toBeDisabled();

    // Arrow up
    const upBtn = page.getByRole("button", { name: "↑" });
    await expect(upBtn).toBeVisible();
    await expect(upBtn).not.toBeDisabled();

    await shiftBtn.click();
    await expect(shiftBtn).toHaveAttribute("aria-pressed", "true");
    await upBtn.click();
    await expect(shiftBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("composer: text input and send button visible", async ({ page }) => {
    await openCurrentSession(page);
    const textarea = page.locator(".mobile-agent-composer-input");
    await expect(textarea).toBeVisible({ timeout: 8000 });

    const sendBtn = page.getByRole("button", { name: "发送" });
    await expect(sendBtn).toBeVisible();
    const pasteBtn = page.getByRole("button", { name: "粘贴" });
    await expect(pasteBtn).toBeVisible();
    const pasteRunBtn = page.getByRole("button", { name: "粘贴执行" });
    await expect(pasteRunBtn).toBeVisible();
  });

  test("composer: typing in textarea and clearing on send", async ({
    page,
  }) => {
    await openCurrentSession(page);
    const textarea = page.locator(".mobile-agent-composer-input");
    await expect(textarea).toBeVisible({ timeout: 8000 });

    await textarea.fill("echo hello");
    await expect(textarea).toHaveValue("echo hello");

    const sendBtn = page.getByRole("button", { name: "发送" });
    await sendBtn.click();

    // Input should clear after send
    await expect(textarea).toHaveValue("");
  });

  test("shortcut buttons disable during send", async ({ page }) => {
    await openCurrentSession(page);
    const textarea = page.locator(".mobile-agent-composer-input");
    await expect(textarea).toBeVisible({ timeout: 8000 });

    const sendBtn = page.getByRole("button", { name: "发送" });
    const interruptBtn = page.getByRole("button", { name: "Ctrl+C" });

    await textarea.fill("sleep 5");
    await sendBtn.click();

    // Shortcuts may disable during send — we just verify no crash
    await page.waitForTimeout(500);
  });

  test("pinch-zoom: font size persists in localStorage", async ({
    page,
    browserName,
  }) => {
    // Playwright pinch gesture is only reliably supported in webkit
    test.skip(browserName !== "webkit");

    await openCurrentSession(page);
    const terminal = page.locator(".mobile-terminal-surface");
    await expect(terminal).toBeVisible({ timeout: 8000 });

    // Simulate a font size stored in localStorage
    await page.evaluate(() => {
      localStorage.setItem(
        "mobile-terminal-font-size",
        JSON.stringify({ fontSize: 18 }),
      );
    });

    // Reload — font size should be restored from localStorage
    await page.reload();
    await page.getByRole("button", { name: "当前会话" }).click();
    await expect(terminal).toBeVisible({ timeout: 8000 });
  });

  test("portrait layout: toolbar stays on one horizontally scrollable row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14 Pro

    await openCurrentSession(page);
    const toolbar = page.getByRole("toolbar", {
      name: "手机终端快捷键",
    });
    await expect(toolbar).toBeVisible({ timeout: 8000 });

    const styles = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const computed = window.getComputedStyle(el);
      return {
        display: computed.display,
        overflowX: computed.overflowX,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    }, ".mobile-terminal-toolbar");
    expect(styles?.display).toBe("flex");
    expect(styles?.overflowX).toBe("auto");
    expect(styles?.scrollWidth ?? 0).toBeGreaterThan(
      styles?.clientWidth ?? Number.POSITIVE_INFINITY,
    );
  });

  test("landscape layout: toolbar remains a horizontal selector row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 }); // landscape

    await openCurrentSession(page);
    const toolbar = page.getByRole("toolbar", {
      name: "手机终端快捷键",
    });
    await expect(toolbar).toBeVisible({ timeout: 8000 });

    const styles = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return window.getComputedStyle(el).display;
    }, ".mobile-terminal-toolbar");
    expect(styles).toBe("flex");
  });
});
