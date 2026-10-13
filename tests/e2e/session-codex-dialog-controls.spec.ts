import { test, expect } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

const out = process.env.CODEX_UI_SHOTS ?? "test-results/codex-dialog-controls";

test("question, approval, queue, and side chat stay on the shipped Codex dialog", async ({
  page,
}, info) => {
  test.setTimeout(480000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  const fixture = await installSessionUxFixture(page, 1);
  const now = Math.floor(Date.now() / 1000);
  fixture.threads[0].turns = [
    {
      id: "turn-q",
      status: "completed",
      startedAt: now - 4,
      completedAt: now,
      durationMs: 4000,
      items: [
        {
          id: "user-q",
          type: "userMessage",
          content: [{ type: "text", text: "需要确认范围" }],
        },
        {
          id: "q-source",
          type: "agentMessage",
          phase: "final_answer",
          text: "请选择检查范围。",
          questions: [{ title: "检查范围？", options: ["当前文件", "整个项目"] }],
        },
        {
          id: "plan-1",
          type: "plan",
          text: "# 计划\n\n先看范围，再改代码。",
        },

      ],
    },
  ];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const composer = page
    .locator(".session-codex-composer [contenteditable=true]")
    .first();
  await composer.waitFor({ timeout: 15000 });
  await composer.click();
  await composer.pressSequentially("hello");
  await composer.press("ControlOrMeta+a");
  const format = page.getByRole("toolbar", { name: "文本格式" });
  await expect(format).toBeVisible();
  await page.screenshot({
    path: `${out}/control-format-toolbar.png`,
    animations: "disabled",
  });
  await format.getByRole("button", { name: "粗体", exact: true }).click();
  await expect(composer).toContainText("**hello**");
  await composer.press("ControlOrMeta+a");
  await composer.press("Backspace");
  const turns = fixture.threads[0].turns;
  await page.evaluate(async (turns) => {
    const load = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path
      );
    const { useCodexStore } = await load(
      "/src/session-mode/components/codex/stores/useCodexStore.ts",
    );
    const { useAgentCenterStore } = await load(
      "/src/session-mode/stores/useAgentCenterStore.ts",
    );
    const { useLayoutStore } = await load(
      "/src/session-mode/stores/useLayoutStore.ts",
    );
    const events = (turns as any[]).flatMap((turn) => [
      ...turn.items.map((item: any) => ({
        method: item.type === "userMessage" ? "item/started" : "item/completed",
        params: { threadId: "ux-0", turnId: turn.id, item },
      })),
      { method: "turn/completed", params: { threadId: "ux-0", turn } },
    ]);
    useLayoutStore.setState({
      view: "agent",
      isSidebarOpen: false,
      isRightPanelOpen: false,
    });
    useAgentCenterStore.getState().addAgentCard(
      { kind: "codex", id: "ux-0", cwd: "/fixture", preview: "control" },
      { activate: true },
    );
    const { useWorkspaceStore } = await load(
      "/src/session-mode/stores/useWorkspaceStore.ts",
    );
    useWorkspaceStore.getState().setCwd("/fixture");
    const { useElicitationStore } = await load(
      "/src/session-mode/components/codex/stores/useElicitationStore.ts",
    );
    useElicitationStore.setState({
      pendingRequests: [
        {
          mode: "form",
          threadId: "ux-0",
          turnId: "turn-form",
          requestId: 7,
          serverName: "fixture-mcp",
          message: "填写连接信息",
          requestedSchema: {
            type: "object",
            properties: {
              host: { type: "string", title: "主机" },
              port: { type: "string", title: "端口" },
            },
          },
          _meta: null,
        },
      ],
      drafts: {},
    });
    const { useSubagentStore } = await load(
      "/src/session-mode/features/subagents/store.ts",
    );
    useSubagentStore.setState({
      nodes: {
        "bg-child": {
          thread: {
            id: "bg-child",
            name: "检查测试",
            preview: "检查测试",
            parentThreadId: "ux-0",
            status: { type: "idle" },
            model: "fixture-model",
            turns: [
              {
                id: "bg-turn",
                status: "inProgress",
                startedAt: 1,
                items: [],
              },
            ],
            canAcceptDirectInput: false,
          },
          parentId: "ux-0",
          verified: true,
          createdInTurn: "turn-q",
          revision: 1,
        },
      },
    });
    useCodexStore.setState({
      currentThreadId: "ux-0",
      events: { "ux-0": events },
      historyLoadedMap: { "ux-0": true },
      threadStatusMap: { "ux-0": { type: "idle" } },
      turnTimingMap: { "ux-0": { turnId: "turn-q", status: "completed" } },
    });
  }, turns);
  await page.evaluate(async () => {
    const load = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path
      );
    const { useAttachmentDraftStore } = await load(
      "/src/session-mode/components/common/useImageAttachments.ts",
    );
    const owner = document
      .querySelector(".session-codex-composer")
      ?.getAttribute("data-draft-owner");
    if (!owner) throw new Error("composer attachment owner missing");
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (char) => char.charCodeAt(0),
    );
    useAttachmentDraftStore.setState({
      drafts: {
        [owner]: [
          {
            id: "failed-image",
            name: "drop.png",
            preview: URL.createObjectURL(new Blob([bytes], { type: "image/png" })),
            file: new File([bytes], "drop.png", { type: "image/png" }),
            status: "error",
            error: "上传失败",
          },
        ],
      },
      hydrated: { [owner]: true },
      errors: {},
    });
  });
  const failedImage = page.getByRole("button", { name: "预览 drop.png，上传失败" });
  await expect(failedImage).toBeVisible();
  await failedImage.click();
  const retryUpload = page.getByRole("button", { name: "再次尝试上传" });
  await expect(retryUpload).toHaveAttribute("title", "再次尝试上传");
  await page.screenshot({
    path: `${out}/control-attachment-retry.png`,
    animations: "disabled",
  });
  await retryUpload.click();
  await expect(page.getByRole("button", { name: "预览 drop.png，上传失败" })).toHaveCount(0);
  await expect(page.locator(".session-context-chip.is-image")).toHaveAttribute("data-state", "ready");
  await page.getByRole("button", { name: "关闭面板", exact: true }).click();

  const shot = async (name: string) => {
    if (pageErrors.length) throw new Error(pageErrors.join("\n"));
    await page.waitForTimeout(400);
    await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  };

  await expect(page.getByText("检查范围？")).toBeVisible();
  await expect(
    page.locator(".session-async-message").getByRole("button", { name: "回答问题", exact: true }),
  ).toBeVisible();
  const notice = page.getByRole("button", { name: "回答问题 · 1" });
  await expect(notice).toBeVisible();
  await page.waitForTimeout(300);
  await notice.click();
  await expect(page.getByRole("region", { name: "回答 Codex 问题" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "当前文件" })).toBeVisible();
  await shot("control-question");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "回答 Codex 问题" })).toHaveCount(0);

  await page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/stores/useApprovalStore.ts";
    const module = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
    );
    const approval = {
      type: "commandExecution",
      requestId: 18,
      threadId: "ux-0",
      turnId: "turn-q",
      itemId: "command",
      startedAtMs: 1,
      command: "pnpm test",
      cwd: "/fixture",
      reason: "运行当前项目检查？",
      proposedExecpolicyAmendment: null,
      availableDecisions: ["accept", "acceptForSession", "decline"],
    };
    module.useApprovalStore.setState({
      pendingApprovals: [approval],
      currentApproval: approval,
    });
  });
  await page.evaluate(async () => {
    const load = (path: string) =>
      import(
        path.startsWith("/node_modules/.vite/deps/")
          ? (window as any).__sessionFixtureDependency(path.split("/").at(-1))
          : (performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path)
      );
    const react = await load("/node_modules/.vite/deps/react.js");
    const dom = await load("/node_modules/.vite/deps/react-dom_client.js");
    const { McpToolCallItem } = await load(
      "/src/session-mode/components/codex/items/McpToolCallItem.tsx",
    );
    const React = react.default ?? react;
    const { createRoot } = dom.default ?? dom;
    const host = document.createElement("div");
    host.id = "mcp-argument-fixture";
    host.className = "session-mode dark";
    host.style.cssText = "position:fixed;z-index:80;left:24px;top:96px;width:520px;background:var(--codex-surface,#20211d)";
    document.querySelector(".session-mode")?.append(host);
    createRoot(host).render(
      React.createElement(McpToolCallItem, {
        item: {
          type: "mcpToolCall",
          id: "mcp-1",
          server: "fixture-mcp",
          tool: "inspect",
          status: "completed",
          arguments: {
            path: "src/app.ts",
            note: "检查当前文件",
            a: "1",
            b: "2",
            extra: "其余参数",
          },
          result: {
            content: [
              {
                type: "resource_link",
                uri: "https://example.invalid/resource",
                name: "资源文档",
              },
            ],
            structuredContent: null,
          },
          error: null,
          durationMs: null,
        },
      }),
    );
  });
  const mcp = page.locator("#mcp-argument-fixture .codex-native-mcp");
  await mcp.getByRole("button", { name: "Inspect" }).click();
  const args = mcp.getByRole("button", { name: "展开 参数" });
  await expect(args).toHaveAttribute("title", "展开");
  await args.click();
  await expect(mcp).toContainText("检查当前文件");
  await expect(mcp.getByText(/其余参数/)).toHaveCount(0);
  await mcp.getByRole("button", { name: "再显示 1 项" }).click();
  await expect(mcp).toContainText("其余参数");
  await page.screenshot({
    path: `${out}/control-mcp-arguments.png`,
    animations: "disabled",
  });
  const resource = mcp.getByRole("link", { name: "资源文档" });
  await expect(resource).toHaveAttribute("href", "https://example.invalid/resource");
  await mcp.getByRole("button", { name: "打开方式" }).click();
  const openMenu = page.locator("#mcp-argument-fixture").getByRole("menu", {
    name: "选择打开位置",
  });
  await expect(openMenu.getByRole("menuitem", { name: "在默认浏览器中打开" })).toHaveAttribute(
    "href",
    "https://example.invalid/resource",
  );
  await expect(openMenu.getByRole("menuitem", { name: "复制链接" })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-resource-open.png`,
    animations: "disabled",
  });
  await page.locator("#mcp-argument-fixture").getByRole("button", { name: "打开方式" }).click();
  await expect(openMenu).toHaveCount(0);
  await page.locator("#mcp-argument-fixture").evaluate((node) => node.remove());

  const plan = page.locator(".codex-plan");
  const planToggle = plan.getByRole("button", { name: "展开计划概要" });
  await expect(planToggle).toHaveAttribute("title", "展开");
  await expect(plan.getByRole("button", { name: "在新窗口打开计划" })).toHaveAttribute(
    "title",
    "在新窗口中打开",
  );
  await page.screenshot({
    path: `${out}/control-plan-summary.png`,
    animations: "disabled",
  });
  await plan.getByRole("button", { name: "在侧边面板中打开计划" }).click();
  const planSide = page.getByRole("complementary", { name: "计划" });
  await expect(planSide).toContainText("先看范围，再改代码。");
  await page.screenshot({
    path: `${out}/control-plan-side.png`,
    animations: "disabled",
  });
  await planSide.getByRole("button", { name: "关闭计划侧边面板" }).click();
  await expect(planSide).toHaveCount(0);
  await planToggle.click();
  await expect(plan.getByRole("button", { name: "折叠计划概要" })).toHaveAttribute(
    "title",
    "折叠",
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async (text: string) => {
        (window as unknown as { __planCopied?: string }).__planCopied = text;
      },
    });
  });
  await plan.getByRole("button", { name: "复制计划", exact: true }).click();
  await expect(plan.getByRole("button", { name: "已复制", exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __planCopied?: string }).__planCopied))
    .toContain("先看范围，再改代码。");
  await page.evaluate(() => {
    const hidden: HTMLElement[] = [];
    for (const node of document.querySelectorAll(
      "[data-codex-approval-surface], .codex-elicitation",
    )) {
      if (node instanceof HTMLElement) {
        node.dataset.planShotHidden = node.style.display;
        node.style.display = "none";
        hidden.push(node);
      }
    }
    document.querySelector(".codex-plan")?.scrollIntoView({ block: "center" });
    (window as unknown as { __planShotHidden?: HTMLElement[] }).__planShotHidden =
      hidden;
  });
  await page.screenshot({
    path: `${out}/control-plan-copy.png`,
    animations: "disabled",
  });
  await page.evaluate(() => {
    for (const node of document.querySelectorAll<HTMLElement>("[data-plan-shot-hidden]")) {
      node.style.display = node.dataset.planShotHidden ?? "";
      delete node.dataset.planShotHidden;
    }
  });
  await expect(plan).toContainText("先看范围，再改代码。");

  const card = page.locator("[data-codex-approval-surface]");
  await expect(card.getByRole("button", { name: "允许一次" })).toBeVisible();
  await card.getByRole("button", { name: "审批选项", exact: true }).click();
  const menu = page.locator(".codex-approval-menu");
  await expect(menu.getByRole("menuitem", { name: "允许一次" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /允许此对话/ })).toBeVisible();
  await shot("control-approval-once");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  const form = page.locator(".codex-elicitation");
  await expect(form.getByRole("button", { name: "暂时跳过" })).toBeVisible();
  await expect(form.getByRole("button", { name: "继续" })).toBeVisible();
  await expect(form.getByRole("button", { name: "取消", exact: true })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-mcp-form.png`,
    animations: "disabled",
  });
  await form.getByRole("button", { name: "暂时跳过" }).click();
  await expect(form.getByRole("textbox", { name: "端口" })).toBeVisible();
  await expect(form.getByRole("button", { name: "跳过", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/stores/useElicitationStore.ts";
    const module = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
    );
    module.useElicitationStore.setState({
      pendingRequests: [
        {
          mode: "form",
          threadId: "ux-0",
          turnId: "turn-mcp",
          requestId: 19,
          serverName: "workspace",
          message: 'Allow workspace to run tool "inspect"?',
          requestedSchema: { type: "object", properties: {} },
          _meta: {
            codex_approval_kind: "mcp_tool_call",
            connector_name: "GitHub",
            tool_name: "inspect",
            risk_level: "high",
          },
        },
      ],
      drafts: {},
    });
  });
  const toolApproval = page.locator(".codex-elicitation");
  await expect(toolApproval.getByText("较高风险")).toBeVisible();
  await expect(toolApproval.locator(".codex-elicitation__title")).toContainText(
    "是否允许 GitHub 运行 inspect 工具？",
  );
  await expect(toolApproval.getByRole("button", { name: "允许一次" })).toBeVisible();
  await expect(toolApproval.getByRole("button", { name: "取消", exact: true })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-mcp-tool-approval.png`,
    animations: "disabled",
  });
  await page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/stores/useElicitationStore.ts";
    const module = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
    );
    module.useElicitationStore.setState({ pendingRequests: [], drafts: {} });
  });
  await expect(toolApproval).toHaveCount(0);
  const agents = page.getByRole("region", { name: "子智能体" });
  await expect(agents.getByRole("button", { name: /子智能体 · 1/ })).toBeVisible();
  await agents.getByRole("button", { name: /打开子智能体/ }).click();
  await page.screenshot({
    path: `${out}/control-subagents.png`,
    animations: "disabled",
  });
  await expect(agents).toContainText("检查测试");
  await expect(agents).toContainText("处理中");
  await expect(agents).toContainText("（使用 @ 标记智能体）");
  await expect(agents.getByText("fixture-model")).toHaveAttribute("title", "使用 fixture-model");
  await expect(agents.getByRole("button", { name: "全部停止" })).toHaveAttribute(
    "title",
    "停止此聊天中的所有子智能体",
  );
  await page.screenshot({
    path: `${out}/control-background-agents.png`,
    animations: "disabled",
  });
  await agents.getByRole("button", { name: "全部停止" }).click();
  const stopAll = page.getByRole("dialog", { name: "停止本轮子智能体" });
  await expect(stopAll).toContainText("检查测试");
  await stopAll.getByRole("button", { name: "确认停止" }).click();
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path.endsWith("/subagents/stop") &&
          call.body?.rootId === "ux-0" &&
          call.body?.targets?.[0]?.threadId === "bg-child" &&
          call.body?.targets?.[0]?.turnId === "bg-turn",
      ),
    )
    .toBe(true);
  await agents.getByRole("button", { name: /返回子智能体/ }).click();
  await page.evaluate(async () => {
    const load = (path: string) =>
      import(
        path.startsWith("/node_modules/.vite/deps/")
          ? (window as any).__sessionFixtureDependency(path.split("/").at(-1))
          : (performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path)
      );
    const react = await load("/node_modules/.vite/deps/react.js");
    const dom = await load("/node_modules/.vite/deps/react-dom_client.js");
    const { DiffViewer } = await load("/src/session-mode/features/DiffViewer.tsx");
    const React = react.default ?? react;
    const { createRoot } = dom.default ?? dom;
    const host = document.createElement("div");
    host.id = "rename-diff-fixture";
    host.className = "session-mode";
    host.style.cssText = "position:fixed;z-index:40;left:24px;bottom:24px;width:520px";
    document.querySelector(".session-mode")?.append(host);
    createRoot(host).render(
      React.createElement(DiffViewer, {
        native: true,
        presentation: "review",
        displayPath: "next.ts",
        unifiedDiff:
          "diff --git a/old.ts b/next.ts\nsimilarity index 100%\nrename from old.ts\nrename to next.ts\n",
        isCollapsed: false,
      }),
    );
  });
  const renamed = page.locator("#rename-diff-fixture");
  await expect(renamed).toContainText("文件已重命名，内容未变更");
  await page.screenshot({
    path: `${out}/control-rename-diff.png`,
    animations: "disabled",
  });
  await renamed.evaluate((node) => node.remove());

  let queueItem: any = {
    id: "q1",
    threadId: "ux-0",
    text: "排队里的下一条",
    images: [],
    parameters: {},
    mode: "queue",
    status: "failed",
    error: "发送失败",
    createdAt: 1,
    fingerprint: "q1",
  };
  await page.route("**/api/**/followups**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET" && !request.url().endsWith("/change"))
      return route.fallback();
    if (request.url().endsWith("/change")) {
      const action = request.postDataJSON()?.action;
      if (action?.type === "retry" && action.id === queueItem.id)
        queueItem = { ...queueItem, status: "queued", error: undefined };
    }
    return route.fulfill({
      json: {
        revision: 1,
        paused: "由于你中断了当前响应，队列已暂停",
        items: [queueItem],
      },
    });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("排队里的下一条")).toBeVisible();
  await expect(page.getByText("由于你中断了当前响应，队列已暂停")).toBeVisible();
  await expect(page.getByRole("button", { name: "删除排队的消息" })).toBeVisible();
  await expect(page.getByText("发送失败")).toBeVisible();
  await page.getByRole("button", { name: /排队消息操作/ }).click();
  const retry = page.getByRole("menuitem", {
    name: "尝试重新发送这条排队中的消息。如果重试一直失败，可编辑或删除它",
  });
  await expect(retry).toHaveAttribute(
    "title",
    "尝试重新发送这条排队中的消息。如果重试一直失败，可编辑或删除它",
  );
  await shot("control-queue-retry");
  await retry.click();
  await expect(page.getByText("发送失败")).toHaveCount(0);
  await shot("control-queue");

  await page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/stores/useCodexStore.ts";
    const module = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
    );
    module.useCodexStore.setState((state: { events: Record<string, unknown[]> }) => ({
      events: {
        ...state.events,
        "ux-0": [
          ...(state.events["ux-0"] ?? []),
          {
            method: "item/completed",
            params: {
              threadId: "ux-0",
              item: {
                type: "agentMessage",
                text: "结果如下\n```ts\nconst answer = 1;\n```",
              },
            },
          },
        ],
      },
    }));
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async (text: string) => {
        (window as unknown as { __copied?: string }).__copied = text;
      },
    });
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const copyCode = page.getByRole("menuitem", { name: "复制最后一个代码块" });
  await expect(copyCode).toBeVisible();
  await page.screenshot({
    path: `${out}/control-copy-last-code.png`,
    animations: "disabled",
  });
  await copyCode.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied))
    .toBe("const answer = 1;");
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const copyMarkdown = page.getByRole("menuitem", { name: "复制为 Markdown" });
  const copyDeep = page.getByRole("menuitem", { name: "复制深层链接" });
  await expect(copyMarkdown).toBeVisible();
  await expect(copyDeep).toBeVisible();
  await page.screenshot({
    path: `${out}/control-copy-markdown.png`,
    animations: "disabled",
  });
  await copyMarkdown.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied))
    .toContain("需要确认范围");
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "复制深层链接" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied))
    .toContain("thread=ux-0");
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useSessionAttentionStore.ts";
    const module = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
    );
    const attention = module.useSessionAttentionStore.getState();
    attention.complete("codex", "ux-0", "reply-menu");
    attention.read("codex", "ux-0", "reply-menu");
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const markUnread = page.getByRole("menuitem", { name: "标记为未读" });
  await expect(markUnread).toBeVisible();
  await page.screenshot({
    path: `${out}/control-mark-unread.png`,
    animations: "disabled",
  });
  await markUnread.click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/session-mode/stores/useSessionAttentionStore.ts";
        const module = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
        );
        return module.latestUnread(
          module.useSessionAttentionStore.getState().receipts["codex:ux-0"],
        );
      }),
    )
    .toBe("reply-menu");
  const prompt = page.locator(".session-codex-composer [contenteditable=true]").first();
  await prompt.click();
  await prompt.pressSequentially("待清除的提示");
  await expect(prompt).toContainText("待清除的提示");
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const clearPrompt = page.getByRole("menuitem", { name: "清除提示" });
  await expect(clearPrompt).toBeVisible();
  await page.screenshot({
    path: `${out}/control-clear-prompt.png`,
    animations: "disabled",
  });
  await clearPrompt.click();
  await expect(prompt).not.toContainText("待清除的提示");
  await page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/stores/useCodexStore.ts";
    const module = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
    );
    module.useCodexStore.setState((state: { threads: Array<{ id: string }> }) => ({
      threads: state.threads.map((thread) =>
        thread.id === "ux-0"
          ? { ...thread, path: "/fixture/sessions/ux-0.jsonl" }
          : thread,
      ),
    }));
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const copyPath = page.getByRole("menuitem", { name: "复制对话路径" });
  await expect(copyPath).toBeVisible();
  await page.screenshot({
    path: `${out}/control-copy-thread-path.png`,
    animations: "disabled",
  });
  await copyPath.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied))
    .toBe("/fixture/sessions/ux-0.jsonl");
  await page.route("**/api/**/filesystem/search-files", (route) =>
    route.fulfill({
      json: [
        {
          name: "note.ts",
          path: "/fixture/项目/very-long-project-path-for-ui-regression/note.ts",
          is_dir: false,
          size: 12,
          extension: "ts",
        },
      ],
    }),
  );
  await page.locator("[data-sonner-toast]").evaluateAll((nodes) => {
    nodes.forEach((node) => node.style.setProperty("pointer-events", "none"));
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "搜索文件", exact: true }).click();
  const fileSearch = page.getByRole("dialog", { name: "搜索文件" });
  const fileQuery = fileSearch.getByRole("textbox", { name: "搜索文件" });
  await expect(fileQuery).toHaveAttribute("placeholder", "搜索文件…");
  await fileQuery.fill("note");
  await expect(fileSearch.getByRole("option", { name: "note.ts" })).toBeVisible({
    timeout: 10000,
  });
  await page.screenshot({
    path: `${out}/control-search-files.png`,
    animations: "disabled",
  });
  await fileSearch.getByRole("option", { name: "note.ts" }).click();
  await expect(fileSearch).toHaveCount(0);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "重命名聊天" }).click();
  const rename = page.getByRole("dialog", { name: "重命名" });
  await expect(rename.getByRole("textbox", { name: "会话名称" })).toBeVisible();
  await expect(rename).toContainText("重命名当前聊天");
  await page.screenshot({
    path: `${out}/control-rename-thread.png`,
    animations: "disabled",
  });
  await rename.getByRole("button", { name: "关闭面板" }).click();
  await expect(rename).toHaveCount(0);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "归档聊天" }).click();
  const archive = page.getByRole("dialog", { name: "归档聊天" });
  await expect(archive).toContainText(
    "将归档当前聊天，并从关注列表移出。Agent 不会被停止。",
  );
  await expect(archive.getByRole("button", { name: "确认归档" })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-archive-thread.png`,
    animations: "disabled",
  });
  await archive.getByRole("button", { name: "返回", exact: true }).click();
  await expect(archive).toHaveCount(0);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "删除聊天" }).click();
  const remove = page.getByRole("dialog", { name: "要删除任务？" });
  await expect(remove).toContainText("这将永久删除该任务及其子智能体任务。此操作无法撤销。");
  await expect(remove.getByRole("button", { name: "删除", exact: true })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-delete-thread.png`,
    animations: "disabled",
  });
  await remove.getByRole("button", { name: "取消", exact: true }).click();
  await expect(remove).toHaveCount(0);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "查找聊天", exact: true }).click();
  const find = page.getByRole("textbox", { name: "搜索会话正文" });
  await expect(find).toBeVisible();
  await find.fill("需要确认范围");
  await page.screenshot({
    path: `${out}/control-find-thread.png`,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const pin = page.getByRole("menuitem", { name: "置顶/取消置顶聊天" });
  await expect(pin).toBeVisible();
  await page.screenshot({
    path: `${out}/control-pin-thread.png`,
    animations: "disabled",
  });
  await pin.click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/session-mode/stores/usePinStore.ts";
        const module = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
        );
        return module.usePinStore.getState().isPinned("ux-0");
      }),
    )
    .toBe(true);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const changes = page.getByRole("menuitem", { name: "显示/隐藏“变更”面板" });
  await expect(changes).toBeVisible();
  await changes.click();
  await expect(page.getByRole("button", { name: "查看变更", pressed: true })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-changes-panel.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "显示/隐藏“变更”面板" }).click();
  await expect(page.getByRole("button", { name: "查看变更", pressed: true })).toHaveCount(0);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const terminal = page.getByRole("menuitem", { name: "打开终端面板" });
  await expect(terminal).toBeVisible();
  await terminal.click();
  await expect(page.locator("[data-tool-tab='terminal'][aria-pressed='true']")).toBeVisible();
  await expect(page.getByLabel("终端列表")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-open-terminal.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const undo = page.getByRole("menuitem", { name: "撤销上一步操作" });
  await expect(undo).toBeEnabled();
  await page.screenshot({
    path: `${out}/control-undo-app-action.png`,
    animations: "disabled",
  });
  await undo.click();
  await expect(page.locator("[data-tool-tab='terminal'][aria-pressed='true']")).toHaveCount(0);
  await expect(page.getByText("已撤销打开终端")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-undo-app-settled.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "重做上一步操作" }).click();
  await expect(page.locator("[data-tool-tab='terminal'][aria-pressed='true']")).toBeVisible();
  await expect(page.getByText("已重做打开终端")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-redo-app-action.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const copyCwd = page.getByRole("menuitem", { name: "复制工作目录" });
  await expect(copyCwd).toBeVisible();
  await page.screenshot({
    path: `${out}/control-copy-cwd.png`,
    animations: "disabled",
  });
  await copyCwd.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied))
    .toBe("/fixture/项目/very-long-project-path-for-ui-regression");
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "侧边聊天", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "侧边聊天输入" })).toBeVisible();
  await expect(page.getByText("独立会话", { exact: true })).toBeVisible();
  await shot("control-side-chat");
  expect(fixture.calls.some((call) => call.path.endsWith("/thread/fork"))).toBe(true);
  await page.keyboard.press("Escape");
  const slashEditor = page
    .locator(".session-codex-composer [contenteditable=true]")
    .first();
  await slashEditor.click();
  await slashEditor.pressSequentially("/");
  const slashMenu = page.locator('[data-composer-suggestions="commands"]');
  await expect(slashMenu).toBeVisible();
  await expect(slashMenu).toContainText("斜杠命令");
  await expect(slashMenu).toContainText("搜索并运行斜杠命令");
  await expect(slashMenu.getByRole("option", { name: /\/status/ })).toContainText(
    "显示聊天 ID、上下文用量和速率限制",
  );
  await expect(slashMenu.getByRole("option", { name: /\/plan/ })).toContainText(
    "计划模式",
  );
  await expect(slashMenu).toContainText("技能");
  const skillOption = slashMenu.getByRole("option", { name: /review-skill/ });
  await skillOption.scrollIntoViewIfNeeded();
  await expect(skillOption).toContainText("检查当前改动");
  await expect(slashMenu.getByRole("option", { name: /\/archive/ })).toContainText(
    "归档当前聊天",
  );
  await expect(
    slashMenu.getByRole("option", { name: /\/autoreview/ }),
  ).toContainText("批准最近一次自动审查驳回");
  await expect(slashMenu.getByRole("option", { name: /\/feedback/ })).toContainText(
    "发送有关此聊天的反馈",
  );
  await shot("control-slash-popup");
  await slashMenu.getByRole("option", { name: /\/plan/ }).click();
  await expect(slashMenu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "取消计划模式" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "取消计划模式" })).toHaveAttribute(
    "title",
    "创建计划",
  );
  await expect(page.getByRole("button", { name: "执行权限：计划" })).toHaveCount(2);
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toHaveAttribute("aria-placeholder", "描述你的任务以生成计划…");
  await shot("control-plan-mode");
  await page.evaluate(async () => {
    const load = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path
      );
    const { useCodexStore } = await load(
      "/src/session-mode/components/codex/stores/useCodexStore.ts",
    );
    const review = {
      threadId: "ux-0",
      turnId: "turn-review",
      reviewId: "review-denied",
      targetItemId: "item-denied",
      startedAtMs: 10,
      completedAtMs: 20,
      decisionSource: "agent",
      review: {
        status: "denied",
        riskLevel: "high",
        userAuthorization: "unknown",
        rationale: "需要明确授权",
      },
      action: {
        type: "command",
        source: "shell",
        command: "curl target",
        cwd: "/fixture",
      },
    };
    const current = useCodexStore.getState().events["ux-0"] ?? [];
    if (current.some((event) => event.params?.reviewId === "review-denied")) return;
    useCodexStore.setState({
      events: {
        ...useCodexStore.getState().events,
        "ux-0": [
          ...current,
          { method: "item/autoApprovalReview/completed", params: review },
        ],
      },
    });
  });
  await page.getByRole("button", { name: "取消计划模式" }).click();
  await expect(page.getByRole("button", { name: "取消计划模式" })).toHaveCount(0);
  await slashEditor.click();
  await slashEditor.press("ControlOrMeta+a");
  await slashEditor.press("Backspace");
  await slashEditor.pressSequentially("/autoreview");
  await page
    .locator('[data-composer-suggestions="commands"]')
    .getByRole("option", { name: /\/autoreview/ })
    .click();
  const denials = page.getByRole("dialog", { name: "批准" });
  await expect(denials).toContainText(
    "选择一条自动审查驳回记录，以批准一次重试。此次重试仍会经过自动审查。",
  );
  const deniedCommand = denials.getByRole("button", { name: /curl target/ });
  await expect(async () => {
    if ((await deniedCommand.count()) === 0) {
      await page.evaluate(async () => {
        const path = "/src/session-mode/components/codex/stores/useCodexStore.ts";
        const module = await import(
          performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
        );
        const current = module.useCodexStore.getState().events["ux-0"] ?? [];
        if (current.some((event) => event.params?.reviewId === "review-denied")) return;
        module.useCodexStore.setState({
          events: {
            ...module.useCodexStore.getState().events,
            "ux-0": [
              ...current,
              {
                method: "item/autoApprovalReview/completed",
                params: {
                  threadId: "ux-0",
                  turnId: "turn-review",
                  reviewId: "review-denied",
                  targetItemId: "item-denied",
                  startedAtMs: 10,
                  completedAtMs: 20,
                  decisionSource: "agent",
                  review: {
                    status: "denied",
                    riskLevel: "high",
                    userAuthorization: "unknown",
                    rationale: "需要明确授权",
                  },
                  action: {
                    type: "command",
                    source: "shell",
                    command: "curl target",
                    cwd: "/fixture",
                  },
                },
              },
            ],
          },
        });
      });
    }
    await expect(deniedCommand).toContainText("需要明确授权");
  }).toPass();
  await shot("control-auto-review-denial");
  await denials.getByRole("button", { name: /curl target/ }).click();
  await expect(denials).toHaveCount(0);
  await expect(page.getByText("已记录批准")).toBeVisible();
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path.endsWith("/guardian-denial/approve") &&
          call.body?.identity?.reviewId === "review-denied" &&
          call.body?.runtimeInstance === "fixture-runtime",
      ),
    )
    .toBe(true);
  expect(
    fixture.calls.filter((call) =>
      /\/turn\/(start|steer|interrupt)|\/thread\/resume/.test(call.path),
    ),
  ).toEqual([]);
  await slashEditor.click();
  await slashEditor.press("ControlOrMeta+a");
  await slashEditor.press("Backspace");
  await slashEditor.pressSequentially("/mcp");
  await page.locator('[data-composer-suggestions="commands"]').getByRole("option", { name: /\/mcp/ }).click();
  await expect(page.getByRole("dialog", { name: "MCP" })).toContainText("fixture-mcp");
  await page.getByRole("button", { name: "关闭面板", exact: true }).click();
  await slashEditor.click();
  await slashEditor.pressSequentially("/feedback");
  await page.locator('[data-composer-suggestions="commands"]').getByRole("option", { name: /\/feedback/ }).click();
  const feedback = page.getByRole("dialog", { name: "提交反馈" });
  await expect(feedback).toBeVisible();
  await feedback.getByRole("radio", { name: "结果异常", exact: true }).click();
  await page.getByRole("textbox", { name: "填写详情（必填）" }).fill("菜单里的反馈");
  await page.getByRole("button", { name: "提交", exact: true }).click();
  await expect.poll(() => fixture.calls.some((call) => call.path.endsWith("/feedback/upload"))).toBe(true);
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await expect(feedback).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("kanban.session.side-chat-close-skip", "1"));
  await page.getByRole("button", { name: "返回主会话", exact: true }).click();
  await expect(page.getByRole("region", { name: "侧边聊天", exact: true })).toHaveCount(0);
  await slashEditor.click();
  await slashEditor.press("ControlOrMeta+a");
  await slashEditor.press("Backspace");
  await slashEditor.pressSequentially("/personality");
  const personalityMenu = page.locator('[data-composer-suggestions="commands"]');
  await personalityMenu.getByRole("option", { name: /\/personality/ }).click();
  const personalityDialog = page.getByRole("dialog", { name: "个性" });
  await expect(personalityDialog.getByRole("button", { name: "务实" })).toBeVisible();
  await expect(personalityDialog.getByRole("button", { name: "亲和友善" })).toBeVisible();
  await shot("control-personality");
  await personalityDialog.getByRole("button", { name: "务实" }).click();
  await expect(personalityDialog).toHaveCount(0);
  await expect(page.getByText("已切换至务实个性")).toBeVisible();
  await shot("control-personality-notice");
  await slashEditor.click();
  await slashEditor.pressSequentially("换一种语气");
  await page
    .locator(".session-codex-composer")
    .getByRole("button", { name: "发送", exact: true })
    .click();
  await expect.poll(() => {
    const sent = fixture.calls.findLast((call) =>
      call.path.endsWith("/followups/submit"),
    );
    return sent?.body?.parameters?.personality;
  }).toBe("pragmatic");
  await page.evaluate(() => localStorage.removeItem("kanban.session.side-chat-close-skip"));
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "侧边聊天", exact: true }).click();
  await page.getByRole("button", { name: "返回主会话", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "关闭侧边聊天？" });
  await expect(confirm).toContainText("这个侧边聊天将被删除，且无法恢复");
  await confirm.getByRole("checkbox", { name: "不再询问" }).check();
  await shot("control-side-chat-close");
  await confirm.getByRole("button", { name: "关闭侧边聊天", exact: true }).click();
  await expect(page.getByRole("region", { name: "侧边聊天", exact: true })).toHaveCount(0);
  await shot("control-side-chat-closed");
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path.endsWith("/thread/delete") &&
          call.body?.threadId === "ux-side",
      ),
    )
    .toBe(true);

  const tabClose = page.getByRole("button", { name: /关闭标签：/ }).first();
  await tabClose.hover({ force: true });
  await tabClose.click({ force: true });
  await expect(page.getByRole("button", { name: /关闭标签：/ })).toHaveCount(0);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const reopen = page.getByRole("menuitem", { name: "重新打开已关闭的标签页" });
  await expect(reopen).toBeVisible();
  await page.screenshot({
    path: `${out}/control-reopen-tab-menu.png`,
    animations: "disabled",
  });
  await reopen.click();
  await expect(page.getByRole("button", { name: /关闭标签：/ })).toHaveCount(1);
  await expect(page.getByText("已重新打开标签页")).toBeVisible();
  await expect(page.getByText("先看范围，再改代码。")).toBeVisible();
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "打开项目选择器" }).click();
  await expect(page.getByRole("button", { name: "收起项目列表" })).toBeVisible();
  await expect(page.getByText("已打开项目选择器")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-open-project.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "收起项目列表" }).click();
  await page.screenshot({
    path: `${out}/control-reopen-tab.png`,
    animations: "disabled",
  });

  await page.evaluate(() => {
    const media = navigator.mediaDevices;
    media.getUserMedia = () =>
      Promise.reject(
        Object.assign(new Error("denied"), { name: "NotAllowedError" }),
      );
  });
  await page
    .locator(".session-codex-composer")
    .getByRole("button", { name: "听写", exact: true })
    .click();
  const dictation = page.locator(".session-dictation-failure");
  await expect(dictation).toContainText("请启用麦克风访问权限以使用听写功能");
  await expect(dictation.getByRole("button", { name: "重试听写" })).toBeVisible();
  await shot("control-dictation-denied");
  await dictation.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dictation).toHaveCount(0);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const voice = page.getByRole("menuitem", { name: "切换语音聊天", exact: true });
  await expect(voice).toBeVisible();
  await page.screenshot({
    path: `${out}/control-voice-menu.png`,
    animations: "disabled",
  });
  await voice.click();
  await expect(page.getByText("已开始听写")).toBeVisible();
  await expect(page.locator(".session-dictation-failure")).toContainText(
    "请启用麦克风访问权限以使用听写功能",
  );
  await page.screenshot({
    path: `${out}/control-voice-chat.png`,
    animations: "disabled",
  });
  await page.locator(".session-dictation-failure").getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "切换语音聊天麦克风", exact: true }).click();
  await expect(page.getByText("当前没有进行中的听写")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-voice-mute.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "结束语音聊天", exact: true }).click();
  await expect(page.getByText("当前没有可结束的听写")).toBeVisible();
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "会议：记笔记", exact: true }).click();
  const notes = page.getByRole("dialog", { name: "会议：记笔记" });
  await expect(notes).toContainText("本机没有 Codex Meetings");
  await notes.getByRole("textbox", { name: "会议笔记" }).fill("先确认范围");
  await page.screenshot({
    path: `${out}/control-meeting-notes.png`,
    animations: "disabled",
  });
  await notes.getByRole("button", { name: "记入当前输入" }).click();
  await expect(notes).toHaveCount(0);
  const noted = page.locator(".session-codex-composer [contenteditable=true]").first();
  await expect(noted).toContainText("先确认范围");
  await noted.click();
  await noted.press("ControlOrMeta+a");
  await noted.press("Backspace");
  await page.evaluate(() => {
    const original = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function patchedClick(this: HTMLInputElement) {
      if (this.dataset.filePicker === "browser") {
        (window as unknown as { __photoAccept?: string }).__photoAccept = this.accept;
        HTMLInputElement.prototype.click = original;
        return;
      }
      original.call(this);
    };
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const photos = page.getByRole("menuitem", { name: "添加照片", exact: true });
  await expect(photos).toBeVisible();
  await page.screenshot({
    path: `${out}/control-add-photos-menu.png`,
    animations: "disabled",
  });
  await photos.click();
  const picker = page.locator("input[data-file-picker='browser']");
  await expect(picker).toHaveAttribute("accept", "image/*");
  await expect(page.getByText("已打开照片选择")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-add-photos.png`,
    animations: "disabled",
  });
  await picker.evaluate((input) => input.dispatchEvent(new Event("cancel")));
  const backgroundEditor = page.locator(".session-codex-composer [contenteditable=true]").first();
  await backgroundEditor.click();
  await backgroundEditor.pressSequentially("后台这条");
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const background = page.getByRole("menuitem", { name: "在后台发送消息", exact: true });
  await expect(background).toBeVisible();
  await page.screenshot({
    path: `${out}/control-background-send-menu.png`,
    animations: "disabled",
  });
  await background.click();
  await expect(page.getByText("已在后台发送消息")).toBeVisible();
  await expect.poll(() => {
    const sent = fixture.calls.findLast((call) => call.path.endsWith("/followups/submit"));
    return sent?.body?.text;
  }).toContain("后台这条");
  await page.screenshot({
    path: `${out}/control-background-send.png`,
    animations: "disabled",
  });

  await page.evaluate(async () => {
    const load = (path: string) =>
      import(
        path.startsWith("/node_modules/.vite/deps/")
          ? (window as any).__sessionFixtureDependency(path.split("/").at(-1))
          : (performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path)
      );
    const react = await load("/node_modules/.vite/deps/react.js");
    const dom = await load("/node_modules/.vite/deps/react-dom_client.js");
    const { CodeEditor } = await load(
      "/src/session-mode/features/files/editor/CodeEditor.tsx",
    );
    const { ThemeProvider } = await load(
      "/src/session-mode/contexts/ThemeContext.tsx",
    );
    const React = react.default ?? react;
    const { createRoot } = dom.default ?? dom;
    const host = document.createElement("div");
    host.id = "goto-line-fixture";
    host.className = "session-mode dark";
    host.style.cssText =
      "position:fixed;z-index:90;left:24px;top:120px;width:640px;height:240px;background:#20211d";
    document.querySelector(".session-mode")?.append(host);
    createRoot(host).render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(CodeEditor, {
          content: "alpha\nbeta\n目标行",
          filePath: "/fixture/note.ts",
        }),
      ),
    );
  });
  const goto = page.locator("#goto-line-fixture").getByRole("textbox", { name: "转到行" });
  await expect(goto).toHaveAttribute("placeholder", "转到行");
  await goto.fill("3");
  await goto.press("Enter");
  await page.screenshot({
    path: `${out}/control-goto-line.png`,
    animations: "disabled",
  });
  await page.locator("#goto-line-fixture").evaluate((node) => node.remove());

  await page.evaluate(async () => {
    localStorage.removeItem("kanban.session.model-upgrade-dismissed");
    const path = "/src/session-mode/components/codex/stores/useConfigStore.ts";
    const module = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
    );
    module.useConfigStore.getState().setModel("fixture-model");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor();
  const upgrade = page.locator(".session-model-change-notice");
  await expect(upgrade).toContainText("测试模型 将于");
  await expect(upgrade).toContainText("停用");
  await expect(upgrade).toContainText("目录提供的替换说明");
  await shot("control-model-upgrade");
  await upgrade.getByRole("button", { name: "立即切换" }).click();
  await expect(page.getByText("此对话将自动切换到 接替模型")).toHaveCount(0);
  await expect(
    page.locator(".session-codex-composer").getByRole("button", { name: "选择 ChatGPT 模型" }),
  ).toContainText("接替模型");
  await page.locator(".session-codex-composer").getByRole("button", { name: "附加文件", exact: true }).click();
  await expect(page.getByRole("button", { name: "附加照片或视频", exact: true })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-attach-menu.png`,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "选择 ChatGPT 模型", exact: true }).click();
  const chooseModel = page.getByRole("menuitem", { name: "选择模型" });
  if (await chooseModel.isVisible()) await chooseModel.click();
  const recentModels = page.getByRole("button", { name: "打开最近使用的模型" });
  await expect(recentModels).toBeVisible();
  await recentModels.click();
  await expect(page.getByText("还没有最近使用的模型")).toBeVisible();
  await page.getByRole("menuitemradio", { name: "接替模型" }).click();
  await expect(page.getByRole("button", { name: /接替模型 ·/ })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-recent-models.png`,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const speed = page.getByRole("menuitem", { name: "循环切换速度", exact: true });
  await expect(speed).toBeVisible();
  await page.screenshot({
    path: `${out}/control-cycle-speed-menu.png`,
    animations: "disabled",
  });
  await speed.click();
  await expect(page.getByText("已切换到快速")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-cycle-speed.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const planMode = page.getByRole("menuitem", { name: "切换规划模式", exact: true });
  await expect(planMode).toBeVisible();
  await page.screenshot({
    path: `${out}/control-plan-toggle-menu.png`,
    animations: "disabled",
  });
  await planMode.click();
  await expect(page.getByText("已开启规划模式")).toBeVisible();
  await expect(page.getByRole("button", { name: "取消计划模式" })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-plan-toggle.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "取消计划模式" }).click();
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const workspace = page.getByRole("menuitem", { name: "切换本地/工作树", exact: true });
  await expect(workspace).toBeVisible();
  await page.screenshot({
    path: `${out}/control-worktree-menu.png`,
    animations: "disabled",
  });
  await workspace.click();
  await expect(page.getByText("新任务将使用独立工作树")).toBeVisible();
  await expect.poll(() =>
    page.evaluate(async () => {
      const path = "/src/session-mode/components/codex/stores/useConfigStore.ts";
      const module = await import(
        performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
      );
      return module.useConfigStore.getState().threadCwdMode;
    }),
  ).toBe("worktree");
  await page.screenshot({
    path: `${out}/control-worktree-toggle.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "切换本地/工作树", exact: true }).click();
  await expect.poll(() =>
    page.evaluate(async () => {
      const path = "/src/session-mode/components/codex/stores/useConfigStore.ts";
      const module = await import(
        performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
      );
      return module.useConfigStore.getState().threadCwdMode;
    }),
  ).toBe("local");
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const raiseEffort = page.getByRole("menuitem", { name: "提高推理强度", exact: true });
  await expect(raiseEffort).toBeVisible();
  await page.screenshot({
    path: `${out}/control-reasoning-menu.png`,
    animations: "disabled",
  });
  await raiseEffort.click();
  await expect(page.getByText("推理强度已设为高")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-reasoning-effort.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const cycleHost = page.getByRole("menuitem", { name: "在主机间循环切换", exact: true });
  await expect(cycleHost).toBeVisible();
  await page.screenshot({
    path: `${out}/control-cycle-host-menu.png`,
    animations: "disabled",
  });
  await cycleHost.click();
  await expect(page.getByText("没有可用的远程计算机。新任务仍使用本机")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-cycle-host.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const commitItem = page.getByRole("menuitem", { name: "提交或推送", exact: true });
  await commitItem.scrollIntoViewIfNeeded();
  await expect(commitItem).toBeVisible();
  await page.screenshot({
    path: `${out}/control-commit-menu.png`,
    animations: "disabled",
  });
  await commitItem.click();
  const commitOptions = page.getByRole("dialog", { name: "提交或推送" });
  await expect(commitOptions).toContainText("打开提交或推送选项");
  await expect(commitOptions.getByRole("button", { name: "推送到远程仓库" })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-commit-options.png`,
    animations: "disabled",
  });
  await commitOptions.getByRole("button", { name: "提交更改" }).click();
  const commit = page.getByRole("dialog", { name: "提交 Git 更改" });
  await expect(commit).toContainText("填写提交说明，将当前已暂存的更改提交到本地仓库。");
  await page.screenshot({
    path: `${out}/control-commit-dialog.png`,
    animations: "disabled",
  });
  await commit.getByRole("button", { name: "取消", exact: true }).click();
  await expect(commit).toHaveCount(0);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const createPr = page.getByRole("menuitem", { name: "创建 PR", exact: true });
  await createPr.scrollIntoViewIfNeeded();
  await expect(createPr).toBeVisible();
  await page.screenshot({
    path: `${out}/control-create-pr-menu.png`,
    animations: "disabled",
  });
  await createPr.click();
  const pullRequest = page.getByRole("dialog", { name: "创建 PR" });
  await expect(pullRequest).toContainText("打开 Pull Request 创建选项");
  await expect(pullRequest).toContainText("fixture/fixture");
  await expect(pullRequest.getByRole("link", { name: "在 GitHub 上创建 PR" })).toHaveAttribute(
    "href",
    /github\.com\/fixture\/fixture\/compare\/feature\/long-branch-name-for-layout/,
  );
  await page.screenshot({
    path: `${out}/control-create-pr.png`,
    animations: "disabled",
  });
  await pullRequest.getByRole("button", { name: "关闭面板" }).click();
  await expect(pullRequest).toHaveCount(0);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const branchItem = page.getByRole("menuitem", { name: "创建分支", exact: true });
  await branchItem.scrollIntoViewIfNeeded();
  await expect(branchItem).toBeVisible();
  await page.screenshot({
    path: `${out}/control-create-branch-menu.png`,
    animations: "disabled",
  });
  await branchItem.click();
  const branchSheet = page.getByRole("dialog", { name: "创建分支" });
  await expect(branchSheet).toContainText("打开分支创建选项");
  await page.screenshot({
    path: `${out}/control-create-branch.png`,
    animations: "disabled",
  });
  await branchSheet.getByRole("textbox", { name: "分支名称" }).fill("feature/from-menu");
  await branchSheet.getByRole("button", { name: "创建并检出" }).click();
  await expect(page.getByText("已创建并检出 feature/from-menu")).toBeVisible();
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path.endsWith("/git/create-branch") &&
          call.body?.cwd ===
            "/fixture/项目/very-long-project-path-for-ui-regression" &&
          call.body?.branch === "feature/from-menu",
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const mergePr = page.getByRole("menuitem", { name: "合并 PR", exact: true });
  await mergePr.scrollIntoViewIfNeeded();
  await expect(mergePr).toBeVisible();
  await page.screenshot({
    path: `${out}/control-merge-pr-menu.png`,
    animations: "disabled",
  });
  await mergePr.click();
  const merge = page.getByRole("dialog", { name: "合并 PR" });
  await expect(merge).toContainText("打开 Pull Request 合并选项");
  await expect(merge).toContainText("本机没有 GitHub CLI");
  await expect(merge.getByRole("link", { name: "在 GitHub 上打开合并选项" })).toHaveAttribute(
    "href",
    /github\.com\/fixture\/fixture\/pulls\?q=is%3Aopen\+head%3Afeature/,
  );
  await page.screenshot({
    path: `${out}/control-merge-pr.png`,
    animations: "disabled",
  });
  await merge.getByRole("button", { name: "关闭面板" }).click();
  await expect(merge).toHaveCount(0);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const openPr = page.getByRole("menuitem", { name: "在 GitHub 上打开 PR", exact: true });
  await openPr.scrollIntoViewIfNeeded();
  await expect(openPr).toBeVisible();
  await page.screenshot({
    path: `${out}/control-open-pr-menu.png`,
    animations: "disabled",
  });
  await openPr.click();
  const opened = page.getByRole("dialog", { name: "在 GitHub 上打开 PR" });
  await expect(opened).toContainText("打开与当前聊天关联的 Pull Request");
  await expect(opened).toContainText("当前聊天没有绑定的 Pull Request 编号");
  await expect(opened.getByRole("link", { name: "在 GitHub 上打开 PR" })).toHaveAttribute(
    "href",
    /github\.com\/fixture\/fixture\/pulls\?q=head%3Afeature/,
  );
  await page.screenshot({
    path: `${out}/control-open-pr.png`,
    animations: "disabled",
  });
  await opened.getByRole("button", { name: "关闭面板" }).click();
  await expect(opened).toHaveCount(0);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const blame = page.getByRole("menuitem", { name: "切换 Git 追溯信息", exact: true });
  await blame.scrollIntoViewIfNeeded();
  await expect(blame).toBeVisible();
  await page.screenshot({
    path: `${out}/control-git-blame-menu.png`,
    animations: "disabled",
  });
  await blame.click();
  await expect(page.getByText("已显示 Git 追溯信息")).toBeVisible();
  const blameLine = page.getByRole("status", { name: "Git 追溯信息" });
  await expect(blameLine).toContainText("作者 Test");
  await expect(blameLine).toContainText("提交 abcdef1 initial");
  await page.screenshot({
    path: `${out}/control-git-blame.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const forkChat = page.getByRole("menuitem", { name: "分叉聊天", exact: true });
  await page.setViewportSize({ width: 1440, height: 2200 });
  await expect(forkChat).toBeVisible();
  await page.screenshot({
    path: `${out}/control-fork-chat-menu.png`,
    animations: "disabled",
  });
  await forkChat.click();
  await expect(page.getByText("已分叉聊天")).toBeVisible();
  await expect(page.getByRole("tab", { name: /分叉聊天/ })).toBeVisible();
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path.endsWith("/thread/fork") && call.body?.threadId === "ux-0",
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: `${out}/control-fork-chat.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 2200 });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const switchChat = page.getByRole("menuitem", { name: "切换聊天…", exact: true });
  await expect(switchChat).toBeVisible();
  await page.screenshot({
    path: `${out}/control-search-chats-menu.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await switchChat.click();
  const switchSheet = page.getByRole("dialog", { name: "切换聊天…" });
  await expect(switchSheet).toContainText("搜索并切换到聊天");
  await switchSheet.getByRole("textbox", { name: "搜索并切换到聊天" }).fill("分叉");
  const forkedChat = switchSheet.getByRole("listbox", { name: "聊天" }).getByRole("option", { name: "分叉聊天" });
  await expect(forkedChat).toBeVisible();
  await page.screenshot({
    path: `${out}/control-search-chats.png`,
    animations: "disabled",
  });
  await forkedChat.click();
  await expect(switchSheet).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /分叉聊天/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.setViewportSize({ width: 1440, height: 2200 });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const activity = page.getByRole("menuitem", { name: "切换活动视图", exact: true });
  await expect(activity).toBeVisible();
  await page.screenshot({
    path: `${out}/control-activity-view-menu.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await activity.click();
  await expect(page.getByText("已开启活动视图")).toBeVisible();
  await expect(page.getByRole("button", { name: "收起项目列表", exact: true })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-activity-view.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "切换活动视图", exact: true }).click();
  await expect(page.getByText("已关闭活动视图")).toBeVisible();
  await expect(page.getByRole("button", { name: "展开项目列表", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 2400 });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const focusMain = page.getByRole("menuitem", { name: "聚焦主聊天输入框", exact: true });
  await expect(focusMain).toBeVisible();
  await page.screenshot({
    path: `${out}/control-focus-main-menu.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator(".session-top-icon").first().focus();
  await focusMain.click();
  await expect(page.getByText("已聚焦主聊天输入框")).toBeVisible();
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toBeFocused();
  await page.screenshot({
    path: `${out}/control-focus-main.png`,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1440, height: 2400 });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const focusSideClosed = page.getByRole("menuitem", { name: "打开侧边聊天", exact: true });
  await expect(focusSideClosed).toBeVisible();
  await page.screenshot({
    path: `${out}/control-focus-side-menu.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await focusSideClosed.click();
  await expect(page.getByText("当前没有打开的侧边聊天")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-focus-side-closed.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "侧边聊天", exact: true }).click();
  const sideInput = page.getByRole("textbox", { name: "侧边聊天输入" });
  await expect(sideInput).toBeVisible();
  await page.locator(".session-top-icon").first().focus();
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "打开侧边聊天", exact: true }).click();
  await expect(page.getByText("已打开侧边聊天")).toBeVisible();
  await expect(sideInput).toBeFocused();
  await page.screenshot({
    path: `${out}/control-focus-side.png`,
    animations: "disabled",
  });
  await page.evaluate(() => localStorage.setItem("kanban.session.side-chat-close-skip", "1"));
  await page.getByRole("button", { name: "返回主会话", exact: true }).click();
  await expect(page.getByRole("region", { name: "侧边聊天", exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 3000 });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const artifactSelect = page.getByRole("menuitem", { name: "工件：选择", exact: true });
  await expect(artifactSelect).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "工件：平移", exact: true })).toBeVisible();
  const canvasPromptItem = page.getByRole("menuitem", { name: "画布：询问 ChatGPT", exact: true });
  await expect(canvasPromptItem).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "工件：矩形", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "工件：圆形", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "工件：箭头", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "工件：直线", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "工件：文本", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "工件：便签", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "项目符号列表", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "核对清单", exact: true })).toBeVisible();
  const openDotInMenu = page.getByRole("menuitem", { name: "打开您的 Dot", exact: true });
  await expect(openDotInMenu).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "下一个需关注的聊天", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "上一个聊天", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "下一个聊天", exact: true })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "下一个最近查看的聊天", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "转到最近聊天 1", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "转到最近聊天 6", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "聚焦第 1 个标签页", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "聚焦第 9 个标签页", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "切换到聊天", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "切换到工作", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "切换到 Codex", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "设置", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "MCP", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "个性", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "从其他 AI 应用导入", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "键盘快捷方式", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "显示键盘快捷键", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "全部标为已读", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "管理已安排任务", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "前往技能", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "强制重新加载技能", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "打开文件夹…", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "显示/隐藏固定摘要", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "打开“变更”选项卡", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "显示/隐藏侧边栏", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "反馈", exact: true })).toBeVisible();
  await openDotInMenu.evaluate((item) => item.scrollIntoView({ block: "end" }));
  const copyPage = page.getByRole("menuitem", { name: "复制页面链接", exact: true });
  await expect(copyPage).toBeVisible();
  await page.screenshot({
    path: `${out}/control-artifact-tools-menu.png`,
    animations: "disabled",
  });
  const pageAddress = page.url();
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async (text: string) => {
        (window as unknown as { __copied?: string }).__copied = text;
      },
    });
  });
  await copyPage.evaluate((item) => item.scrollIntoView({ block: "center" }));
  await copyPage.click({ force: true });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied))
    .toBe(pageAddress);
  const copiedToast = page.getByText("已复制页面链接");
  await copiedToast.evaluate((node) => {
    let parent: HTMLElement | null = node.parentElement;
    while (parent) {
      parent.scrollTop = 0;
      parent = parent.parentElement;
    }
    node.scrollIntoView({ block: "center" });
  });
  await expect(copiedToast).toBeVisible();
  await page.screenshot({
    path: `${out}/control-copy-page-link.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  await page.getByRole("menuitem", { name: "工件：选择", exact: true }).click();
  await expect(page.getByText("当前没有打开的工件画布")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-artifact-tools-closed.png`,
    animations: "disabled",
  });
  await page
    .locator(".session-codex-composer")
    .getByRole("button", { name: "附加文件" })
    .click();
  await page.getByRole("button", { name: "画草图", exact: true }).click();
  const drawing = page.getByRole("img", { name: "绘图画布", exact: true });
  await expect(drawing).toBeVisible();
  const sketch = page.getByRole("dialog", { name: "画草图" });
  await sketch.getByRole("button", { name: "工件：选择", exact: true }).click();
  await expect(sketch.getByRole("button", { name: "工件：选择", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({
    path: `${out}/control-artifact-select.png`,
    animations: "disabled",
  });
  await sketch.getByRole("button", { name: "工件：平移", exact: true }).click();
  await expect(sketch.getByRole("button", { name: "工件：平移", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({
    path: `${out}/control-artifact-pan.png`,
    animations: "disabled",
  });
  await page.keyboard.press("r");
  await expect(sketch.getByRole("button", { name: "工件：矩形", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const rectBox = await drawing.boundingBox();
  const rectsBefore = await drawing.locator("rect").count();
  await page.mouse.move((rectBox?.x ?? 0) + 48, (rectBox?.y ?? 0) + 48);
  await page.mouse.down();
  await page.mouse.move((rectBox?.x ?? 0) + 220, (rectBox?.y ?? 0) + 160, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => drawing.locator("rect").count()).toBeGreaterThan(rectsBefore);
  await page.screenshot({
    path: `${out}/control-artifact-rect.png`,
    animations: "disabled",
  });
  await page.keyboard.press("o");
  await expect(sketch.getByRole("button", { name: "工件：圆形", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const ellipseBox = await drawing.boundingBox();
  const ellipsesBefore = await drawing.locator("ellipse").count();
  await page.mouse.move((ellipseBox?.x ?? 0) + 280, (ellipseBox?.y ?? 0) + 70);
  await page.mouse.down();
  await page.mouse.move((ellipseBox?.x ?? 0) + 460, (ellipseBox?.y ?? 0) + 190, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => drawing.locator("ellipse").count()).toBeGreaterThan(ellipsesBefore);
  await page.screenshot({
    path: `${out}/control-artifact-ellipse.png`,
    animations: "disabled",
  });
  await page.keyboard.press("a");
  await expect(sketch.getByRole("button", { name: "工件：箭头", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const arrowBox = await drawing.boundingBox();
  const linesBefore = await drawing.locator("polyline").count();
  await page.mouse.move((arrowBox?.x ?? 0) + 80, (arrowBox?.y ?? 0) + 240);
  await page.mouse.down();
  await page.mouse.move((arrowBox?.x ?? 0) + 260, (arrowBox?.y ?? 0) + 300, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => drawing.locator("polyline").count()).toBeGreaterThan(linesBefore);
  await page.screenshot({
    path: `${out}/control-artifact-arrow.png`,
    animations: "disabled",
  });
  await page.keyboard.press("l");
  await expect(sketch.getByRole("button", { name: "工件：直线", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const lineBox = await drawing.boundingBox();
  const straightBefore = await drawing.locator("polyline").count();
  await page.mouse.move((lineBox?.x ?? 0) + 520, (lineBox?.y ?? 0) + 80);
  await page.mouse.down();
  await page.mouse.move((lineBox?.x ?? 0) + 680, (lineBox?.y ?? 0) + 220, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => drawing.locator("polyline").count()).toBe(straightBefore + 1);
  await page.screenshot({
    path: `${out}/control-artifact-line.png`,
    animations: "disabled",
  });
  await page.keyboard.press("t");
  await expect(sketch.getByRole("button", { name: "工件：文本", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const textBox = await drawing.boundingBox();
  await page.mouse.click((textBox?.x ?? 0) + 90, (textBox?.y ?? 0) + 250);
  const textEntry = sketch.getByRole("textbox", { name: "说明文字" });
  await expect(textEntry).toBeVisible();
  await textEntry.fill("画布文字");
  await sketch.getByRole("button", { name: "添加文字", exact: true }).click();
  await expect(drawing).toContainText("画布文字");
  await page.screenshot({
    path: `${out}/control-artifact-text.png`,
    animations: "disabled",
  });
  await page.keyboard.press("n");
  await expect(sketch.getByRole("button", { name: "批注", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const noteBox = await drawing.boundingBox();
  await page.mouse.click((noteBox?.x ?? 0) + 360, (noteBox?.y ?? 0) + 250);
  const noteEntry = sketch.getByRole("textbox", { name: "说明文字" });
  await expect(noteEntry).toBeVisible();
  await noteEntry.fill("画布便签");
  await sketch.getByRole("button", { name: "添加文字", exact: true }).click();
  await expect(drawing).toContainText("画布便签");
  await page.screenshot({
    path: `${out}/control-artifact-note.png`,
    animations: "disabled",
  });
  const canvasBox = await drawing.boundingBox();
  await page.mouse.move((canvasBox?.x ?? 0) + 180, (canvasBox?.y ?? 0) + 120);
  await page.keyboard.press("/");
  const canvasPrompt = page.getByRole("dialog", { name: "画布：询问 ChatGPT" });
  await expect(canvasPrompt).toBeVisible();
  await expect(canvasPrompt).toContainText("在指针位置打开画布提示");
  await canvasPrompt.getByRole("textbox", { name: "画布提示" }).fill("把这块草图改成流程图");
  await page.screenshot({
    path: `${out}/control-canvas-prompt.png`,
    animations: "disabled",
  });
  await canvasPrompt.getByRole("button", { name: "添加到输入", exact: true }).click();
  await expect(page.getByText("已把画布提示加入输入")).toBeVisible();
  await expect(canvasPrompt).toHaveCount(0);
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toContainText("把这块草图改成流程图");
  await page.screenshot({
    path: `${out}/control-canvas-prompt-added.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "返回并保留草稿", exact: true }).click();
  await expect(drawing).toHaveCount(0);
  const mainComposer = page.locator(".session-codex-composer [contenteditable=true]").first();
  await mainComposer.click();
  await mainComposer.press("ControlOrMeta+a");
  await mainComposer.press("Backspace");
  await expect(mainComposer).not.toContainText("把这块草图改成流程图");

  await page
    .locator(".session-codex-composer")
    .getByRole("button", { name: "附加文件" })
    .click();
  await expect(page.getByRole("button", { name: "文件和文件夹" })).toBeVisible();
  await shot("control-files-folders");
  await page.getByRole("button", { name: "录制技能" }).click();
  const record = page.getByRole("dialog", { name: "录制技能" });
  await expect(record).toContainText("浏览器不能录制屏幕");
  await record.getByRole("textbox", { name: "技能名称" }).fill("检查当前改动");
  await record.getByRole("textbox", { name: "工作流步骤" }).fill("先看 diff，再跑测试");
  await shot("control-record-skill");
  await page.keyboard.press("Escape");
  await expect(record).toHaveCount(0);

  await page
    .locator(".session-codex-composer")
    .getByRole("button", { name: "附加文件" })
    .click();
  await page.getByRole("button", { name: "展开编辑", exact: true }).click();
  const expanded = page.getByRole("dialog", { name: "展开编辑" });
  const expandedEditor = expanded.getByRole("textbox").first();
  await expandedEditor.click();
  await page.keyboard.press("Shift+F10");
  await expect(expanded.getByRole("button", { name: "纯文本模式", exact: true })).toBeFocused();
  await expandedEditor.fill("先看范围\n再改代码");
  await expandedEditor.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+Alt+4");
  await expect(expandedEditor).toHaveValue("1. 先看范围\n2. 再改代码");
  await page.screenshot({
    path: `${out}/control-numbered-list.png`,
    animations: "disabled",
  });
  await expect(page.getByText("已聚焦内容控件")).toHaveCount(0);
  await page.screenshot({
    path: `${out}/control-focus-content.png`,
    animations: "disabled",
  });
  await expandedEditor.fill("先看范围\n再改代码");
  await expandedEditor.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+Alt+5");
  await expect(expandedEditor).toHaveValue("- 先看范围\n- 再改代码");
  await page.screenshot({
    path: `${out}/control-bulleted-list.png`,
    animations: "disabled",
  });
  await expandedEditor.fill("先看范围\n再改代码");
  await expandedEditor.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+Alt+6");
  await expect(expandedEditor).toHaveValue("- [ ] 先看范围\n- [ ] 再改代码");
  await page.screenshot({
    path: `${out}/control-checklist.png`,
    animations: "disabled",
  });
  await expandedEditor.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+Alt+6");
  await expect(expandedEditor).toHaveValue("先看范围\n再改代码");
  await expandedEditor.fill("");
  await page.keyboard.press("Escape");
  await expect(expanded).toHaveCount(0);
  await page.evaluate(async () => {
    const load = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
      );
    const center = await load("/src/session-mode/stores/useAgentCenterStore.ts");
    const attention = await load("/src/session-mode/stores/useSessionAttentionStore.ts");
    const approvals = await load("/src/session-mode/components/codex/stores/useApprovalStore.ts");
    const permissions = await load("/src/session-mode/components/codex/stores/usePermissionsStore.ts");
    const questions = await load("/src/session-mode/components/codex/stores/useRequestUserInputStore.ts");
    const elicitations = await load("/src/session-mode/components/codex/stores/useElicitationStore.ts");
    const codex = await load("/src/session-mode/components/codex/stores/useCodexStore.ts");
    const questionsStore = await load("/src/session-mode/features/async-questions/store.ts");
    approvals.useApprovalStore.setState({ pendingApprovals: [], currentApproval: null });
    permissions.usePermissionsStore.setState({ pendingRequests: [] });
    questions.useRequestUserInputStore.setState({ pendingRequests: [], currentRequest: null });
    elicitations.useElicitationStore.setState({ pendingRequests: [] });
    attention.useSessionAttentionStore.setState({ receipts: {} });
    const open = questionsStore.useAsyncQuestionStore.getState().sessions;
    questionsStore.useAsyncQuestionStore.setState({
      sessions: Object.fromEntries(
        Object.entries(open).map(([id, session]) => [
          id,
          { ...(session as object), openId: undefined },
        ]),
      ),
    });
    codex.useCodexStore.setState((state: { events: Record<string, unknown[]> }) => ({
      events: Object.fromEntries(
        Object.entries(state.events).map(([id, events]) => [
          id,
          events.filter((event) => {
            const params = (event as {
              params?: {
                item?: { questions?: unknown };
                turn?: { items?: Array<{ questions?: unknown }> };
              };
            }).params;
            return (
              !params?.item?.questions &&
              !params?.turn?.items?.some((item) => item.questions)
            );
          }),
        ]),
      ),
    }));
    const names = await load("/src/session-mode/stores/useSessionNameStore.ts");
    names.useSessionNameStore.getState().setName("codex", "ux-attention", "待关注");
    center.useAgentCenterStore.getState().addAgentCard(
      { kind: "codex", id: "ux-attention", cwd: "/fixture", preview: "待关注" },
      { activate: false },
    );
    attention.useSessionAttentionStore
      .getState()
      .complete("codex", "ux-attention", "reply-attention");
  });
  await page.setViewportSize({ width: 1440, height: 3000 });
  await page.evaluate(async () => {
    const load = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
      );
    const codex = await load("/src/session-mode/components/codex/stores/useCodexStore.ts");
    codex.useCodexStore.setState({ events: {} });
  });
  await page.evaluate(async () => {
    const load = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
      );
    const questionsStore = await load("/src/session-mode/features/async-questions/store.ts");
    const open = questionsStore.useAsyncQuestionStore.getState().sessions;
    questionsStore.useAsyncQuestionStore.setState({
      sessions: Object.fromEntries(
        Object.entries(open).map(([id, session]) => [
          id,
          { ...(session as object), openId: undefined },
        ]),
      ),
    });
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).evaluate((node) => {
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    (node as HTMLButtonElement).click();
  });
  const openDot = page.getByRole("menuitem", { name: "打开您的 Dot", exact: true });
  const threadBeforeDot = page.url();
  await openDot.evaluate((item) => item.scrollIntoView({ block: "center" }));
  await openDot.click({ force: true });
  await expect(page.getByText("本机没有与 Dot 的对话")).toBeVisible();
  await expect(page).toHaveURL(threadBeforeDot);
  const dotToast = page.getByText("本机没有与 Dot 的对话");
  await dotToast.evaluate((node) => {
    let parent: HTMLElement | null = node.parentElement;
    while (parent) {
      parent.scrollTop = 0;
      parent = parent.parentElement;
    }
    node.scrollIntoView({ block: "center" });
  });
  await page.screenshot({
    path: `${out}/control-open-dot.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const nextAttention = page.getByRole("menuitem", { name: "下一个需关注的聊天", exact: true });
  await nextAttention.evaluate((item) => item.scrollIntoView({ block: "center" }));
  await nextAttention.click({ force: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("tab", { name: "待关注" }).click();
  await expect(page.getByRole("tab", { name: "待关注" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.screenshot({
    path: `${out}/control-next-attention.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 3000 });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const previousChat = page.getByRole("menuitem", { name: "上一个聊天", exact: true });
  await previousChat.evaluate((item) => item.scrollIntoView({ block: "center" }));
  const selectedKey = await page
    .locator("[role='tab'][aria-selected='true']")
    .getAttribute("data-tab-key");
  const tabOrder = await page.locator("[role='tab']").evaluateAll((tabs) =>
    tabs.map((tab) => (tab as HTMLElement).dataset.tabKey ?? ""),
  );
  const selectedIndex = tabOrder.indexOf(selectedKey ?? "");
  await previousChat.click({ force: true });
  await page.waitForTimeout(120);
  const afterPrevious = await page.evaluate(async () => {
    const load = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
      );
    const center = await load("/src/session-mode/stores/useAgentCenterStore.ts");
    const state = center.useAgentCenterStore.getState();
    return {
      current: state.currentAgentCardId,
      cards: state.cards.map((card: { id: string }) => card.id),
    };
  });
  if (afterPrevious.current !== tabOrder[selectedIndex - 1]?.replace(/^codex:/, "")) {
    throw new Error(
      `previous moved to ${afterPrevious.current}; expected ${tabOrder[selectedIndex - 1]}; cards ${afterPrevious.cards.join(",")}`,
    );
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByText("已切换到下一个需关注的聊天")).toBeVisible();
  await expect(page.getByText("已切换到上一个聊天")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
          );
        const center = await load("/src/session-mode/stores/useAgentCenterStore.ts");
        return center.useAgentCenterStore.getState().currentAgentCardId as string;
      }),
    )
    .toBe(tabOrder[selectedIndex - 1]?.replace(/^codex:/, ""));
  await page.screenshot({
    path: `${out}/control-previous-chat.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 3000 });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const nextChat = page.getByRole("menuitem", { name: "下一个聊天", exact: true });
  await nextChat.evaluate((item) => item.scrollIntoView({ block: "center" }));
  await nextChat.click({ force: true });
  await page.waitForTimeout(120);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByText("已切换到下一个聊天")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
          );
        const center = await load("/src/session-mode/stores/useAgentCenterStore.ts");
        return center.useAgentCenterStore.getState().currentAgentCardId as string;
      }),
    )
    .toBe("ux-attention");
  await page.screenshot({
    path: `${out}/control-next-chat.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 3000 });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const recentChat = page.getByRole("menuitem", { name: "下一个最近查看的聊天", exact: true });
  await recentChat.evaluate((item) => item.scrollIntoView({ block: "center" }));
  await recentChat.click({ force: true });
  await page.waitForTimeout(120);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByText("已切换到下一个最近查看的聊天")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
          );
        const center = await load("/src/session-mode/stores/useAgentCenterStore.ts");
        return center.useAgentCenterStore.getState().currentAgentCardId as string;
      }),
    )
    .toBe("ux-side");
  await page.screenshot({
    path: `${out}/control-next-recent.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 3000 });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const recentSlot = page.getByRole("menuitem", { name: "转到最近聊天 1", exact: true });
  await recentSlot.evaluate((item) => item.scrollIntoView({ block: "center" }));
  await recentSlot.click({ force: true });
  await page.waitForTimeout(120);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByText("已打开最近聊天 1")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
          );
        const center = await load("/src/session-mode/stores/useAgentCenterStore.ts");
        return center.useAgentCenterStore.getState().currentAgentCardId as string;
      }),
    )
    .toBe("ux-side");
  await page.screenshot({
    path: `${out}/control-recent-slot.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 3000 });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const secondSlot = page.getByRole("menuitem", { name: "转到最近聊天 2", exact: true });
  await secondSlot.evaluate((item) => item.scrollIntoView({ block: "center" }));
  await secondSlot.click({ force: true });
  await page.waitForTimeout(120);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByText("已打开最近聊天 2")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
          );
        const center = await load("/src/session-mode/stores/useAgentCenterStore.ts");
        return center.useAgentCenterStore.getState().currentAgentCardId as string;
      }),
    )
    .toBe("ux-attention");
  await page.screenshot({
    path: `${out}/control-recent-slot-2.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 3000 });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const secondTab = page.getByRole("menuitem", { name: "聚焦第 2 个标签页", exact: true });
  await secondTab.evaluate((item) => item.scrollIntoView({ block: "center" }));
  await secondTab.click({ force: true });
  await page.waitForTimeout(120);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByText("已聚焦第 2 个标签页")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
          );
        const center = await load("/src/session-mode/stores/useAgentCenterStore.ts");
        return center.useAgentCenterStore.getState().currentAgentCardId as string;
      }),
    )
    .toBe("ux-side");
  await page.screenshot({
    path: `${out}/control-focus-tab.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const switchToChat = page.getByRole("menuitem", { name: "切换到聊天", exact: true });
  await switchToChat.evaluate((item) => item.scrollIntoView({ block: "center" }));
  await switchToChat.click({ force: true });
  await expect(page).toHaveURL(/view=agent/);
  await expect(page.getByRole("tablist", { name: "关注会话" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    path: `${out}/control-switch-chat.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const switchToWork = page.getByRole("menuitem", { name: "切换到工作", exact: true });
  await switchToWork.scrollIntoViewIfNeeded();
  await switchToWork.click();
  await expect(page.getByText("本机没有 ChatGPT 工作模式")).toBeVisible();
  await expect(page).toHaveURL(/view=agent/);
  await page.screenshot({
    path: `${out}/control-switch-work.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const switchToCodex = page.getByRole("menuitem", { name: "切换到 Codex", exact: true });
  await switchToCodex.scrollIntoViewIfNeeded();
  await switchToCodex.click();
  await expect(page.getByText("当前已是 Codex 会话")).toBeVisible();
  await expect(page).toHaveURL(/view=agent/);
  await page.screenshot({
    path: `${out}/control-switch-codex.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const openSettings = page.getByRole("menuitem", { name: "设置", exact: true });
  await openSettings.scrollIntoViewIfNeeded();
  await openSettings.click();
  await expect(page).toHaveURL(/view=settings/);
  await expect(page.getByRole("link", { name: "GitHub 项目", exact: true })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-settings.png`,
    animations: "disabled",
  });
  await page.goto(`${page.url().replace(/view=settings/, "view=agent")}`);
  await expect(page.getByRole("tablist", { name: "关注会话" })).toBeVisible();
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const openMcp = page.getByRole("menuitem", { name: "MCP", exact: true });
  await openMcp.scrollIntoViewIfNeeded();
  await openMcp.click();
  const mcpSheet = page.getByRole("dialog", { name: "MCP" });
  await expect(mcpSheet).toContainText("fixture-mcp");
  await page.screenshot({
    path: `${out}/control-mcp-settings.png`,
    animations: "disabled",
  });
  await mcpSheet.getByRole("button", { name: "关闭面板", exact: true }).click();
  await expect(mcpSheet).toHaveCount(0);
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const openPersonality = page.getByRole("menuitem", { name: "个性", exact: true });
  await openPersonality.scrollIntoViewIfNeeded();
  await openPersonality.click();
  const personalitySheet = page.getByRole("dialog", { name: "个性" });
  await expect(personalitySheet).toContainText("调整语气和回复风格");
  await expect(personalitySheet.getByRole("button", { name: "务实" })).toBeVisible();
  await expect(personalitySheet.getByRole("button", { name: "亲和友善" })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-personality-menu.png`,
    animations: "disabled",
  });
  await personalitySheet.getByRole("button", { name: "关闭面板", exact: true }).click();
  await expect(personalitySheet).toHaveCount(0);
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "I",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
  });
  await expect(personalitySheet).toBeVisible();
  await personalitySheet.getByRole("button", { name: "关闭面板", exact: true }).click();
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const importAgents = page.getByRole("menuitem", { name: "从其他 AI 应用导入", exact: true });
  await importAgents.scrollIntoViewIfNeeded();
  await importAgents.click();
  await expect(page.getByText("未找到兼容的导入项")).toBeVisible();
  await expect(page.getByText("后摩智能找不到来自其他编程智能体的兼容数据")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-import-external-agent.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const openShortcuts = page.getByRole("menuitem", { name: "键盘快捷方式", exact: true });
  await openShortcuts.scrollIntoViewIfNeeded();
  await openShortcuts.click();
  const shortcutSheet = page.getByRole("dialog", { name: "键盘快捷方式" });
  await expect(shortcutSheet).toContainText("自定义键盘快捷键");
  await shortcutSheet.getByRole("textbox", { name: "搜索键盘快捷键" }).fill("个性");
  await expect(shortcutSheet.getByRole("button", { name: "为 个性 录入快捷键" })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-keyboard-shortcuts.png`,
    animations: "disabled",
  });
  await shortcutSheet.getByRole("button", { name: "为 个性 录入快捷键" }).click();
  await expect(shortcutSheet.getByRole("button", { name: "为 个性 录入快捷键" })).toHaveText(
    "按下新的组合键",
  );
  await shortcutSheet.getByRole("button", { name: "全部重置为默认值" }).click();
  await expect(page.getByText("无法保存快捷键偏好设置")).toBeVisible();
  await shortcutSheet.getByRole("button", { name: "关闭面板", exact: true }).click();
  await expect(shortcutSheet).toHaveCount(0);
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true }),
    );
  });
  await expect(shortcutSheet).toBeVisible();
  await shortcutSheet.getByRole("button", { name: "关闭面板", exact: true }).click();
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const showShortcuts = page.getByRole("menuitem", { name: "显示键盘快捷键", exact: true });
  await showShortcuts.scrollIntoViewIfNeeded();
  await showShortcuts.click();
  await expect(shortcutSheet).toBeVisible();
  await expect(shortcutSheet).toContainText("显示键盘快捷键");
  await page.screenshot({
    path: `${out}/control-show-keyboard-shortcuts.png`,
    animations: "disabled",
  });
  await shortcutSheet.getByRole("button", { name: "关闭面板", exact: true }).click();
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useSessionAttentionStore.ts";
    const module = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
    );
    const attention = module.useSessionAttentionStore.getState();
    attention.complete("codex", "ux-0", "clear-all");
    attention.complete("cc", "ux-0", "keep-cc");
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const clearUnreads = page.getByRole("menuitem", { name: "全部标为已读", exact: true });
  await clearUnreads.scrollIntoViewIfNeeded();
  await clearUnreads.click();
  await expect(page.getByText("已全部标为已读")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/session-mode/stores/useSessionAttentionStore.ts";
        const module = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path
        );
        return {
          codex: module.latestUnread(
            module.useSessionAttentionStore.getState().receipts["codex:ux-0"],
          ),
          cc: module.latestUnread(
            module.useSessionAttentionStore.getState().receipts["cc:ux-0"],
          ),
        };
      }),
    )
    .toEqual({ codex: null, cc: "keep-cc" });
  await page.screenshot({
    path: `${out}/control-clear-all-unreads.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const manageTasks = page.getByRole("menuitem", { name: "管理已安排任务", exact: true });
  await manageTasks.scrollIntoViewIfNeeded();
  await manageTasks.click();
  await expect(page).toHaveURL(/view=automations/);
  await expect(page.getByRole("heading", { name: "定时任务", exact: true })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-manage-tasks.png`,
    animations: "disabled",
  });
  await page.goto(`${page.url().replace(/view=automations/, "view=agent")}`);
  await expect(page.getByRole("tablist", { name: "关注会话" })).toBeVisible();
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const openSkills = page.getByRole("menuitem", { name: "前往技能", exact: true });
  await openSkills.scrollIntoViewIfNeeded();
  await openSkills.click();
  await expect(page).toHaveURL(/view=plugins/);
  await expect(page.getByRole("button", { name: "插件目录操作", exact: true })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-open-skills.png`,
    animations: "disabled",
  });
  await page.goto(`${page.url().replace(/view=plugins/, "view=agent")}`);
  await expect(page.getByRole("tablist", { name: "关注会话" })).toBeVisible();
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const reloadSkills = page.getByRole("menuitem", { name: "强制重新加载技能", exact: true });
  await reloadSkills.scrollIntoViewIfNeeded();
  await reloadSkills.click();
  await expect(page.getByText("无法刷新技能和应用")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-reload-skills.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const openFolder = page.getByRole("menuitem", { name: "打开文件夹…", exact: true });
  await openFolder.scrollIntoViewIfNeeded();
  await openFolder.click();
  await expect(page.getByRole("button", { name: "收起项目列表" })).toBeVisible();
  await page.screenshot({
    path: `${out}/control-open-folder.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "收起项目列表" }).click();
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const hideSidebar = page.getByRole("menuitem", { name: "显示/隐藏侧边栏", exact: true });
  await hideSidebar.scrollIntoViewIfNeeded();
  await hideSidebar.click();
  await expect(page.getByRole("button", { name: "收起项目列表" })).toBeVisible();
  await page.getByRole("button", { name: "当前会话的更多操作" }).click();
  const openFeedback = page.getByRole("menuitem", { name: "反馈", exact: true });
  await openFeedback.scrollIntoViewIfNeeded();
  await openFeedback.click();
  const feedbackDialog = page.getByRole("dialog", { name: "提交反馈" });
  await expect(feedbackDialog).toBeVisible();
  await page.screenshot({
    path: `${out}/control-feedback.png`,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  const tailCommands: Array<[string, RegExp]> = [
    ["显示/隐藏导航面板", /已(显示|隐藏)导航面板/],
    ["显示/隐藏底部面板", /已(显示|隐藏)底部面板/],
    ["显示/隐藏固定摘要", /当前没有可切换的置顶摘要/],
    ["打开终端", /已打开终端面板/],
    ["完整视图", /本机没有独立完整视图/],
    ["循环切换工作空间布局", /已(显示|隐藏)分屏/],
    ["打开“变更”选项卡", /已打开“变更”选项卡/],
    ["打开浏览器标签页", /本机没有应用内浏览器标签页/],
    ["转到行", /当前文件没有转到行|已聚焦转到行/],
    ["聚焦浏览器地址栏", /本机没有应用内浏览器地址栏/],
  ];
  for (const [label, result] of tailCommands) {
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        (node) => node.getAttribute("aria-label") === "当前会话的更多操作",
      );
      if (!(button instanceof HTMLButtonElement)) return;
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      button.click();
    });
    const item = page.getByRole("menuitem", { name: label, exact: true });
    await item.scrollIntoViewIfNeeded();
    await item.click();
    await expect(page.getByText(result).first()).toBeVisible();
    const file = label.replaceAll(/[“”/]/g, "");
    const shot = `${out}/control-tail-${file}.png`;
    await page.screenshot({
      path: shot,
      animations: "disabled",
    });
    console.log(`TAIL_COMMAND ${label} asserted ${result} shot ${shot}`);
  }
  const openTailMenu = async () => {
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        (node) => node.getAttribute("aria-label") === "当前会话的更多操作",
      );
      if (!(button instanceof HTMLButtonElement)) return;
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      button.click();
    });
  };
  const clickFind = async () => {
    await openTailMenu();
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find(
        (node) => node.textContent?.trim() === "查找",
      );
      if (item instanceof HTMLElement) item.click();
    });
  };
  const search = page.locator(".codex-thread-search");
  if (await search.count()) await clickFind();
  await clickFind();
  await expect(search).toHaveCount(1);
  await page.screenshot({
    path: `${out}/control-tail-find.png`,
    animations: "disabled",
  });
  console.log(`TAIL_COMMAND 查找 asserted .codex-thread-search shot ${out}/control-tail-find.png`);
  await page.keyboard.press("Escape");
  await openTailMenu();
  const logOut = page.getByRole("menuitem", { name: "退出登录", exact: true });
  await logOut.scrollIntoViewIfNeeded();
  await logOut.click();
  await expect(page).toHaveURL(/view=settings/);
  await expect(page.getByText("退出登录在设置里")).toBeVisible();
  await page.screenshot({
    path: `${out}/control-tail-logout.png`,
    animations: "disabled",
  });
  console.log(`TAIL_COMMAND 退出登录 asserted view=settings shot ${out}/control-tail-logout.png`);
  const settingsMenu = page.locator(".session-secondary-header").getByRole("button", {
    name: "当前会话的更多操作",
    exact: true,
  });
  const openSettingsMenu = async () => {
    await expect(page).toHaveURL(/view=settings|view=plugins/);
    await expect(settingsMenu).toBeVisible();
    await settingsMenu.click();
  };
  await expect(page).toHaveURL(/view=settings/);
  await openSettingsMenu();
  await page.getByRole("menuitem", { name: "前往技能", exact: true }).click();
  await expect(page).toHaveURL(/view=plugins/);
  await openSettingsMenu();
  await page.getByRole("menuitem", { name: "返回", exact: true }).click();
  await expect(page).toHaveURL(/view=settings/);
  const beforeForward = page.url();
  await openSettingsMenu();
  const goForward = page.getByRole("menuitem", { name: "前进", exact: true });
  await expect(goForward).toBeVisible();
  await goForward.click();
  await expect(page).toHaveURL(/view=plugins/);
  await expect.poll(() => page.url()).not.toBe(beforeForward);
  await page.screenshot({
    path: `${out}/control-tail-forward.png`,
    animations: "disabled",
  });
  console.log(`TAIL_COMMAND 前进 clicked getByRole menuitem while view=settings asserted url changed shot ${out}/control-tail-forward.png`);
  await openSettingsMenu();
  await page.getByRole("menuitem", { name: "返回", exact: true }).click();
  await expect(page).toHaveURL(/view=settings/);
  const beforeBack = page.url();
  await openSettingsMenu();
  const goBack = page.getByRole("menuitem", { name: "返回", exact: true });
  await expect(goBack).toBeVisible();
  await goBack.click();
  await expect(page).toHaveURL(/view=agent/);
  await expect.poll(() => page.url()).not.toBe(beforeBack);
  await page.screenshot({
    path: `${out}/control-tail-back.png`,
    animations: "disabled",
  });
  console.log(`TAIL_COMMAND 返回 clicked getByRole menuitem while view=settings asserted url changed shot ${out}/control-tail-back.png`);
  await page.goto("/?mode=session&view=agent");
  await expect(page.getByRole("tablist", { name: "关注会话" })).toBeVisible();
  await page.evaluate(() => {
    const grid = [...document.querySelectorAll("button")].find(
      (node) => node.getAttribute("aria-label") === "多会话网格",
    );
    if (grid instanceof HTMLButtonElement) grid.click();
  });
  await page.evaluate(() => {
    const composer = document.querySelector(".session-codex-composer");
    const add = [...(composer?.querySelectorAll("button") ?? [])].find(
      (node) => node.getAttribute("aria-label") === "附加文件",
    );
    if (add instanceof HTMLButtonElement) add.click();
  });
  await page.evaluate(() => {
    const expand = [...document.querySelectorAll("button")].find(
      (node) => node.textContent?.trim() === "展开编辑",
    );
    if (expand instanceof HTMLButtonElement) expand.click();
  });
  await expect(expanded).toBeVisible();
  await expanded.getByRole("button", { name: "插入代码块" }).click();
  const languageButton = expanded.getByRole("button", { name: "代码语言：自动检测" });
  await expect(languageButton).toBeVisible();
  await languageButton.click();
  const languageMenu = expanded.getByRole("listbox", { name: "代码语言" });
  await languageMenu.getByRole("textbox", { name: "搜索语言" }).fill("zzz");
  await expect(languageMenu.getByRole("status")).toHaveText("未找到语言");
  await shot("control-code-language");
  await languageMenu.getByRole("textbox", { name: "搜索语言" }).fill("rust");
  await languageMenu.getByRole("option", { name: "Rust", exact: true }).click();
  await expect(expanded.getByRole("button", { name: "代码语言：Rust" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(expanded).toHaveCount(0);
  await page.evaluate(() => {
    const button = document.querySelector(".session-global-new button");
    if (button instanceof HTMLButtonElement) button.click();
  });
  const branch = page.getByRole("button", { name: /^Git 分支：/ });
  await expect(branch).toHaveAttribute("title", "切换分支");
  await branch.evaluate((node) => {
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    (node as HTMLButtonElement).click();
  });
  await page.getByRole("menuitem", { name: "main" }).click();
  const dirty = page.getByRole("alertdialog", { name: "提交更改以切换分支" });
  await expect(dirty).toContainText("提交 2 个文件中的");
  await expect(dirty).toContainText("+6");
  await expect(dirty).toContainText("-3");
  await expect(dirty).toContainText("src/app.ts");
  await expect(dirty).toContainText("+4");
  await expect(dirty).toContainText("src/conflict.ts");
  await expect(dirty).toContainText("你对以下文件的更改将被检出操作覆盖");
  await expect(dirty).toContainText("main");
  await shot("control-branch-switch");
  await page.keyboard.press("Escape");
  await expect(dirty).toHaveCount(0);
  const createBranch = page.getByRole("menuitem", { name: "创建并检出新分支…" });
  await expect(createBranch).toBeDisabled();
  await expect(createBranch).toHaveAttribute("title", "提交更改以创建并检出新分支");
  await shot("control-branch-create");
  await page.keyboard.press("Escape");
  expect(
    fixture.calls.some((call) => call.path.endsWith("/git/checkout-branch")),
  ).toBe(false);

  const huge =
    "diff --git a/generated.ts b/generated.ts\n--- a/generated.ts\n+++ b/generated.ts\n@@ -1 +1 @@\n-" +
    "a".repeat(100_001) +
    "\n+short\n";
  await page.evaluate(
    async ({ huge }) => {
      const load = (path: string) =>
        import(
          path.startsWith("/node_modules/.vite/deps/")
            ? (window as any).__sessionFixtureDependency(path.split("/").at(-1))
            : (performance
                .getEntriesByType("resource")
                .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
              path)
        );
      const react = await load("/node_modules/.vite/deps/react.js");
      const dom = await load("/node_modules/.vite/deps/react-dom_client.js");
      const { DiffViewer } = await load("/src/session-mode/features/DiffViewer.tsx");
      const React = react.default ?? react;
      const { createRoot } = dom.default ?? dom;
      const host = document.createElement("div");
      host.id = "oversized-diff-fixture";
      host.className = "session-mode";
      host.style.cssText =
        "position:fixed;z-index:200;left:24px;bottom:24px;width:640px;background:var(--background)";
      document.querySelector(".session-mode")?.append(host);
      createRoot(host).render(
        React.createElement(DiffViewer, {
          native: true,
          presentation: "review",
          displayPath: "generated.ts",
          unifiedDiff: huge,
          isCollapsed: false,
          onOpenFile: () => {
            (window as any).__oversizedDiffOpened = "generated.ts";
          },
        }),
      );
    },
    { huge },
  );
  const oversized = page.locator("#oversized-diff-fixture");
  await expect(oversized.getByRole("status")).toContainText("此文件过大，无法在此显示。");
  await expect(oversized.getByText("a".repeat(40))).toHaveCount(0);
  await shot("control-diff-too-large");
  await oversized.getByRole("button", { name: "在编辑器中打开" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__oversizedDiffOpened)).toBe("generated.ts");
});
