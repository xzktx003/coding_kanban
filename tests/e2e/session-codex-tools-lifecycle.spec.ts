import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAABICAIAAACyfKYoAAABBklEQVR4nO3QoZGFMAAFwF/QFUEJiBSAREYiEEx0RBQ6miqvhyeidmYr2N/ffsW2vcXK3mPn/sbufcbG/sV+okWLFi1atGjRokWLFi1atOg10ccV244WK0ePnccbu48ZG8cXEy1atGjRokWLFi1atGjRokUviq5XbKstVmqPnfWN3XXGRv1iokWLFi1atGjRokWLFi1atOhF0c8V254WK0+Pnc8bu58ZG88XEy1atGjRokWLFi1atGjRokUvih5XbBstVkaPneON3WPGxvhiokWLFi1atGjRokWLFi1atOhF0fOKbbPFyuyxc76xe87YmF9MtGjRokWLFi1atGjRokWLFr0k+h8jd1cCNT+MqwAAAABJRU5ErkJggg==";
const item = (
  id: string,
  type: string,
  fields: object = {},
  method = "item/completed",
) => ({
  method,
  params: {
    threadId: "ux-0",
    turnId: "tools-turn",
    item: { id, type, ...fields },
  },
});
async function seed(page: Page, theme: string, events: object[]) {
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
        ),
        { useLayoutStore } = await module(
          "/src/session-mode/stores/useLayoutStore.ts",
        ),
        { useAgentCenterStore } = await module(
          "/src/session-mode/stores/useAgentCenterStore.ts",
        ),
        { useCodexStore } = await module(
          "/src/session-mode/components/codex/stores/index.ts",
        );
      useThemeStore.getState().setTheme(theme);
      useLayoutStore.setState({
        view: "agent",
        isSidebarOpen: false,
        isRightPanelOpen: false,
      });
      useAgentCenterStore.getState().addAgentCard({
        kind: "codex",
        id: "ux-0",
        cwd: "/fixture",
        preview: "工具语义验收",
      });
      useAgentCenterStore.getState().setCardsViewMode("solo");
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
for (const width of [1440, 390])
  test.describe(`${width} native tools`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"])
      test(`real LAN tools gallery edit hooks and review (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(120000);
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await installSessionUxFixture(page);
        let reads = 0,
          uploads = 0;
        await page.route("**/api/codex/thread/search-occurrences", (route) =>
          route.fulfill({
            status: 501,
            json: { error: "Native search unsupported in isolated fixture" },
          }),
        );
        await page.route("**/api/filesystem/read-file", async (route) => {
          reads++;
          expect(["/fixture/one.png", "/fixture/two.png"]).toContain(
            route.request().postDataJSON().filePath,
          );
          await route.fulfill({ json: png });
        });
        await page.route("**/api/session/files/upload", async (route) => {
          uploads++;
          const body = route.request().postDataJSON();
          expect(body.data.length).toBeGreaterThan(10);
          await route.fulfill({ json: { path: "/fixture/edited.png" } });
        });
        await page.setViewportSize({ width, height: 844 });
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-mode [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page);
        const hook = {
          id: "hook",
          eventName: "postToolUse",
          handlerType: "command",
          executionMode: "sync",
          scope: "thread",
          sourcePath: "/fixture/hooks.json",
          source: "project",
          displayOrder: 1,
          status: "blocked",
          statusMessage: "Project policy",
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          entries: [{ kind: "feedback", text: "Review completed safely" }],
        };
        const review = {
          threadId: "ux-0",
          turnId: "tools-turn",
          reviewId: "review",
          targetItemId: "command",
          startedAtMs: 1,
          completedAtMs: 2,
          decisionSource: "agent",
          review: {
            status: "denied",
            riskLevel: "high",
            userAuthorization: "unknown",
            rationale: "Needs explicit task scope",
          },
          action: {
            type: "command",
            source: "shell",
            command: "curl target",
            cwd: "/fixture",
          },
        };
        const events = [
          item(
            "user",
            "userMessage",
            {
              content: [
                {
                  type: "text",
                  text: "检查工具结果与图片。",
                  text_elements: [],
                },
              ],
              clientId: null,
            },
            "item/started",
          ),
          {
            method: "hook/started",
            params: {
              threadId: "ux-0",
              turnId: "tools-turn",
              run: {
                ...hook,
                status: "running",
                completedAt: null,
                entries: [],
              },
            },
          },
          {
            method: "hook/completed",
            params: { threadId: "ux-0", turnId: "tools-turn", run: hook },
          },
          item("gen-one", "imageGeneration", {
            status: "completed",
            result: png,
            revisedPrompt: null,
          }),
          item("gen-two", "imageGeneration", {
            status: "completed",
            result: png,
            revisedPrompt: null,
          }),
          item("view-one", "imageView", { path: "/fixture/one.png" }),
          item("view-two", "imageView", { path: "/fixture/two.png" }),
          {
            method: "item/autoApprovalReview/started",
            params: {
              ...review,
              review: { ...review.review, status: "inProgress" },
            },
          },
          { method: "item/autoApprovalReview/completed", params: review },
          {
            method: "model/rerouted",
            params: {
              threadId: "ux-0",
              turnId: "tools-turn",
              fromModel: "gpt-a",
              toModel: "gpt-b",
              reason: "highRiskCyberActivity",
            },
          },
          item("reply", "agentMessage", {
            text: "已检查工具结果。",
            phase: "final_answer",
            memoryCitation: null,
          }),
          {
            method: "turn/completed",
            params: {
              threadId: "ux-0",
              turn: {
                id: "tools-turn",
                status: "completed",
                items: [],
                error: null,
              },
            },
          },
        ];
        await seed(page, theme, events);
        const surface = page.locator(".codex-presentation").first();
        await expect(
          surface.locator(".codex-native-user").first(),
        ).toBeVisible();
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .focus();
        await page.keyboard.press("Control+f");
        const search = page.getByRole("textbox", { name: "搜索会话正文" });
        await expect(search).toBeFocused();
        await search.fill("检查");
        await search.press("Enter");
        await expect
          .poll(() =>
            page.evaluate(() => {
              const range = [
                ...((CSS as any).highlights.get("codex-thread-search-active") ??
                  []),
              ][0];
              return range?.toString();
            }),
          )
          .toBe("检查");
        await search.press("Control+g");
        await expect
          .poll(() =>
            page.evaluate(() => {
              const range = [
                ...((CSS as any).highlights.get("codex-thread-search-active") ??
                  []),
              ][0];
              return Boolean(
                range?.startContainer.parentElement?.closest(
                  ".codex-assistant-content",
                ),
              );
            }),
          )
          .toBe(true);
        await page.screenshot({
          path: info.outputPath(`tools-search-${theme}-${width}.png`),
          fullPage: true,
        });
        await search.press("Escape");
        await expect
          .poll(() =>
            page.evaluate(() =>
              (CSS as any).highlights.has("codex-thread-search-active"),
            ),
          )
          .toBe(false);
        await expect(
          surface.locator(".codex-native-generated-gallery img"),
        ).toHaveCount(2);
        await expect
          .poll(() =>
            surface
              .locator(".codex-native-generated-gallery img")
              .first()
              .evaluate((el: HTMLImageElement) => el.naturalWidth),
          )
          .toBe(120);
        const gallery = await surface
          .locator(".codex-native-generated-gallery")
          .boundingBox();
        expect(gallery!.height).toBeCloseTo((gallery!.width - 24) / 4, 0);
        expect(reads).toBe(0);
        await surface.getByRole("button", { name: "已查看 2 张图像" }).click();
        await expect(
          surface.locator(".codex-native-image-gallery img"),
        ).toHaveCount(2);
        await expect.poll(() => reads).toBe(2);
        await surface.getByRole("button", { name: "curl target" }).click();
        await expect(
          surface.getByText("此操作被视为高风险，需要明确授权", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          surface.getByText("Needs explicit task scope"),
        ).toHaveCount(0);
        await expect(
          surface.getByRole("button", { name: "批准", exact: true }),
        ).toHaveCount(0);
        await surface.locator(".codex-assistant").last().hover();
        await surface
          .getByRole("button", { name: "钩子统计信息" })
          .last()
          .click();
        await expect(
          page.getByRole("dialog").getByText("运行次数", { exact: false }),
        ).toBeVisible();
        await page.getByRole("dialog").locator("summary").click();
        await expect(page.getByText("Review completed safely")).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`tools-hooks-${theme}-${width}.png`),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await surface
          .getByRole("button", { name: "编辑图片", exact: true })
          .first()
          .click();
        const editor = page.getByRole("dialog");
        await expect(
          editor.getByRole("button", { name: "完成并附加" }),
        ).toBeEnabled();
        await page.screenshot({
          path: info.outputPath(`tools-image-editor-${theme}-${width}.png`),
          fullPage: true,
        });
        await editor.getByRole("button", { name: "完成并附加" }).click();
        await expect.poll(() => uploads).toBe(1);
        const draft = await page.evaluate(async () => {
          const { useAttachmentDraftStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast(
                (e) =>
                  new URL(e.name).pathname ===
                  "/src/session-mode/components/common/useImageAttachments.ts",
              )!.name
          );
          return Object.entries(useAttachmentDraftStore.getState().drafts).map(
            ([key, items]: any) => ({
              key,
              paths: items.map((item: any) => item.path),
            }),
          );
        });
        expect(
          draft.find((d) => d.key === '["codex","","session","ux-0"]')?.paths,
        ).toContain("/fixture/edited.png");
        await page.screenshot({
          path: info.outputPath(`tools-final-${theme}-${width}.png`),
          fullPage: true,
        });
        await expect(
          surface.getByText("hook/started", { exact: true }),
        ).toHaveCount(0);
        expect(errors).toEqual([]);
      });
  });
