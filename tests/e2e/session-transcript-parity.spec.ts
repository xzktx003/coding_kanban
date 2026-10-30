import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

const streams = new WeakMap<Page, Awaited<ReturnType<typeof liveStream>>>();
test.beforeEach(async ({ page, baseURL }) => {
  streams.set(page, await liveStream(page, baseURL!));
});
test.afterEach(async ({ page }) => {
  await streams.get(page)?.close();
  streams.delete(page);
});

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const details = page.getByText("错误详情", { exact: true });
  if (await details.isVisible().catch(() => false))
    await details.click().catch(() => {});
  await info.attach("failure-body", {
    body: await page
      .locator("body")
      .innerText()
      .catch(() => "unavailable"),
    contentType: "text/plain",
  });
});

for (const width of [1440, 393]) {
  test(`external live attachment is explicit and stays attached after refresh (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 852 });
    const fixture = await installSessionUxFixture(page, 1);
    let attached = false,
      writes = 0;
    await page.route("**/api/**/thread/access", (route) =>
      route.fulfill({
        json: {
          state: attached ? "owned" : "readonly",
          reason: "",
          generation: 7,
          sharedDaemon: true,
          loaded: true,
          attached,
          activeTurnId: attached ? null : "external-turn",
        },
      }),
    );
    await page.route("**/api/session/lifecycle/context", (route) =>
      route.fulfill({
        json: { scopeToken: "fixture-scope", namespace: "fixture-account" },
      }),
    );
    await page.route("**/api/session/lifecycle/attach", async (route) => {
      writes++;
      expect(route.request().postDataJSON()).toEqual({
        expectedScope: "fixture-scope",
        threadId: "ux-0",
        expectedTurnId: "external-turn",
      });
      attached = true;
      await route.fulfill({ json: { attached: true } });
    });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await seedSessionUx(page, 1);
    await page.evaluate(async () => {
      const path = "/src/session-mode/stores/useAgentCenterStore.ts";
      const { useAgentCenterStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
      useAgentCenterStore
        .getState()
        .addAgentCard({
          kind: "codex",
          id: "ux-0",
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          preview: "external task",
        });
    });
    const connect = page.getByRole("button", {
      name: "连接实时交互",
      exact: true,
    });
    await expect(connect).toBeVisible();
    expect(writes).toBe(0);
    await connect.click();
    await expect.poll(() => writes).toBe(1);
    await expect(page.getByText("该任务正在官方服务中运行，可连接实时交互。", { exact: true })).toHaveCount(0);
    await expect(connect).toHaveCount(0);
    expect(writes).toBe(1);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.locator('[data-codex-transcript-shell="ux-0"] .thread-surface'),
    ).toBeVisible();
    await expect(connect).toHaveCount(0);
    expect(writes).toBe(1);
    expect(
      fixture.calls.filter((call) =>
        /thread\/(resume|acquire)$|turn\/(start|interrupt|steer)$/.test(
          call.path,
        ),
      ),
    ).toEqual([]);
  });

  test(`cached transcript and precise composer remain usable before the full renderer (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 852 });
    const fixture = await installSessionUxFixture(page, 1);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = 0;
    await page.route(
      /\/src\/session-mode\/components\/codex\/thread\/CodexTranscript\.tsx/,
      async (route) => {
        requested++;
        await held;
        await route.continue();
      },
    );
    try {
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await seedSessionUx(page, 1);
      await page.evaluate(async () => {
        const moduleUrl = (path: string) =>
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path;
        const { useCodexStore } = await import(
          moduleUrl("/src/session-mode/components/codex/stores/index.ts")
        );
        const { useAgentCenterStore } = await import(
          moduleUrl("/src/session-mode/stores/useAgentCenterStore.ts")
        );
        useCodexStore.setState({
          events: {
            "ux-0": [
              {
                method: "item/completed",
                params: {
                  threadId: "ux-0",
                  turnId: "cached-turn",
                  item: {
                    type: "agentMessage",
                    id: "cached-answer",
                    text: "The correct cached conversation remains readable",
                    phase: "final_answer",
                    memoryCitation: null,
                  },
                },
              },
            ],
          },
          historyLoadedMap: { "ux-0": true },
        });
        useAgentCenterStore
          .getState()
          .addAgentCard({
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "cached reader",
          });
      });
      const pending = page.locator('[data-transcript-preparing="ux-0"]');
      await expect(pending).toContainText(
        "The correct cached conversation remains readable",
      );
      const composer = page.locator(".session-codex-composer");
      await expect(composer).toHaveAttribute(
        "data-draft-owner",
        JSON.stringify(["codex", "", "session", "ux-0"]),
      );
      const editor = composer.locator("[contenteditable=true]").first();
      await editor.fill("Preserve this draft while rich tools load");
      await expect(editor).toHaveText(
        "Preserve this draft while rich tools load",
      );
      expect(requested).toBe(1);
      expect(
        fixture.calls.filter((call) =>
          /turn\/(start|interrupt|steer)$/.test(call.path),
        ),
      ).toEqual([]);
      release();
      await expect(pending).toHaveCount(0);
      await expect(
        page.locator('[data-codex-transcript-shell="ux-0"] .thread-surface'),
      ).toContainText("The correct cached conversation remains readable");
      await expect(editor).toHaveText(
        "Preserve this draft while rich tools load",
      );
    } finally {
      release();
    }
  });

  test(`latest process, live Markdown and Sources preserve the exact conversation (${width})`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 852 });
    const fixture = await installSessionUxFixture(page, 1);
    fixture.threads[0].status = { type: "active", activeFlags: [] } as never;
    let detailReads = 0;
    await page.route("**/api/**/thread/item-detail", async (route) => {
      detailReads++;
      const body = route.request().postDataJSON();
      expect(body).toEqual({
        threadId: "ux-0",
        turnId: "parity-turn",
        itemId: "mcp",
        expectedType: "mcpToolCall",
      });
      await route.fulfill({
        json: {
          ...body,
          item: {
            type: "mcpToolCall",
            id: "mcp",
            server: "docs",
            tool: "search_docs",
            status: "completed",
            arguments: { query: "source preview input" },
            result: {
              content: [{ type: "text", text: "source preview result" }],
            },
            error: null,
            durationMs: 12,
          },
        },
      });
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await seedSessionUx(page, 1);
    await page.evaluate(async () => {
      const moduleUrl = (path: string) =>
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path;
      const { useCodexStore } = await import(
        moduleUrl("/src/session-mode/components/codex/stores/index.ts")
      );
      const { useAgentCenterStore } = await import(
        moduleUrl("/src/session-mode/stores/useAgentCenterStore.ts")
      );
      const threadId = "ux-0",
        turnId = "parity-turn";
      const nativeItem = (
        id: string,
        item: object,
        method = "item/completed",
      ) => ({
        method,
        params: {
          threadId,
          turnId,
          startedAtMs: Date.now(),
          completedAtMs: Date.now(),
          item: { id, ...item },
        },
      });
      const events = [
        {
          method: "turn/started",
          params: {
            threadId,
            turn: {
              id: turnId,
              status: "inProgress",
              items: [],
              startedAt: Math.floor(Date.now() / 1000),
              completedAt: null,
              durationMs: null,
            },
          },
        },
        nativeItem(
          "user",
          {
            type: "userMessage",
            content: [
              { type: "text", text: "Review these sources", text_elements: [] },
              {
                type: "mention",
                name: "provided file",
                path: "/fixture/provided.ts",
              },
            ],
          },
          "item/started",
        ),
        nativeItem("old-comment", {
          type: "agentMessage",
          text: "Earlier progress is retained",
          phase: "commentary",
          memoryCitation: null,
        }),
        nativeItem("mcp", {
          type: "mcpToolCall",
          server: "docs",
          tool: "search_docs",
          status: "completed",
          arguments: null,
          result: null,
          error: null,
          durationMs: 12,
          transcriptMetadataOnly: true,
        }),
        nativeItem("web", {
          type: "webSearch",
          query: "reference",
          action: { type: "openPage", url: "https://example.org/reference" },
          results: null,
        }),
        nativeItem("patch", {
          type: "fileChange",
          status: "completed",
          changes: [
            {
              path: "/fixture/created.ts",
              kind: { type: "add" },
              diff: "",
              transcriptMetadataOnly: true,
            },
          ],
          transcriptMetadataOnly: true,
        }),
        nativeItem("image-quota", {
          type: "imageGeneration",
          status: "failed",
          result: "",
          revisedPrompt: null,
          transcriptMetadataOnly: true,
          failure: {
            type: "usageLimitExceeded",
            limitId: "image_gen",
            resetsAt: null,
          },
        }),
        nativeItem("latest-comment", {
          type: "agentMessage",
          text: "Latest progress stays visible",
          phase: "commentary",
          memoryCitation: null,
        }),
        nativeItem(
          "current-command",
          {
            type: "commandExecution",
            command: "check-current",
            cwd: "/fixture",
            status: "inProgress",
            commandActions: [],
            aggregatedOutput: null,
          },
          "item/started",
        ),
        {
          method: "thread/readState/changed",
          params: { threadId, readState: { revision: "1" } },
        },
      ];
      useCodexStore.setState({
        currentThreadId: threadId,
        currentTurnId: turnId,
        events: { [threadId]: events },
        historyLoadedMap: { [threadId]: true },
        historyLoadingMap: {},
        historyErrorMap: {},
        threadStatusMap: { [threadId]: { type: "active", activeFlags: [] } },
        turnTimingMap: {
          [threadId]: {
            turnId,
            status: "inProgress",
            startedAtMs: Date.now(),
            durationMs: null,
          },
        },
      });
      useAgentCenterStore
        .getState()
        .addAgentCard({
          kind: "codex",
          id: threadId,
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          preview: "source parity",
        });
      (window as any).__transcriptParityStore = useCodexStore;
    });
    await expect(
      page.getByText("Latest progress stays visible", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[data-image-quota-failure="image-quota"]'),
    ).toContainText(/你已达到图像创建上限|image creation limit/);
    await expect(
      page.getByText("Earlier progress is retained", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("thread/readState/changed", { exact: true }),
    ).toHaveCount(0);
    const all = page.locator('button[data-turn-work="parity-turn"]');
    await expect(all).toHaveAttribute("aria-expanded", "false");
    await all.click();
    await expect(
      page.getByText("Earlier progress is retained", { exact: true }),
    ).toBeVisible();
    await all.click();
    await expect(
      page.getByText("Earlier progress is retained", { exact: true }),
    ).toHaveCount(0);

    await page.evaluate(() => {
      (window as any).__transcriptParityStore
        .getState()
        .setStreamingAgentDeltas("ux-0", [
          {
            method: "item/agentMessage/delta",
            params: {
              threadId: "ux-0",
              turnId: "parity-turn",
              itemId: "live",
              delta:
                "**Live formatted progress**\n\n```ts\nconst streamed = 42;\n```\n\n| Result | Value |\n|---|---|\n| rows | two |",
            },
          },
        ]);
    });
    const live = page.locator("[data-codex-live-message]");
    await expect(live.locator("strong")).toHaveText("Live formatted progress");
    await expect(live.locator("table")).toBeVisible();
    await expect(live.locator(".codex-message-native-actions")).toHaveCount(0);
    expect(detailReads).toBe(0);
    await page
      .getByRole("button", { name: "查看会话来源", exact: true })
      .click({ timeout: 5000 });
    const sources = page.getByRole("dialog", { name: "来源", exact: true });
    const site = sources.locator("summary").filter({ hasText: "example.org" });
    await expect(site).toBeVisible();
    await site.click();
    await expect(
      sources.getByRole("link", {
        name: "https://example.org/reference",
        exact: true,
      }),
    ).toHaveAttribute("href", "https://example.org/reference");
    await expect(
      sources.getByRole("button", {
        name: "/fixture/provided.ts",
        exact: true,
      }),
    ).toBeVisible();
    await expect(sources.getByText("已创建", { exact: true })).toBeVisible();
    expect(detailReads).toBe(0);
    await sources
      .getByRole("button", { name: "search_docs", exact: true })
      .click();
    await expect(sources.getByText(/source preview input/)).toBeVisible();
    expect(detailReads).toBe(1);
    await page.screenshot({
      path: info.outputPath(`sources-${width}.png`),
      fullPage: false,
    });
    await sources.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sources).toHaveCount(0);
    await expect(live.locator("table")).toBeVisible();
    expect(
      fixture.calls.filter((call) =>
        /turn\/(start|interrupt|steer)$/.test(call.path),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
}
