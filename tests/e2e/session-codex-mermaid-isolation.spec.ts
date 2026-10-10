import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("actual Claude renderer stays unchanged while Codex SVGs and themes interleave", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await installSessionUxFixture(page, 2);
  await page.goto("/?mode=session");
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor();
  await seedSessionUx(page, 2);
  await page.evaluate(async () => {
    const module = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
    const [
      { useCCStore },
      { useAgentCenterStore },
      { useLayoutStore },
      { useThemeStore },
    ] = await Promise.all([
      module("/src/session-mode/stores/cc/index.ts"),
      module("/src/session-mode/stores/useAgentCenterStore.ts"),
      module("/src/session-mode/stores/useLayoutStore.ts"),
      module("/src/session-mode/stores/settings/useThemeStore.ts"),
    ]);
    useThemeStore.getState().setTheme("dark");
    useLayoutStore.setState({
      view: "agent",
      isSidebarOpen: false,
      isRightPanelOpen: false,
    });
    useCCStore.setState({
      sessionMessagesMap: {
        "cc-media": [
          {
            type: "assistant",
            uuid: "cc-answer",
            session_id: "cc-media",
            message: {
              content: [
                {
                  type: "text",
                  text: "Claude baseline\n\n```mermaid\ngraph TD\n  C[Claude] --> D[Original]\n```",
                },
              ],
            },
          },
        ],
      },
      sessionLoadingMap: {},
      activeSessionIds: ["cc-media"],
    });
    useAgentCenterStore.getState().addAgentCard({
      kind: "cc",
      id: "cc-media",
      cwd: "/fixture",
      preview: "Claude media baseline",
    });
    for (const id of ["ux-0", "ux-1"])
      useAgentCenterStore
        .getState()
        .addAgentCard({ kind: "codex", id, cwd: "/fixture", preview: id });
    for (const id of ["cc-media", "ux-0", "ux-1"])
      useAgentCenterStore.getState().setCardSize(id, { height: 440 });
    useAgentCenterStore.setState({ cardsViewMode: "grid" });
  });
  const claude = page.locator('[data-session-card="cc-media"]');
  await expect(claude).toContainText("Claude baseline");
  await page.waitForTimeout(300);
  const baseline = await claude.locator("pre").evaluateAll((elements) =>
    elements.map((element) => ({
      text: element.textContent,
      svg: element.querySelector("svg.flowchart")?.outerHTML ?? null,
      fontSynthesis: getComputedStyle(element).getPropertyValue(
        "font-synthesis-weight",
      ),
      font: getComputedStyle(element).font,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    })),
  );
  await writeFile(
    info.outputPath("claude-baseline.json"),
    JSON.stringify(baseline, null, 2),
  );
  expect(baseline.length).toBe(1);
  expect(baseline[0].svg).toBeNull();
  expect(baseline[0].fontSynthesis).toBe("auto");
  for (const theme of ["dark", "light", "dark", "light"] as const) {
    await page.evaluate(async (theme) => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const [{ useCodexStore }, { useThemeStore }, { useCCStore }] =
        await Promise.all([
          module("/src/session-mode/components/codex/stores/index.ts"),
          module("/src/session-mode/stores/settings/useThemeStore.ts"),
          module("/src/session-mode/stores/cc/index.ts"),
        ]);
      useThemeStore.getState().setTheme(theme);
      useCCStore.setState({
        sessionMessagesMap: { ...useCCStore.getState().sessionMessagesMap },
      });
      const events = Object.fromEntries(
        ["ux-0", "ux-1"].map((threadId) => [
          threadId,
          [
            {
              method: "item/completed",
              params: {
                threadId,
                turnId: "isolated",
                item: {
                  id: "isolated",
                  type: "agentMessage",
                  phase: "final_answer",
                  text: "```mermaid\ngraph TD\n  A[Start] --> B[Done]\n```",
                },
              },
            },
          ],
        ]),
      );
      useCodexStore.setState({
        events,
        historyLoadedMap: { "ux-0": true, "ux-1": true },
        historyLoadingMap: {},
        currentThreadId: "ux-0",
        currentTurnId: null,
        threadStatusMap: { "ux-0": { type: "idle" }, "ux-1": { type: "idle" } },
      });
    }, theme);
    for (const id of ["ux-0", "ux-1"]) {
      const graph = page.locator(`[data-session-card="${id}"] svg.flowchart`);
      await expect(graph).toBeVisible();
      await expect(graph.locator(".node rect").first()).toHaveCSS(
        "fill",
        theme === "dark" ? "rgb(13, 39, 63)" : "rgb(229, 242, 255)",
      );
      await expect(graph.locator(".node rect").first()).toHaveAttribute(
        "height",
        "60",
      );
    }
    expect(
      await claude.locator("pre").evaluateAll((elements) =>
        elements.map((element) => ({
          text: element.textContent,
          svg: element.querySelector("svg.flowchart")?.outerHTML ?? null,
          fontSynthesis: getComputedStyle(element).getPropertyValue(
            "font-synthesis-weight",
          ),
          font: getComputedStyle(element).font,
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        })),
      ),
    ).toEqual(baseline);
  }
  await page.evaluate(async () => {
    const module = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
    const [{ useCodexStore }, { useThemeStore }] = await Promise.all([
      module("/src/session-mode/components/codex/stores/index.ts"),
      module("/src/session-mode/stores/settings/useThemeStore.ts"),
    ]);
    for (let index = 0; index < 6; index += 1) {
      useThemeStore.getState().setTheme(index % 2 ? "light" : "dark");
      const events = Object.fromEntries(
        ["ux-0", "ux-1"].map((threadId) => [
          threadId,
          [
            {
              method: "item/completed",
              params: {
                threadId,
                turnId: `burst-${index}`,
                item: {
                  id: `burst-${index}`,
                  type: "agentMessage",
                  phase: "final_answer",
                  text: `\`\`\`mermaid\ngraph TD\n A[Latest ${index}] --> B[Done]\n\`\`\``,
                },
              },
            },
          ],
        ]),
      );
      useCodexStore.setState({ events });
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  });
  for (const id of ["ux-0", "ux-1"]) {
    const graph = page.locator(`[data-session-card="${id}"] svg.flowchart`);
    await expect(graph).toContainText("Latest 5");
    await expect(graph.locator(".node rect").first()).toHaveCSS(
      "fill",
      "rgb(229, 242, 255)",
    );
    await expect(graph.locator(".node rect").first()).toHaveAttribute(
      "height",
      "60",
    );
  }
  expect(
    await claude.locator("pre").evaluateAll((elements) =>
      elements.map((element) => ({
        text: element.textContent,
        svg: element.querySelector("svg.flowchart")?.outerHTML ?? null,
        fontSynthesis: getComputedStyle(element).getPropertyValue(
          "font-synthesis-weight",
        ),
        font: getComputedStyle(element).font,
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      })),
    ),
  ).toEqual(baseline);
  await page.screenshot({
    path: info.outputPath("codex-claude-interleaved.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(
    fixture.calls.filter((call) =>
      /turn\/(start|steer)|approval\/reply|thread\/rollback|cc\/resume/.test(
        call.path,
      ),
    ),
  ).toEqual([]);
});
