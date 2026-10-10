import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
const sourceId = "ux-0";
function history(count = 60) {
  return Array.from({ length: count }, (_, index) => ({
    id: `turn-${index}`,
    status: "completed",
    items: [
      {
        type: "userMessage",
        id: `user-${index}`,
        clientId: null,
        content: [
          {
            type: "text",
            text: `用户消息 ${index} ${index === 0 ? "stable target café 中文" : "native request"}`,
            text_elements: [],
          },
        ],
      },
      {
        type: "agentMessage",
        id: `assistant-${index}`,
        text: `完成回复 ${index}\n\nNative complete reply with \`index\`.`,
        phase: "final_answer",
        memoryCitation: null,
      },
    ],
    startedAt: 1,
    durationMs: 1000,
    error: null,
  }));
}
async function configure(page: Page, turns: any[], theme: string) {
  await page.route("**/api/codex/thread/search-occurrences", (route) =>
    route.fulfill({
      status: 501,
      json: { error: "Native thread/searchOccurrences is not supported yet" },
    }),
  );
  await page.evaluate(
    async ({ turns, theme }) => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
      const [
        { useCodexStore },
        { useAgentCenterStore },
        { useLayoutStore },
        { useThemeStore },
        { useSessionDraftStore, sessionDraftKey },
      ] = await Promise.all([
        module("/src/session-mode/components/codex/stores/useCodexStore.ts"),
        module("/src/session-mode/stores/useAgentCenterStore.ts"),
        module("/src/session-mode/stores/useLayoutStore.ts"),
        module("/src/session-mode/stores/settings/useThemeStore.ts"),
        module("/src/session-mode/stores/useSessionDraftStore.ts"),
      ]);
      const events = turns.flatMap((turn) => [
        ...turn.items.map((item: any) => ({
          method:
            item.type === "userMessage" ? "item/started" : "item/completed",
          params: { threadId: "ux-0", turnId: turn.id, item },
        })),
        { method: "turn/completed", params: { threadId: "ux-0", turn } },
      ]);
      useThemeStore.getState().setTheme(theme);
      useLayoutStore.setState({
        view: "agent",
        isSidebarOpen: false,
        isRightPanelOpen: false,
      });
      useCodexStore.setState({
        threads: [
          {
            ...(useCodexStore
              .getState()
              .threads.find((thread: any) => thread.id === "ux-0") ?? {}),
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            name: "Native workflow fixture",
            preview: "Native workflow fixture",
            modelProvider: "openai",
            createdAt: 1,
            updatedAt: 2,
            status: { type: "idle" },
            turns,
          },
          ...useCodexStore
            .getState()
            .threads.filter((thread: any) => thread.id !== "ux-0"),
        ],
        events: { "ux-0": events },
        historyLoadedMap: { "ux-0": true },
        historyLoadingMap: {},
        currentThreadId: "ux-0",
        currentTurnId: null,
        threadStatusMap: { "ux-0": { type: "idle" } },
        turnTimingMap: {},
      });
      useAgentCenterStore.getState().addAgentCard(
        {
          kind: "codex",
          id: "ux-0",
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          preview: "Native workflow fixture",
        },
        { activate: true },
      );
      useAgentCenterStore.setState({ cardsViewMode: "solo" });
      useSessionDraftStore
        .getState()
        .setText(
          sessionDraftKey("codex", "ux-0"),
          "Detached draft stays intact",
        );
    },
    { turns, theme },
  );
}
async function menu(page: Page, label: string) {
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}
for (const width of [1440, 390])
  test.describe(`${width}px workflow`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"])
      test(`search uses virtual anchors, native actions and source Markdown (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        const fixture = await installSessionUxFixture(page, 2);
        const turns = history();
        fixture.threads[0].turns = turns;
        await page.setViewportSize({ width, height: 844 });
        await page.goto("/?mode=session");
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page, 2);
        await configure(page, turns, theme);
        await expect(
          page.locator('[data-thread-workflows="ux-0"]'),
        ).toHaveCount(1);
        await expect(page.locator(".codex-thread-search")).toHaveCount(0);
        await menu(page, "搜索会话");
        const input = page.getByRole("textbox", { name: "搜索会话正文" });
        await expect(input).toBeVisible();
        await input.fill("STABLE TARGET");
        await expect(
          page.locator(".codex-thread-search-results"),
        ).toContainText("stable target café 中文");
        await page
          .locator(".codex-thread-search-results button")
          .first()
          .click();
        await page.getByRole("button", { name: "关闭搜索" }).click();
        await expect(
          page.locator('.codex-native-user[data-owner-turn="turn-0"]'),
        ).toBeVisible();
        await menu(page, "用户消息导航");
        await page
          .locator(".codex-thread-user-navigation")
          .getByRole("button", { name: /用户消息 59/ })
          .click();
        await page.getByRole("button", { name: "关闭用户消息导航" }).click();
        const last = page.locator(
          '.codex-native-user[data-owner-turn="turn-59"]',
        );
        await expect(last).toBeVisible();
        await last.hover();
        await last
          .getByRole("button", { name: /编辑消息|Edit message/ })
          .click();
        await expect(
          page.getByRole("textbox", { name: "编辑上一条用户消息" }),
        ).toBeVisible();
        await page
          .getByRole("textbox", { name: "编辑上一条用户消息" })
          .fill("Inline buffer is independent");
        await expect(
          page
            .locator(".session-codex-composer [contenteditable=true]")
            .first(),
        ).toContainText("Detached draft stays intact");
        await page.getByRole("button", { name: "取消编辑" }).click();
        const download = page.waitForEvent("download");
        await menu(page, "导出 Markdown");
        const file = await download;
        const path = await file.path();
        expect(path).not.toBeNull();
        const exported = await readFile(path!, "utf8");
        expect(exported).toContain("stable target café 中文");
        expect(exported).toContain("完成回复 59");
        expect(exported).not.toMatch(
          /复制消息|从此轮创建分支|引用选区|raw reasoning/,
        );
        if (width === 390) {
          const actions = last.locator(".codex-message-native-actions button");
          for (const box of await actions.evaluateAll((elements) =>
            elements.map((el) => ({
              w: el.getBoundingClientRect().width,
              h: el.getBoundingClientRect().height,
            })),
          )) {
            expect(box.w).toBeGreaterThanOrEqual(44);
            expect(box.h).toBeGreaterThanOrEqual(44);
          }
        }
        await expect(page.locator('[role="menu"]')).toHaveCount(0);
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: info.outputPath(`workflow-${width}-${theme}.png`),
          fullPage: true,
        });
      });
  });

test("fork selection captures original source and delayed response cannot switch another tab or overwrite draft", async ({
  page,
}) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 2);
  const turns = history(2);
  fixture.threads[0].turns = turns;
  const calls: any[] = [];
  let finish!: () => void;
  const response = new Promise<void>((resolve) => (finish = resolve));
  await page.route("**/api/session/api/codex/thread/fork", async (route) => {
    calls.push(route.request().postDataJSON());
    await response;
    const thread = {
      ...fixture.threads[0],
      id: "forked-turn-1",
      turns: [turns[0], turns[1]],
    };
    fixture.threads.push(thread);
    await route.fulfill({
      json: { thread, model: "fixture-model", reasoningEffort: "medium" },
    });
  });
  await page.goto("/?mode=session");
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor({ timeout: 60000 });
  await seedSessionUx(page, 2);
  await configure(page, turns, "dark");
  const reply = page.locator('.codex-assistant[data-owner-turn="turn-1"]');
  await reply.hover();
  await reply.getByRole("button", { name: "从此轮创建分支" }).click();
  await expect.poll(() => calls.length).toBe(1);
  await page.evaluate(async () => {
    const module = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
    const { useCodexStore } = await module(
      "/src/session-mode/components/codex/stores/index.ts",
    );
    const { useSessionDraftStore, sessionDraftKey } = await module(
      "/src/session-mode/stores/useSessionDraftStore.ts",
    );
    const { useAgentCenterStore } = await module(
      "/src/session-mode/stores/useAgentCenterStore.ts",
    );
    useAgentCenterStore.getState().addAgentCard(
      {
        kind: "codex",
        id: "ux-1",
        cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
        preview: "Other thread",
      },
      { activate: true },
    );
    useCodexStore.getState().setCurrentThreadId("ux-1");
    useSessionDraftStore
      .getState()
      .setText(sessionDraftKey("codex", "ux-1"), "Other draft");
  });
  finish();
  expect(calls[0]).toMatchObject({
    threadId: "ux-0",
    lastTurnId: "turn-1",
    deferGoalContinuation: true,
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { useCodexStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast(
              (e) =>
                new URL(e.name).pathname ===
                "/src/session-mode/components/codex/stores/index.ts",
            )!.name
        );
        return useCodexStore.getState().currentThreadId;
      }),
    )
    .toBe("ux-1");
});

test("native last-user edit preserves original remote attachment and settings across delayed rollback while detached draft stays intact", async ({
  page,
}) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 2);
  const turns = history(1);
  const image = {
    type: "image",
    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9kAAAAASUVORK5CYII=",
  };
  turns[0].items[0].content.push(image as any);
  fixture.threads[0].turns = turns;
  const calls: any[] = [];
  let finish!: () => void;
  const delayed = new Promise<void>((resolve) => (finish = resolve));
  await page.route(
    "**/api/session/api/codex/thread/rollback",
    async (route) => {
      calls.push({ kind: "rollback", body: route.request().postDataJSON() });
      await delayed;
      fixture.threads[0].turns = [];
      await route.fulfill({ json: { thread: fixture.threads[0] } });
    },
  );
  await page.route("**/api/session/api/codex/turn/start", async (route) => {
    calls.push({ kind: "start", body: route.request().postDataJSON() });
    const turn = {
      id: "replacement",
      status: "completed",
      items: [],
      startedAt: 2,
      durationMs: 10,
      error: null,
    };
    fixture.threads[0].turns = [turn];
    await route.fulfill({ json: { turn } });
  });
  await page.goto("/?mode=session");
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor({ timeout: 60000 });
  await seedSessionUx(page, 2);
  await configure(page, turns, "dark");
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useThreadModelStore.ts",
      { changeThreadModel } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
    changeThreadModel("ux-0", {
      model: "owner-model",
      reasoningEffort: "high",
      serviceTier: "fast",
      sandbox: "read-only",
      approvalPolicy: "on-request",
      webSearchRequest: true,
      collaborationMode: "default",
    });
  });
  const user = page.locator('.codex-native-user[data-owner-turn="turn-0"]');
  await user.hover();
  await user.getByRole("button", { name: "编辑消息" }).click();
  await page
    .getByRole("textbox", { name: "编辑上一条用户消息" })
    .fill("Edited independent message");
  await page.getByRole("button", { name: "发送编辑消息" }).click();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect
    .poll(() => calls.filter((call) => call.kind === "rollback").length)
    .toBe(1);
  await page.evaluate(async () => {
    const module = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
    const [
      { changeThreadModel },
      { useCodexStore },
      { useAgentCenterStore },
      { useWorkspaceStore },
    ] = await Promise.all([
      module("/src/session-mode/stores/useThreadModelStore.ts"),
      module("/src/session-mode/components/codex/stores/index.ts"),
      module("/src/session-mode/stores/useAgentCenterStore.ts"),
      module("/src/session-mode/stores/useWorkspaceStore.ts"),
    ]);
    changeThreadModel("ux-0", {
      model: "changed-owner-model",
      serviceTier: "flex",
      sandbox: "workspace-write",
      webSearchRequest: false,
      collaborationMode: "plan",
    });
    changeThreadModel("ux-1", {
      model: "other-model",
      serviceTier: "flex",
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      collaborationMode: "plan",
    });
    useAgentCenterStore.getState().addAgentCard(
      {
        kind: "codex",
        id: "ux-1",
        cwd: "/fixture/other",
        preview: "Other target",
      },
      { activate: true },
    );
    useCodexStore.getState().setCurrentThreadId("ux-1");
    useWorkspaceStore.setState({ cwd: "/fixture/other" });
  });
  finish();
  await expect
    .poll(() => calls.filter((call) => call.kind === "start").length)
    .toBe(1);
  expect(calls[0]).toEqual({
    kind: "rollback",
    body: { threadId: "ux-0", numTurns: 1, beforeTurnId: "turn-0" },
  });
  const start = calls.find((call) => call.kind === "start").body;
  expect(start.threadId).toBe("ux-0");
  expect(start.input).toEqual([
    { type: "text", text: "Edited independent message", text_elements: [] },
    image,
  ]);
  expect(start).toMatchObject({
    model: "owner-model",
    effort: "high",
    serviceTier: "fast",
    approvalPolicy: "on-request",
    sandboxPolicy: { type: "readOnly", networkAccess: true },
    collaborationMode: {
      mode: "default",
      settings: { model: "owner-model", reasoning_effort: "high" },
    },
  });
  expect(
    await page.evaluate(async () => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
      const [{ useCodexStore }, { readDraft, sessionDraftKey }] =
        await Promise.all([
          module("/src/session-mode/components/codex/stores/index.ts"),
          module("/src/session-mode/stores/useSessionDraftStore.ts"),
        ]);
      return {
        current: useCodexStore.getState().currentThreadId,
        draft: readDraft(sessionDraftKey("codex", "ux-0")).text,
      };
    }),
  ).toEqual({ current: "ux-1", draft: "Detached draft stays intact" });
});

test("unknown native edit send preserves accessible buffer after rollback and never repeats the mutation", async ({
  page,
}) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 1);
  const turns = history(1);
  fixture.threads[0].turns = turns;
  let rollback = 0,
    start = 0;
  await page.route(
    "**/api/session/api/codex/thread/rollback",
    async (route) => {
      rollback++;
      fixture.threads[0].turns = [];
      await route.fulfill({ json: { thread: fixture.threads[0] } });
    },
  );
  await page.route("**/api/session/api/codex/turn/start", async (route) => {
    start++;
    await route.fulfill({
      status: 503,
      json: { error: "Connection lost after possible execution" },
    });
  });
  await page.goto("/?mode=session");
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor({ timeout: 60000 });
  await seedSessionUx(page, 1);
  await configure(page, turns, "dark");
  const user = page.locator('.codex-native-user[data-owner-turn="turn-0"]');
  await user.hover();
  await user.getByRole("button", { name: "编辑消息" }).click();
  await page
    .getByRole("textbox", { name: "编辑上一条用户消息" })
    .fill("Retained unknown edit");
  await page.getByRole("button", { name: "发送编辑消息" }).click();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  const recovery = page.locator(".codex-thread-edit-recovery");
  await expect(recovery).toContainText("编辑结果待确认");
  await recovery.locator("summary").click();
  await expect(recovery).toContainText("Retained unknown edit");
  await expect(recovery).toContainText("确认执行结果前不会重复");
  expect(rollback).toBe(1);
  expect(start).toBe(1);
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toContainText("Detached draft stays intact");
  await menu(page, "搜索会话");
  await page.getByRole("button", { name: "关闭搜索" }).click();
  expect(rollback).toBe(1);
  expect(start).toBe(1);
});

for (const width of [1440, 390])
  test.describe(`${width}px plan window`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"])
      test(`completed plan opens an actual owner-scoped independent window with code, file link and isolated visualize (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        page.on("pageerror", (error) =>
          console.error("plan popup pageerror", error.message),
        );
        page.on("console", (message) => {
          if (message.type() === "error")
            console.error("plan popup console", message.text());
        });
        const fixture = await installSessionUxFixture(page, 1);
        const turns = history(1);
        await page.setViewportSize({ width, height: 844 });
        const imageUrl = new URL(
          "/native-plan-fixture.png",
          info.project.use.baseURL as string,
        ).href;
        let imageRequests = 0;
        await page.context().route("**/native-plan-fixture.png", (route) => {
          imageRequests++;
          return route.fulfill({
            contentType: "image/png",
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAHgAAABICAIAAACyfKYoAAABBklEQVR4nO3QoZGFMAAFwF/QFUEJiBSAREYiEEx0RBQ6miqvhyeidmYr2N/ffsW2vcXK3mPn/sbufcbG/sV+okWLFi1atGjRokWLFi1atOg10ccV244WK0ePnccbu48ZG8cXEy1atGjRokWLFi1atGjRokUviq5XbKstVmqPnfWN3XXGRv1iokWLFi1atGjRokWLFi1atOhF0c8V254WK0+Pnc8bu58ZG88XEy1atGjRokWLFi1atGjRokUvih5XbBstVkaPneON3WPGxvhiokWLFi1atGjRokWLFi1atOhF0fOKbbPFyuyxc76xe87YmF9MtGjRokWLFi1atGjRokWLFr0k+h8jd1cCNT+MqwAAAABJRU5ErkJggg==",
              "base64",
            ),
          });
        });
        const root = "/fixture/项目/very-long-project-path-for-ui-regression",
          vizPath = `${root}/popup.html`;
        const serveVisualization = async (route: Route) => {
          expect(route.request().postDataJSON()).toMatchObject({
            root,
            path: vizPath,
          });
          const content =
            '<div style="height:420px"><button id="popup-fixture">Popup visualize</button></div><script>document.querySelector("button").addEventListener("click",()=>document.querySelector("button").textContent="Clicked safely");</script>';
          await route.fulfill({
            json: {
              path: vizPath,
              version: "fixture",
              content,
              size: content.length,
            },
          });
        };
        await page
          .context()
          .route(
            "**/api/session/workspace-files/visualization",
            serveVisualization,
          );
        await page.route(
          "**/api/session/workspace-files/visualization",
          serveVisualization,
        );
        const text =
          `# Plan\n\n[Owner file](src/owned.ts:42:3)\n\n\`\`\`ts\nconst saved = 42;\n\`\`\`\n\n![image](${imageUrl})` +
          `\n\n|A|B|\n|-|-|\n|1|2|\n\nvisualize${JSON.stringify({ path: vizPath, mode: "wide", title: "Popup fixture" })}`;
        (turns[0].items as any[]).push({ type: "plan", id: "plan", text });
        fixture.threads[0].turns = turns;
        await page.goto("/?mode=session");
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page, 1);
        await configure(page, turns, theme);
        const popupMutations: string[] = [],
          popupErrors: string[] = [];
        page.context().on("page", (child) => {
          child.on("request", (request) => {
            if (
              /\/api\/session\/.*(?:initialize|turn\/(?:start|steer)|thread\/(?:start|resume|fork|rollback|revert|access)|followups\/submit)/.test(
                new URL(request.url()).pathname,
              )
            )
              popupMutations.push(request.url());
          });
          child.on("pageerror", (error) => popupErrors.push(error.message));
        });
        const popupEvent = page.waitForEvent("popup");
        await page
          .locator('button[aria-label="在新窗口打开计划"]:not(:disabled)')
          .click();
        const popup = await popupEvent;
        await popup.setViewportSize({
          width: Math.min(width, 960),
          height: 844,
        });
        await expect(popup.locator(".codex-plan-window")).toContainText("Plan");
        expect(
          await popup.locator("#root > .session-mode").evaluate((root) => {
            const bounds = root.getBoundingClientRect();
            return {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              viewport: innerWidth,
            };
          }),
        ).toEqual({
          x: 0,
          y: 0,
          width: Math.min(width, 960),
          viewport: Math.min(width, 960),
        });
        await expect(popup.locator(".session-codex-composer")).toHaveCount(0);
        expect(new URL(popup.url()).searchParams.get("planWindow")).toMatch(
          /^[\da-f-]{36}$/,
        );
        await expect(popup.locator(".codex-plan-window code")).toContainText(
          "const saved = 42;",
        );
        await expect(
          popup.getByRole("link", { name: "Owner file" }),
        ).toBeVisible();
        await expect(popup.locator("table")).toHaveCount(1);
        await page
          .context()
          .grantPermissions(["clipboard-read", "clipboard-write"]);
        const codeFence = popup.locator(".codex-native-code-fence");
        await codeFence.hover();
        await codeFence
          .getByRole("button", { name: "启用自动换行", exact: true })
          .click();
        await expect(codeFence.locator("pre")).toHaveAttribute(
          "data-wrap",
          "true",
        );
        await codeFence
          .getByRole("button", { name: "复制", exact: true })
          .click();
        await expect
          .poll(async () =>
            (await popup.evaluate(() => navigator.clipboard.readText())).trim(),
          )
          .toBe("const saved = 42;");
        await codeFence
          .getByRole("button", { name: "代码块更多操作", exact: true })
          .click();
        await expect(popup.getByRole("menu")).toBeVisible();
        expect(
          await popup
            .getByRole("menu")
            .evaluate((element) => !!element.closest(".session-mode")),
        ).toBe(true);
        await expect(page.getByRole("menu")).toHaveCount(0);
        const codeDownload = popup.waitForEvent("download");
        await popup
          .getByRole("menuitem", { name: "下载代码", exact: true })
          .click();
        const codeFile = await codeDownload;
        expect(codeFile.suggestedFilename()).toBe("code.ts");
        expect((await readFile((await codeFile.path())!, "utf8")).trim()).toBe(
          "const saved = 42;",
        );
        const table = popup.locator(".codex-native-table");
        await table.hover();
        await table
          .getByRole("button", { name: "表格更多操作", exact: true })
          .click();
        await expect(popup.getByRole("menu")).toBeVisible();
        await expect(page.getByRole("menu")).toHaveCount(0);
        await popup
          .getByRole("menuitem", { name: "复制 · TSV", exact: true })
          .click();
        await expect
          .poll(async () =>
            (await popup.evaluate(() => navigator.clipboard.readText())).trim(),
          )
          .toBe("A\tB\n1\t2");
        await table
          .getByRole("button", { name: "表格更多操作", exact: true })
          .click();
        const tableDownload = popup.waitForEvent("download");
        await popup
          .getByRole("menuitem", { name: "下载 · CSV", exact: true })
          .click();
        const tableFile = await tableDownload;
        expect(tableFile.suggestedFilename()).toBe("table.csv");
        expect((await readFile((await tableFile.path())!, "utf8")).trim()).toBe(
          "A,B\n1,2",
        );
        await expect
          .poll(() =>
            popup
              .getByRole("img", { name: "image", exact: true })
              .evaluate(
                (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
              ),
          )
          .toBe(true);
        expect(imageRequests).toBeGreaterThan(0);
        expect(await popup.evaluate(() => window.opener)).toBeNull();
        const frame = popup.locator(
          'iframe[title="可视化预览：Popup fixture"]',
        );
        await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
        await expect(
          popup
            .frameLocator('iframe[title="可视化预览：Popup fixture"]')
            .getByRole("button", { name: "Popup visualize" }),
        ).toBeVisible();
        await popup
          .frameLocator('iframe[title="可视化预览：Popup fixture"]')
          .getByRole("button", { name: "Popup visualize" })
          .click();
        await expect(
          popup
            .frameLocator('iframe[title="可视化预览：Popup fixture"]')
            .getByRole("button", { name: "Clicked safely" }),
        ).toBeVisible();
        await expect
          .poll(() => frame.evaluate((el) => el.getBoundingClientRect().height))
          .toBeGreaterThan(400);
        await popup.getByRole("button", { name: "展开可视化" }).click();
        await expect(
          popup.getByRole("dialog", { name: "Popup fixture" }),
        ).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await popup.getByRole("button", { name: "Close", exact: true }).click();
        await expect(popup.getByRole("dialog")).toHaveCount(0);
        await popup.getByRole("link", { name: "Owner file" }).click();
        await expect
          .poll(() =>
            page.evaluate(async () => {
              const path = "/src/session-mode/stores/useEditorStore.ts",
                { useEditorStore } = await import(
                  performance
                    .getEntriesByType("resource")
                    .findLast((e) => new URL(e.name).pathname === path)?.name ??
                    path
                );
              return useEditorStore.getState().activeFile;
            }),
          )
          .toBe(
            "/fixture/项目/very-long-project-path-for-ui-regression/src/owned.ts",
          );
        await popup.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        });
        const canvas = await popup.evaluate(() => {
          const root = document.querySelector("#root > .session-mode")!;
          return {
            rootBottom: root.getBoundingClientRect().bottom + scrollY,
            documentHeight: document.documentElement.scrollHeight,
            rootBackground: getComputedStyle(root).backgroundColor,
            bodyBackground: getComputedStyle(document.body).backgroundColor,
            paneBackground: getComputedStyle(
              document.querySelector(".codex-plan-window")!,
            ).backgroundColor,
          };
        });
        expect(canvas.rootBottom).toBeGreaterThanOrEqual(canvas.documentHeight);
        expect(canvas.rootBackground).not.toBe("rgba(0, 0, 0, 0)");
        expect(canvas.bodyBackground).not.toBe("rgba(0, 0, 0, 0)");
        expect(canvas.bodyBackground).toBe(canvas.paneBackground);
        // Capture the popup canvas below its fold without rewriting its content or rendering inputs.
        const popupScreenshot = await popup.context().newCDPSession(popup);
        const rendered = await popupScreenshot.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          fromSurface: true,
          clip: {
            x: 0,
            y: 0,
            width: Math.min(width, 960),
            height: Math.ceil(canvas.rootBottom),
            scale: 1,
          },
        });
        await writeFile(
          info.outputPath(`plan-popup-${width}-${theme}.png`),
          Buffer.from(rendered.data, "base64"),
        );
        await popupScreenshot.detach();
        await popup.close();
        expect(popupMutations).toEqual([]);
        expect(popupErrors).toEqual([]);
        await expect(
          page
            .locator(".session-codex-composer [contenteditable=true]")
            .first(),
        ).toContainText("Detached draft stays intact");
      });
  });

test("copied conversation URL reads native history, opens a followed tab and reaches the exact turn without ownership or execution", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90000);
  const sourceFixture = await installSessionUxFixture(page, 2);
  const turns = history();
  sourceFixture.threads[0].turns = turns;
  await page.goto("/?mode=session");
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor({ timeout: 60000 });
  await seedSessionUx(page, 2);
  await configure(page, turns, "dark");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await menu(page, "复制会话链接");
  await expect(page.getByText("会话链接已复制", { exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const link = new URL(copied);
  expect(link.searchParams.get("mode")).toBe("session");
  expect(link.searchParams.get("thread")).toBe("ux-0");
  expect(link.searchParams.get("cwd")).toBeNull();
  // A native turn boundary remains opaque and is resolved from actual verified history.
  link.searchParams.set("turn", "turn-0");
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 844 },
  });
  try {
    const linked = await context.newPage();
    const fixture = await installSessionUxFixture(linked, 2);
    fixture.threads[0].turns = turns;
    await linked.goto(link.toString());
    await expect(
      linked.locator('.codex-native-user[data-owner-turn="turn-0"]'),
    ).toBeVisible({ timeout: 60000 });
    const state = await linked.evaluate(async () => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
      const [
        { useCodexStore },
        { useAgentCenterStore },
        { useWorkspaceStore },
        { useThreadLinkStore },
      ] = await Promise.all([
        module("/src/session-mode/components/codex/stores/useCodexStore.ts"),
        module("/src/session-mode/stores/useAgentCenterStore.ts"),
        module("/src/session-mode/stores/useWorkspaceStore.ts"),
        module(
          "/src/session-mode/features/thread-workflows/threadLinkStore.ts",
        ),
      ]);
      return {
        thread: useCodexStore.getState().currentThreadId,
        cards: useAgentCenterStore.getState().cards,
        cwd: useWorkspaceStore.getState().cwd,
        target: useThreadLinkStore.getState().target,
      };
    });
    expect(state.thread).toBe("ux-0");
    expect(state.cards).toContainEqual(
      expect.objectContaining({ kind: "codex", id: "ux-0" }),
    );
    expect(state.cwd).toBe(fixture.threads[0].cwd);
    expect(state.target).toBeNull();
    expect(
      fixture.calls.filter((call) =>
        /\/(?:thread\/(?:resume|start|fork|rollback|revert)|turn\/(?:start|steer)|followups\/submit)$/.test(
          call.path,
        ),
      ),
    ).toEqual([]);
    // The existing notice polls a readonly status endpoint; it never acquires or releases authority.
    expect(
      fixture.calls
        .filter((call) => call.path.endsWith("/thread/access"))
        .every((call) => call.body.release === false),
    ).toBe(true);
    expect(
      fixture.calls.some(
        (call) =>
          call.path.endsWith("/thread/read") && call.body.threadId === "ux-0",
      ),
    ).toBe(true);
    await linked.screenshot({
      path: info.outputPath("copied-link-followed-tab-exact-turn.png"),
      fullPage: true,
    });
    await expect(
      page.locator(".session-codex-composer [contenteditable=true]").first(),
    ).toContainText("Detached draft stays intact");
  } finally {
    await context.close();
  }
});

test("a late URL history result cannot add interest or steal a newly chosen owner", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 2);
  fixture.threads[0].turns = history(2);
  let pending: Route | null = null;
  await page.route("**/api/codex/thread/read", (route) => {
    if (route.request().postDataJSON()?.threadId === "ux-0") {
      pending = route;
      return;
    }
    return route.fallback();
  });
  await page.goto("/?mode=session&thread=ux-0&turn=turn-0");
  await expect.poll(() => !!pending, { timeout: 60000 }).toBe(true);
  await page.evaluate(async () => {
    const module = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
    const [
      { useCodexStore },
      { useAgentCenterStore },
      { useWorkspaceStore },
      { useAgentSettingsStore },
      { useSessionDraftStore, sessionDraftKey },
    ] = await Promise.all([
      module("/src/session-mode/components/codex/stores/useCodexStore.ts"),
      module("/src/session-mode/stores/useAgentCenterStore.ts"),
      module("/src/session-mode/stores/useWorkspaceStore.ts"),
      module("/src/session-mode/stores/useAgentSettingsStore.ts"),
      module("/src/session-mode/stores/useSessionDraftStore.ts"),
    ]);
    useCodexStore.setState({ currentThreadId: "ux-1" });
    useAgentSettingsStore.setState({ selectedAgent: "codex" });
    useAgentCenterStore.getState().addAgentCard(
      {
        kind: "codex",
        id: "ux-1",
        cwd: "/fixture/new-owner",
        preview: "Deliberately chosen owner",
      },
      { activate: true },
    );
    useWorkspaceStore.setState({ cwd: "/fixture/new-owner" });
    useSessionDraftStore
      .getState()
      .setText(sessionDraftKey("codex", "ux-1"), "New owner unsent draft");
  });
  await pending!.fulfill({ json: { thread: fixture.threads[0] } });
  await expect(
    page.getByText(
      "输入目标在读取链接期间已改变；历史已缓存，未自动加入关注或切换会话。",
      { exact: true },
    ),
  ).toBeVisible();
  const state = await page.evaluate(async () => {
    const module = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
    const [{ useCodexStore }, { useAgentCenterStore }, { useWorkspaceStore }] =
      await Promise.all([
        module("/src/session-mode/components/codex/stores/useCodexStore.ts"),
        module("/src/session-mode/stores/useAgentCenterStore.ts"),
        module("/src/session-mode/stores/useWorkspaceStore.ts"),
      ]);
    return {
      thread: useCodexStore.getState().currentThreadId,
      cards: useAgentCenterStore.getState().cards,
      cwd: useWorkspaceStore.getState().cwd,
      cached: !!useCodexStore.getState().events["ux-0"]?.length,
    };
  });
  expect(state).toMatchObject({
    thread: "ux-1",
    cwd: "/fixture/new-owner",
    cached: true,
  });
  expect(state.cards).not.toContainEqual(
    expect.objectContaining({ kind: "codex", id: "ux-0" }),
  );
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toContainText("New owner unsent draft");
  await page.screenshot({
    path: info.outputPath("copied-link-late-owner-cas.png"),
    fullPage: true,
  });
});

test("the real file editor adds captured Codex selection context and rejects another project's pinned file", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 2);
  fixture.threads[0].turns = history(2);
  fixture.threads[1].cwd = "/other-owner";
  const root = fixture.threads[0].cwd,
    filePath = `${root}/src/selection.ts`;
  await page.route("**/api/filesystem/canonicalize-path", (route) =>
    route.fulfill({ json: route.request().postDataJSON().path }),
  );
  await page.route("**/api/filesystem/read-directory", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/workspace-files/read", (route) =>
    route.fulfill({
      json: {
        path: filePath,
        content: "const captured = 42;\nconst original = captured;\n",
        version: "fixture-version",
        size: 52,
      },
    }),
  );
  await page.goto("/?mode=session");
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor({ timeout: 60000 });
  await seedSessionUx(page, 2);
  await configure(page, fixture.threads[0].turns, "dark");
  await page.evaluate(
    async ({ root, filePath }) => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
      const [{ useEditorStore }, { useLayoutStore }, { useWorkspaceStore }] =
        await Promise.all([
          module("/src/session-mode/stores/useEditorStore.ts"),
          module("/src/session-mode/stores/useLayoutStore.ts"),
          module("/src/session-mode/stores/useWorkspaceStore.ts"),
        ]);
      useWorkspaceStore.setState({ cwd: root });
      useEditorStore.getState().revealFile(filePath, root);
      useLayoutStore.getState().setActiveRightPanelTab("files");
      useLayoutStore.setState({ isRightPanelOpen: true });
    },
    { root, filePath },
  );
  const ace = page.locator(".session-mode .ace_editor").first();
  await expect(ace).toBeVisible();
  await ace.evaluate((element: any) => {
    element.env.editor.focus();
    element.env.editor.clearSelection();
    element.env.editor.selectAll();
  });
  await page.getByRole("button", { name: "将代码选区加入当前会话" }).click();
  const originalContext = await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useSessionDraftStore.ts";
    const { readDraft, sessionDraftKey } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    const contextPath =
      "/src/session-mode/components/codex/composer/v2/drafts.ts";
    const { composerDrafts } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === contextPath)?.name ??
        contextPath
    );
    return {
      ...readDraft(sessionDraftKey("codex", "ux-0")),
      ...composerDrafts.read(sessionDraftKey("codex", "ux-0")),
    };
  });
  expect(originalContext.text).toBe("Detached draft stays intact");
  expect(originalContext.contexts).toContainEqual(
    expect.objectContaining({
      path: filePath,
      text: "const captured = 42;\nconst original = captured;\n",
      range: { start: 1, end: 2 },
    }),
  );
  await page.evaluate(async () => {
    const module = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
    const [
      { useCodexStore },
      { useWorkspaceStore },
      { useSessionDraftStore, sessionDraftKey },
      { useAgentCenterStore },
    ] = await Promise.all([
      module("/src/session-mode/components/codex/stores/useCodexStore.ts"),
      module("/src/session-mode/stores/useWorkspaceStore.ts"),
      module("/src/session-mode/stores/useSessionDraftStore.ts"),
      module("/src/session-mode/stores/useAgentCenterStore.ts"),
    ]);
    useCodexStore.setState((state) => ({
      currentThreadId: "ux-1",
      threads: state.threads.map((thread: any) =>
        thread.id === "ux-1" ? { ...thread, cwd: "/other-owner" } : thread,
      ),
    }));
    useWorkspaceStore.setState({ cwd: "/other-owner" });
    useAgentCenterStore.getState().addAgentCard(
      {
        kind: "codex",
        id: "ux-1",
        cwd: "/other-owner",
        preview: "Deliberately chosen owner",
      },
      { activate: true },
    );
    useSessionDraftStore
      .getState()
      .setText(sessionDraftKey("codex", "ux-1"), "Other owner stays intact");
  });
  await ace.evaluate((element: any) => {
    element.env.editor.focus();
    element.env.editor.clearSelection();
    element.env.editor.selectAll();
  });
  await page.getByRole("button", { name: "将代码选区加入当前会话" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "未添加到输入区" }),
  ).toBeVisible();
  const after = await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useSessionDraftStore.ts";
    const { readDraft, sessionDraftKey } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    const contextPath =
      "/src/session-mode/components/codex/composer/v2/drafts.ts";
    const { composerDrafts } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === contextPath)?.name ??
        contextPath
    );
    return {
      original: {
        ...readDraft(sessionDraftKey("codex", "ux-0")),
        ...composerDrafts.read(sessionDraftKey("codex", "ux-0")),
      },
      current: {
        ...readDraft(sessionDraftKey("codex", "ux-1")),
        ...composerDrafts.read(sessionDraftKey("codex", "ux-1")),
      },
    };
  });
  expect(after.original.contexts).toEqual(originalContext.contexts);
  expect(after.current.text).toBe("Other owner stays intact");
  expect(after.current.contexts).toEqual([]);
  await page.screenshot({
    path: info.outputPath("file-editor-captured-context-owner-rejection.png"),
    fullPage: true,
  });
  expect(
    fixture.calls.filter((call) =>
      /\/(?:turn\/start|thread\/resume|followups\/submit)$/.test(call.path),
    ),
  ).toEqual([]);
});

test("native remote search resolves only the actual item and inclusive history cursor before virtual navigation", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 2),
    turns = history();
  fixture.threads[0].turns = turns;
  await page.goto("/?mode=session");
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor({ timeout: 60000 });
  await seedSessionUx(page, 2);
  await configure(page, turns.slice(-5), "dark");
  const searchCalls: any[] = [],
    historyCalls: any[] = [];
  await page.route("**/api/codex/thread/search-occurrences", async (route) => {
    searchCalls.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        data: [
          {
            turnId: "turn-0",
            itemId: "user-0",
            snippet: "stable target café 中文",
            snippetMatchRange: { start: 0, end: 13 },
            turnCursor: "actual-inclusive-native-cursor",
          },
        ],
        nextCursor: null,
      },
    });
  });
  await page.route("**/api/codex/thread/turns/list", async (route) => {
    const body = route.request().postDataJSON();
    if (body.cursor !== "actual-inclusive-native-cursor")
      return route.fallback();
    historyCalls.push(body);
    await route.fulfill({ json: { data: [turns[0]], nextCursor: null } });
  });
  await expect(
    page.locator('.codex-native-user[data-owner-turn="turn-0"]'),
  ).toHaveCount(0);
  await menu(page, "搜索会话");
  await page
    .getByRole("textbox", { name: "搜索会话正文" })
    .fill("stable target");
  await expect(page.locator(".codex-thread-search-results mark")).toHaveText(
    "stable target",
  );
  await page.locator(".codex-thread-search-results button").first().click();
  await expect(
    page.locator('.codex-native-user[data-owner-turn="turn-0"]'),
  ).toBeVisible();
  expect(searchCalls).toEqual([
    { threadId: "ux-0", searchTerm: "stable target", limit: 250 },
  ]);
  expect(historyCalls).toEqual([
    {
      threadId: "ux-0",
      cursor: "actual-inclusive-native-cursor",
      limit: 10,
      sortDirection: "desc",
      itemsView: "full",
    },
  ]);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(
          (CSS as any).highlights.get("codex-thread-search-active") ?? [],
        ).map((range: Range) => range.toString()),
      ),
    )
    .toEqual(["stable target"]);
  const targetBox = await page
    .locator('.codex-native-user[data-owner-turn="turn-0"]')
    .boundingBox();
  const searchBox = await page.locator(".codex-thread-search").boundingBox();
  expect(targetBox!.y).toBeGreaterThanOrEqual(searchBox!.y + searchBox!.height);
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toContainText("Detached draft stays intact");
  await page.screenshot({
    path: info.outputPath(
      "native-search-readonly-real-cursor-virtual-highlight.png",
    ),
    fullPage: true,
  });
  expect(
    fixture.calls.filter((call) =>
      /\/(?:turn\/start|thread\/resume|followups\/submit)$/.test(call.path),
    ),
  ).toEqual([]);
});

test("a newer native user turn keeps the earlier independent edit buffer reachable without sending or changing the detached draft", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 1),
    turns = history(2);
  fixture.threads[0].turns = turns;
  await page.goto("/?mode=session");
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor({ timeout: 60000 });
  await seedSessionUx(page, 1);
  await configure(page, turns, "dark");
  const last = page.locator('.codex-native-user[data-owner-turn="turn-1"]');
  await last.hover();
  await last.getByRole("button", { name: /编辑消息|Edit message/ }).click();
  await page
    .getByRole("textbox", { name: "编辑上一条用户消息" })
    .fill("Earlier edit remains independently reachable");
  const later = history(3)[2];
  await page.evaluate(async (later) => {
    const path = "/src/session-mode/components/codex/stores/useCodexStore.ts";
    const { useCodexStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    const incoming = [
      ...later.items.map((item: any) => ({
        method: item.type === "userMessage" ? "item/started" : "item/completed",
        params: { threadId: "ux-0", turnId: later.id, item },
      })),
      { method: "turn/completed", params: { threadId: "ux-0", turn: later } },
    ];
    useCodexStore.setState((state) => ({
      events: {
        ...state.events,
        "ux-0": [...state.events["ux-0"], ...incoming],
      },
    }));
  }, later);
  await expect(
    page.getByRole("textbox", { name: "编辑上一条用户消息" }),
  ).toHaveCount(0);
  await page.getByText("未完成的消息编辑已保留", { exact: true }).click();
  await expect(page.locator(".codex-thread-edit-recovery pre")).toHaveText(
    "Earlier edit remains independently reachable",
  );
  await expect(
    page.getByRole("button", { name: "复制保留的编辑内容" }),
  ).toBeVisible();
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toContainText("Detached draft stays intact");
  expect(
    fixture.calls.filter((call) =>
      /\/(?:turn\/start|thread\/resume|thread\/rollback|followups\/submit)$/.test(
        call.path,
      ),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("native-edit-new-turn-preserved-buffer.png"),
    fullPage: true,
  });
});
