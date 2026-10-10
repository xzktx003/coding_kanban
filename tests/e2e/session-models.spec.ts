import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

async function selectThread(page: Page, id: string) {
  // Use the mounted navigation after reload; mutating selection before sidebar
  // and shared-tab hydration finishes can be overwritten by initialization.
  const row = page
    .locator(".session-nav-row[role=button]")
    .filter({ hasText: `中文会话 ${id.slice(3)} ` })
    .first();
  await expect(
    page.getByRole("button", { name: /^(展开|收起)项目列表$/ }).first(),
  ).toBeVisible();
  if (!(await row.isVisible())) {
    const expand = page.getByRole("button", {
      name: "展开项目列表",
      exact: true,
    });
    if (await expand.isVisible()) await expand.click();
    // Cached transcripts mount before a fresh sidebar list after reload.
    await expect(row).toBeVisible();
  }
  await row.click();
  const projects = page.getByRole("dialog", {
    name: "项目与会话列表",
    exact: true,
  });
  if (await projects.isVisible()) {
    await projects
      .getByRole("button", { name: "收起项目列表", exact: true })
      .click();
    await expect(projects).not.toBeVisible();
  }
  await expect(
    page.locator(`[role=tab][data-tab-key="codex:${id}"]`),
  ).toHaveAttribute("aria-selected", "true");
}
for (const width of [375, 1440]) {
  test(`model selection, notices, actual sends and reload stay isolated between threads (${width}px)`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    const f = await installSessionUxFixture(page, 2);
    const models = [
      {
        id: "gpt-6-astra",
        displayName: "隔离模型 Astra",
        defaultReasoningEffort: "high",
      },
      {
        id: "gpt-6-sol",
        displayName: "隔离模型 Sol",
        defaultReasoningEffort: "low",
      },
      {
        id: "gpt-6-luna",
        displayName: "隔离模型 Luna",
        defaultReasoningEffort: "medium",
      },
    ].map((m, i) => ({
      ...m,
      model: m.id,
      isDefault: !i,
      hidden: false,
      description: "隔离验收",
      supportedReasoningEfforts: ["low", "medium", "high"].map(
        (reasoningEffort) => ({
          reasoningEffort,
          description: reasoningEffort,
        }),
      ),
    }));
    await page.route("**/api/codex/model/list", (r) =>
      r.fulfill({ json: { data: models, nextCursor: null } }),
    );
    await page.route(/\/api\/codex\/thread\/read(?:\?.*)?$/, (r) => {
      const id = r.request().postDataJSON().threadId;
      return r.fulfill({
        json: {
          thread: f.threads.find((t) => t.id === id),
          model: id === "ux-0" ? "gpt-6-astra" : "gpt-6-sol",
          modelProvider: "openai",
          reasoningEffort: id === "ux-0" ? "high" : "low",
        },
      });
    });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor();
    await seedSessionUx(page, 2);
    await page.evaluate(async () => {
      const path = (name: string) =>
        performance
          .getEntriesByType("resource")
          .findLast((e) => e.name.includes(`/src/session-mode/${name}.ts`))
          ?.name ?? `/src/session-mode/${name}.ts`;
      const { useAgentCenterStore } = await import(
        path("stores/useAgentCenterStore")
      );
      const { codexService } = await import(path("services/codexService"));
      const cwd = "/fixture/项目/very-long-project-path-for-ui-regression";
      for (const id of ["ux-1", "ux-0"]) {
        useAgentCenterStore.getState().addAgentCard(
          {
            kind: "codex",
            id,
            cwd,
            preview: id === "ux-0" ? "隔离会话 A" : "隔离会话 B",
          },
          { activate: false },
        );
        await codexService.threadResume(id, undefined, { background: true });
      }
    });
    await selectThread(page, "ux-0");
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    const label = (model: string, effort: string) =>
      page.getByRole("button", {
        name: `Agent 与模型：Codex，${model}，${effort}`,
        exact: true,
      });
    await expect(label("gpt-6-astra", "high")).toBeVisible();
    await expect(page.locator(".session-model-change-notice")).toHaveCount(0);
    await editor.fill("A 的未发送草稿");
    await label("gpt-6-astra", "high").click();
    // Sol defaults to low but also supports high: switching must retain A's preference.
    await page.getByRole("menuitem", { name: "选择模型", exact: true }).click();
    await page
      .getByRole("menuitemradio")
      .filter({ hasText: "隔离模型 Sol" })
      .click();
    await page.locator(".session-native-model-menu").press("Escape");
    await editor.click();
    await expect(label("gpt-6-sol", "high")).toBeVisible();
    await label("gpt-6-sol", "high").click();
    await page.getByRole("menuitem", { name: "选择模型", exact: true }).click();
    await page
      .getByRole("menuitemradio")
      .filter({ hasText: "隔离模型 Luna" })
      .click();
    await page.locator(".session-native-model-menu").press("Escape");
    await editor.click();
    await expect(label("gpt-6-luna", "high")).toBeVisible();
    const notice = page.locator(".session-model-change-notice");
    await expect(notice).toContainText("gpt-6-sol → gpt-6-luna");
    await expect(notice).toContainText("下次发送生效");
    await expect(editor).toContainText("A 的未发送草稿");
    expect(
      f.calls.filter((c) => /\/turn\/(start|steer|interrupt)$/.test(c.path)),
    ).toHaveLength(0);
    const beforeB = f.calls.length;
    await selectThread(page, "ux-1");
    await expect(label("gpt-6-sol", "low")).toBeVisible();
    await expect(notice).toHaveCount(0);
    await editor.fill("B 的独立消息");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect
      .poll(
        () =>
          f.calls
            .slice(beforeB)
            .filter((c) => c.path.endsWith("/followups/submit")).length,
      )
      .toBe(1);
    const sentB = f.calls
      .slice(beforeB)
      .find((c) => c.path.endsWith("/followups/submit"))!;
    expect(sentB.body.threadId).toBe("ux-1");
    expect(sentB.body.parameters).toMatchObject({
      model: "gpt-6-sol",
      effort: "low",
    });
    await selectThread(page, "ux-0");
    await expect(label("gpt-6-luna", "high")).toBeVisible();
    await expect(editor).toContainText("A 的未发送草稿");
    await page.reload();
    await selectThread(page, "ux-0");
    await expect(label("gpt-6-luna", "high")).toBeVisible();
    await expect(notice).toContainText("gpt-6-sol → gpt-6-luna");
    await expect(editor).toContainText("A 的未发送草稿");
    const bounds = await notice.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        right: r.right,
        bottom: r.bottom,
        width: innerWidth,
        height: innerHeight,
        scroll: document.documentElement.scrollWidth,
      };
    });
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    if (width < 768) {
      const close = await notice
        .getByRole("button", { name: "收起模型切换提示" })
        .boundingBox();
      expect(close!.width).toBeGreaterThanOrEqual(44);
      expect(close!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: `.dev-runtime/session-models/notice-${width}.png`,
      animations: "disabled",
    });
    await notice.getByRole("button", { name: "收起模型切换提示" }).click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await selectThread(page, "ux-0");
    await expect(notice).toHaveCount(0);
    await expect(label("gpt-6-luna", "high")).toBeVisible();
    const beforeA = f.calls.length;
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect
      .poll(
        () =>
          f.calls
            .slice(beforeA)
            .filter((c) => c.path.endsWith("/followups/submit")).length,
      )
      .toBe(1);
    expect(
      f.calls.slice(beforeA).find((c) => c.path.endsWith("/followups/submit"))!
        .body.parameters,
    ).toMatchObject({ model: "gpt-6-luna", effort: "high" });
    await selectThread(page, "ux-1");
    await expect(label("gpt-6-sol", "low")).toBeVisible();
    expect(errors).toEqual([]);
  });
}
