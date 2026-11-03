import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const screenshotDir =
  process.env.MOBILE_TERMINAL_SCREENSHOT_DIR ??
  join(process.cwd(), ".dev-runtime", "mobile-terminal-screenshots");

test.use({
  hasTouch: true,
  ignoreHTTPSErrors: true,
  launchOptions: {
    args: [
      "--font-render-hinting=none",
      "--disable-font-subpixel-positioning",
    ],
  },
});

const failedResponses: string[] = [];

async function shot(page: Page, name: string) {
  mkdirSync(screenshotDir, { recursive: true });
  const overlay = await page.getByText("Internal Server Error").count();
  expect(overlay, failedResponses.join("\n")).toBe(0);
  await page.screenshot({
    fullPage: true,
    path: join(screenshotDir, name),
  });
}

test.describe("Mobile Terminal", () => {
  let sessionId: string | undefined;
  let sessionName: string;

  test.beforeEach(async ({ page, request }) => {
    failedResponses.length = 0;
    page.on("response", (response) => {
      if (response.status() >= 500) {
        failedResponses.push(`${response.status()} ${response.url()}`);
      }
    });
    sessionName = `Mobile E2E ${Date.now()}`;
    const response = await request.post("/api/agent-launch/pty", {
      data: {
        workspaceId: "default",
        displayName: sessionName,
        agentKind: "shell",
        command: "node scripts/mock-terminal-agent.mjs raw",
        workingDirectory: process.cwd(),
        tmuxSessionName: `mobilee2e${Date.now()}`,
      },
    });
    expect(response.ok()).toBeTruthy();
    sessionId = (await response.json()).id as string;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?view=mobile", { timeout: 45_000, waitUntil: "domcontentloaded" });
  });

  test.afterEach(async ({ request }) => {
    if (!sessionId) return;
    await request.delete(`/api/agent-sessions/${sessionId}`);
    sessionId = undefined;
  });

  async function openSession(page: Page) {
    const card = page.getByRole("button", {
      name: `打开 ${sessionName} 当前会话`,
    });
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.click();
    await expect(page.locator(".mobile-terminal-surface")).toBeVisible();
  }

  test("phone entries land on grouped sessions, then one fullscreen terminal", async ({
    page,
  }) => {
    await expect(page.getByRole("heading", { name: "手机工作区" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator(".mobile-attention-group").first()).toBeVisible();
    await expect(page.locator(".mobile-agent-composer")).toHaveCount(0);
    await shot(page, "portrait-session-list.png");

    const frames: string[] = [];
    page.on("websocket", (socket) => {
      socket.on("framesent", (frame) => {
        frames.push(
          typeof frame.payload === "string"
            ? frame.payload
            : Buffer.from(frame.payload).toString("latin1"),
        );
      });
    });
    await openSession(page);
    const surface = page.locator(".mobile-terminal-surface");
    await expect(surface).toContainText("raw-ready", { timeout: 20_000 });
    const box = await surface.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(180);
    await expect(page.locator(".mobile-agent-composer")).toHaveCount(0);
    await expect(page.getByRole("toolbar", { name: "Termux 扩展键" })).toBeVisible();
    for (const label of ["ESC", "/", "-", "HOME", "UP", "END", "PGUP", "TAB", "CTRL", "ALT", "LEFT", "DOWN", "RIGHT", "PGDN"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "会话" })).toBeVisible();
    await shot(page, "portrait-terminal.png");

    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          `/api/agent-sessions/${sessionId}/stdin`
      ) {
        frames.push(request.postDataJSON().input as string);
      }
    });
    const ime = page.getByLabel("终端输入");
    await ime.focus();
    await page.keyboard.type("hi");
    await page.getByRole("button", { name: "CTRL" }).click();
    await page.getByRole("button", { name: "/" }).click();
    await expect.poll(() => frames.join("")).toContain("hi");
    await expect.poll(() => frames.some((frame) => frame.includes("\u001f"))).toBe(true);
    await page.waitForTimeout(1500);
    const screen = page.locator(".xterm-screen");
    await screen.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const fire = (type: string, x: number, y: number) => {
        const touch = new Touch({
          identifier: 1,
          target: node,
          clientX: x,
          clientY: y,
        });
        node.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === "touchend" ? [] : [touch],
            changedTouches: [touch],
          }),
        );
      };
      fire("touchstart", box.left + 40, box.top + 36);
      fire("touchend", box.left + 40, box.top + 36);
      fire("touchstart", box.left + 40, box.top + 160);
      fire("touchmove", box.left + 40, box.top + 40);
      fire("touchend", box.left + 40, box.top + 20);
    });
    await page.getByRole("button", { name: "CTRL" }).click();
    await page.getByRole("button", { name: "LEFT", exact: true }).click();
    const joined = () => frames.join("");
    await expect.poll(() => joined().includes("\u001b[<0;")).toBe(true);
    await expect.poll(() => /\u001b\[<0;\d+;\d+m/.test(joined())).toBe(true);
    await expect
      .poll(() => joined().includes("\u001b[<64;") || joined().includes("\u001b[<65;"))
      .toBe(true);
    const flingWheels = (joined().match(/\u001b\[<6[45];/g) ?? []).length;
    expect(flingWheels).toBeGreaterThan(1);
    await expect.poll(() => joined().includes("\u001b[1;5D")).toBe(true);
    await shot(page, "portrait-typed.png");

    await page.getByRole("button", { name: "会话工具" }).click();
    const drawer = page.getByRole("dialog", { name: "会话工具" });
    await expect(drawer.getByRole("button", { name: "完整记录" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "变更" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "文件" })).toBeVisible();
    await expect(drawer.getByRole("option", { name: new RegExp(sessionName) })).toBeVisible();
    await shot(page, "portrait-drawer.png");
  });

  test("leaving the phone terminal stops later drags from reaching the disposed terminal", async ({
    page,
  }) => {
    const frames: string[] = [];
    page.on("websocket", (socket) => {
      socket.on("framesent", (frame) => {
        frames.push(
          typeof frame.payload === "string"
            ? frame.payload
            : Buffer.from(frame.payload).toString("latin1"),
        );
      });
    });
    await expect(page.getByRole("heading", { name: "手机工作区" })).toBeVisible({
      timeout: 20_000,
    });
    await openSession(page);
    await expect(page.locator(".mobile-terminal-surface")).toContainText("raw-ready", {
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "看板" }).click();
    await expect(page.getByRole("heading", { name: "手机工作区" })).toBeVisible();
    const before = frames.join("");
    await page.evaluate(() => {
      for (const type of ["pointerdown", "pointermove", "pointerup"]) {
        document.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            clientX: 120,
            clientY: type === "pointerdown" ? 240 : 40,
          }),
        );
      }
    });
    await page.waitForTimeout(400);
    expect(frames.join("").slice(before.length)).not.toContain("\u001b[<");
  });

  test("a wide desktop terminal page stays the desktop terminal", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=terminal");
    await expect(page.getByRole("heading", { name: "手机工作区" })).toHaveCount(0);
    await expect(page.locator(".termux-extra-keys")).toHaveCount(0);
  });

  test("a phone opening the desktop terminal page uses the same session UI", async ({
    page,
  }) => {
    await page.goto("/?mode=terminal");
    await expect(page.getByRole("heading", { name: "手机工作区" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator(".mobile-agent-composer")).toHaveCount(0);
    await shot(page, "portrait-desktop-terminal-entry.png");
  });

  test("short landscape keeps a readable terminal and the accessory row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openSession(page);
    const surface = page.locator(".mobile-terminal-surface");
    await expect(surface).toContainText("raw-ready", { timeout: 20_000 });
    const box = await surface.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(140);
    const accessory = page.getByRole("toolbar", { name: "Termux 扩展键" });
    await expect(accessory).toBeVisible();
    const overlap = await page.evaluate(() => {
      const screen = document.querySelector(".xterm-screen");
      const row = document.querySelector(".termux-extra-keys");
      if (!(screen instanceof HTMLElement) || !(row instanceof HTMLElement)) {
        return null;
      }
      const screenBox = screen.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      return {
        rowTop: rowBox.top,
        screenBottom: screenBox.bottom,
      };
    });
    expect(overlap).not.toBeNull();
    expect(overlap!.screenBottom).toBeLessThanOrEqual(overlap!.rowTop + 1);
    const clipped = await page.evaluate(() => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      return [...document.querySelectorAll(".termux-extra-key")]
        .map((button) => {
          const box = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const textClipped =
            button.scrollWidth > button.clientWidth + 1 ||
            style.overflowX === "hidden" ||
            style.textOverflow === "ellipsis";
          return {
            label: button.textContent?.trim() ?? "",
            inside:
              !textClipped &&
              box.width > 0 &&
              box.height > 0 &&
              box.left >= -1 &&
              box.top >= -1 &&
              box.right <= viewportWidth + 1 &&
              box.bottom <= viewportHeight + 1,
          };
        })
        .filter((button) => !button.inside)
        .map((button) => button.label);
    });
    expect(clipped).toEqual([]);
    await shot(page, "landscape-terminal.png");
  });
});
