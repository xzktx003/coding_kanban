import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const cwd = "/fixture/项目/very-long-project-path-for-ui-regression";

async function evaluateWithNavigationRetry<T>(
  page: Page,
  callback: (arg: T) => Promise<void>,
  arg: T,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.evaluate(callback, arg);
      return;
    } catch (error) {
      if (attempt || !String(error).includes("Execution context was destroyed"))
        throw error;
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
  }
}

async function focusCodexCard(page: Page, id: string) {
  await evaluateWithNavigationRetry(
    page,
    async ({ id, cwd }) => {
      const live = async (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const { useAgentCenterStore } = await live(
        "/src/session-mode/stores/useAgentCenterStore.ts",
      );
      const { useAgentSettingsStore } = await live(
        "/src/session-mode/stores/useAgentSettingsStore.ts",
      );
      const { useCodexStore } = await live(
        "/src/session-mode/components/codex/stores/index.ts",
      );
      useAgentSettingsStore.getState().setSelectedAgent("codex");
      const center = useAgentCenterStore.getState();
      for (const card of center.cards.filter(
        (card) => card.kind === "codex" && card.id !== id,
      ))
        center.removeCard(card);
      center.addAgentCard({
        kind: "codex",
        id,
        cwd,
        preview: `中文会话 ${id.replace("ux-", "")}`,
      });
      center.setCurrentAgentCardId(id, "codex");
      useCodexStore.setState({ currentThreadId: id });
    },
    { id, cwd },
  );
}

async function focusCcCard(page: Page, id: string) {
  await evaluateWithNavigationRetry(
    page,
    async ({ id, cwd }) => {
      const live = async (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const { useAgentCenterStore } = await live(
        "/src/session-mode/stores/useAgentCenterStore.ts",
      );
      const { useAgentSettingsStore } = await live(
        "/src/session-mode/stores/useAgentSettingsStore.ts",
      );
      const { useCCStore } = await live("/src/session-mode/stores/cc/index.ts");
      useAgentSettingsStore.getState().setSelectedAgent("cc");
      const center = useAgentCenterStore.getState();
      for (const card of center.cards.filter(
        (card) => card.kind === "cc" && card.id !== id,
      ))
        center.removeCard(card);
      center.addAgentCard({
        kind: "cc",
        id,
        cwd,
        preview: `Claude ${id}`,
      });
      center.setCurrentAgentCardId(id, "cc");
      useCCStore.setState({ activeSessionId: id });
    },
    { id, cwd },
  );
}

for (const width of [375, 1440]) {
  test(`opening and reopening a long Codex conversation starts at latest (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 812 });
    await installSessionUxFixture(page, 2);
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor();
    await seedSessionUx(page, 2);
    await focusCodexCard(page, "ux-0");
    await page.evaluate(async () => {
      const live = async (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const { useCodexStore } = await live(
        "/src/session-mode/components/codex/stores/index.ts",
      );
      const events = Array.from({ length: 80 }, (_, i) => ({
        method: "item/completed",
        params: {
          threadId: "ux-0",
          turnId: `turn-${i}`,
          item: {
            id: `reply-${i}`,
            type: "agentMessage",
            text: `历史回复 ${i}\n\n${"这是用于验证手机长对话滚动的位置。".repeat(20)}`,
          },
        },
      }));
      useCodexStore.setState({ events: { "ux-0": events, "ux-1": [] } });
    });
    const viewport = page
      .locator('.session-mode [data-slot="scroll-area-viewport"]')
      .filter({ has: page.locator("[data-session-latest]") });
    const remaining = () =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
      );
    await expect.poll(remaining).toBeLessThan(5);
    await viewport.evaluate((el) => {
      el.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -500, bubbles: true }),
      );
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBe(0);
    await page.evaluate(async () => {
      const live = async (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const { useCodexStore } = await live(
        "/src/session-mode/components/codex/stores/index.ts",
      );
      const state = useCodexStore.getState();
      state.addEvent("ux-0", {
        method: "item/completed",
        params: {
          threadId: "ux-0",
          turnId: "new-turn",
          item: {
            id: "new-reply",
            type: "agentMessage",
            text: "阅读历史期间的新回复",
          },
        },
      });
    });
    await page.waitForTimeout(150);
    await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBe(0);
    await focusCodexCard(page, "ux-1");
    await expect(viewport.locator("[data-session-latest]")).toBeAttached();
    await focusCodexCard(page, "ux-0");
    await expect.poll(remaining).toBeLessThan(5);
  });
}

for (const width of [375, 1440]) {
  test(`Claude switches and loads history at latest without animated scrolling (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 812 });
    await installSessionUxFixture(page, 0);
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor();
    await seedSessionUx(page, 0);
    await page.evaluate(async () => {
      const live = async (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const { useCCStore } = await live("/src/session-mode/stores/cc/index.ts");
      const messages = Array.from({ length: 40 }, (_, i) => ({
        type: "user",
        text: `历史 ${i} ${"长对话手机测试。".repeat(30)}`,
      }));
      useCCStore.setState({
        activeSessionId: "scroll-a",
        activeSessionIds: ["scroll-a", "scroll-b"],
        messages,
        sessionMessagesMap: { "scroll-a": messages, "scroll-b": [] },
        sessionLoadingMap: {},
      });
    });
    await focusCcCard(page, "scroll-a");
    const viewport = page
      .locator(".session-mode .overflow-y-auto")
      .filter({ has: page.locator("[data-session-latest]") });
    const remaining = () =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
      );
    await expect.poll(remaining).toBeLessThan(5);
    await page.waitForTimeout(50);
    await viewport.evaluate((el) => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event("scroll"));
    });
    await focusCcCard(page, "scroll-b");
    await page.evaluate(async () => {
      const live = async (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const { useCCStore } = await live("/src/session-mode/stores/cc/index.ts");
      useCCStore.setState((state) => ({
        messages: [],
        sessionMessagesMap: { ...state.sessionMessagesMap, "scroll-b": [] },
      }));
    });
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollHeight <= el.clientHeight))
      .toBe(true);
    await page.evaluate(async () => {
      const live = async (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const { useCCStore } = await live("/src/session-mode/stores/cc/index.ts");
      const messages = Array.from({ length: 40 }, (_, i) => ({
        type: "user",
        text: `新会话历史 ${i} ${"异步加载历史手机测试。".repeat(30)}`,
      }));
      useCCStore.setState((state) => ({
        messages,
        sessionMessagesMap: {
          ...state.sessionMessagesMap,
          "scroll-b": messages,
        },
      }));
    });
    await expect.poll(remaining).toBeLessThan(5);
    await page.waitForTimeout(50);
    await viewport.evaluate((el) => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.evaluate(async () => {
      const live = async (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const { useCCStore } = await live("/src/session-mode/stores/cc/index.ts");
      useCCStore.setState((state) => ({
        messages: [
          ...state.messages,
          { type: "user", text: "新输出不抢走阅读位置" },
        ],
        sessionMessagesMap: {
          ...state.sessionMessagesMap,
          "scroll-b": [
            ...(state.sessionMessagesMap["scroll-b"] ?? []),
            { type: "user", text: "新输出不抢走阅读位置" },
          ],
        },
      }));
    });
    await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBe(100);
  });
}

test("mobile tap and keyboard layout scrolls do not cancel following latest", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await installSessionUxFixture(page, 2);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page.locator(".session-mode [contenteditable=true]").first();
  await editor.waitFor();
  await seedSessionUx(page, 2);
  await focusCodexCard(page, "ux-0");
  await page.evaluate(async () => {
    const live = async (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
    const { useCodexStore } = await live(
      "/src/session-mode/components/codex/stores/index.ts",
    );
    useCodexStore.setState({
      events: {
        "ux-0": Array.from({ length: 60 }, (_, i) => ({
          method: "item/completed",
          params: {
            threadId: "ux-0",
            turnId: `t-${i}`,
            item: {
              id: `r-${i}`,
              type: "agentMessage",
              text: `手机历史 ${i} ${"软键盘布局变化测试。".repeat(25)}`,
            },
          },
        })),
      },
    });
  });
  const viewport = page
    .locator('.session-mode [data-slot="scroll-area-viewport"]')
    .filter({ has: page.locator("[data-session-latest]") });
  const remaining = () =>
    viewport.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await expect.poll(remaining).toBeLessThan(5);
  // A stationary finger tap followed by the browser's keyboard/focus scroll is not a history swipe.
  await viewport.evaluate((el) => {
    el.dispatchEvent(new Event("touchstart", { bubbles: true }));
    el.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }),
    );
    el.dispatchEvent(new Event("touchend", { bubbles: true }));
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  await editor.click();
  await page.setViewportSize({ width: 375, height: 480 });
  await expect.poll(remaining).toBeLessThan(5);
  await editor.fill("手机发送回归测试");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(remaining).toBeLessThan(5);
  // Actual vertical finger movement keeps control with the history reader.
  await viewport.evaluate((el) => {
    const touch = (type: string, y: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "touches", {
        value: [{ clientX: 100, clientY: y }],
      });
      el.dispatchEvent(event);
    };
    touch("touchstart", 100);
    touch("touchmove", 150);
    el.scrollTop = 100;
    el.dispatchEvent(new Event("scroll"));
    el.dispatchEvent(new Event("touchend", { bubbles: true }));
  });
  await page.evaluate(async () => {
    const live = async (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
    const { useCodexStore } = await live(
      "/src/session-mode/components/codex/stores/index.ts",
    );
    useCodexStore.getState().addEvent("ux-0", {
      method: "item/completed",
      params: {
        threadId: "ux-0",
        turnId: "mobile-new",
        item: {
          id: "mobile-new-reply",
          type: "agentMessage",
          text: "实际滑动阅读时不抢走位置",
        },
      },
    });
  });
  await page.waitForTimeout(150);
  // Virtualized rows may adjust their measured heights; remain in history, not at latest.
  await expect
    .poll(() => viewport.evaluate((el) => el.scrollTop))
    .toBeLessThan(1000);
  await expect.poll(remaining).toBeGreaterThan(500);
});
