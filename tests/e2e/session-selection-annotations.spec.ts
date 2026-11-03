import { expect, test, type Page } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

async function selectText(page: Page, text: string, streaming = false) {
  const body = page
    .locator(
      streaming
        ? ".codex-assistant[data-streaming] .codex-assistant-content"
        : ".codex-assistant:not([data-streaming]) .codex-assistant-content",
    )
    .filter({ hasText: text })
    .first();
  await expect(body).toBeVisible({ timeout: 45_000 });
  await body.evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const start = node.textContent?.indexOf(text) ?? -1;
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }
    throw new Error("fixture selection text not found");
  }, text);
}

async function dragSelectText(page: Page, text: string) {
  const body = page
    .locator(".codex-assistant:not([data-streaming]) .codex-assistant-content")
    .filter({ hasText: text })
    .first();
  await expect(body).toBeVisible({ timeout: 45_000 });
  const points = await body.evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const start = node.textContent?.indexOf(text) ?? -1;
      if (start < 0) continue;
      const first = document.createRange(),
        last = document.createRange();
      first.setStart(node, start);
      first.setEnd(node, start + 1);
      last.setStart(node, start + text.length - 1);
      last.setEnd(node, start + text.length);
      const a = first.getBoundingClientRect(),
        b = last.getBoundingClientRect();
      return {
        x1: a.left + 1,
        y1: a.top + a.height / 2,
        x2: b.right - 1,
        y2: b.top + b.height / 2,
      };
    }
    throw new Error("fixture selection text not found");
  }, text);
  await page.mouse.move(points.x1, points.y1);
  await page.mouse.down();
  await page.mouse.move(points.x2, points.y2, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe(text);
}

test("selected response comments survive reload and are frozen in the real followup queue", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const fixture = await setup(page, true, async (data) => {
    const turn = data.threads[0].turns[0];
    turn.status = "completed";
    turn.items.find((item) => item.type === "agentMessage")!.phase =
      "final_answer";
    turn.completedAt = Math.floor(Date.now() / 1000);
    data.threads[0].turns.push({
      id: "active-after-reply",
      status: "inProgress",
      startedAt: Math.floor(Date.now() / 1000),
      items: [],
    });
  });
  try {
    await dragSelectText(page, "状态恢复");
    await expect(
      page.getByRole("button", { name: "添加到对话", exact: true }),
    ).toBeVisible();
    await page
      .locator(".codex-assistant-content")
      .first()
      .evaluate((element) =>
        element
          .closest('[data-slot="scroll-area-viewport"]')
          ?.dispatchEvent(new Event("scroll")),
      );
    await expect(
      page.getByRole("button", { name: "添加到对话", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "添加到对话", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "选区批注" })).toBeVisible();
    await expect(
      page.locator(".session-reference-actions").first(),
    ).toHaveAttribute("data-selection", "false");
    await expect(page.getByRole("button", { name: /Add todo/ })).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "选区评论" })
      .fill("请解释这里的恢复机制\n以及失败时的处理");
    await page.screenshot({ path: info.outputPath("response-annotation.png") });
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await expect(page.getByRole("button", { name: "编辑批注 1" })).toBeVisible({
      timeout: 45_000,
    });
    await selectText(page, "事件同步");
    await page.getByRole("button", { name: "添加到对话", exact: true }).click();
    await page.getByRole("textbox", { name: "选区评论" }).fill("解释事件处理");
    await page
      .locator(".codex-assistant-content")
      .first()
      .evaluate((element) =>
        element
          .closest('[data-slot="scroll-area-viewport"]')
          ?.dispatchEvent(new Event("scroll")),
      );
    await expect(page.getByRole("textbox", { name: "选区评论" })).toHaveValue(
      "解释事件处理",
    );
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "编辑批注 2" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "编辑批注 1" })).toBeVisible({
      timeout: 45_000,
    });
    await expect(
      page.getByRole("button", { name: "编辑批注 2" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "编辑批注 1" }).click();
    await expect(page.getByRole("textbox", { name: "选区评论" })).toHaveValue(
      "请解释这里的恢复机制\n以及失败时的处理",
    );
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await page.getByRole("tab", { name: /中文会话 1/ }).click();
    await expect(page.locator(".session-codex-composer")).toHaveAttribute(
      "data-owner-thread",
      "ux-1",
    );
    await expect(page.locator(".session-context-chip")).toHaveCount(0);
    await page.getByRole("tab", { name: /中文会话 0/ }).click();
    await expect(page.locator(".session-codex-composer")).toHaveAttribute(
      "data-owner-thread",
      "ux-0",
    );
    await expect(page.getByRole("button", { name: "编辑批注 1" })).toBeVisible({
      timeout: 45_000,
    });
    await page.getByRole("button", { name: "加入队列", exact: true }).click();
    await expect
      .poll(async () => (await fixture.queue.get("ux-0")).items.length)
      .toBe(1);
    const item = (await fixture.queue.get("ux-0")).items[0];
    expect(item.contexts).toHaveLength(2);
    expect(item.contexts?.[0]).toMatchObject({
      kind: "quote",
      sourceThreadId: "ux-0",
      sourceItemId: "preview-agent",
      text: "所选文本：\n状态恢复\n\n用户评论：\n请解释这里的恢复机制\n以及失败时的处理",
    });
    expect(item.contexts?.[0]).not.toHaveProperty("annotation");
    expect(item.contexts?.[0]).not.toHaveProperty("responseSelection");
    expect(item.contexts?.[1]?.text).toBe(
      "所选文本：\n事件同步\n\n用户评论：\n解释事件处理",
    );
    await fixture.event("turn/completed", "initial-turn", "completed");
    await fixture.queue.tick();
    expect(
      fixture.calls.find((call) => call.method === "turn/start")?.params
        .input[0].text,
    ).toContain("请解释这里的恢复机制\n以及失败时的处理");
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("a selection and its comment stay attached while the response continues", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await setup(page);
  try {
    await expect(page.locator(".thread-surface")).toBeVisible({
      timeout: 45_000,
    });
    const emit = (delta: string) =>
      page.evaluate(
        async ({ url, delta }) => {
          const { useCodexStore } = await import(url);
          useCodexStore.getState().setStreamingAgentDeltas("ux-0", [
            {
              method: "item/agentMessage/delta",
              params: {
                threadId: "ux-0",
                turnId: "initial-turn",
                itemId: "live-selection",
                delta,
              },
            },
          ]);
        },
        { url: fixture.storeUrl(), delta },
      );
    await emit("先检查 **关键路径**，再继续。");
    await selectText(page, "关键路径", true);
    await page.getByRole("button", { name: "添加到对话", exact: true }).click();
    await page
      .getByRole("textbox", { name: "选区评论" })
      .fill("请解释这个路径");
    await emit("后续内容正在输出。");
    await expect(page.getByRole("textbox", { name: "选区评论" })).toHaveValue(
      "请解释这个路径",
    );
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "编辑批注 1" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "加入队列", exact: true }).click();
    await expect
      .poll(async () => (await fixture.queue.get("ux-0")).items.length)
      .toBe(1);
    expect(
      (await fixture.queue.get("ux-0")).items[0].contexts?.[0],
    ).toMatchObject({
      sourceItemId: "live-selection",
      text: "所选文本：\n关键路径\n\n用户评论：\n请解释这个路径",
    });
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("the response annotation editor stays inside a narrow light viewport", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.addInitScript(() =>
    localStorage.setItem(
      "kanban.session.theme-storage",
      JSON.stringify({
        state: {
          theme: "light",
          accent: "default",
          starfield: false,
          backgroundImage: null,
        },
        version: 1,
      }),
    ),
  );
  const fixture = await setup(page, true, async (data) => {
    const turn = data.threads[0].turns[0];
    turn.status = "completed";
    turn.items.find((item) => item.type === "agentMessage")!.phase =
      "final_answer";
    turn.completedAt = Math.floor(Date.now() / 1000);
    data.threads[0].turns.push({
      id: "active-after-reply",
      status: "inProgress",
      startedAt: Math.floor(Date.now() / 1000),
      items: [],
    });
  });
  try {
    await expect(page.locator(".session-mode")).toHaveClass(/\blight\b/);
    await selectText(page, "状态恢复");
    await page.getByRole("button", { name: "添加到对话", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "选区批注" });
    await expect(editor).toBeVisible();
    const bounds = await editor.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(393);
    await page
      .getByRole("textbox", { name: "选区评论" })
      .fill("手机上继续补充");
    await page.screenshot({ path: info.outputPath("mobile-annotation.png") });
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "编辑批注 1" })).toBeVisible({
      timeout: 45_000,
    });
  } finally {
    await fixture.close();
  }
});

test("file editor adds the selected code and its comment to the captured session", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const fixture = await setup(page);
  try {
    const root = fixture.fixture.threads[0].cwd;
    const filePath = `${root}/src/selection.ts`;
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
          content: "const chosen = 42;\nconst second = chosen;\n",
          version: "fixture-version",
          size: 42,
        },
      }),
    );
    await page.evaluate(
      async ({ root, filePath }) => {
        const module = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
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
    await expect(ace).toBeVisible({ timeout: 45_000 });
    await ace.evaluate((element: any) => {
      element.env.editor.focus();
      element.env.editor.clearSelection();
      element.env.editor.selectAll();
    });
    const toolbar = page.locator("[data-floating-selection-toolbar]");
    await toolbar.getByRole("button", { name: "评论", exact: true }).click();
    await toolbar
      .getByRole("textbox", { name: "代码选区评论" })
      .fill("请分析这段代码");
    const bounds = await toolbar.evaluate((element) => {
      const popup = element.getBoundingClientRect(),
        parent = element.parentElement!.getBoundingClientRect();
      return {
        popupLeft: popup.left,
        popupRight: popup.right,
        parentLeft: parent.left,
        parentRight: parent.right,
      };
    });
    expect(bounds.popupLeft).toBeGreaterThanOrEqual(bounds.parentLeft);
    expect(bounds.popupRight).toBeLessThanOrEqual(bounds.parentRight);
    await page.screenshot({ path: info.outputPath("file-annotation.png") });
    await page.getByRole("tab", { name: /中文会话 1/ }).click();
    await expect(page.locator(".session-codex-composer")).toHaveAttribute(
      "data-owner-thread",
      "ux-1",
    );
    await expect(page.locator(".session-context-chip")).toHaveCount(0);
    await page.getByRole("tab", { name: /中文会话 0/ }).click();
    await expect(page.locator(".session-codex-composer")).toHaveAttribute(
      "data-owner-thread",
      "ux-0",
    );
    await expect(page.locator(".session-context-chip")).toHaveCount(1);
    await page.locator(".session-context-chip button").first().click();
    await expect(
      page.getByRole("textbox", { name: "给所选内容添加评论" }),
    ).toHaveValue("请分析这段代码");
    await page.route("**/api/filesystem/read-text-file", (route) =>
      route.fulfill({ json: "const chosen = 43;\nconst second = chosen;\n" }),
    );
    await page.getByRole("button", { name: "检查源文件更新" }).click();
    await expect(page.getByRole("button", { name: "更新为最新内容" })).toBeVisible();
    await page
      .getByRole("textbox", { name: "给所选内容添加评论" })
      .fill("请检查这段代码的边界");
    await page.getByRole("button", { name: "更新为最新内容" }).click();
    await expect(
      page.getByRole("textbox", { name: "给所选内容添加评论" }),
    ).toHaveValue("请检查这段代码的边界");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "加入队列", exact: true }).click();
    await expect
      .poll(async () => (await fixture.queue.get("ux-0")).items.length)
      .toBe(1);
    const item = (await fixture.queue.get("ux-0")).items[0];
    expect(item.contexts?.[0]).toMatchObject({
      kind: "file",
      path: filePath,
      range: { start: 1, end: 2 },
      text: expect.stringContaining("请检查这段代码的边界"),
    });
    expect(item.contexts?.[0]?.text).toContain("const chosen = 43;");
    expect(item.contexts?.[0]).not.toHaveProperty("annotation");
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
