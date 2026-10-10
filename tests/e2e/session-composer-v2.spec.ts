import { test, expect, type Page } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";
import { composerAction, openComposerStatus } from "./session-composer-actions";
const editor = (page: Page) =>
  page.locator(".session-composer-editor [contenteditable=true]").first();
async function paste(page: Page, text: string) {
  await editor(page).evaluate((el, text) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", text);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

test("large paste and selected reply survive reload, freeze in queue, and undo preserves configuration", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    const logs = "完整日志\n".repeat(50) + "最后一行不要丢失";
    await editor(page).fill("原问题");
    await paste(page, logs);
    await expect(
      page.getByRole("button", { name: /粘贴的文本.*行/ }).first(),
    ).toBeVisible();
    await expect(editor(page)).toHaveText("原问题");
    await page
      .getByText(
        "我会检查状态恢复与事件同步，并保留正在运行的会话和未发送草稿。",
        { exact: true },
      )
      .evaluate((el) => {
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let n: Node | null;
        while ((n = walk.nextNode())) {
          const at = (n.textContent ?? "").indexOf("状态恢复");
          if (at >= 0) {
            const r = document.createRange();
            r.setStart(n, at);
            r.setEnd(n, at + 4);
            const selection = getSelection()!;
            selection.removeAllRanges();
            selection.addRange(r);
            document.dispatchEvent(new Event("selectionchange"));
            break;
          }
        }
      });
    await page
      .getByRole("button", { name: "引用选区", exact: true })
      .first()
      .click();
    await page.reload();
    await expect(editor(page)).toHaveText("原问题");
    await expect(page.locator(".session-context-chip")).toHaveCount(2);
    await page.getByRole("button", { name: "排队消息", exact: true }).click();
    await expect
      .poll(async () => (await f.queue.get("ux-0")).items.length)
      .toBe(1);
    const before = (await f.queue.get("ux-0")).items[0];
    expect(before.contexts?.map((x) => x.text)).toContain(logs);
    expect(before.contexts?.find((x) => x.kind === "quote")?.text).toBe(
      "状态恢复",
    );
    await openComposerStatus(page);
    await expect(page.getByLabel("入队时的发送配置")).toContainText(
      "使用入队时的配置",
    );
    await page
      .getByRole("button", { name: "删除排队消息", exact: true })
      .click();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect
      .poll(async () => (await f.queue.get("ux-0")).items[0].status)
      .toBe("queued");
    expect((await f.queue.get("ux-0")).items[0].contexts).toEqual(
      before.contexts,
    );
    expect((await f.queue.get("ux-0")).items[0].parameters).toEqual(
      before.parameters,
    );
    await f.event("turn/completed", "initial-turn", "completed");
    await f.queue.tick();
    expect(
      f.calls.find((c) => c.method === "turn/start")?.params.input[0].text,
    ).toContain(logs);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("expanded code editing keeps content across modes, close and reload", async ({
  page,
}, info) => {
  const f = await setup(page);
  try {
    let value = "原需求\n\n```typescript\nconst x = 1;\n```\n最后一段";
    await editor(page).fill(value);
    await composerAction(page, "展开编辑");
    await expect(page.locator(".session-draft-code")).toBeVisible();
    await page.locator(".ace_editor").first().click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("const changed = 2;");
    value = value.replace("const x = 1;", "const changed = 2;");
    await page.getByRole("button", { name: "纯文本模式", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "展开的消息草稿", exact: true }),
    ).toHaveValue(value);
    await page
      .getByRole("textbox", { name: "展开的消息草稿", exact: true })
      .fill(value + "\n追加");
    await page.screenshot({
      path: info.outputPath("expanded-code-editing.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "返回并保留草稿", exact: true })
      .click();
    await expect(editor(page)).toHaveText(value + "\n追加", {
      useInnerText: true,
    });
    await page.reload();
    await expect(editor(page)).toHaveText(value + "\n追加", {
      useInnerText: true,
    });
    expect(f.calls).toHaveLength(0);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("file mention captures content, detects source changes and restores paste without replacing draft", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    let source = "const fileSnapshot = 1;";
    await page.route("**/api/session/api/filesystem/search-files", (r) =>
      r.fulfill({
        json: [
          { name: "example.ts", path: "/fixture/example.ts", isDir: false },
        ],
      }),
    );
    await page.route("**/api/session/api/filesystem/read-text-file", (r) =>
      r.fulfill({ json: source }),
    );
    await editor(page).fill("@example");
    await page
      .getByRole("option")
      .filter({ hasText: "example.ts" })
      .first()
      .click();
    await page.getByRole("button", { name: /example.ts.*文件快照/ }).click();
    await expect(page.locator(".session-context-preview")).toHaveText(source);
    source = "const fileSnapshot = 2;";
    await page
      .getByRole("button", { name: "检查源文件更新", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "源文件已变化" }),
    ).toBeVisible();
    await expect(page.locator(".session-context-preview")).toContainText("= 1");
    await page
      .getByRole("button", { name: "更新为最新内容", exact: true })
      .click();
    await expect(page.locator(".session-context-preview")).toHaveText(source);
    await page.getByRole("button", { name: "关闭面板", exact: true }).click();
    await editor(page).fill("已有正文");
    await editor(page).press("End");
    await paste(page, "长文本\n".repeat(45));
    await page.getByRole("button", { name: /粘贴的文本.*行/ }).click();
    await page
      .getByRole("button", { name: "还原到输入框", exact: true })
      .click();
    await expect(editor(page)).toContainText("已有正文");
    await expect(editor(page)).toContainText("长文本");
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("sketch exports a real PNG, restores editable marks and keeps original image data", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    let uploads: Buffer[] = [];
    await page.route("**/files/upload", async (r) => {
      uploads.push(Buffer.from(r.request().postDataJSON().data, "base64"));
      await r.fulfill({ json: { path: "/fixture/drawing.png" } });
    });
    await page
      .getByRole("button", { name: "添加附件与上下文", exact: true })
      .click();
    await page.getByRole("button", { name: "画草图", exact: true }).click();
    const canvas = page.getByRole("img", { name: "绘图画布", exact: true });
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 100, { steps: 8 });
    await page.mouse.up();
    await expect(
      page.getByRole("button", { name: "撤销上一笔", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "撤销上一笔", exact: true }).click();
    await page.getByRole("button", { name: "重做上一笔", exact: true }).click();
    await page
      .getByRole("button", { name: "返回并保留草稿", exact: true })
      .click();
    await page
      .getByRole("button", { name: "添加附件与上下文", exact: true })
      .click();
    await page.getByRole("button", { name: "画草图", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "撤销上一笔", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "完成并附加", exact: true }).click();
    await expect.poll(() => uploads.length).toBe(1);
    expect(
      uploads[0].includes(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    ).toBe(true);
    await expect(page.locator(".session-context-chip")).toContainText(
      "草图.png",
    );
    await page.reload();
    await page
      .getByRole("button", { name: /草图.png/ })
      .first()
      .click();
    await page.getByRole("button", { name: "标注图片", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "撤销上一笔", exact: true }),
    ).toBeEnabled();
    expect(f.calls).toHaveLength(0);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("mobile viewport, soft keyboard and full editor keep strength and controls accessible", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const f = await setup(page);
  try {
    await editor(page).fill("手机草稿");
    await editor(page).press("Enter");
    await editor(page).pressSequentially("继续输入");
    await expect(editor(page)).toContainText("手机草稿");
    expect(f.calls).toHaveLength(0);
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 812 });
      const layout = await page
        .locator(".session-codex-composer")
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          return {
            right: r.right,
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
          };
        });
      expect(layout.scroll).toBeLessThanOrEqual(layout.width);
      expect(layout.right).toBeLessThanOrEqual(layout.width);
      const controls = await page
        .locator(".session-composer-toolbar button")
        .evaluateAll((es) =>
          es
            .filter((e) => e.getBoundingClientRect().width > 0)
            .map((e) => ({
              w: e.getBoundingClientRect().width,
              h: e.getBoundingClientRect().height,
              right: e.getBoundingClientRect().right,
            })),
        );
      for (const c of controls) {
        expect(c.h).toBeGreaterThanOrEqual(44);
        expect(c.right).toBeLessThanOrEqual(width);
      }
      await expect(page.locator(".session-model-effort").first()).toBeVisible();
    }
    await page.setViewportSize({ width: 844, height: 390 });
    const landscapeSend = (await page
      .getByRole("button", { name: "排队消息", exact: true })
      .boundingBox())!;
    expect(landscapeSend.y + landscapeSend.height).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 390, height: 844 });
    await composerAction(page, "展开编辑");
    await expect(page.getByRole("dialog", { name: "展开编辑" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog", { name: "展开编辑" })).toHaveCount(0);
    await expect(editor(page)).toContainText("手机草稿");
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
    await context.close();
  }
});

test("settings commands preserve draft and do not start a turn", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await editor(page).fill("保留这个需求");
    await page
      .getByRole("button", { name: "添加附件与上下文", exact: true })
      .click();
    await page.getByRole("button", { name: "快捷命令", exact: true }).click();
    await page
      .getByRole("textbox", { name: "搜索快捷命令", exact: true })
      .fill("/plan");
    await page.getByRole("button", { name: /\/plan/ }).click();
    await expect(editor(page)).toHaveText("保留这个需求");
    await expect(page.locator(".session-compact-status").first()).toHaveText(
      "规划模式",
    );
    await openComposerStatus(page);
    await expect(
      page.getByRole("button", { name: "取消规划模式", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭面板", exact: true }).click();
    await editor(page).fill("保留这个需求 /effort");
    await page.getByRole("option").filter({ hasText: "/effort" }).click();
    await expect(
      page.getByRole("dialog", { name: "模型与思考强度", exact: true }),
    ).toBeVisible();
    expect(f.calls).toHaveLength(0);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("image annotation keeps original pixels, remains editable and supports attachment undo", async ({
  page,
}, info) => {
  const f = await setup(page);
  try {
    const uploads: string[] = [];
    await page.route("**/files/upload", async (r) => {
      uploads.push(r.request().postDataJSON().data);
      await r.fulfill({
        json: { path: `/fixture/image-${uploads.length}.png` },
      });
    });
    await editor(page).evaluate(async (el) => {
      const c = document.createElement("canvas");
      c.width = 200;
      c.height = 160;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#336699";
      ctx.fillRect(0, 0, 200, 160);
      const blob = await new Promise<Blob>((r) =>
        c.toBlob((b) => r(b!), "image/png"),
      );
      const data = new DataTransfer();
      data.items.add(new File([blob], "original.png", { type: "image/png" }));
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect.poll(() => uploads.length).toBe(1);
    await page
      .getByRole("button", { name: /original.png/ })
      .first()
      .click();
    await page.getByRole("button", { name: "标注图片", exact: true }).click();
    const canvas = page.getByRole("img", { name: "绘图画布", exact: true });
    await expect(
      page.getByRole("button", { name: "完成并附加", exact: true }),
    ).toBeEnabled();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, {
      steps: 5,
    });
    await page.mouse.up();
    await page.getByRole("button", { name: "批注", exact: true }).click();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
    await page
      .getByRole("textbox", { name: "说明文字", exact: true })
      .fill("检查布局\n保留强度");
    await page.getByRole("button", { name: "添加文字", exact: true }).click();
    await expect(
      page
        .locator(".session-drawing-canvas text")
        .filter({ hasText: "检查布局" }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("annotation-original-image.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "完成并附加", exact: true }).click();
    await expect.poll(() => uploads.length).toBe(2);
    const pixels = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const c = document.createElement("canvas");
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      return {
        w: image.width,
        h: image.height,
        corner: [...ctx.getImageData(0, 0, 1, 1).data],
        center: [...ctx.getImageData(100, 80, 1, 1).data],
      };
    }, uploads[1]);
    expect(pixels).toMatchObject({
      w: 200,
      h: 160,
      corner: [51, 102, 153, 255],
    });
    expect(pixels.center).not.toEqual(pixels.corner);
    await page
      .getByRole("button", { name: /标注图片.png/ })
      .first()
      .click();
    await page.getByRole("button", { name: "移除", exact: true }).click();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.reload();
    await page
      .getByRole("button", { name: /标注图片.png/ })
      .first()
      .click();
    await page.getByRole("button", { name: "标注图片", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "撤销上一笔", exact: true }),
    ).toBeEnabled();
    const href = await page
      .locator(".session-drawing-canvas image")
      .getAttribute("href");
    expect(href).toMatch(/^blob:/);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("mobile pinch does not leave an accidental stroke and simulated keyboard keeps send visible", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage(),
    f = await setup(page);
  try {
    await page
      .getByRole("button", { name: "添加附件与上下文", exact: true })
      .click();
    await page.getByRole("button", { name: "画草图", exact: true }).click();
    const bounds = (await page
      .getByRole("dialog", { name: "画草图", exact: true })
      .boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
    const box = (await page
      .getByRole("img", { name: "绘图画布", exact: true })
      .boundingBox())!;
    const client = await context.newCDPSession(page),
      y = box.y + box.height / 2,
      x = box.x + box.width / 2;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 1, x: x - 30, y },
        { id: 2, x: x + 30, y },
      ],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { id: 1, x: x - 60, y },
        { id: 2, x: x + 60, y },
      ],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(
      page.getByRole("button", { name: "200% · 复位视图", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "撤销上一笔", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "返回并保留草稿", exact: true })
      .click();
    await editor(page).fill("键盘弹出后的草稿");
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, "height", {
        configurable: true,
        value: 500,
      });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect(page.locator(".session-mode")).toHaveClass(
      /session-keyboard-open/,
    );
    const send = (await page
      .getByRole("button", { name: "排队消息", exact: true })
      .boundingBox())!;
    expect(send.y + send.height).toBeLessThanOrEqual(500);
    await page.screenshot({
      path: "docs/designs/composer-v2/acceptance-mobile-keyboard.png",
    });
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
    await context.close();
  }
});

test("queue edit undo is reachable inside the dialog and retains the original context", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await editor(page).fill("第一条");
    await page.getByRole("button", { name: "排队消息", exact: true }).click();
    await editor(page).fill("第二条");
    await page.getByRole("button", { name: "排队消息", exact: true }).click();
    await openComposerStatus(page);
    const dialog = page.getByRole("dialog", { name: "输入状态与消息队列" });
    await dialog
      .getByRole("button", { name: "排队消息 1 的更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "编辑消息", exact: true }).click();
    await page
      .getByRole("textbox", { name: "编辑排队消息", exact: true })
      .fill("修改后");
    await page.getByRole("button", { name: "保存消息", exact: true }).click();
    await dialog.getByRole("button", { name: "撤销", exact: true }).click();
    await expect
      .poll(async () => (await f.queue.get("ux-0")).items[0].text)
      .toBe("第一条");
  } finally {
    await f.close();
  }
});

test("desktop and phone acceptance captures keep attachments and nested panels within the viewport", async ({
  page,
}) => {
  test.setTimeout(60000);
  const f = await setup(page);
  try {
    await page.evaluate(async (url) => {
      const { useConfigStore } = await import(url);
      useConfigStore.setState({
        sandbox: "danger-full-access",
        approvalPolicy: "never",
      });
      // Existing conversations own their model; global settings apply to new chats.
      const path = "/src/session-mode/stores/useThreadModelStore.ts";
      const { hydrateThreadModel } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
      hydrateThreadModel("ux-0", {
        model: "gpt-6-astra",
        modelProvider: "openai",
        reasoningEffort: "high",
      });
    }, f.storeUrl());
    await editor(page).fill("请按引用和截图优化输入栏，保留模型与思考强度。");
    await paste(page, "浏览器布局日志\n".repeat(48));
    await page
      .locator(".session-message-actions")
      .first()
      .locator("..")
      .hover();
    await page
      .getByRole("button", { name: "引用", exact: true })
      .first()
      .click();
    const dismiss = page.locator("[data-sonner-toast] [data-close-button]");
    if (await dismiss.count()) await dismiss.first().click();
    for (const width of [1440, 768, 430, 390, 375, 360, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator(".session-model-effort").first()).toContainText(
        "High",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `docs/designs/composer-v2/acceptance-${width}.png`,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await composerAction(page, "展开编辑");
    const expanded = page.getByRole("dialog", {
      name: "展开编辑",
      exact: true,
    });
    await expanded.getByRole("button", { name: /粘贴的文本.*行/ }).click();
    const preview = page.getByRole("dialog", {
      name: "粘贴的文本",
      exact: true,
    });
    await expect(preview).toBeVisible();
    let b = (await preview.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(390);
    expect(b.y + b.height).toBeLessThanOrEqual(844);
    await page.goBack();
    await expect(preview).toHaveCount(0);
    await expect(expanded).toBeVisible();
    await page.screenshot({
      path: "docs/designs/composer-v2/acceptance-expanded-phone.png",
    });
    await page
      .getByRole("button", { name: "返回并保留草稿", exact: true })
      .click();
    await page
      .getByRole("button", { name: "添加附件与上下文", exact: true })
      .click();
    await page.getByRole("button", { name: "画草图", exact: true }).click();
    await page.screenshot({
      path: "docs/designs/composer-v2/acceptance-drawing-phone.png",
    });
    await page
      .getByRole("button", { name: "返回并保留草稿", exact: true })
      .click();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(
      page.getByRole("button", { name: "排队消息", exact: true }),
    ).toBeVisible();
    const send = (await page
      .getByRole("button", { name: "排队消息", exact: true })
      .boundingBox())!;
    expect(send.y + send.height).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: "docs/designs/composer-v2/acceptance-landscape.png",
    });
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
