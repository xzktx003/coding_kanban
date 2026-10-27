import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const sourcePaths = [
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/ModelChangeNotice.tsx",
  "apps/web/src/session-mode/components/codex/composer/recentModelConfigs.ts",
  "apps/web/src/session-mode/features/native-notifications/notifications.css",
  "apps/web/src/session-mode/features/native-notifications/service.tsx",
  "apps/web/src/session-mode/stores/useThreadModelStore.ts",
  "apps/web/src/session-mode/stores/threadModelPersistence.ts",
  "apps/web/src/session-mode/hooks/useThreadModelSettings.ts",
  "apps/web/src/session-mode/services/followupService.ts",
];
const sourceHashes = async () =>
  Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ]),
    ),
  );
async function pendingModel(page: Page, threadId: string) {
  return page.evaluate(async (threadId) => {
    const path = "/src/session-mode/stores/useThreadModelStore.ts";
    const { useThreadModelStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    const state = useThreadModelStore.getState(),
      value = state.threads[threadId];
    return {
      model: value?.model,
      reasoningEffort: value?.reasoningEffort,
      pending: value?.pending,
      pendingFields: value?.pendingFields,
      notice: value?.notice,
      status: state.storage?.[threadId]?.status,
    };
  }, threadId);
}

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
  test.describe(`${width}px model entry`, () => {
    test.use({
      viewport: { width, height: 900 },
      hasTouch: width < 768,
      isMobile: width < 768,
    });
    test(`model selection, notices, actual sends and reload stay isolated between threads (${width}px)`, async ({
      page,
    }, info) => {
      const beforeSources = await sourceHashes();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width, height: 900 });
      const f = await installSessionUxFixture(page, 2);
      // A completed historical turn makes an explicit recent-model operation
      // eligible for its native warning; this does not start a running task.
      (f.threads[0] as any).turns = [
        {
          id: "model-history",
          status: "completed",
          startedAt: 1,
          completedAt: 2,
          durationMs: 1000,
          error: null,
          items: [
            {
              id: "model-history-answer",
              type: "agentMessage",
              text: "已完成的模型隔离测试历史",
              phase: "final",
            },
          ],
        },
      ];
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
          name: `模型：${model}，${effort}`,
          exact: true,
        });
      await expect(label("gpt-6-astra", "high")).toBeVisible();
      await expect(page.locator(".session-model-change-notice")).toHaveCount(0);
      await page.evaluate(async () => {
        const path =
          "/src/session-mode/features/native-notifications/service.tsx";
        const { nativeNotifications } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
        const original = nativeNotifications.info;
        (window as any).__modelNoticeCalls = [];
        nativeNotifications.info = (title: any, options: any) => {
          if (
            String(options?.id ?? "").startsWith(
              "composer.modelChangeDuringConversationWarning.",
            )
          )
            (window as any).__modelNoticeCalls.push({ title, id: options.id });
          return original(title, options);
        };
      });
      await editor.fill("A 的未发送草稿");
      await label("gpt-6-astra", "high").click();
      // Sol defaults to low but also supports high: switching must retain A's preference.
      await page
        .getByRole("menuitem", { name: "选择模型", exact: true })
        .click();
      await page
        .getByRole("menuitemradio")
        .filter({ hasText: "隔离模型 Sol" })
        .click();
      await page.locator(".session-native-model-menu").press("Escape");
      await editor.click();
      await expect(label("gpt-6-sol", "high")).toBeVisible();
      await label("gpt-6-sol", "high").click();
      await page
        .getByRole("menuitem", { name: "选择模型", exact: true })
        .click();
      await page
        .getByRole("menuitemradio")
        .filter({ hasText: "隔离模型 Luna" })
        .click();
      await page.locator(".session-native-model-menu").press("Escape");
      await editor.click();
      await expect(label("gpt-6-luna", "high")).toBeVisible();
      const notice = page
        .locator(".codex-native-alert")
        .filter({ hasText: "在对话中途更改模型" });
      await expect(page.locator(".session-model-change-notice")).toHaveCount(0);
      await expect(notice).toHaveCount(0);
      expect(
        await page.evaluate(() => (window as any).__modelNoticeCalls),
      ).toEqual([]);
      await expect
        .poll(() => pendingModel(page, "ux-0"))
        .toMatchObject({
          model: "gpt-6-luna",
          reasoningEffort: "high",
          pending: true,
          pendingFields: expect.arrayContaining(["model"]),
          status: "ready",
          notice: { from: "gpt-6-sol", to: "gpt-6-luna" },
        });

      // Recent is an actual operation entry; ordinary radios above stay silent.
      await label("gpt-6-luna", "high").click();
      await page
        .getByRole("menuitem", { name: "选择模型", exact: true })
        .click();
      await page
        .getByRole("button", { name: "打开最近使用的模型", exact: true })
        .click();
      const recent = page
        .getByRole("group", { name: "最近使用的模型", exact: true })
        .getByRole("button", { name: /隔离模型 Sol/ });
      if (width < 768) await recent.tap();
      else await recent.click();
      await expect(label("gpt-6-sol", "high")).toBeVisible();
      await expect(notice).toHaveCount(1);
      await expect(notice).toContainText("切换回 gpt-6-luna。");
      const noticeCalls = await page.evaluate(
        () => (window as any).__modelNoticeCalls,
      );
      expect(noticeCalls).toHaveLength(1);
      expect(noticeCalls[0].id).toBe(
        "composer.modelChangeDuringConversationWarning.ux-0",
      );
      await expect(notice).toBeInViewport({ ratio: 1 });
      await expect
        .poll(() =>
          notice.evaluate((el) => {
            const toast = el.closest("[data-sonner-toast]") ?? el;
            return toast
              .getAnimations({ subtree: true })
              .every(
                (animation) =>
                  animation.playState !== "running" && !animation.pending,
              );
          }),
        )
        .toBe(true);
      const bounds = await notice.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          width: innerWidth,
          height: innerHeight,
          scroll: document.documentElement.scrollWidth,
        };
      });
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.width);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
      const close = notice.getByRole("button", { name: "关闭", exact: true });
      const closeBounds = (await close.boundingBox())!;
      // The shipped native close control is exactly 24 CSS px. A translated
      // toast's DOMRect can carry fractional floating-point subtraction noise.
      await expect(close).toHaveCSS("width", "24px");
      await expect(close).toHaveCSS("height", "24px");
      if (width < 768) {
        expect(
          await page.evaluate(() => matchMedia("(pointer:coarse)").matches),
        ).toBe(true);
        const target = (await label("gpt-6-sol", "high").boundingBox())!;
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({
        path: `.dev-runtime/session-models/notice-${width}.png`,
        animations: "disabled",
      });
      if (width < 768) await close.tap();
      else await close.click();
      await expect(notice).toHaveCount(0);
      await label("gpt-6-sol", "high").click();
      await page
        .getByRole("menuitem", { name: "选择模型", exact: true })
        .click();
      await page
        .getByRole("menuitemradio")
        .filter({ hasText: "隔离模型 Luna" })
        .click();
      await page.locator(".session-native-model-menu").press("Escape");
      await editor.click();
      await expect(label("gpt-6-luna", "high")).toBeVisible();
      await expect
        .poll(() => pendingModel(page, "ux-0"))
        .toMatchObject({
          model: "gpt-6-luna",
          reasoningEffort: "high",
          pending: true,
          status: "ready",
        });
      expect(
        await page.evaluate(() => (window as any).__modelNoticeCalls),
      ).toHaveLength(1);
      await expect(notice).toHaveCount(0);
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
      await expect(notice).toHaveCount(0);
      await expect(page.locator(".session-model-change-notice")).toHaveCount(0);
      await expect
        .poll(() => pendingModel(page, "ux-0"))
        .toMatchObject({
          model: "gpt-6-luna",
          reasoningEffort: "high",
          pending: true,
          status: "ready",
        });
      await expect(editor).toContainText("A 的未发送草稿");
      // A second restoration also remains silent without dismissing its pending metadata.
      await page.reload();
      await selectThread(page, "ux-0");
      await expect(notice).toHaveCount(0);
      await expect(label("gpt-6-luna", "high")).toBeVisible();
      await expect(editor).toContainText("A 的未发送草稿");
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
        f.calls
          .slice(beforeA)
          .find((c) => c.path.endsWith("/followups/submit"))!.body.parameters,
      ).toMatchObject({ model: "gpt-6-luna", effort: "high" });
      await selectThread(page, "ux-1");
      await expect(label("gpt-6-sol", "low")).toBeVisible();
      expect(errors).toEqual([]);
      const sentA = f.calls
        .slice(beforeA)
        .find((c) => c.path.endsWith("/followups/submit"))!;
      expect(sentA.body.threadId).toBe("ux-0");
      expect(sentA.body.text).toBe("A 的未发送草稿");
      expect(sentB.body.text).toBe("B 的独立消息");
      const afterSources = await sourceHashes();
      expect(afterSources).toEqual(beforeSources);
      const output = resolve(".dev-runtime/session-models-entry-20261027");
      await mkdir(output, { recursive: true });
      const evidence = resolve(output, `model-entry-${width}.json`);
      await writeFile(
        evidence,
        JSON.stringify(
          {
            width,
            beforeSources,
            afterSources,
            noticeCalls,
            bounds,
            closeBounds,
            sentA: sentA.body,
            sentB: sentB.body,
            errors,
          },
          null,
          2,
        ),
      );
      await info.attach("model-entry-evidence", {
        path: evidence,
        contentType: "application/json",
      });
    });
  });
}
