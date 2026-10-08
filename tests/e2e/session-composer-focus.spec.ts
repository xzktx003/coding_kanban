import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
test("mobile focus and streaming preserve historical reading; explicit sends follow the latest message", async ({
  page,
}) => {
  const fixture = await installSessionUxFixture(page, 2);
  // Load through the authoritative history endpoint so all turn timing/phase
  // events are identical during background reconciliation and row measurement.
  Object.assign(fixture.threads[0], {
    turns: Array.from({ length: 70 }, (_, i) => ({
      id: `t-${i}`,
      status: "completed",
      startedAt: i + 1,
      durationMs: 1,
      error: null,
      items: [
        {
          type: "agentMessage",
          id: `r-${i}`,
          text: `对话 ${i} ${"手机点击输入框验证。".repeat(20)}`,
          phase: "final",
        },
      ],
    })),
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page.locator(".session-mode [contenteditable=true]").first();
  await editor.waitFor();
  await seedSessionUx(page, 2);
  await page.evaluate(async () => {
    const path = "/src/session-mode/lib/agentNav.ts";
    const { navigateToAgentSession } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    navigateToAgentSession({
      agent: "codex",
      threadId: "ux-0",
      cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
    });
  });
  await page.evaluate(async () => {
    const path = "/src/session-mode/services/codexService.ts";
    const { codexService } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    await codexService.loadThreadHistory("ux-0");
  });
  const transcript = page
    .locator('.session-mode [data-slot="scroll-area-viewport"]')
    .filter({ has: page.locator("[data-session-latest]") });
  const remaining = () =>
    transcript.evaluate(
      (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
    );
  await expect.poll(remaining).toBeLessThan(5);
  await editor.fill("保留的输入草稿");
  await editor.evaluate((el) => (el as HTMLElement).blur());
  // Reading history cancels following until the user scrolls back to bottom.
  await transcript.evaluate((el) => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, bubbles: true }));
    el.scrollTop = el.scrollHeight / 2;
    el.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(200); // let virtual row measurement settle before recording the reading anchor
  const readingTop = await transcript.evaluate((el) => el.scrollTop);
  // Safari keyboard shrinks/pans the visual viewport while layout viewport stays unchanged.
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, {
      height: { configurable: true, value: 460 },
      offsetTop: { configurable: true, value: 180 },
    });
    window.visualViewport!.dispatchEvent(new Event("resize"));
    window.visualViewport!.dispatchEvent(new Event("scroll"));
  });
  await editor.tap();
  await editor.press("End");
  await editor.press("a");
  await expect
    .poll(() => transcript.evaluate((el) => el.scrollTop))
    .toBeCloseTo(readingTop, 0);
  await page.evaluate(async () => {
    const { useCodexStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/components/codex/stores/index.ts",
        )?.name ?? "/src/session-mode/components/codex/stores/index.ts"
    );
    useCodexStore.getState().addEvent("ux-0", {
      method: "item/completed",
      params: {
        threadId: "ux-0",
        turnId: "new",
        item: { id: "new", type: "agentMessage", text: "阅读历史时的新回复" },
      },
    });
  });
  await page.waitForTimeout(150);
  await expect
    .poll(() => transcript.evaluate((el) => el.scrollTop))
    .toBeCloseTo(readingTop, 0);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  // The established delivery contract intentionally follows the newly submitted
  // message. Focus, uploads and incoming streaming alone must preserve reading.
  await expect.poll(remaining).toBeLessThan(5);
  // Returning manually to bottom resumes following subsequent output.
  await transcript.evaluate((el) => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: 500, bubbles: true }));
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll"));
  });
  await page.evaluate(async () => {
    const { useCodexStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/components/codex/stores/index.ts",
        )?.name ?? "/src/session-mode/components/codex/stores/index.ts"
    );
    useCodexStore.getState().addEvent("ux-0", {
      method: "item/completed",
      params: {
        threadId: "ux-0",
        turnId: "latest",
        item: {
          id: "latest",
          type: "agentMessage",
          text: "回到底部后继续跟随。".repeat(150),
        },
      },
    });
  });
  await expect.poll(remaining).toBeLessThan(5);
  const displaced = await editor.evaluate((el) => {
    const result: Array<{ tag: string; scroll: number }> = [];
    for (
      let p = el.parentElement;
      p && p !== document.body;
      p = p.parentElement
    ) {
      if (p.scrollTop > 1)
        result.push({ tag: p.className, scroll: p.scrollTop });
    }
    return result;
  });
  expect(displaced).toEqual([]);
});

test("bottom scrolling uses a bounded offset compatible with WebKit integer scrollTop", async ({
  page,
}) => {
  // WebKit Element.scrollTop uses a signed WebIDL long (WebKit bug 188045).
  // Model that binding conversion so Chromium cannot hide overflow behind clamping.
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollTop",
    )!;
    Object.defineProperty(Element.prototype, "scrollTop", {
      ...descriptor,
      set(value: number) {
        descriptor.set!.call(this, Number(value) | 0);
      },
    });
  });
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page.locator(".session-mode [contenteditable=true]").first();
  await editor.waitFor();
  await seedSessionUx(page, 1);
  await page.evaluate(async () => {
    const path = "/src/session-mode/lib/agentNav.ts";
    const { navigateToAgentSession } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    navigateToAgentSession({
      agent: "codex",
      threadId: "ux-0",
      cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
    });
  });
  await page.evaluate(async () => {
    const { useCodexStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/components/codex/stores/index.ts",
        )?.name ?? "/src/session-mode/components/codex/stores/index.ts"
    );
    useCodexStore.setState({
      events: {
        "ux-0": Array.from({ length: 50 }, (_, i) => ({
          method: "item/completed",
          params: {
            threadId: "ux-0",
            turnId: `t-${i}`,
            item: {
              id: `r-${i}`,
              type: "agentMessage",
              text: `历史 ${i} ${"底部定位。".repeat(30)}`,
            },
          },
        })),
      },
    });
  });
  const transcript = page
    .locator('.session-mode [data-slot="scroll-area-viewport"]')
    .filter({ has: page.locator("[data-session-latest]") });
  await expect
    .poll(() =>
      transcript.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
      ),
    )
    .toBeLessThan(5);
  await editor.tap();
  await page.setViewportSize({ width: 390, height: 500 });
  await expect
    .poll(() =>
      transcript.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
      ),
    )
    .toBeLessThan(5);
});
