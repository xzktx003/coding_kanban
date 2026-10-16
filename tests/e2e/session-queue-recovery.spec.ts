import { test, expect } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";
import { FollowupRejected } from "../../apps/server/src/services/codex-followups";

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 393, height: 852 },
]) {
  test(`occupied queue recovery preserves content and never resumes blindly at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    let access = "external";
    const mutations: any[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        new URL(req.url()).pathname.endsWith("/followups/change")
      )
        mutations.push(req.postDataJSON());
    });
    const f = await setup(page, false, async () => {
      await page.route(
        "**/api/session/api/codex/thread/access",
        async (route) => {
          expect(route.request().postDataJSON().release).not.toBe(true);
          await route.fulfill({
            json: { state: access, reason: "", generation: 1 },
          });
        },
      );
    });
    try {
      const original = {
        id: "occupied-message",
        threadId: "ux-0",
        text: "你好，保留这条消息",
        images: [],
        mode: "queue" as const,
        parameters: {
          model: "captured",
          cwd: "/project/original",
          effort: "high",
        },
      };
      f.fail(
        new FollowupRejected("SESSION_OWNED_ELSEWHERE: 其他客户端正在使用"),
      );
      await f.queue.submit(original);
      await f.queue.tick();
      await expect(
        page.getByRole("button", { name: "处理失败消息", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("由于你中断了当前响应，队列已暂停", { exact: true }),
      ).toHaveCount(0);
      const retry = page.getByRole("button", { name: "重试", exact: true });
      await expect(retry).toBeDisabled();
      const editor = page
        .locator(".session-composer-editor [contenteditable=true]")
        .first();
      await editor.fill("独立的新草稿");
      await page
        .getByRole("button", { name: "排队消息操作 1", exact: true })
        .click();
      await expect(
        page.getByRole("menuitem", { name: "继续", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("menuitem", { name: /尝试重新发送/ }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      expect(mutations).toEqual([]);
      await page
        .getByRole("button", { name: "处理失败消息", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByText(original.text, { exact: true }),
      ).toBeVisible();
      await expect(dialog.getByText(/会话被其他客户端占用/)).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "重试", exact: true }),
      ).toBeDisabled();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      expect(overflow).toBe(false);
      const screenshot = testInfo.outputPath("occupied-queue.png");
      await page.screenshot({ path: screenshot });
      await testInfo.attach("occupied-queue", {
        path: screenshot,
        contentType: "image/png",
      });
      await dialog
        .getByRole("button", { name: "关闭面板", exact: true })
        .click();
      await expect(editor).toHaveText("独立的新草稿");
      access = "readonly";
      f.fail();
      await page.getByRole("button", { name: "重新核对", exact: true }).click();
      await expect(retry).toBeEnabled();
      expect((await f.queue.get("ux-0")).items[0].status).toBe("failed");
      expect(mutations).toEqual([]);
      await retry.click();
      await expect
        .poll(async () => (await f.queue.get("ux-0")).items[0].status)
        .toBe("queued");
      await f.queue.tick();
      await f.queue.tick();
      const sent = (await f.queue.get("ux-0")).items[0];
      expect(sent.status).toBe("sent");
      expect(sent.id).toBe(original.id);
      expect(sent.parameters).toEqual(original.parameters);
      expect(mutations.map((m) => m.action)).toEqual([
        { type: "retry", id: original.id },
      ]);
      expect(
        f.calls.filter((call) => call.method === "turn/start"),
      ).toHaveLength(2); // one rejected attempt and one accepted retry
      await expect(editor).toHaveText("独立的新草稿");
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
}

test("uncertain delivery requires confirmation before retry and ordinary pause can resume", async ({
  page,
}) => {
  const f = await setup(page, false);
  try {
    f.fail(new Error("response lost"));
    await f.queue.submit({
      id: "unknown-message",
      threadId: "ux-0",
      text: "核对后再发送",
      images: [],
      mode: "queue",
      parameters: {},
    });
    await f.queue.tick();
    await expect(
      page.getByRole("button", { name: "核对送达状态", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "确认消息未送达？" }),
    ).toBeVisible();
    expect((await f.queue.get("ux-0")).items[0].status).toBe("uncertain");
    f.fail();
    await page
      .getByRole("button", { name: "确认未送达并重试", exact: true })
      .click();
    await expect
      .poll(async () => (await f.queue.get("ux-0")).items[0].status)
      .toBe("queued");
    const current = await f.queue.get("ux-0");
    await f.queue.change("ux-0", current.revision, { type: "pause" });
    await expect(page.getByText("队列已暂停", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await expect
      .poll(async () => (await f.queue.get("ux-0")).paused)
      .toBeNull();
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("removing a failed item remains available during external ownership and never resends it", async ({
  page,
}) => {
  let access = "external";
  const f = await setup(page, false, async () => {
    await page.route("**/api/session/api/codex/thread/access", (route) =>
      route.fulfill({ json: { state: access, reason: "", generation: 1 } }),
    );
  });
  try {
    f.fail(new FollowupRejected("SESSION_OWNED_ELSEWHERE"));
    await f.queue.submit({
      id: "remove-failed",
      threadId: "ux-0",
      text: "不再发送这条",
      images: [],
      mode: "queue",
      parameters: {},
    });
    await f.queue.tick();
    await expect(
      page.getByRole("button", { name: "处理失败消息", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "删除排队的消息", exact: true })
      .click();
    await expect
      .poll(async () => (await f.queue.get("ux-0")).items[0].status)
      .toBe("cancelled");
    await expect(
      page.getByRole("button", { name: "继续", exact: true }),
    ).toBeDisabled();
    access = "readonly";
    await page.getByRole("button", { name: "重新核对", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "继续", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await expect
      .poll(async () => (await f.queue.get("ux-0")).paused)
      .toBeNull();
    await f.queue.tick();
    expect(f.calls).toHaveLength(1);
    expect((await f.queue.get("ux-0")).items[0].status).toBe("cancelled");
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
