import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

test("composer command and mention menus inherit the theme and fit desktop and mobile viewports", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installSessionUxFixture(page, 0);
  await page.route("**/api/session/api/codex/plugin/installed", (r) =>
    r.fulfill({ json: { marketplaces: [] } }),
  );
  await page.route("**/api/session/api/codex/skills/list", (r) =>
    r.fulfill({
      json: {
        data: [
          {
            cwd: "/fixture",
            errors: [],
            skills: Array.from({ length: 14 }, (_, i) => ({
              name: `research-analysis-${i}`,
              path: `/fixture/${i}/SKILL.md`,
              enabled: true,
              scope: "user",
              description:
                "分析实验结果、检查数据与证据，整理为清晰且可复现的研究报告。",
              shortDescription: null,
              interface: null,
            })),
          },
        ],
      },
    }),
  );
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page.locator(".session-mode [contenteditable=true]").first();
  await editor.waitFor();
  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useWorkspaceStore.ts",
        )?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts"
    );
    useWorkspaceStore.setState({ cwd: "/fixture", projects: ["/fixture"] });
    const { useAgentSettingsStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useAgentSettingsStore.ts",
        )?.name ?? "/src/session-mode/stores/useAgentSettingsStore.ts"
    );
    const { useLayoutStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useLayoutStore.ts",
        )?.name ?? "/src/session-mode/stores/useLayoutStore.ts"
    );
    const { useAgentCenterStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useAgentCenterStore.ts",
        )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
    );
    useAgentSettingsStore.setState({ selectedAgent: "codex" });
    useLayoutStore.setState({
      view: "agent",
      isRightPanelOpen: false,
      isRightPanelFocused: false,
    });
    useAgentCenterStore.setState({
      cards: [],
      currentAgentCardId: null,
      cardsViewMode: "solo",
    });
  });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 375, height: 667 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    for (const symbol of ["/", "$"]) {
      await editor.click();
      await editor.press("ControlOrMeta+a");
      await editor.press("Backspace");
      await editor.pressSequentially(symbol);
      const first = page.locator("button[data-selected]").first();
      await first.waitFor();
      expect(
        await first.evaluate((element) => !!element.closest(".session-mode")),
        "suggestions must inherit scoped theme styles",
      ).toBe(true);
      const menu = page.locator("[data-composer-suggestions]").first();
      await expect(menu).toBeVisible();
      const bounds = await menu.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(8);
      expect(bounds!.y).toBeGreaterThanOrEqual(8);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 8);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
        viewport.height - 8,
      );
      expect(
        await menu.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await editor.press("ArrowDown");
      await expect(menu.locator("[aria-selected=true]")).toHaveCount(1);
      await page.screenshot({
        path: `.dev-runtime/composer-ui/${symbol === "/" ? "slash" : "dollar"}-${viewport.width}x${viewport.height}.png`,
      });
      await editor.press("Escape");
      await expect(menu).toHaveCount(0);
    }
  }
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.press("Backspace");
  await editor.pressSequentially("$research-analysis-12");
  await expect(
    page.locator("[data-composer-suggestions] [role=option]"),
  ).toHaveCount(1);
  await editor.press("Enter");
  await expect(page.locator("[data-composer-suggestions]")).toHaveCount(0);
  await expect(editor).toContainText("research-analysis-12");
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.press("Backspace");
  await editor.pressSequentially("/no-such-command");
  await expect(page.locator("[data-composer-suggestions]")).toContainText(
    "没有匹配项",
  );
  await editor.press("Escape");
  await expect(page.locator("[data-composer-suggestions]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Claude slash menu keeps the editor focused while selecting a command", async ({
  page,
}) => {
  await installSessionUxFixture(page, 0);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await page.evaluate(async () => {
    const { useCCStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname === "/src/session-mode/stores/cc/index.ts",
        )?.name ?? "/src/session-mode/stores/cc/index.ts"
    );
    const { useAgentSettingsStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useAgentSettingsStore.ts",
        )?.name ?? "/src/session-mode/stores/useAgentSettingsStore.ts"
    );
    const { useLayoutStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useLayoutStore.ts",
        )?.name ?? "/src/session-mode/stores/useLayoutStore.ts"
    );
    const { useAgentCenterStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useAgentCenterStore.ts",
        )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
    );
    useCCStore.setState({
      slashCommands: ["help", "compact", "review"],
      activeSessionId: null,
    });
    useAgentSettingsStore.setState({ selectedAgent: "cc" });
    useLayoutStore.setState({ view: "agent", isRightPanelOpen: false });
    useAgentCenterStore.setState({
      cards: [],
      currentAgentCardId: null,
      cardsViewMode: "solo",
    });
  });
  await page.setViewportSize({ width: 375, height: 667 });
  const editor = page.locator(".session-mode textarea").first();
  await editor.fill("/");
  const menu = page.locator("[data-composer-suggestions]");
  await expect(menu).toBeVisible();
  await menu.getByRole("option", { name: "/help", exact: true }).click();
  await expect(editor).toHaveValue("/help ");
  await expect(editor).toBeFocused();
});
