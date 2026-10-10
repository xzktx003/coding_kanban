import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const patch =
  "--- a/example.py\n+++ b/example.py\n@@ -115,3 +115,4 @@\n context\n-old = 1\n+new = 2\n+extra = 3\n tail\n@@ -307,1 +308,1 @@\n-old = 4\n+new = 5\n";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAABICAIAAACyfKYoAAABBklEQVR4nO3QoZGFMAAFwF/QFUEJiBSAREYiEEx0RBQ6miqvhyeidmYr2N/ffsW2vcXK3mPn/sbufcbG/sV+okWLFi1atGjRokWLFi1atOg10ccV244WK0ePnccbu48ZG8cXEy1atGjRokWLFi1atGjRokUviq5XbKstVmqPnfWN3XXGRv1iokWLFi1atGjRokWLFi1atOhF0c8V254WK0+Pnc8bu58ZG88XEy1atGjRokWLFi1atGjRokUvih5XbBstVkaPneON3WPGxvhiokWLFi1atGjRokWLFi1atOhF0fOKbbPFyuyxc76xe87YmF9MtGjRokWLFi1atGjRokWLFr0k+h8jd1cCNT+MqwAAAABJRU5ErkJggg==";
function audioFixture() {
  const wave = Buffer.alloc(844, 128);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(836, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24);
  wave.writeUInt32LE(8000, 28);
  wave.writeUInt16LE(1, 32);
  wave.writeUInt16LE(8, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(800, 40);
  return wave.toString("base64");
}
async function state(page: Page, theme: string, events: any[]) {
  await page.evaluate(
    async ({ theme, events }) => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
      const { useThemeStore } = await module(
        "/src/session-mode/stores/settings/useThemeStore.ts",
      );
      const { useCodexStore } = await module(
        "/src/session-mode/components/codex/stores/index.ts",
      );
      const { useLayoutStore } = await module(
        "/src/session-mode/stores/useLayoutStore.ts",
      );
      const { useAgentCenterStore } = await module(
        "/src/session-mode/stores/useAgentCenterStore.ts",
      );
      useThemeStore.getState().setTheme(theme);
      useLayoutStore.setState({
        view: "agent",
        isSidebarOpen: false,
        isRightPanelOpen: false,
      });
      // Use the real follow operation so background tab reconciliation does not
      // replace a fixture-only card with the authoritative empty snapshot.
      useAgentCenterStore.getState().addAgentCard(
        {
          kind: "codex",
          id: "ux-0",
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          preview: "原生呈现验收",
        },
        { activate: true },
      );
      useAgentCenterStore.setState({ cardsViewMode: "solo" });
      useCodexStore.setState({
        events: { "ux-0": events },
        historyLoadedMap: { "ux-0": true },
        historyLoadingMap: {},
        currentThreadId: "ux-0",
      });
    },
    { theme, events },
  );
}
const item = (id: string, data: any) => ({
  method: "item/completed",
  params: {
    threadId: "ux-0",
    turnId: "native-turn",
    completedAtMs: 1,
    item: { id, ...data },
  },
});

for (const width of [1440, 390])
  test.describe(`${width}px native content`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"]) {
      test(`native semantic tools decode media and settle interrupted activity (${width}, ${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await installSessionUxFixture(page);
        let reads = 0;
        await page.route("**/api/filesystem/read-file", async (route) => {
          reads++;
          expect(route.request().postDataJSON().filePath).toBe(
            "/fixture/owner-image.png",
          );
          await route.fulfill({ json: png });
        });
        await page.setViewportSize({ width, height: 1000 });
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page);
        const events = [
          item("web", {
            type: "webSearch",
            query: "codex site:openai.com",
            action: {
              type: "search",
              query: "codex site:openai.com",
              queries: null,
            },
            results: null,
          }),
          item("image", {
            type: "imageGeneration",
            result: png,
            revisedPrompt: "a test color chart",
            status: "completed",
          }),
          item("view", { type: "imageView", path: "/fixture/owner-image.png" }),
          item("mcp", {
            type: "mcpToolCall",
            server: "workspace",
            tool: "inspect",
            arguments: { owner: "ux-0" },
            status: "completed",
            durationMs: 200,
            error: null,
            result: {
              content: [
                { type: "text", text: "真实媒体解码验收" },
                { type: "image", data: png, mimeType: "image/png" },
                { type: "audio", data: audioFixture(), mimeType: "audio/wav" },
                {
                  type: "resource_link",
                  uri: "https://example.invalid/resource",
                  name: "资源文档",
                },
              ],
              structuredContent: null,
            },
          }),
          item("compact", { type: "contextCompaction" }),
        ];
        await state(page, theme, events);
        const surface = page.locator(".codex-presentation").first();
        await expect(
          surface.getByText("codex | openai.com", { exact: false }),
        ).toBeVisible();
        await expect(
          surface.getByText("上下文已压缩", { exact: true }),
        ).toBeVisible();
        expect(reads).toBe(0);
        const generated = surface.getByRole("img", {
          name: "生成的图片",
          exact: true,
        });
        await expect
          .poll(() =>
            generated.evaluate((el: HTMLImageElement) => el.naturalWidth),
          )
          .toBe(120);
        await surface.getByRole("button", { name: "已查看 1 张图像" }).click();
        const inspected = surface.getByRole("img", {
          name: "查看的图片",
          exact: true,
        });
        await expect
          .poll(() =>
            inspected.evaluate((el: HTMLImageElement) => el.naturalWidth),
          )
          .toBe(120);
        expect(reads).toBe(1);
        await surface.getByRole("button", { name: /^Inspect/ }).click();
        await expect(
          surface.getByRole("link", { name: "资源文档" }),
        ).toHaveAttribute("href", "https://example.invalid/resource");
        const audio = surface.locator("audio");
        await expect
          .poll(() => audio.evaluate((el: HTMLAudioElement) => el.readyState))
          .toBeGreaterThanOrEqual(1);
        expect(
          await audio.evaluate((el: HTMLAudioElement) => el.duration),
        ).toBeCloseTo(0.1, 2);
        await page.screenshot({
          path: info.outputPath(`semantic-${width}-${theme}.png`),
          fullPage: true,
        });
        await surface
          .getByRole("button", { name: "放大生成的图片", exact: true })
          .click();
        await expect(
          page.getByRole("dialog").getByRole("link", { name: "下载图片" }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        const running = {
          method: "item/started",
          params: {
            threadId: "ux-0",
            turnId: "native-turn",
            item: {
              type: "dynamicToolCall",
              id: "unfinished",
              namespace: "functions",
              tool: "inspect",
              status: "inProgress",
              arguments: {},
              contentItems: null,
              success: null,
              durationMs: null,
            },
          },
        };
        await state(page, theme, [running]);
        await expect(
          surface.locator(
            '[data-activity-state="active"] .codex-cadenced-shimmer',
          ),
        ).toHaveCount(1);
        await state(page, theme, [
          running,
          {
            method: "turn/completed",
            params: {
              threadId: "ux-0",
              turn: { id: "native-turn", status: "interrupted", items: [] },
            },
          },
        ]);
        await expect(
          surface.locator('[data-codex-row="event-native-turn-unfinished"]'),
        ).toBeVisible();
        await expect(surface.locator(".codex-cadenced-shimmer")).toHaveCount(0);
        await expect(surface.getByText("Success", { exact: true })).toHaveCount(
          0,
        );
        expect(errors).toEqual([]);
      });
      test(`native approval scopes and long command remain usable (${width}, ${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const fixture = await installSessionUxFixture(page);
        await page.setViewportSize({ width, height: 1000 });
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page);
        await state(page, theme, [
          item("answer", {
            type: "agentMessage",
            text: "等待你的命令授权。",
            phase: null,
            memoryCitation: null,
          }),
        ]);
        const decision = {
          acceptWithExecpolicyAmendment: {
            execpolicy_amendment: ["python", "-m", "pytest"],
          },
        };
        const approval = {
          type: "commandExecution",
          requestId: 18,
          threadId: "ux-0",
          turnId: "native-turn",
          itemId: "command",
          startedAtMs: 1,
          environmentId: null,
          requestToken: "native-ui-fixture",
          command:
            "python -m pytest tests/test_owner.py\n# second line\n# third line\n# fourth line\n# fifth line",
          cwd: "/fixture/owner-project",
          reason: "运行当前项目的针对性检查？",
          proposedExecpolicyAmendment: ["python", "-m", "pytest"],
          availableDecisions: [
            "accept",
            decision,
            "acceptForSession",
            "decline",
          ],
        };
        await page.evaluate(async (approval) => {
          const path =
            "/src/session-mode/components/codex/stores/useApprovalStore.ts";
          const module = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          module.useApprovalStore.setState({
            pendingApprovals: [approval],
            currentApproval: approval,
          });
        }, approval);
        const card = page.locator("[data-codex-approval-surface]");
        await expect(
          card.getByText("/fixture/owner-project", { exact: true }),
        ).toBeVisible();
        const expand = card.getByRole("button", { name: "展开", exact: true });
        await expand.click();
        await expect(
          card.getByRole("button", { name: "收起", exact: true }),
        ).toHaveAttribute("aria-expanded", "true");
        const preview = card.locator(".codex-command-preview");
        expect((await preview.boundingBox())!.height).toBeLessThanOrEqual(321);
        await card
          .getByRole("button", { name: "审批选项", exact: true })
          .click();
        const menu = page.locator(".codex-approval-menu");
        await expect(menu).toBeVisible();
        expect(await menu.getByRole("menuitem").allTextContents()).toEqual([
          "允许一次",
          "允许类似命令python -m pytest",
          "允许此对话允许本次和本会话内的后续请求",
        ]);
        await page.screenshot({
          path: info.outputPath(`approval-${width}-${theme}.png`),
          fullPage: true,
        });
        await menu.getByRole("menuitem", { name: "允许类似命令" }).click();
        await expect(card).toHaveCount(0);
        const sent = fixture.calls.filter((call) =>
          call.path.endsWith("/approval/command-execution"),
        );
        expect(sent).toHaveLength(1);
        expect(sent[0].body.decision).toEqual(decision);
        expect(sent[0].body.request).toMatchObject({
          threadId: "ux-0",
          turnId: "native-turn",
          itemId: "command",
          requestToken: "native-ui-fixture",
        });
        expect(errors).toEqual([]);
      });
      test(`Codex native content preserves the detached composer and file hover (${width}, ${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await installSessionUxFixture(page);
        await page.setViewportSize({ width, height: 1000 });
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page);
        const changes = [
          {
            path: "/fixture/项目/very-long-project-path-for-ui-regression/example.py",
            kind: { type: "update", move_path: null },
            diff: patch,
          },
        ];
        await state(page, theme, [
          item("answer", {
            type: "agentMessage",
            text: "原生正文使用 `index` 和 \\(x^2\\)。\n\n请保留输入区与会话窗口分离。\n\n```python\nanswer = 3\n```",
            phase: "final_answer",
            memoryCitation: null,
          }),
          item("patch", { type: "fileChange", status: "completed", changes }),
          {
            method: "turn/completed",
            params: {
              threadId: "ux-0",
              turn: {
                id: "native-turn",
                status: "completed",
                items: [
                  {
                    type: "fileChange",
                    id: "patch",
                    status: "completed",
                    changes,
                  },
                ],
              },
            },
          },
        ]);
        const surface = page.locator(".codex-presentation").first();
        const composer = page.locator(".session-codex-composer").first();
        await expect(surface.locator(".katex").first()).toBeVisible();
        const numberToken = surface
          .locator('[data-streamdown="code-block"] pre')
          .getByText("3", { exact: true });
        await expect(numberToken).toBeVisible();
        expect(
          await numberToken.evaluate((el) => getComputedStyle(el).color),
        ).toBe(theme === "dark" ? "rgb(241, 162, 117)" : "rgb(172, 79, 35)");
        expect(
          await composer.evaluate(
            (el) => el.closest(".codex-presentation") === null,
          ),
        ).toBe(true);
        const body = surface.locator(".codex-assistant-content");
        expect(
          await body.evaluate((el) => getComputedStyle(el).borderTopWidth),
        ).toBe("0px");
        const patchRow = surface.locator(
          '[data-codex-row="event-native-turn-patch"]',
        );
        await patchRow
          .getByRole("button", { name: "已编辑", exact: true })
          .click();
        const inlinePatch = patchRow.locator(".codex-inline-diff");
        await expect(inlinePatch).toBeVisible();
        await expect(
          inlinePatch.getByText("307", { exact: true }),
        ).toBeVisible();
        await expect(inlinePatch.locator("[data-diff-toolbar]")).toHaveCount(0);
        await expect(
          inlinePatch.getByText("@@ -115,3 +115,4 @@", { exact: true }),
        ).toHaveCount(0);
        await page
          .context()
          .grantPermissions(["clipboard-read", "clipboard-write"]);
        await inlinePatch.hover();
        await inlinePatch
          .getByRole("button", { name: "Copy", exact: true })
          .click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
          patch,
        );
        const filename = page
          .locator(".codex-turn-diff-summary")
          .getByTitle("example.py", { exact: true });
        await expect(filename).toBeVisible();
        if (width === 390)
          await page
            .getByRole("button", { name: "预览 example.py Diff", exact: true })
            .click();
        else await filename.hover();
        const preview = page.locator('[data-slot="hover-card-content"]');
        await expect(preview).toBeVisible();
        await expect(preview.getByText("307", { exact: true })).toBeVisible();
        const previewTitle = preview.locator(".codex-hover-diff-label");
        await expect(
          previewTitle.getByTitle("example.py", { exact: true }),
        ).toHaveText("example.py");
        expect((await previewTitle.boundingBox())!.width).toBeGreaterThan(75);
        expect(
          await preview
            .locator('[data-old-line="116"]:not([data-new-line])')
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        ).not.toBe("rgba(0, 0, 0, 0)");
        await page.screenshot({
          path: info.outputPath(`native-${width}-${theme}.png`),
          fullPage: true,
        });
        await info.attach(`native-${width}-${theme}`, {
          path: info.outputPath(`native-${width}-${theme}.png`),
          contentType: "image/png",
        });
        expect(errors).toEqual([]);
      });
    }
  });

test("interleaved native streaming keeps one row and fills missing final text without a reload", async ({
  page,
}, info) => {
  await installSessionUxFixture(page);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor({ timeout: 60000 });
  await seedSessionUx(page);
  const delta = (text: string) => ({
    method: "item/agentMessage/delta",
    params: {
      threadId: "ux-0",
      turnId: "native-turn",
      itemId: "answer",
      delta: text,
    },
  });
  const events = [
    delta("第一段"),
    {
      method: "thread/tokenUsage/updated",
      params: { threadId: "ux-0", tokenUsage: {} },
    },
    delta("，第二段"),
  ];
  await state(page, "dark", events);
  await expect(
    page.locator(
      '.codex-presentation [data-codex-row="event-native-turn-answer"]',
    ),
  ).toHaveCount(1);
  await expect(page.getByText("第一段，第二段", { exact: true })).toBeVisible();
  await state(page, "dark", [
    ...events,
    item("answer", {
      type: "agentMessage",
      text: "第一段，第二段；最终补齐。",
      phase: "final_answer",
      memoryCitation: null,
    }),
  ]);
  await expect(
    page.getByText("第一段，第二段；最终补齐。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(
      '.codex-presentation [data-codex-row="event-native-turn-answer"]',
    ),
  ).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("native-stream-complete.png"),
  });
});

test("10000 interleaved events keep native rows bounded and the latest reply immediately visible", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await installSessionUxFixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor({ timeout: 60000 });
  await seedSessionUx(page);
  await state(page, "dark", [
    item("warm", {
      type: "agentMessage",
      text: "预热正文",
      phase: null,
      memoryCitation: null,
    }),
  ]);
  await expect(page.getByText("预热正文", { exact: true })).toBeVisible();
  const metrics = await page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/stores/index.ts";
    const { useCodexStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    const events = Array.from({ length: 2500 }, (_, index) => {
      const params = {
        threadId: "ux-0",
        turnId: `load-${index}`,
        itemId: `answer-${index}`,
      };
      return [
        {
          method: "item/agentMessage/delta",
          params: { ...params, delta: `正文 ${index}` },
        },
        {
          method: "thread/tokenUsage/updated",
          params: { threadId: "ux-0", turnId: params.turnId, tokenUsage: {} },
        },
        {
          method: "item/agentMessage/delta",
          params: { ...params, delta: " 中间片段" },
        },
        {
          method: "item/completed",
          params: {
            threadId: params.threadId,
            turnId: params.turnId,
            item: {
              type: "agentMessage",
              id: params.itemId,
              text: `正文 ${index} 最终快照`,
              phase: "final_answer",
              memoryCitation: null,
            },
          },
        },
      ];
    }).flat();
    const start = performance.now();
    useCodexStore.setState({ events: { "ux-0": events } });
    while (performance.now() - start < 5000) {
      await new Promise(requestAnimationFrame);
      const row = document.querySelector(
        '[data-codex-row="event-load-2499-answer-2499"]',
      );
      const viewport = row?.closest('[data-slot="scroll-area-viewport"]');
      if (row && viewport) {
        const box = row.getBoundingClientRect(),
          area = viewport.getBoundingClientRect();
        if (box.top < area.bottom && box.bottom > area.top)
          return {
            elapsedMs: performance.now() - start,
            eventCount: events.length,
          };
      }
    }
    throw new Error("The latest 10000-event snapshot was not visible");
  });
  expect(metrics.eventCount).toBe(10000);
  expect(metrics.elapsedMs).toBeLessThan(500);
  const surface = page.locator(".codex-presentation").first();
  await expect(
    surface.getByText("正文 2499 最终快照", { exact: true }),
  ).toBeVisible();
  expect(await surface.locator("[data-codex-row]").count()).toBeLessThan(80);
  expect(await surface.locator("*").count()).toBeLessThan(2000);
  await page.screenshot({ path: info.outputPath("native-10000-events.png") });
  await info.attach("native-10000-events-metrics", {
    body: JSON.stringify(metrics),
    contentType: "application/json",
  });
  console.log(`native 10000 events: ${metrics.elapsedMs.toFixed(1)}ms`);
});
