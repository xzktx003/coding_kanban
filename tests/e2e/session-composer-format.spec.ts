import { test, expect } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";
import { seedSessionUx } from "./session-ux-fixture";

// The isolated workbench fixture loads hundreds of Vite modules. Geometry and
// interaction expectations keep their ordinary bounds once it is ready.
test.describe.configure({ timeout: 90_000 });

for (const width of [1440, 390]) {
  test(`selection formatting keeps the composer stable and usable (${width})`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await setup(page, false);
    try {
      const editor = page
        .locator(".session-composer-editor [contenteditable=true]")
        .first();
      const frame = page
        .locator(".session-codex-composer .session-compact-frame")
        .first();
      await editor.fill(
        "检查选中文字时的工具栏\n保留第二行内容\n保留第三行内容",
      );
      const before = (await frame.boundingBox())!;
      await editor.press("ControlOrMeta+A");
      const toolbar = page.getByRole("toolbar", { name: "文本格式" });
      await expect(toolbar).toBeVisible();
      await expect(toolbar).toHaveCSS("opacity", "1");
      const selected = (await frame.boundingBox())!;
      for (const key of ["x", "y", "width", "height"] as const) {
        expect(
          Math.abs(selected[key] - before[key]),
          `frame ${key}`,
        ).toBeLessThanOrEqual(1);
      }
      const inputBox = (await editor.boundingBox())!;
      const toolbarBox = (await toolbar.boundingBox())!;
      expect(inputBox.height).toBeGreaterThan(0);
      const selection = await editor.evaluate((element) => {
        const range = element.ownerDocument.getSelection()?.getRangeAt(0);
        const rect = range?.getBoundingClientRect();
        return (
          rect && {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          }
        );
      });
      expect(selection).toBeTruthy();
      expect(
        toolbarBox.y + toolbarBox.height <= selection!.y + 1 ||
          toolbarBox.y >= selection!.y + selection!.height - 1 ||
          toolbarBox.x + toolbarBox.width <= selection!.x + 1 ||
          toolbarBox.x >= selection!.x + selection!.width - 1,
      ).toBe(true);
      expect(toolbarBox.x).toBeGreaterThanOrEqual(0);
      expect(toolbarBox.y).toBeGreaterThanOrEqual(0);
      expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(width);
      expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(900);
      expect(
        Math.min(
          Math.abs(toolbarBox.y + toolbarBox.height - selection!.y),
          Math.abs(toolbarBox.y - selection!.y - selection!.height),
        ),
      ).toBeLessThanOrEqual(16);
      await expect
        .poll(() =>
          toolbar.evaluate((el) => {
            const button = el.querySelector("button")!;
            const rect = button.getBoundingClientRect();
            return button.contains(
              document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              ),
            );
          }),
        )
        .toBe(true);
      await page.screenshot({ path: info.outputPath("selected-draft.png") });
      await toolbar.getByRole("button", { name: "粗体", exact: true }).click();
      await expect(editor).toHaveText(
        "**检查选中文字时的工具栏\n保留第二行内容\n保留第三行内容**",
      );
      await expect(toolbar).toHaveCount(0);
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
}

test("partial selection survives link editing without submitting the composer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await setup(page, false);
  const submissions: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/followups/submit"))
      submissions.push(request.url());
  });
  try {
    const editor = page
      .locator(".session-composer-editor [contenteditable=true]")
      .first();
    await editor.fill("alpha beta");
    await editor.press("Home");
    for (let i = 0; i < 5; i++) await editor.press("Shift+ArrowRight");
    await expect
      .poll(() => page.evaluate(() => document.getSelection()?.toString()))
      .toBe("alpha");
    const toolbar = page.getByRole("toolbar", { name: "文本格式" });
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "链接", exact: true }).click();
    const url = toolbar.getByRole("textbox", { name: "链接地址" });
    await url.fill("ftp://example.test");
    await toolbar.getByRole("button", { name: "应用", exact: true }).click();
    await expect(toolbar.getByRole("alert")).toHaveText(
      "输入 HTTP 或 HTTPS 链接",
    );
    await url.fill("https://example.test/reference");
    await url.press("Enter");
    await expect(editor).toHaveText(
      "[alpha](https://example.test/reference) beta",
    );
    await expect(toolbar).toHaveCount(0);
    expect(submissions).toEqual([]);
    expect(fixture.calls).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("keyboard users can enter the selection toolbar, apply a format and return to the draft", async ({
  page,
}) => {
  const fixture = await setup(page, false);
  try {
    const editor = page
      .locator(".session-composer-editor [contenteditable=true]")
      .first();
    await editor.fill("keyboard format");
    await editor.press("Home");
    for (let i = 0; i < 8; i++) await editor.press("Shift+ArrowRight");
    const toolbar = page.getByRole("toolbar", { name: "文本格式" });
    const bold = toolbar.getByRole("button", { name: "粗体", exact: true });
    await expect(toolbar).toBeVisible();
    await editor.press("Tab");
    await expect(bold).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(editor).toBeFocused();
    await expect(toolbar).toBeVisible();
    await editor.press("Tab");
    await expect(bold).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(editor).toHaveText("**keyboard** format");
    await expect(editor).toBeFocused();
    await editor.press("ControlOrMeta+A");
    await expect(toolbar).toBeVisible();
    await editor.press("Tab");
    await expect(bold).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(toolbar).toHaveCount(0);
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText("**keyboard** format");
    expect(fixture.calls).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("a replaced draft invalidates a link editor and its captured selection", async ({
  page,
}) => {
  const fixture = await setup(page, false);
  try {
    const editor = page
      .locator(".session-composer-editor [contenteditable=true]")
      .first();
    await editor.fill("old draft");
    await editor.press("ControlOrMeta+A");
    const toolbar = page.getByRole("toolbar", { name: "文本格式" });
    await toolbar.getByRole("button", { name: "链接", exact: true }).click();
    const url = toolbar.getByRole("textbox", { name: "链接地址" });
    await url.fill("https://example.test");
    await page.evaluate(async () => {
      const path = "/src/session-mode/stores/useSessionDraftStore.ts";
      const source =
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path;
      const { useSessionDraftStore, sessionDraftKey } = await import(source);
      useSessionDraftStore
        .getState()
        .setText(sessionDraftKey("codex", "ux-0"), "newer draft");
    });
    await expect(editor).toHaveText("newer draft");
    await expect(toolbar).toHaveCount(0);
    expect(fixture.calls).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("the floating toolbar follows a visible selection when the draft scrolls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await setup(page, false);
  try {
    const frame = page
      .locator(".session-codex-composer .session-compact-frame")
      .first();
    const editor = frame.locator("[contenteditable=true]").first();
    const scroller = frame.locator(".session-composer-editor");
    const lines = Array.from(
      { length: 30 },
      (_, index) => `draft line ${String(index).padStart(2, "0")}`,
    );
    await editor.fill(lines.join("\n"));
    await expect
      .poll(() =>
        scroller.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);
    await scroller.evaluate((element) => {
      element.scrollTop = 200;
    });
    const offset = lines.slice(0, 12).join("\n").length + 1;
    await editor.evaluate((element, start) => {
      element.focus();
      const node = document
        .createTreeWalker(element, NodeFilter.SHOW_TEXT)
        .nextNode()!;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 5);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    }, offset);
    const toolbar = page.getByRole("toolbar", { name: "文本格式" });
    await expect(toolbar).toBeVisible();
    const before = (await toolbar.boundingBox())!;
    const beforeSelection = await editor.evaluate(
      (element) =>
        element.ownerDocument
          .getSelection()!
          .getRangeAt(0)
          .getBoundingClientRect().y,
    );
    const beforeScroll = await scroller.evaluate(
      (element) => element.scrollTop,
    );
    await scroller.evaluate((element) => {
      element.scrollTop += 20;
    });
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(beforeScroll);
    await expect
      .poll(() =>
        editor.evaluate(
          (element) =>
            element.ownerDocument
              .getSelection()!
              .getRangeAt(0)
              .getBoundingClientRect().y,
        ),
      )
      .toBeLessThan(beforeSelection - 10);
    await expect
      .poll(async () => {
        const selection = await editor.evaluate(
          (element) =>
            element.ownerDocument
              .getSelection()!
              .getRangeAt(0)
              .getBoundingClientRect().y,
        );
        const box = (await toolbar.boundingBox())!;
        return Math.abs(box.y - before.y - (selection - beforeSelection));
      })
      .toBeLessThanOrEqual(2);
    await expect(editor).toContainText("draft line 12");
    expect(fixture.calls).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("a pointer selection and composition keep the draft and toolbar lifecycle independent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await setup(page, false);
  try {
    const editor = page
      .locator(".session-composer-editor [contenteditable=true]")
      .first();
    await editor.fill("alpha beta gamma");
    const bounds = await editor.evaluate((element) => {
      const text = document
        .createTreeWalker(element, NodeFilter.SHOW_TEXT)
        .nextNode()!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 5);
      const rect = range.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        y: rect.top + rect.height / 2,
      };
    });
    await page.mouse.move(bounds.left + 1, bounds.y);
    await page.mouse.down();
    await page.mouse.move(bounds.right - 1, bounds.y, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => document.getSelection()?.toString()))
      .toBe("alpha");
    const toolbar = page.getByRole("toolbar", { name: "文本格式" });
    await expect(toolbar).toBeVisible();
    await editor.evaluate((element) =>
      element.dispatchEvent(
        new CompositionEvent("compositionstart", {
          bubbles: true,
          data: "中文",
        }),
      ),
    );
    await expect(toolbar).toHaveCount(0);
    // Lexical replaces the selected range when composition starts, even for a
    // synthetic composition with no committed characters.
    const composingText = await editor.textContent();
    await editor.evaluate((element) =>
      element.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "中文" }),
      ),
    );
    await expect(editor).toHaveText(composingText ?? "");
    expect(composingText).toContain(" beta gamma");
    expect(fixture.calls).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("format tools leave the DOM when the agent view becomes hidden", async ({
  page,
}) => {
  const fixture = await setup(page, false);
  try {
    const editor = page
      .locator(".session-composer-editor [contenteditable=true]")
      .first();
    await editor.fill("保留选中的草稿");
    await editor.press("ControlOrMeta+A");
    const toolbar = page.getByRole("toolbar", { name: "文本格式" });
    await expect(toolbar).toBeVisible();
    await page.evaluate(async () => {
      const path = "/src/session-mode/stores/useLayoutStore.ts";
      const url =
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path;
      const { useLayoutStore } = await import(url);
      useLayoutStore.setState({ view: "plugins" });
    });
    await expect(toolbar).toHaveCount(0);
    expect(fixture.calls).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("IME composition never submits the draft and explicit send keeps its text", async ({
  page,
}) => {
  const fixture = await setup(page, false);
  const submissions: Array<{ threadId?: string; text?: string }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/followups/submit"))
      submissions.push(request.postDataJSON());
  });
  try {
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    await editor.fill("输入法完成后的草稿");
    await editor.evaluate((element) => {
      element.dispatchEvent(
        new CompositionEvent("compositionstart", {
          bubbles: true,
          data: "中文",
        }),
      );
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 229,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      element.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "Enter",
          code: "Enter",
          keyCode: 229,
          isComposing: true,
          bubbles: true,
        }),
      );
      element.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "中文" }),
      );
    });
    await expect(editor).toHaveText("输入法完成后的草稿");
    expect(submissions).toEqual([]);
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(1);
    expect(submissions[0]).toMatchObject({
      threadId: "ux-0",
      text: "输入法完成后的草稿",
    });
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("switching sessions closes the toolbar and preserves both drafts", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await setup(page, false);
  try {
    await seedSessionUx(page, 2);
    for (const index of [0, 1]) {
      await page
        .locator(".session-nav-row[role=button]")
        .filter({ hasText: `中文会话 ${index} ` })
        .first()
        .click();
    }
    await page.locator('[role="tab"][data-tab-key="codex:ux-0"]').click();
    const editor = page
      .locator(".session-composer-editor [contenteditable=true]")
      .first();
    const toolbar = page.getByRole("toolbar", { name: "文本格式" });
    await editor.fill("会话 A 的未发送草稿");
    await editor.press("ControlOrMeta+A");
    await expect(toolbar).toBeVisible();
    await page.locator('[role="tab"][data-tab-key="codex:ux-1"]').click();
    await expect(toolbar).toHaveCount(0);
    await expect(editor).toHaveText("");
    await editor.fill("会话 B 的未发送草稿");
    await page.locator('[role="tab"][data-tab-key="codex:ux-0"]').click();
    await expect(editor).toHaveText("会话 A 的未发送草稿");
    await expect(toolbar).toHaveCount(0);
    await page.locator('[role="tab"][data-tab-key="codex:ux-1"]').click();
    await expect(editor).toHaveText("会话 B 的未发送草稿");
    expect(fixture.calls).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("window blur closes the floating selection tools without changing the draft", async ({
  page,
}) => {
  const fixture = await setup(page, false);
  try {
    const editor = page
      .locator(".session-composer-editor [contenteditable=true]")
      .first();
    await editor.fill("失焦后保留草稿");
    await editor.press("ControlOrMeta+A");
    const toolbar = page.getByRole("toolbar", { name: "文本格式" });
    await expect(toolbar).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(toolbar).toHaveCount(0);
    await expect(editor).toHaveText("失焦后保留草稿");
    expect(fixture.calls).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test.describe("touch selection", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("keeps the fixed frame and applies formatting by touch", async ({
    page,
  }) => {
    const fixture = await setup(page, false);
    try {
      const frame = page
        .locator(".session-codex-composer .session-compact-frame")
        .first();
      const editor = frame.locator("[contenteditable=true]").first();
      await editor.fill("手机输入草稿");
      const before = (await frame.boundingBox())!;
      await editor.press("ControlOrMeta+A");
      const toolbar = page.getByRole("toolbar", { name: "文本格式" });
      await expect(toolbar).toBeVisible();
      const after = (await frame.boundingBox())!;
      expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
      const box = (await toolbar.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      await page.setViewportSize({ width: 390, height: 600 });
      await expect
        .poll(async () => {
          const adjusted = (await toolbar.boundingBox())!;
          return adjusted.y >= 0 && adjusted.y + adjusted.height <= 600;
        })
        .toBe(true);
      await toolbar.getByRole("button", { name: "粗体", exact: true }).tap();
      await expect(editor).toHaveText("**手机输入草稿**");
      expect(fixture.calls).toEqual([]);
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
});
