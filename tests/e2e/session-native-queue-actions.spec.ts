import { expect, test, type Page } from "@playwright/test";
import Fastify from "../../apps/server/node_modules/fastify/fastify.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSessionFollowupRoutes } from "../../apps/server/src/routes/session-followups.ts";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

async function nativeQueueFixture() {
  const home = await mkdtemp(join(tmpdir(), "native-queue-http-")),
    app = Fastify({ forceCloseConnections: true });
  const state = {
    items: [
      {
        id: "original",
        clientUserMessageId: "external",
        input: [{ type: "text", text: "保存的排队消息" }],
      },
    ] as any[],
    loseNextEditResponse: false,
    closing: false,
  };
  const calls: Array<{ method: string; params: any }> = [];
  const context = async () => ({
    scope: "fixture-current-scope",
    namespace: "private-fixture-history-domain",
  });
  const call = async (method: string, params: any): Promise<any> => {
    calls.push({ method, params });
    if (method === "thread/queue/list")
      return { data: state.items, nextCursor: null };
    if (method === "thread/read")
      return {
        thread: {
          id: params.threadId,
          status: { type: "idle" },
          canAcceptDirectInput: true,
        },
      };
    if (method === "thread/turns/list") return { data: [], nextCursor: null };
    if (method === "thread/goal/get") return { goal: null };
    if (method === "thread/queue/delete") {
      state.items = state.items.filter(
        (row) => row.id !== params.queuedSubmissionId,
      );
      return {};
    }
    if (method === "thread/queue/update") {
      const row = state.items.find(
        (row) => row.id === params.queuedSubmissionId,
      );
      if (!row) throw new Error("queue item missing");
      row.input = params.input;
      return {};
    }
    if (method === "thread/queue/add") {
      const row = {
        id: `added-${calls.length}`,
        clientUserMessageId: params.clientUserMessageId,
        input: params.input,
      };
      state.items.push(row);
      return { queuedSubmission: row };
    }
    if (method === "thread/queue/reorder") {
      state.items = params.queuedSubmissionIds.map((id: string) =>
        state.items.find((row) => row.id === id),
      );
      return {};
    }
    if (method === "thread/queue/start" || method === "thread/settings/update")
      return {};
    throw new Error(`Unexpected native fixture method: ${method}`);
  };
  registerSessionFollowupRoutes(app, {
    file: join(home, "followups.json"),
    origin: () => null,
    nativeQueue: true,
    autoStart: false,
    runtime: {
      call,
      context,
      guardedCall: async (method, params, expected) => {
        expect(expected).toBe((await context()).scope);
        return call(method, params);
      },
      statuses: async () => ({ "ux-0": "idle" }),
    },
  });
  app.get("/api/session/lifecycle/context", async () => ({
    scopeToken: (await context()).scope,
    namespace: (await context()).namespace,
  }));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  return {
    state,
    calls,
    origin,
    async close() {
      state.closing = true;
      await app.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}
async function setup(
  page: Page,
  fixture: Awaited<ReturnType<typeof nativeQueueFixture>>,
) {
  await installSessionUxFixture(page, 1);
  await page.route("**/api/session/lifecycle/context", async (route) =>
    route.fulfill({
      response: await route.fetch({
        url: fixture.origin + new URL(route.request().url()).pathname,
      }),
    }),
  );
  await page.route("**/api/session/followups**", async (route) => {
    if (fixture.state.closing) return route.abort("aborted");
    const url = new URL(route.request().url());
    let response;
    try {
      response = await route.fetch({
        url: fixture.origin + url.pathname + url.search,
      });
    } catch (error) {
      if (fixture.state.closing) {
        await route.abort("aborted").catch(() => {});
        return;
      }
      throw error;
    }
    if (
      fixture.state.loseNextEditResponse &&
      route.request().method() === "POST" &&
      url.pathname.endsWith("/change") &&
      route.request().postDataJSON().action.type === "edit"
    ) {
      fixture.state.loseNextEditResponse = false;
      await route.abort("connectionfailed");
      return;
    }
    await route.fulfill({ response });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toBeVisible();
  await seedSessionUx(page, 1);
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useAgentCenterStore.ts";
    const { useAgentCenterStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((row) => new URL(row.name).pathname === path)?.name ?? path
    );
    useAgentCenterStore.getState().addAgentCard(
      {
        kind: "codex",
        id: "ux-0",
        cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
        preview: "Native queue actions",
      },
      { activate: true },
    );
  });
  await expect(
    page.getByRole("button", { name: "排队消息操作 1", exact: true }).first(),
  ).toBeVisible();
}
async function edit(page: Page, text: string) {
  await page
    .getByRole("button", { name: "排队消息操作 1", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "编辑消息", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "编辑排队消息",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await editor.fill(text);
  await page.getByRole("button", { name: "保存消息", exact: true }).click();
}
for (const width of [1440, 393]) {
  test(`last native queue deletion keeps an explicit undo confirmation after rail exits at ${width}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(75_000);
    await page.setViewportSize({ width, height: 852 });
    const fixture = await nativeQueueFixture();
    try {
      await setup(page, fixture);
      await page
        .locator(".session-codex-composer [contenteditable=true]")
        .first()
        .fill("保留这份未发送草稿");
      const direct = page
        .getByRole("button", { name: "删除排队的消息" })
        .first();
      if (await direct.isVisible()) await direct.click();
      else {
        await page
          .getByRole("button", { name: "排队消息操作 1", exact: true })
          .first()
          .click();
        await page
          .getByRole("menuitem", { name: "删除消息", exact: true })
          .click();
      }
      await expect
        .poll(
          () =>
            fixture.calls.filter((row) => row.method === "thread/queue/delete")
              .length,
        )
        .toBe(1);
      await expect(
        page.getByRole("status").filter({ hasText: "已删除排队消息" }),
      ).toBeVisible();
      // Wait for the real 150ms rail exit; the toast remains an independent action owner.
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: "撤销", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "恢复保存的排队消息？" });
      await expect(dialog).toBeVisible();
      expect(
        fixture.calls.filter((row) => row.method === "thread/queue/add"),
      ).toHaveLength(0);
      await expect(dialog).toContainText("空闲时会立即执行");
      await dialog
        .getByRole("button", { name: "确认加入队列并执行", exact: true })
        .click();
      await expect
        .poll(
          () =>
            fixture.calls.filter((row) => row.method === "thread/queue/add")
              .length,
        )
        .toBe(1);
      await expect(dialog).not.toBeVisible();
      await expect(
        page.locator(".session-codex-composer [contenteditable=true]").first(),
      ).toHaveText("保留这份未发送草稿");
      await testInfo.attach("native-queue-http-evidence", {
        body: JSON.stringify({
          width,
          calls: fixture.calls.filter(
            (row) => row.method !== "thread/queue/list",
          ),
          state: fixture.state,
        }),
        contentType: "application/json",
      });
    } finally {
      await fixture.close();
    }
  });
}
test("a real HTTP edit with a lost browser ACK is reconciled after refresh and from a second page without another native mutation", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const fixture = await nativeQueueFixture();
  try {
    await setup(page, fixture);
    fixture.state.loseNextEditResponse = true;
    await edit(page, "服务端已接受但浏览器回执丢失");
    await expect
      .poll(
        () =>
          fixture.calls.filter((row) => row.method === "thread/queue/update")
            .length,
      )
      .toBe(1);
    await expect(
      page.getByRole("textbox", { name: "编辑排队消息", exact: true }),
    ).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.locator(".session-codex-composer [contenteditable=true]").first(),
    ).toBeVisible();
    await seedSessionUx(page, 1);
    await page.evaluate(async () => {
      const path = "/src/session-mode/stores/useAgentCenterStore.ts";
      const { useAgentCenterStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((row) => new URL(row.name).pathname === path)?.name ?? path
      );
      useAgentCenterStore.getState().addAgentCard(
        {
          kind: "codex",
          id: "ux-0",
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          preview: "Native queue actions",
        },
        { activate: true },
      );
    });
    const second = await page.context().newPage();
    await second.setViewportSize({ width: 393, height: 852 });
    await setup(second, fixture);
    await edit(second, "这是尚未明确提交的新编辑");
    await expect(
      second.getByRole("textbox", { name: "编辑排队消息", exact: true }),
    ).toHaveValue("这是尚未明确提交的新编辑");
    await expect
      .poll(() =>
        second
          .getByText(
            "原操作已核对；本次新修改尚未提交，请查看当前队列后重新执行",
            { exact: true },
          )
          .count(),
      )
      .toBeGreaterThan(0);
    expect(
      fixture.calls.filter((row) => row.method === "thread/queue/update"),
    ).toHaveLength(1);
    expect(fixture.state.items[0].input[0].text).toBe(
      "服务端已接受但浏览器回执丢失",
    );
    await testInfo.attach("lost-http-ack-evidence", {
      body: JSON.stringify({
        calls: fixture.calls.filter(
          (row) => row.method !== "thread/queue/list",
        ),
        state: fixture.state,
      }),
      contentType: "application/json",
    });
  } finally {
    await fixture.close();
  }
});
