import { expect, test, type Page } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";
import { composerAction, openComposerStatus } from "./session-composer-actions";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const editor = (page: Page) =>
  page.locator(".session-codex-composer [contenteditable=true]").first();
async function pasteImage(page: Page, count = 1) {
  await editor(page).evaluate(
    (el, { png, count }) => {
      const data = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      for (let i = 0; i < count; i++)
        transfer.items.add(
          new File([data], `布局图片-${i}.png`, { type: "image/png" }),
        );
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { png, count },
  );
}
async function fixedHeight(page: Page, expected: number) {
  await expect
    .poll(async () =>
      Math.abs(
        (await page
          .locator(".session-composer-target-container")
          .boundingBox())!.height - expected,
      ),
    )
    .toBeLessThanOrEqual(2);
}
async function nativeGeometry(page: Page) {
  const geometry = await page
    .locator(".session-native-composer .session-compact-frame")
    .first()
    .evaluate((el) => {
      const body = el.querySelector(".session-compact-body")!,
        toolbar = el.querySelector(".session-composer-bottom")!;
      const css = getComputedStyle(el),
        container = el.closest(".session-composer-width")!;
      return {
        width: container.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        autoHeight:
          body.getBoundingClientRect().height +
          toolbar.getBoundingClientRect().height +
          parseFloat(css.paddingTop) +
          parseFloat(css.paddingBottom) +
          parseFloat(css.rowGap) +
          parseFloat(css.borderTopWidth) +
          parseFloat(css.borderBottomWidth),
      };
    });
  if (geometry.width <= 480) expect(geometry.height).toBe(124);
  else
    expect(
      Math.abs(geometry.height - Math.max(98, geometry.autoHeight)),
    ).toBeLessThanOrEqual(1);
  return geometry;
}
async function identityPlacement(page: Page) {
  const surface = (await page
    .locator(".session-native-composer .session-compact-frame")
    .first()
    .boundingBox())!;
  const input = (await page.locator(".session-composer-editor").boundingBox())!;
  const identity = (await page
    .locator(".session-compact-meta")
    .first()
    .boundingBox())!;
  const container = (await page
    .locator(".session-composer-width")
    .boundingBox())!;
  if (container.width <= 840)
    expect(identity.y + identity.height).toBeLessThanOrEqual(surface.y);
  else expect(identity.y).toBeGreaterThanOrEqual(input.y + input.height);
}
async function setModelNotice(page: Page) {
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useThreadModelStore.ts";
    const { hydrateThreadModel, changeThreadModel } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    hydrateThreadModel("ux-0", {
      model: "gpt-6-astra",
      modelProvider: "openai",
      reasoningEffort: "high",
    });
    changeThreadModel("ux-0", {
      model: "gpt-6-luna",
      reasoningEffort: "medium",
    });
  });
}
for (const width of [375, 1440]) {
  test(`native input keeps mobile height and desktop autoheight for long text, images and state (${width}px)`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await setup(page, false);
    const frame = page.locator(".session-composer-target-container");
    const measurements: Record<string, number> = {};
    try {
      const before = (await frame.boundingBox())!.height;
      measurements.empty = before;
      let stable = before;
      await nativeGeometry(page);
      await editor(page).fill("请参考图片");
      const textHeight = (await frame.boundingBox())!.height;
      measurements.shortText = textHeight;
      await pasteImage(page);
      await expect(page.locator(".session-context-chip").first()).toBeVisible();
      await nativeGeometry(page);
      if (width === 375) await fixedHeight(page, stable);
      else
        expect((await frame.boundingBox())!.height).toBeGreaterThanOrEqual(
          textHeight,
        );
      stable = (await frame.boundingBox())!.height;
      measurements.oneImage = (await frame.boundingBox())!.height;
      await pasteImage(page, 7);
      await expect(page.locator(".session-context-chip")).toHaveCount(8);
      await expect
        .poll(() =>
          page.locator(".session-context-chip[data-state=ready]").count(),
        )
        .toBe(8);
      await fixedHeight(page, stable);
      measurements.eightImages = (await frame.boundingBox())!.height;
      const strip = page.locator(".session-context-strip.is-compact");
      expect(
        await strip.evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true);
      await strip.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      await expect(
        strip.getByRole("button", { name: "8 项", exact: true }),
      ).toBeInViewport();
      await editor(page).fill("正文内部滚动\n".repeat(12));
      await nativeGeometry(page);
      if (width === 375) await fixedHeight(page, before);
      else expect((await frame.boundingBox())!.height).toBeGreaterThan(stable);
      stable = (await frame.boundingBox())!.height;
      measurements.longText = (await frame.boundingBox())!.height;
      expect(
        await page
          .locator(".session-composer-editor")
          .evaluate((el) => el.scrollHeight > el.clientHeight),
      ).toBe(true);
      await setModelNotice(page);
      await expect(
        page.locator(".session-native-composer-status").first(),
      ).toContainText("模型已切换");
      await fixedHeight(page, stable);
      measurements.modelChange = (await frame.boundingBox())!.height;
      if (width === 375) expect(before).toBeLessThanOrEqual(150);
      if (width > 1024)
        expect((await frame.boundingBox())!.width).toBeGreaterThan(1000);
      const first = strip.getByRole("button", { name: /^预览 / }).first();
      await first.click();
      await expect(
        page.getByRole("dialog", { name: "附件与上下文", exact: true }),
      ).toBeVisible();
      await fixedHeight(page, stable);
      await page.getByRole("button", { name: "移除", exact: true }).click();
      await fixedHeight(page, stable);
      await page.getByRole("button", { name: "撤销", exact: true }).click();
      await expect(page.locator(".session-context-chip")).toHaveCount(8);
      await fixedHeight(page, stable);
      await composerAction(page, "展开编辑");
      await page
        .getByRole("button", { name: "纯文本模式", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "展开的消息草稿", exact: true }),
      ).toHaveValue("正文内部滚动\n".repeat(12));
      await page
        .getByRole("button", { name: "返回并保留草稿", exact: true })
        .click();
      await expect(editor(page)).toBeFocused();
      await fixedHeight(page, stable);
      await page.screenshot({
        path: `.dev-runtime/compact-composer-review/accepted-${width}.png`,
      });
      await info.attach("geometry", {
        body: JSON.stringify(measurements),
        contentType: "application/json",
      });
      expect(f.calls).toHaveLength(0);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
}

test("touch controls, agent label, owner states and narrow desktop pane stay within the frame", async ({
  browser,
}, info) => {
  test.setTimeout(90000);
  const metrics: Array<Record<string, number | boolean>> = [];
  for (const touch of [true, false]) {
    const context = await browser.newContext({
      viewport: { width: touch ? 375 : 1440, height: 900 },
      isMobile: touch,
      hasTouch: touch,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage(),
      f = await setup(page);
    try {
      await editor(page).fill("运行中的草稿");
      for (const width of touch
        ? [320, 360, 375, 390, 430]
        : [768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator(".session-target-agent")).toHaveText("Codex");
        const frame = (await page
          .locator(".session-compact-frame")
          .first()
          .boundingBox())!;
        const container = (await page
          .locator(".session-composer-width")
          .boundingBox())!;
        const coarse = await page.evaluate(
          () => matchMedia("(pointer: coarse)").matches,
        );
        expect(coarse).toBe(touch);
        const controls = await page
          .locator(".session-native-composer .session-composer-toolbar button")
          .evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              return { left: r.left, right: r.right, w: r.width, h: r.height };
            }),
          );
        for (const control of controls) {
          expect(control.left).toBeGreaterThanOrEqual(frame.x);
          expect(control.right).toBeLessThanOrEqual(frame.x + frame.width);
          expect(control.h).toBeGreaterThanOrEqual(
            coarse || container.width <= 480 ? 44 : 28,
          );
          if (coarse || container.width <= 480)
            expect(control.w).toBeGreaterThanOrEqual(44);
        }
        const model = (await page
          .locator(".session-native-model-trigger")
          .first()
          .boundingBox())!;
        for (const right of await page
          .locator(".session-native-model-label, .session-native-model-effort")
          .evaluateAll((els) =>
            els.map((el) => el.getBoundingClientRect().right),
          ))
          expect(right).toBeLessThanOrEqual(model.x + model.width);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await nativeGeometry(page);
        await identityPlacement(page);
        metrics.push({
          viewport: width,
          width: frame.width,
          height: frame.height,
          coarse,
        });
        await page.screenshot({
          path: `.dev-runtime/compact-composer-review/accepted-running-${width}.png`,
        });
      }
      const initial = (await page
        .locator(".session-composer-target-container")
        .boundingBox())!.height;
      await page.evaluate(async () => {
        const module = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
        const [{ changeThreadModel }, { goalDrafts }, { activeDraftOwner }] =
          await Promise.all([
            module("/src/session-mode/stores/useThreadModelStore.ts"),
            module("/src/session-mode/components/codex/composer/goalDrafts.ts"),
            module("/src/session-mode/stores/useInputStore.ts"),
          ]);
        changeThreadModel("ux-0", { collaborationMode: "plan" });
        goalDrafts.set(activeDraftOwner(), true);
      });
      await expect(
        page.locator(".session-native-composer-status").first(),
      ).toHaveText("规划模式");
      await fixedHeight(page, initial);
      await openComposerStatus(page);
      await expect(
        page.getByRole("button", { name: "取消规划模式", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "取消目标草稿", exact: true }),
      ).toBeVisible();
      await fixedHeight(page, initial);
      await page.getByRole("button", { name: "关闭面板", exact: true }).click();
      await page.evaluate(async () => {
        const path = "/src/session-mode/components/codex/composer/v2/drafts.ts";
        const { useComposerDraftStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
        useComposerDraftStore.setState({ error: "测试磁盘空间不足" });
      });
      await expect(
        page.locator(".session-native-composer-status[role=alert]"),
      ).toContainText("上下文保存失败");
      await expect(
        page.getByRole("button", { name: "排队消息", exact: true }),
      ).toBeDisabled();
      await fixedHeight(page, initial);
      await openComposerStatus(page);
      await expect(
        page.getByRole("alert").filter({ hasText: "测试磁盘空间不足" }).last(),
      ).toBeVisible();
      await page.getByRole("button", { name: "关闭面板", exact: true }).click();
      await page.locator(".session-composer-width").evaluate((el) => {
        (el as HTMLElement).style.width = "360px";
      });
      await nativeGeometry(page);
      const pane = (await page
        .locator(".session-compact-frame")
        .first()
        .boundingBox())!;
      expect(pane.width).toBeLessThanOrEqual(360);
      expect(pane.height).toBe(124);
      const send = (await page
        .getByRole("button", { name: "排队消息", exact: true })
        .boundingBox())!;
      expect(send.x + send.width).toBeLessThanOrEqual(pane.x + pane.width);
      await page.screenshot({
        path: `.dev-runtime/compact-composer-review/accepted-narrow-pane-${touch ? "touch" : "desktop"}.png`,
      });
      expect(f.calls).toHaveLength(0);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
      await context.close();
    }
  }
  await info.attach("width-matrix", {
    body: JSON.stringify(metrics),
    contentType: "application/json",
  });
});

test("slow upload, upload failure and retry reserve the same geometry and keep sending blocked", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  const f = await setup(page, false);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let retry = false;
  await page.route("**/files/upload", async (r) => {
    if (!retry) {
      await held;
      await r.fulfill({ status: 500, json: { error: "测试上传失败" } });
    } else await r.fulfill({ json: { path: "/fixture/retried.png" } });
  });
  try {
    const before = (await page
      .locator(".session-composer-target-container")
      .boundingBox())!.height;
    await editor(page).fill("上传时保留草稿");
    await pasteImage(page);
    await expect(
      page.locator(".session-context-chip[data-state=uploading]"),
    ).toBeVisible();
    await fixedHeight(page, before);
    await expect(
      page.locator(".session-native-composer-status[role=status]"),
    ).toContainText("正在上传");
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeDisabled();
    release();
    await expect(
      page.locator(".session-context-chip[data-state=error]"),
    ).toBeVisible();
    await expect(
      page.locator(".session-native-composer-status[role=alert]"),
    ).toContainText("图片上传失败");
    await fixedHeight(page, before);
    await page.getByRole("button", { name: /预览 .*上传失败/ }).click();
    await expect(
      page.getByRole("button", { name: "重试上传", exact: true }),
    ).toBeVisible();
    retry = true;
    await page.getByRole("button", { name: "重试上传", exact: true }).click();
    await expect(
      page.locator(".session-context-chip[data-state=ready]"),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "关闭面板", exact: true }).click();
    await fixedHeight(page, before);
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeEnabled();
    await expect(editor(page)).toHaveText("上传时保留草稿");
    expect(f.calls).toHaveLength(0);
    expect(f.errors).toEqual([]);
  } finally {
    release();
    await f.close();
  }
});

test("visual acceptance captures both themes, left thumbnails, direct utilities and floating queue actions", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const f = await setup(page);
  let imageBytes = "";
  await page.route("**/api/filesystem/asset?**", (r) =>
    r.fulfill({
      contentType: "image/png",
      body: Buffer.from(imageBytes || png, "base64"),
    }),
  );
  try {
    await page.evaluate(async () => {
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
    });
    imageBytes = await editor(page).evaluate(async (el) => {
      const c = document.createElement("canvas");
      c.width = 240;
      c.height = 160;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#283a48";
      ctx.fillRect(0, 0, 240, 160);
      ctx.fillStyle = "#d9c49a";
      ctx.fillRect(16, 18, 74, 7);
      ctx.fillStyle = "#96b6c4";
      for (let i = 0; i < 4; i++)
        ctx.fillRect(16, 48 + i * 20, 170 - i * 20, 6);
      const blob = await new Promise<Blob>((resolve) =>
        c.toBlob((b) => resolve(b!), "image/png"),
      );
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([blob], "布局参考.png", { type: "image/png" }),
      );
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
      return c.toDataURL("image/png").split(",")[1];
    });
    await expect(
      page.locator(".session-context-chip[data-state=ready]"),
    ).toHaveCount(1);
    await editor(page).fill("请按图片调整布局，保留常用按钮。");
    for (const theme of ["dark", "light"]) {
      await page.evaluate((theme) => {
        const root = document.querySelector(".session-mode")!;
        root.classList.toggle("dark", theme === "dark");
      }, theme);
      for (const width of [320, 375, 430, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const e = (await page
          .locator(".session-composer-editor")
          .boundingBox())!;
        const a = (await page
          .locator(".session-context-strip.is-compact")
          .boundingBox())!;
        expect(a.x + a.width).toBeLessThanOrEqual(e.x);
        await expect(
          page.getByRole("button", { name: "展开编辑", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "当前会话的更多操作", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "输入状态与消息队列", exact: true }),
        ).toBeVisible();
        const path = `.dev-runtime/compact-composer-review/visual-${theme}-${width}.png`;
        await page.screenshot({ path });
        await info.attach(`${theme}-${width}`, {
          path,
          contentType: "image/png",
        });
      }
    }
    await page.setViewportSize({ width: 375, height: 900 });
    const before = (await page
      .locator(".session-composer-target-container")
      .boundingBox())!.height;
    (f.fixture.threads[0] as any).turns[0].items.push({
      type: "agentMessage",
      id: "glass-check",
      text: "版面检查：输入区大小稳定，常用按钮保持直接可见。\n\n".repeat(16),
      phase: "commentary",
    });
    await page.evaluate(async () => {
      const path = "/src/session-mode/components/codex/stores/index.ts";
      const { useCodexStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
      useCodexStore.getState().addEvent("ux-0", {
        method: "item/completed",
        params: {
          threadId: "ux-0",
          turnId: "initial-turn",
          item: {
            type: "agentMessage",
            id: "glass-check",
            phase: "commentary",
            text: "版面检查：输入区大小稳定，常用按钮保持直接可见。\n\n".repeat(
              16,
            ),
          },
        },
      });
    });
    await page.getByRole("button", { name: "排队消息", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "立即引导", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "排队消息 1 的更多操作", exact: true })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "删除消息", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await fixedHeight(page, before);
    expect(
      (await page
        .locator(".session-composer-floating .session-queue-shelf")
        .boundingBox())!.height,
    ).toBeLessThanOrEqual(56);
    expect(
      await page
        .locator(".session-composer-floating .session-queue-shelf")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toContain("0.78");
    const floating = (await page
      .locator(".session-composer-floating")
      .first()
      .boundingBox())!;
    const frame = (await page
      .locator(".session-compact-frame")
      .first()
      .boundingBox())!;
    expect(floating.y + floating.height).toBeLessThanOrEqual(frame.y);
    await editor(page).fill("这一轮的补充仍可继续输入");
    await setModelNotice(page);
    await fixedHeight(page, before);
    await expect(page.locator(".session-followup-images img")).toHaveJSProperty(
      "naturalWidth",
      240,
    );
    const path =
      ".dev-runtime/compact-composer-review/visual-floating-queue.png";
    await page.screenshot({ path });
    await info.attach("floating-actions", { path, contentType: "image/png" });
    expect(f.calls).toHaveLength(0);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

for (const width of [375, 1440])
  test(`thumbnail delete remains direct, images are larger and identity follows native placement (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await setup(page, false);
    try {
      await editor(page).fill("不要移除正文");
      const textHeight = (await page
        .locator(".session-composer-target-container")
        .boundingBox())!.height;
      await pasteImage(page);
      const image = page.locator(".session-context-chip.is-image img");
      const b = (await image.boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(width < 768 ? 80 : 64);
      expect(b.height).toBeGreaterThanOrEqual(60);
      await nativeGeometry(page);
      await identityPlacement(page);
      const imageHeight = (await page
        .locator(".session-composer-target-container")
        .boundingBox())!.height;
      await page
        .getByRole("button", { name: "移除 布局图片-0.png", exact: true })
        .click();
      await expect(page.locator(".session-context-chip.is-image")).toHaveCount(
        0,
      );
      await fixedHeight(page, textHeight);
      await page.getByRole("button", { name: "撤销", exact: true }).click();
      await expect(page.locator(".session-context-chip.is-image")).toHaveCount(
        1,
      );
      await expect(editor(page)).toHaveText("不要移除正文");
      await fixedHeight(page, imageHeight);
      expect(f.calls).toHaveLength(0);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
