import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";
import { projectCodexChatValue } from "../../packages/shared/src/codex-chat-projection";

const patch =
  "--- a/example.py\n+++ b/example.py\n@@ -115,3 +115,4 @@\n context\n-old = 1\n+new = 2\n+extra = 3\n tail\n@@ -307,1 +308,1 @@\n-old = 4\n+new = 5\n";
const largePatch = `${patch}${"+large-diff-line\n".repeat(1800)}`;
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
    // Match the production gateway before data crosses into the browser. Full
    // tool results are never an implicit detail source for a chat snapshot.
    { theme, events: projectCodexChatValue(events) as any[] },
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
function observeHistoryReads(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/\/codex\/thread\/(read|turns\/list)$/.test(url.pathname))
      urls.push(url.href);
  });
  return urls;
}

for (const width of [1440, 390])
  test.describe(`${width}px native content`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"]) {
      test(`native bounded tool metadata and explicit owner image settle interrupted activity (${width}, ${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const fixture = await installSessionUxFixture(page);
        const historyReads = observeHistoryReads(page);
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
        const longDiff = largePatch;
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
          item("large-patch", {
            type: "fileChange",
            status: "completed",
            changes: [
              {
                path: "/fixture/owner/large-output.ts",
                kind: { type: "update", move_path: null },
                diff: longDiff,
              },
            ],
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
        expect(
          fixture.calls.filter(({ path }) =>
            path.includes("/api/codex/thread/item-detail"),
          ),
        ).toEqual([]);
        await expect(
          surface.getByText("large-diff-line", { exact: false }),
        ).toHaveCount(0);
        await expect(surface.locator("img, audio")).toHaveCount(0);
        await expect(
          surface.getByRole("link", { name: "资源文档" }),
        ).toHaveCount(0);
        await expect(
          surface.getByRole("button", { name: "显示原始工具调用输出" }),
        ).toHaveCount(0);
        await expect(
          surface.getByText("工具未返回任何内容", { exact: true }),
        ).toHaveCount(0);
        await expect(
          surface.getByText("真实媒体解码验收", { exact: true }),
        ).toHaveCount(0);
        expect(reads).toBe(0);
        const projected = projectCodexChatValue(events) as any[];
        expect(
          projected.find((event) => event.params.item.id === "mcp").params.item,
        ).toMatchObject({
          result: null,
          arguments: { owner: "ux-0" },
          transcriptMetadataOnly: true,
        });
        expect(
          projected.find((event) => event.params.item.id === "image").params
            .item.result,
        ).toBeUndefined();
        expect(
          projected.find((event) => event.params.item.id === "large-patch")
            .params.item.changes[0],
        ).toMatchObject({ diff: "", transcriptMetadataOnly: true });
        await page.screenshot({
          path: info.outputPath(`semantic-metadata-${width}-${theme}.png`),
          fullPage: true,
        });

        // An independent, explicit read-only component fixture tests an available
        // owner image. It does not restore a full tool result/history into chat.
        await page.evaluate(async () => {
          const dependency = (window as any).__sessionFixtureDependency;
          const [react, dom, { EventItem }] = await Promise.all([
            import(dependency("react.js")),
            import(dependency("react-dom_client.js")),
            import("/src/session-mode/components/codex/items/EventItem.tsx"),
          ]);
          const R = react.default ?? react;
          const host = document.createElement("div");
          host.className = "session-mode";
          host.id = "explicit-owner-image-fixture";
          host.style.cssText =
            "position:fixed;inset:220px 16px auto;z-index:90;padding:12px;background:var(--background);";
          document.body.append(host);
          const { createRoot } = dom.default ?? dom;
          const root = createRoot(host);
          (window as any).__explicitOwnerImageRoot = root;
          root.render(
            R.createElement(
              "div",
              { className: "codex-presentation" },
              R.createElement(EventItem, {
                event: {
                  method: "item/completed",
                  params: {
                    threadId: "ux-0",
                    turnId: "explicit-image-read",
                    item: {
                      id: "explicit-image",
                      type: "imageView",
                      path: "/fixture/owner-image.png",
                    },
                  },
                },
              }),
            ),
          );
        });
        const explicit = page.locator("#explicit-owner-image-fixture");
        expect(reads).toBe(0);
        await explicit.getByRole("button", { name: "已查看 1 张图像" }).click();
        const inspected = explicit.getByRole("img", {
          name: "查看的图片",
          exact: true,
        });
        await expect
          .poll(() =>
            inspected.evaluate((el: HTMLImageElement) => el.naturalWidth),
          )
          .toBe(120);
        expect(reads).toBe(1);
        await explicit
          .getByRole("button", { name: "放大查看的图片", exact: true })
          .click();
        await expect(
          page.getByRole("dialog").getByRole("link", { name: "下载图片" }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await page.evaluate(() => {
          (window as any).__explicitOwnerImageRoot.unmount();
          delete (window as any).__explicitOwnerImageRoot;
          document.getElementById("explicit-owner-image-fixture")?.remove();
        });
        // Event-driven chat reconciliation may finish while the explicit image
        // is opened; it must keep tool bodies unloaded and use chat projection.
        await expect(
          surface.getByText("large-diff-line", { exact: false }),
        ).toHaveCount(0);
        await expect(surface.locator("img, audio")).toHaveCount(0);
        await expect(
          surface.getByRole("button", { name: "显示原始工具调用输出" }),
        ).toHaveCount(0);
        expect(
          historyReads.every(
            (url) => new URL(url).searchParams.get("view") === "chat",
          ),
        ).toBe(true);
        expect(
          fixture.calls.filter(({ path }) =>
            /\/(turn\/(start|steer|interrupt)|thread\/(resume|fork)|review\/start)$/.test(
              path,
            ),
          ),
        ).toEqual([]);
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
        await surface
          .getByRole("button", { name: "工作过程", exact: true })
          .click();
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
      test(`Codex native content preserves the detached composer and metadata source navigation (${width}, ${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.context().grantPermissions([
          "clipboard-read",
          "clipboard-write",
        ]);
        const fixture = await installSessionUxFixture(page);
        const historyReads = observeHistoryReads(page);
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
          {
            path: "/fixture/项目/very-long-project-path-for-ui-regression/large-output.py",
            kind: { type: "update", move_path: null },
            diff: largePatch,
          },
        ];
        await state(page, theme, [
          item("answer", {
            type: "agentMessage",
            text: "原生正文使用 `index` 和 \\(x^2\\)。\n\n请保留输入区与会话窗口分离。\n\n| 类型 | 检查结果 |\n| --- | --- |\n| Markdown 表格 | 保留原生行列 |\n\n```python\nanswer = 3\n```",
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
        const completedChanges = await page.evaluate(async () => {
          const codexPath = "/src/session-mode/components/codex/stores/index.ts";
          const logicPath = "/src/session-mode/components/codex/items/fileChangeLogic.ts";
          const resolve = (path: string) =>
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path;
          const [{ useCodexStore }, { completedTurnChanges }] = await Promise.all([
            import(resolve(codexPath)),
            import(resolve(logicPath)),
          ]);
          const events = useCodexStore.getState().events["ux-0"];
          const index = events.findIndex((event: any) => event.method === "turn/completed");
          const event = events[index] as any;
          return completedTurnChanges("ux-0", "native-turn", event.params.turn.items, {
            events,
            eventIndex: index,
          }).changes.map((change: any) => ({
            path: change.path,
            diffLength: change.diff.length,
            metadataOnly: change.transcriptMetadataOnly === true,
          }));
        });
        expect(completedChanges).toContainEqual({
          path: changes[1].path,
          diffLength: 0,
          metadataOnly: true,
        });
        const surface = page.locator(".codex-presentation").first();
        const composer = page.locator(".session-codex-composer").first();
        await expect(surface.locator(".katex").first()).toBeVisible();
        const markdownTable = surface.locator(".codex-markdown table").first();
        await expect(markdownTable).toBeVisible();
        await expect(markdownTable).toContainText("保留原生行列");
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
        // Completed work is folded separately from the final answer. Inspect it
        // explicitly; expanding does not load the discarded raw patch body.
        await surface
          .getByRole("button", { name: "工作过程", exact: true })
          .click();
        const patchRow = surface.locator(
          '[data-codex-row="event-native-turn-patch"]',
        );
        await expect(
          patchRow.getByRole("button", { name: "编辑了文件", exact: true }),
        ).toBeVisible();
        await expect(patchRow.locator(".codex-inline-diff")).toHaveCount(0);
        await expect(
          patchRow.locator("[data-kind=add], [data-kind=remove]"),
        ).toHaveCount(0);
        const summary = page.locator(".codex-turn-diff-summary");
        const renderedChanges = await summary.evaluate((element) => {
          const fiberKey = Object.keys(element).find((key) =>
            key.startsWith("__reactFiber$"),
          );
          let fiber = fiberKey
            ? (element as any)[fiberKey]
            : null;
          while (fiber && fiber.type?.name !== "ThreadFileChangesSummary")
            fiber = fiber.return;
          return fiber?.memoizedProps?.changes?.map((change: any) => ({
            path: change.path,
            diffLength: change.diff?.length ?? null,
            metadataOnly: change.transcriptMetadataOnly === true,
          })) ?? null;
        });
        expect(renderedChanges).toContainEqual({
          path: changes[1].path,
          diffLength: 0,
          metadataOnly: true,
        });
        const shortRow = summary
          .locator(".codex-turn-diff-file-row")
          .filter({ hasText: "example.py" });
        const largeFile = summary.getByRole("button", {
          name: "查看文件 large-output.py",
          exact: true,
        });
        await expect(shortRow).toBeVisible();
        await expect(largeFile).toBeVisible();
        await expect(summary.getByText("详情未加载", { exact: true })).toBeVisible();
        await expect(
          shortRow.locator("[data-transcript-details-unloaded]"),
        ).toHaveCount(0);
        await expect(shortRow.getByText("+3", { exact: true })).toBeVisible();
        await expect(shortRow.getByText("-2", { exact: true })).toBeVisible();
        await expect(
          summary.getByRole("button", {
            name: "预览 large-output.py Diff",
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(summary.getByText("+0", { exact: true })).toHaveCount(0);
        await expect(summary.getByText("-0", { exact: true })).toHaveCount(0);
        await expect(
          summary.getByText("large-diff-line", { exact: false }),
        ).toHaveCount(0);
        await shortRow.locator(".codex-turn-diff-file-path").hover();
        await expect(page.locator('[data-slot="hover-card-content"]')).toBeVisible();
        await expect(
          page.locator(".codex-file-preview").getByText("extra = 3", { exact: true }),
        ).toBeVisible();
        await page
          .locator(".codex-file-preview")
          .getByRole("button", { name: "Copy", exact: true })
          .click();
        await expect
          .poll(() => page.evaluate(() => navigator.clipboard.readText()))
          .toContain("+extra = 3");
        await page.mouse.move(0, 0);
        await expect(
          page.locator('[data-slot="hover-card-content"]'),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: "预览 example.py Diff",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          summary.getByRole("button", { name: "Review", exact: true }),
        ).toHaveCount(0);
        await expect(
          summary.getByRole("button", { name: "审查", exact: true }),
        ).toHaveCount(0);
        // The short patch remains available to preview and copy; the long patch
        // remains metadata-only until the explicit owner source read below.
        const sourceReads: Array<{ root: string; path: string }> = [];
        await page.route(
          "**/api/session/workspace-files/read",
          async (route) => {
            const { root, path } = route.request().postDataJSON();
            sourceReads.push({ root, path });
            const content = "owner source file content";
            await route.fulfill({
              json: {
                path,
                content,
                version: "owner-source-v1",
                size: Buffer.byteLength(content),
              },
            });
          },
        );
        await largeFile.click();
        await expect
          // The dev entry uses StrictMode: its mount effect can repeat a
          // read-only request. Every request must still target the same owner.
          .poll(() => [
            ...new Set(sourceReads.map((value) => JSON.stringify(value))),
          ])
          .toEqual([
            JSON.stringify({
              root: "/fixture/项目/very-long-project-path-for-ui-regression",
              path: changes[1].path,
            }),
          ]);
        const selected = await page.evaluate(async () => {
          const path = "/src/session-mode/stores/useEditorStore.ts";
          const { useEditorStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
          return useEditorStore.getState().selectedFilePath;
        });
        expect(selected).toBe(changes[1].path);
        await expect(patchRow.locator(".codex-inline-diff")).toHaveCount(0);
        expect(
          historyReads.every(
            (url) => new URL(url).searchParams.get("view") === "chat",
          ),
        ).toBe(true);
        expect(
          fixture.calls.filter(({ path }) =>
            /\/(turn\/(start|steer|interrupt)|thread\/(resume|fork)|review\/start)$/.test(
              path,
            ),
          ),
        ).toEqual([]);
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

let activeNativeRenderStream:
  | Awaited<ReturnType<typeof liveStream>>
  | undefined;
test.afterEach(async () => {
  await activeNativeRenderStream?.close();
  activeNativeRenderStream = undefined;
});

test("10000 interleaved events keep native rows bounded and the latest reply immediately visible", async ({
  page,
  baseURL,
}, info) => {
  test.setTimeout(90000);
  await installSessionUxFixture(page);
  activeNativeRenderStream = await liveStream(page, baseURL!);
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
  await expect
    .poll(async () => {
      const connected = await page.evaluate(async () => {
        const path = "/src/session-mode/lib/eventStream.ts";
        const module = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
        return module.isEventStreamConnected();
      });
      return {
        connected,
        opens: activeNativeRenderStream?.opens(),
        connections: activeNativeRenderStream?.connections(),
      };
    })
    .toEqual({ connected: true, opens: 1, connections: 1 });
  await expect(
    page.locator('.codex-presentation [data-codex-row="event-native-turn-warm"]'),
  ).toBeVisible();
  await expect(page.locator('[data-transcript-preparing="ux-0"]')).toHaveCount(0);
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
