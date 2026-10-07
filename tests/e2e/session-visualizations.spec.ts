import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const fixture = `<div class="viz-carousel" aria-label="手机与桌面设计草图">
<section data-variant="手机 · 对话优先"><div aria-label="手机会话工作台设计草图"><button data-action="projects">项目</button><button data-action="status">待确认 2</button><button data-action="new" aria-label="新建会话"><i data-lucide="plus"></i></button><div class="layer" hidden></div></div></section>
<section data-variant="桌面 · 多会话工作台" hidden><div aria-label="桌面会话工作台设计草图">桌面草图</div></section>
</div><script>document.addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(button){const layer=document.querySelector('.layer');layer.hidden=false;layer.dataset.kind=button.dataset.action;layer.textContent=button.dataset.action;}});</script>`;

test("session messages render interactive, isolated visualizations on desktop and mobile", async ({
  page,
}) => {
  test.setTimeout(90000);
  const sessionFixture = await installSessionUxFixture(page, 1);
  const reviewPath = process.env.VISUALIZATION_REVIEW_PATH;
  const root = reviewPath
    ? process.cwd()
    : "/fixture/项目/very-long-project-path-for-ui-regression";
  const path = reviewPath ?? `${root}/mock.html`;
  const screenshotStem = reviewPath ? "visualize" : "visualize-fixture";
  for (const thread of sessionFixture.threads) thread.cwd = root;
  let reads = 0;
  await page.route(
    "**/api/session/workspace-files/visualization",
    async (route) => {
      reads++;
      if (reviewPath) await route.continue();
      else
        await route.fulfill({
          json: {
            path,
            version: "fixture",
            content: fixture,
            size: fixture.length,
          },
        });
    },
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/?mode=session");
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 1);
  const update = async (text: string) =>
    page.evaluate(
      async ({ text, root }) => {
        const { useCodexStore } = await import(
          performance
            .getEntriesByType("resource")
            .find(
              (e) =>
                new URL(e.name).pathname ===
                "/src/session-mode/components/codex/stores/index.ts",
            )?.name ?? "/src/session-mode/components/codex/stores/index.ts"
        );
        const { useWorkspaceStore } = await import(
          performance
            .getEntriesByType("resource")
            .find(
              (e) =>
                new URL(e.name).pathname ===
                "/src/session-mode/stores/useWorkspaceStore.ts",
            )?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts"
        );
        useWorkspaceStore.setState({ cwd: root, projects: [root] });
        const { useAgentCenterStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) =>
              e.name.includes(
                "/src/session-mode/stores/useAgentCenterStore.ts",
              ),
            )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
        );
        useAgentCenterStore.setState({
          cards: [{ kind: "codex", id: "ux-0", cwd: root }],
          currentAgentCardId: "ux-0",
          currentAgentCardKind: "codex",
          detachedCard: null,
          cardsViewMode: "solo",
        });
        const current = useCodexStore.getState();
        useCodexStore.setState({
          currentThreadId: "ux-0",
          threads: current.threads.map((t) => ({ ...t, cwd: root })),
          events: {
            "ux-0": [
              {
                method: "item/completed",
                params: {
                  threadId: "ux-0",
                  turnId: "viz-turn",
                  item: { id: "viz-message", type: "agentMessage", text },
                },
              },
            ],
          },
        });
      },
      { text, root },
    );
  await update('visualize{"path":');
  await expect(page.getByText("正在接收可视化预览…")).toBeVisible();
  expect(reads).toBe(0);
  const marker = `visualize${JSON.stringify({ path, mode: "wide", title: "会话草图" })}`;
  await update("说明文字\n\n" + marker + "\n\n后续文字");
  const frame = page.frameLocator('iframe[title="可视化预览：会话草图"]');
  await expect(
    frame.locator('[aria-label="手机会话工作台设计草图"]'),
  ).toBeVisible();
  await expect(
    frame.locator('[data-lucide="plus"] svg').first(),
  ).toBeAttached();
  expect(reads).toBe(1);
  if (reviewPath) {
    const panel = frame.locator("[data-variant]:not([hidden])");
    await panel.getByText("演示设置", { exact: true }).click();
    await panel.getByLabel("存在待确认会话").uncheck();
    await expect(panel.locator(".attention")).toHaveText("关注 4");
    await panel.getByLabel("存在待确认会话").check();
    await expect(panel.locator(".attention")).toHaveText("待确认 2");
    await panel.getByText("演示设置", { exact: true }).click();
  }
  for (const action of ["projects", "status", "new"]) {
    await frame
      .locator(`[data-variant]:not([hidden]) [data-action="${action}"]:visible`)
      .first()
      .click();
    await expect(
      frame.locator(`.layer[data-kind="${action}"]`).first(),
    ).toBeVisible();
    if (reviewPath)
      await frame
        .locator('[data-variant]:not([hidden]) [data-action="close"]:visible')
        .first()
        .click();
  }
  await frame.getByRole("tab", { name: "桌面 · 多会话工作台" }).click();
  await expect(
    frame.locator('[aria-label="桌面会话工作台设计草图"]'),
  ).toBeVisible();
  const isolation = await page
    .locator('iframe[title="可视化预览：会话草图"]')
    .evaluate(async (element) => {
      // Only inspect host-side attributes here; the opaque frame cannot read host state.
      return {
        sandbox: element.getAttribute("sandbox"),
        policy: element.getAttribute("srcdoc")?.includes("connect-src 'none'"),
      };
    });
  expect(isolation).toEqual({ sandbox: "allow-scripts", policy: true });
  const sandboxFrame = await page
    .locator('iframe[title="可视化预览：会话草图"]')
    .elementHandle();
  const child = await sandboxFrame!.contentFrame();
  expect(
    await child!.evaluate(() => {
      try {
        void parent.document.body;
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  expect(
    await child!.evaluate(async () => {
      try {
        await fetch("https://example.invalid/private");
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  await page.getByRole("button", { name: "展开可视化", exact: true }).click();
  await expect(page.getByRole("dialog").locator("iframe")).toBeVisible();
  expect((await page.getByRole("dialog").boundingBox())!.width).toBeGreaterThan(
    1000,
  );
  await page
    .frameLocator('iframe[title="展开的可视化预览：会话草图"]')
    .getByRole("tab", { name: "桌面 · 多会话工作台" })
    .click();
  await page.getByRole("dialog").screenshot({
    path: `.dev-runtime/session-ui-review/${screenshotStem}-expanded.png`,
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 1000 });
  await frame.getByRole("tab", { name: "手机 · 对话优先" }).click();
  await expect(
    frame.locator('[aria-label="手机会话工作台设计草图"]'),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "展开可视化", exact: true }).click();
  await page.getByRole("dialog").screenshot({
    path: `.dev-runtime/session-ui-review/${screenshotStem}-mobile.png`,
  });
  await page.keyboard.press("Escape");
  await expect(
    page.locator('[data-visualization-preview] [role="alert"]'),
  ).toHaveCount(0);
  const beforeCode = reads;
  await update("```text\n" + marker + "\n```");
  await expect(page.locator("[data-visualization-preview]")).toHaveCount(0);
  expect(reads).toBe(beforeCode);
});
