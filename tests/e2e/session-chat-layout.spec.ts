import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

test("long Codex, Claude and ACP chats keep navigation, latest message and composer inside the workspace", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Keep all synthetic conversations, reads and draft writes in this browser.
  await installSessionUxFixture(page, 0);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page
    .locator(".session-mode [contenteditable=true]")
    .first()
    .waitFor({ timeout: 30000 });
  for (const kind of ["codex", "cc", "acp"]) {
    await page.evaluate(async (kind) => {
      const mountedModule = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const { useAgentSettingsStore } = await mountedModule(
        "/src/session-mode/stores/useAgentSettingsStore.ts",
      );
      const { useAgentCenterStore } = await mountedModule(
        "/src/session-mode/stores/useAgentCenterStore.ts",
      );
      const { useCodexStore } = await mountedModule(
        "/src/session-mode/components/codex/stores/index.ts",
      );
      const { useCCStore } = await mountedModule(
        "/src/session-mode/stores/cc/index.ts",
      );
      const { useAcpStore } = await mountedModule(
        "/src/session-mode/stores/useAcpStore.ts",
      );
      const lines = Array.from({ length: 40 }, (_, i) => `布局回归消息 ${i}`);
      for (const card of useAgentCenterStore.getState().cards) {
        useAgentCenterStore.getState().removeCard(card);
      }
      useAgentCenterStore.setState({
        cards: [],
        currentAgentCardId: null,
        cardsViewMode: "solo",
      });
      useAgentSettingsStore.setState({
        selectedAgent: kind === "cc" ? "cc" : "codex",
      });
      useCodexStore.setState({
        currentThreadId: "layout-codex",
        historyLoadedMap: { "layout-codex": true },
        historyLoadingMap: {},
        events: {
          "layout-codex": lines.map((text, i) => ({
            method: "item/completed",
            params: {
              threadId: "layout-codex",
              turnId: `layout-turn-${i}`,
              item: {
                id: `layout-${i}`,
                type: "agentMessage",
                phase: "final_answer",
                text,
              },
            },
          })),
        },
      });
      const messages = lines.map((text, i) => ({
        type: "assistant",
        message: {
          id: `layout-${i}`,
          role: "assistant",
          content: [{ type: "text", text }],
        },
      }));
      useCCStore.setState({
        activeSessionId: "layout-cc",
        messages,
        sessionMessagesMap: { "layout-cc": messages },
        isLoading: false,
      });
      useAcpStore.setState({
        active: kind === "acp",
        connectionId: "layout-acp",
        sessionId: "layout-acp-session",
        entries: lines.map((text, i) => ({
          id: `layout-${i}`,
          role: "agent",
          text,
        })),
        running: false,
        connecting: false,
      });
      // Solo transcripts follow the selected workspace card, just like tabs.
      if (kind !== "acp") {
        useAgentCenterStore
          .getState()
          .addAgentCard(
            { kind, id: `layout-${kind}`, preview: "布局回归会话" },
            { activate: true },
          );
      }
    }, kind);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
      { width: 375, height: 667 },
      { width: 812, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      const editor = page
        .locator(
          kind === "codex"
            ? ".session-mode [contenteditable=true]"
            : ".session-mode textarea",
        )
        .first();
      await expect(editor).toBeVisible();
      expect(errors).toEqual([]);
      await editor.fill("保留草稿，不发送");
      await page.waitForTimeout(200);
      const bounds = await page.evaluate(() => {
        const root = document
          .querySelector(".session-content")!
          .getBoundingClientRect();
        const nav = document
          .querySelector(".session-top-nav")!
          .getBoundingClientRect();
        const editor = document
          .querySelector(
            ".session-mode [contenteditable=true], .session-mode textarea",
          )!
          .getBoundingClientRect();
        return {
          root: root.toJSON(),
          nav: nav.toJSON(),
          editor: editor.toJSON(),
        };
      });
      await page.screenshot({
        path: `.dev-runtime/dialog-fix/${kind}-${viewport.width}x${viewport.height}.png`,
      });
      expect(
        bounds.nav.top,
        `${kind}: navigation is clipped after focusing the composer`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        bounds.editor.bottom,
        `${kind}: composer bottom must fit the session workspace`,
      ).toBeLessThanOrEqual(bounds.root.bottom + 1);
      expect(bounds.editor.bottom).toBeLessThanOrEqual(viewport.height);
      const latest = page.getByText("布局回归消息 39", { exact: true });
      await latest.scrollIntoViewIfNeeded();
      const messageBounds = await latest.boundingBox();
      expect(messageBounds).not.toBeNull();
      expect(messageBounds!.y).toBeGreaterThanOrEqual(bounds.root.top);
      expect(messageBounds!.y + messageBounds!.height).toBeLessThanOrEqual(
        bounds.editor.top,
      );
    }
  }
  expect(errors).toEqual([]);
});
