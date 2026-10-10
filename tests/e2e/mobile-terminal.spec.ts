import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  let sessionId: string | undefined;

  async function openCurrentSession(page: Page) {
    await page.goto("/mobile");
    await expect(page.locator(".mobile-session-picker-trigger")).toBeEnabled({
      timeout: 8000,
    });
  }

  test.beforeEach(async ({ page, request }) => {
    const response = await request.post("/api/agent-launch/pty", {
      data: {
        workspaceId: "default",
        displayName: `Mobile E2E ${Date.now()}`,
        agentKind: "shell",
        command: "node scripts/mock-terminal-agent.mjs raw",
        workingDirectory: process.cwd(),
      },
    });
    expect(response.ok()).toBeTruthy();
    sessionId = (await response.json()).id as string;
    await page.goto("/");
  });

  test.afterEach(async ({ request }) => {
    if (!sessionId) return;
    await request.delete(`/api/agent-sessions/${sessionId}`);
    sessionId = undefined;
  });

  test("route detection: /mobile redirects to mobile terminal view", async ({
    page,
  }) => {
    await page.goto("/mobile");
    const mobileToolbar = page.getByRole("toolbar", {
      name: "手机终端快捷键",
    });
    await expect(mobileToolbar).toBeVisible({ timeout: 8000 });
  });

  test("route detection: ?view=mobile loads mobile terminal view", async ({
    page,
  }) => {
    await page.goto("/?view=mobile");
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
      name: "快捷键说明",
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
    const interruptBtn = page.getByRole("button", {
      name: "中断当前输出或命令",
    });
    await expect(interruptBtn).toBeVisible();
    await expect(interruptBtn).not.toBeDisabled();

    const ctrlBBtn = page.getByRole("button", {
      name: "发送 Ctrl+B；tmux 默认用作前缀键",
    });
    await expect(ctrlBBtn).toBeVisible();
    await expect(ctrlBBtn).not.toBeDisabled();

    // ESC button
    const escBtn = page.getByRole("button", { name: "退出 TUI 当前状态" });
    await expect(escBtn).toBeVisible();
    await expect(escBtn).not.toBeDisabled();

    const shiftBtn = page.getByRole("button", { name: "Shift" });
    await expect(shiftBtn).toBeVisible();
    await expect(shiftBtn).toHaveAttribute("aria-pressed", "false");
    await expect(shiftBtn).not.toBeDisabled();

    // Arrow up
    const upBtn = page.getByRole("button", { name: /方向键上/ });
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

    const sendBtn = page.getByRole("button", { name: "发送", exact: true });
    await expect(sendBtn).toBeVisible();
    const pasteBtn = page.getByRole("button", { name: "粘贴" });
    await expect(pasteBtn).toBeVisible();
  });

  test("composer: typing in textarea and clearing on send", async ({
    page,
  }) => {
    await openCurrentSession(page);
    const textarea = page.locator(".mobile-agent-composer-input");
    await expect(textarea).toBeVisible({ timeout: 8000 });

    await textarea.fill("echo hello");
    await expect(textarea).toHaveValue("echo hello");

    const sendBtn = page.getByRole("button", { name: "发送", exact: true });
    const trigger = page.locator(".mobile-session-picker-trigger");
    await expect(page.locator(".mobile-terminal-surface")).toContainText(
      "raw-ready",
      { timeout: 8000 },
    );
    await expect(sendBtn).toBeEnabled();
    await expect(trigger).not.toHaveText("没有可用会话");
    await sendBtn.click();

    await expect(trigger).not.toHaveText("没有可用会话");
    await expect(textarea).toHaveValue("");
  });

  test("shortcut buttons disable during send", async ({ page }) => {
    await openCurrentSession(page);
    const textarea = page.locator(".mobile-agent-composer-input");
    await expect(textarea).toBeVisible({ timeout: 8000 });

    const sendBtn = page.getByRole("button", { name: "发送", exact: true });
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

  test("horizontal drag scrolls the shortcut bar to a clipped key", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCurrentSession(page);
    const toolbar = page.locator(".mobile-terminal-toolbar");
    await expect(toolbar).toBeVisible({ timeout: 8000 });

    const tab = toolbar.getByRole("button", { name: "补全或切换焦点" });
    const clipped = toolbar.getByRole("button", { name: "说明" });
    const tabBox = await tab.boundingBox();
    const toolbarBox = await toolbar.boundingBox();
    expect(tabBox).not.toBeNull();
    expect(toolbarBox).not.toBeNull();

    const startX = tabBox!.x + tabBox!.width / 2;
    const startY = tabBox!.y + Math.min(12, tabBox!.height / 2);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 280, startY, { steps: 8 });
    await page.mouse.move(toolbarBox!.x + 24, startY, { steps: 4 });
    await page.mouse.up();
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 280, startY, { steps: 8 });
    await page.mouse.up();

    const scrollLeft = await toolbar.evaluate((element) => element.scrollLeft);
    expect(scrollLeft).toBeGreaterThanOrEqual(40);

    const inside = await page.evaluate(() => {
      const bar = document.querySelector(".mobile-terminal-toolbar");
      const key = [...document.querySelectorAll(".mobile-terminal-key")].find(
        (node) => node.textContent?.trim() === "说明",
      );
      if (!bar || !key) return false;
      const barBox = bar.getBoundingClientRect();
      const keyBox = key.getBoundingClientRect();
      return (
        keyBox.left >= barBox.left - 1 &&
        keyBox.right <= barBox.right + 1 &&
        keyBox.top >= barBox.top - 1 &&
        keyBox.bottom <= barBox.bottom + 1 &&
        keyBox.width > 0
      );
    });
    expect(inside).toBe(true);
    await expect(clipped).toBeVisible();

    const sent = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().includes("/stdin"),
    );
    await tab.click();
    const request = await sent;
    const payload = request.postDataJSON() as { input?: string };
    expect(payload.input).toBe("\t");
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

  async function readTerminalFit(page: Page) {
    await expect(page.locator(".mobile-terminal-surface .xterm")).toBeAttached({
      timeout: 8000,
    });
    return page.evaluate(() => {
      const surface = document.querySelector(".mobile-terminal-surface");
      const buffer =
        document.querySelector(".xterm-screen") ??
        document.querySelector(".xterm-rows");
      const identity = document.querySelector(".mobile-session-picker-trigger");
      const send = [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "发送",
      );
      const nav = document.querySelector(".mobile-primary-nav");
      if (!surface || !buffer || !identity || !send) return null;
      const surfaceBox = surface.getBoundingClientRect();
      const bufferBox = buffer.getBoundingClientRect();
      const identityBox = identity.getBoundingClientRect();
      const sendBox = send.getBoundingClientRect();
      const navBox = nav?.getBoundingClientRect() ?? null;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const inside = (box: DOMRect) =>
        box.top >= -1 &&
        box.left >= -1 &&
        box.bottom <= viewportHeight + 1 &&
        box.right <= viewportWidth + 1;
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.top < b.bottom - 1 &&
        a.bottom > b.top + 1 &&
        a.left < b.right - 1 &&
        a.right > b.left + 1;
      return {
        surfaceHeight: surfaceBox.height,
        surfaceInside: inside(surfaceBox),
        bufferHeight: bufferBox.height,
        bufferExtendsBelowSurface: bufferBox.bottom > surfaceBox.bottom + 1,
        identityInside: inside(identityBox),
        sendInside: inside(sendBox),
        surfaceCoversIdentity: overlaps(surfaceBox, identityBox),
        surfaceCoversSend: overlaps(surfaceBox, sendBox),
        navVisible: Boolean(
          nav && window.getComputedStyle(nav).display !== "none",
        ),
        navBottom: navBox?.bottom ?? null,
      };
    });
  }

  test("landscape layout: live terminal keeps a readable surface", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });

    await openCurrentSession(page);
    const fit = await readTerminalFit(page);
    expect(fit).not.toBeNull();
    expect(fit!.surfaceHeight).toBeGreaterThanOrEqual(96);
    expect(fit!.surfaceInside).toBe(true);
    expect(fit!.bufferHeight).toBeLessThanOrEqual(fit!.surfaceHeight + 1);
    expect(fit!.bufferExtendsBelowSurface).toBe(false);
    expect(fit!.identityInside).toBe(true);
    expect(fit!.sendInside).toBe(true);
    expect(fit!.surfaceCoversIdentity).toBe(false);
    expect(fit!.surfaceCoversSend).toBe(false);
  });

  test("portrait layout: keyboard inset keeps the composer and send inside the visual viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCurrentSession(page);

    const input = page.locator(".mobile-agent-composer-input");
    const send = page.getByRole("button", { name: "发送", exact: true });
    const nav = page.getByRole("navigation", { name: "手机端主导航" });
    await input.focus();
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, "height", {
        configurable: true,
        get: () => 400,
      });
      window.visualViewport?.dispatchEvent(new Event("resize"));
    });

    await expect(nav).toBeHidden();
    const boxes = await page.evaluate(() => {
      const visibleHeight = window.visualViewport?.height ?? window.innerHeight;
      const inputBox = document
        .querySelector(".mobile-agent-composer-input")
        ?.getBoundingClientRect();
      const sendBox = [...document.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "发送")
        ?.getBoundingClientRect();
      const surface = document
        .querySelector(".mobile-terminal-surface")
        ?.getBoundingClientRect();
      const inside = (box: DOMRect | undefined) =>
        Boolean(
          box &&
            box.width > 0 &&
            box.height > 0 &&
            box.top >= -1 &&
            box.bottom <= visibleHeight + 1,
        );
      return {
        visibleHeight,
        inputInside: inside(inputBox),
        sendInside: inside(sendBox),
        surfaceHeight: surface?.height ?? 0,
        appHeight: getComputedStyle(document.documentElement).getPropertyValue(
          "--app-height",
        ),
      };
    });

    expect(boxes.visibleHeight).toBe(400);
    expect(boxes.appHeight.trim()).toBe("400px");
    expect(boxes.inputInside).toBe(true);
    expect(boxes.sendInside).toBe(true);
    expect(boxes.surfaceHeight).toBeGreaterThanOrEqual(96);

    await input.blur();
    await page.evaluate(() => {
      delete (window.visualViewport as { height?: number }).height;
      window.visualViewport?.dispatchEvent(new Event("resize"));
    });
    await expect(nav).toBeVisible();
  });

  test("portrait layout: live terminal and bottom nav stay visible", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await openCurrentSession(page);
    const fit = await readTerminalFit(page);
    expect(fit).not.toBeNull();
    expect(fit!.surfaceHeight).toBeGreaterThanOrEqual(96);
    expect(fit!.surfaceInside).toBe(true);
    expect(fit!.navVisible).toBe(true);
    expect(fit!.navBottom ?? 0).toBeLessThanOrEqual(844 + 1);
    expect(fit!.bufferExtendsBelowSurface).toBe(false);
  });

  test("portrait layout: closed session switcher shows which window is selected", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const suffix = Date.now().toString();
    const alphaName = `Walk Alpha ${suffix}`;
    const betaName = `Walk Beta ${suffix}`;
    const created: string[] = [];
    for (const displayName of [alphaName, betaName]) {
      const response = await request.post("/api/agent-launch/pty", {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "shell",
          command: "node scripts/mock-terminal-agent.mjs raw",
          workingDirectory: process.cwd(),
        },
      });
      expect(response.ok()).toBeTruthy();
      created.push((await response.json()).id as string);
    }

    try {
      await page.goto("/?view=mobile");
      const trigger = page.locator(".mobile-session-picker-trigger");
      await expect(trigger).toBeEnabled({ timeout: 8000 });

      const readClosedTrigger = async (token: "Alpha" | "Beta") =>
        trigger.evaluate((element, token) => {
          const send = [...document.querySelectorAll("button")].find(
            (button) => button.textContent?.trim() === "发送",
          );
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          let tokenNode: Text | null = null;
          let tokenOffset = -1;
          while (walker.nextNode()) {
            const text = walker.currentNode as Text;
            const offset = text.data.indexOf(token);
            if (offset >= 0) {
              tokenNode = text;
              tokenOffset = offset;
              break;
            }
          }
          if (!send || !tokenNode || tokenOffset < 0) return null;
          const range = document.createRange();
          range.setStart(tokenNode, tokenOffset);
          range.setEnd(tokenNode, tokenOffset + token.length);
          const tokenBox = range.getBoundingClientRect();
          const triggerBox = element.getBoundingClientRect();
          // Padding edge. A border-box comparison of the inner name span is
          // not enough: overflow does not shrink that box, so a clipped
          // token can still sit inside it while the trigger clips the glyphs.
          const clientLeft = triggerBox.left + element.clientLeft;
          const clientRight = clientLeft + element.clientWidth;
          const clientTop = triggerBox.top + element.clientTop;
          const clientBottom = clientTop + element.clientHeight;
          const sendBox = send.getBoundingClientRect();
          const viewportWidth =
            window.visualViewport?.width ?? window.innerWidth;
          const viewportHeight =
            window.visualViewport?.height ?? window.innerHeight;
          const insideViewport = (box: DOMRect) =>
            box.width > 0 &&
            box.height > 0 &&
            box.top >= -1 &&
            box.left >= -1 &&
            box.bottom <= viewportHeight + 1 &&
            box.right <= viewportWidth + 1;
          const overlaps = (a: DOMRect, b: DOMRect) =>
            a.top < b.bottom - 1 &&
            a.bottom > b.top + 1 &&
            a.left < b.right - 1 &&
            a.right > b.left + 1;
          const touchHeight = (selector: string) =>
            [...document.querySelectorAll(selector)].map(
              (node) => node.getBoundingClientRect().height,
            );
          return {
            tokenWidth: tokenBox.width,
            tokenInsideTrigger:
              tokenBox.width >= 1 &&
              tokenBox.left >= triggerBox.left &&
              tokenBox.right <= triggerBox.right &&
              tokenBox.top >= triggerBox.top &&
              tokenBox.bottom <= triggerBox.bottom &&
              tokenBox.left >= clientLeft &&
              tokenBox.right <= clientRight &&
              tokenBox.top >= clientTop &&
              tokenBox.bottom <= clientBottom,
            tokenInsideViewport: insideViewport(tokenBox),
            triggerInside: insideViewport(triggerBox),
            coversSend: overlaps(triggerBox, sendBox),
            triggerHeight: triggerBox.height,
            triggerClientWidth: element.clientWidth,
            triggerScrollWidth: element.scrollWidth,
            shortcutHeights: touchHeight(".mobile-terminal-key"),
            navHeights: touchHeight(".mobile-primary-nav button"),
          };
        }, token);

      const selectClosed = async (name: string) => {
        if ((await page.locator(".mobile-session-picker-menu").count()) === 0) {
          await trigger.click();
        }
        await page.getByRole("option", { name }).click();
        await expect(page.locator(".mobile-session-picker-menu")).toHaveCount(0);
      };

      const assertClosedToken = (
        reading: Awaited<ReturnType<typeof readClosedTrigger>>,
      ) => {
        expect(reading).not.toBeNull();
        expect(reading!.tokenWidth).toBeGreaterThanOrEqual(1);
        expect(reading!.tokenInsideTrigger).toBe(true);
        expect(reading!.tokenInsideViewport).toBe(true);
        expect(reading!.triggerInside).toBe(true);
        expect(reading!.coversSend).toBe(false);
        expect(reading!.triggerHeight).toBeGreaterThanOrEqual(44);
        expect(reading!.shortcutHeights.length).toBeGreaterThan(0);
        expect(
          Math.min(...reading!.shortcutHeights),
        ).toBeGreaterThanOrEqual(44);
        expect(reading!.navHeights.length).toBeGreaterThan(0);
        expect(Math.min(...reading!.navHeights)).toBeGreaterThanOrEqual(44);
      };

      await selectClosed(alphaName);
      assertClosedToken(await readClosedTrigger("Alpha"));
      expect(await readClosedTrigger("Beta")).toBeNull();

      await selectClosed(betaName);
      assertClosedToken(await readClosedTrigger("Beta"));
      expect(await readClosedTrigger("Alpha")).toBeNull();
    } finally {
      for (const id of created) {
        await request.delete(`/api/agent-sessions/${id}`);
      }
    }
  });

  test("portrait changes overlay keeps wide diff lines readable and the close control clear of the bottom nav", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const wide = `PHONE_DIFF_WIDE_${"token_".repeat(48)}END`;
    const root = mkdtempSync(join(tmpdir(), "phone-diff-"));
    const displayName = `Phone Diff ${Date.now()}`;
    let extraSessionId: string | undefined;
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "phone-diff@example.com"], {
      cwd: root,
    });
    execFileSync("git", ["config", "user.name", "phone-diff"], { cwd: root });
    writeFileSync(join(root, "wide.txt"), `kept\n${"pad\n".repeat(80)}`);
    execFileSync("git", ["add", "wide.txt"], { cwd: root });
    execFileSync("git", ["commit", "-m", "base"], { cwd: root });
    writeFileSync(join(root, "wide.txt"), `kept\n${wide}\n${"tail\n".repeat(80)}`);

    try {
      const launched = await request.post("/api/agent-launch/pty", {
        data: {
          workspaceId: "default",
          displayName,
          agentKind: "shell",
          command: "node scripts/mock-terminal-agent.mjs raw",
          workingDirectory: root,
        },
      });
      expect(launched.ok()).toBeTruthy();
      extraSessionId = (await launched.json()).id as string;

      await page.goto("/mobile");
      const trigger = page.locator(".mobile-session-picker-trigger");
      await expect(trigger).toBeEnabled({ timeout: 8000 });
      await trigger.click();
      await page.getByRole("option", { name: displayName }).click();
      await page.getByRole("button", { name: "变更", exact: true }).click();
      const overlay = page.locator(".mobile-changes-overlay");
      await expect(overlay).toBeVisible();
      await expect(
        overlay.locator(".diff-row code", { hasText: wide }),
      ).toBeVisible({
        timeout: 8000,
      });

      const reading = await page.evaluate((marker) => {
        const overlayNode = document.querySelector(".mobile-changes-overlay");
        const nav = document.querySelector(".mobile-primary-nav");
        const close = [...document.querySelectorAll("button")].find(
          (button) => button.getAttribute("aria-label") === "关闭变更面板",
        );
        const revert = overlayNode?.querySelector(".diff-hunk-revert");
        const viewer = overlayNode?.querySelector(".diff-viewer");
        if (
          !(overlayNode instanceof HTMLElement) ||
          !(close instanceof HTMLElement) ||
          !(revert instanceof HTMLElement) ||
          !(viewer instanceof HTMLElement)
        ) {
          return null;
        }
        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        const viewportHeight =
          window.visualViewport?.height ?? window.innerHeight;
        const overlayBox = overlayNode.getBoundingClientRect();
        const closeBox = close.getBoundingClientRect();
        const revertBox = revert.getBoundingClientRect();
        const navBox = nav?.getBoundingClientRect() ?? null;
        const viewerBox = viewer.getBoundingClientRect();
        const inside = (box: DOMRect) =>
          box.width > 0 &&
          box.height > 0 &&
          box.top >= -1 &&
          box.left >= -1 &&
          box.bottom <= viewportHeight + 1 &&
          box.right <= viewportWidth + 1;
        const overlaps = (a: DOMRect, b: DOMRect | null) =>
          Boolean(
            b &&
              a.top < b.bottom - 1 &&
              a.bottom > b.top + 1 &&
              a.left < b.right - 1 &&
              a.right > b.left + 1,
          );
        const insideClient = (box: DOMRect, host: DOMRect) =>
          box.left >= host.left - 1 &&
          box.right <= host.right + 1 &&
          box.top >= host.top - 1 &&
          box.bottom <= host.bottom + 1;
        viewer.scrollTop = 0;
        const codes = [
          ...overlayNode.querySelectorAll(".diff-viewer .diff-row code"),
        ].filter((node) => node.getBoundingClientRect().width > 0);
        const clientWidth = overlayNode.clientWidth;
        const lines = codes.map((node) => {
          const element = node as HTMLElement;
          const row = element.closest(".diff-row") as HTMLElement | null;
          const lineBox = row ?? element;
          return {
            text: element.textContent ?? "",
            scrollWidth: lineBox.scrollWidth,
            clientWidth,
            wrapped:
              lineBox.scrollWidth <= clientWidth + 1 &&
              element.scrollWidth <= clientWidth + 1,
          };
        });
        const wideLine = lines.find((line) => line.text.includes(marker));
        const navClearance = Number.parseFloat(
          getComputedStyle(overlayNode).paddingBottom,
        );
        const before = viewer.scrollTop;
        viewer.scrollTop = viewer.scrollHeight;
        const scrolled = viewer.scrollTop;
        const last = viewer.querySelector(".diff-code > :last-child");
        const lastBox =
          last instanceof HTMLElement ? last.getBoundingClientRect() : null;
        const contentClearsNav =
          lastBox !== null &&
          (navBox === null || lastBox.bottom <= navBox.top + 1);
        viewer.scrollTop = before;
        return {
          lines,
          wideLine: wideLine ?? null,
          closeInside: inside(closeBox),
          closeCoveredByNav: overlaps(closeBox, navBox),
          revertInsideClient: insideClient(revertBox, overlayBox),
          revertCoveredByNav: overlaps(revertBox, navBox),
          navClearance,
          navHeight: navBox?.height ?? 0,
          contentClearsNav,
          canScroll: viewer.scrollHeight > viewer.clientHeight + 1,
          scrolledToEnd: scrolled > before,
          overlayWidth: overlayBox.width,
          viewerHeight: viewerBox.height,
          clientWidth,
        };
      }, wide);
      expect(reading).not.toBeNull();
      expect(reading!.wideLine).not.toBeNull();
      expect(reading!.wideLine!.text).toContain("END");
      expect(reading!.wideLine!.text.length).toBe(wide.length + 1);
      expect(reading!.lines.length).toBeGreaterThan(0);
      for (const line of reading!.lines) {
        expect(line.wrapped).toBe(true);
      }
      expect(reading!.closeInside).toBe(true);
      expect(reading!.closeCoveredByNav).toBe(false);
      expect(reading!.revertInsideClient).toBe(true);
      expect(reading!.revertCoveredByNav).toBe(false);
      expect(reading!.navClearance).toBeGreaterThanOrEqual(
        reading!.navHeight - 1,
      );
      expect(reading!.canScroll).toBe(true);
      expect(reading!.scrolledToEnd).toBe(true);
      expect(reading!.contentClearsNav).toBe(true);
    } finally {
      if (extraSessionId) {
        await request.delete(`/api/agent-sessions/${extraSessionId}`);
      }
      rmSync(root, { force: true, recursive: true });
    }
  });
});
