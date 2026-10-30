import { test, expect } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";
for (const width of [1440, 393])
  test(`ACP refresh observes the same running connection, approval and draft at ${width}px`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 852 });
    await installSessionUxFixture(page, 0);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const writes: string[] = [];
    let reads = 0;
    let running = true;
    let text = "仍在执行的原回复";
    let sourceId = 2;
    const owner = {
      runtimeInstance: "fixture-runtime",
      connectionId: "recovered-connection",
      agentId: "fixture-agent",
      sessionId: "recovered-session",
      historySessionId: "source-recovered-session",
    };
    await page.route(
      /\/api\/acp\/(start|new-session|load-session|cancel|stop|prompt)(?:\?|$)/,
      async (route) => {
        writes.push(new URL(route.request().url()).pathname);
        await route.fulfill({
          status: 409,
          json: { error: "implicit native action forbidden" },
        });
      },
    );
    await page.route(
      /\/api\/acp\/connection-snapshot(?:\?|$)/,
      async (route) => {
        const body = route.request().postDataJSON();
        expect(body).toMatchObject({
          connection_id: owner.connectionId,
          session_id: owner.sessionId,
          expected_runtime_instance: owner.runtimeInstance,
        });
        reads++;
        await route.fulfill({
          json: {
            ...owner,
            cwd: "/fixture/acp",
            initialize: {
              agentInfo: { name: "Fixture Agent" },
              agentCapabilities: { loadSession: true },
              authMethods: [],
            },
            session: {
              sessionId: owner.sessionId,
              historySessionId: owner.historySessionId,
            },
            settingsKnown: false,
            running,
            deliveryUnknown: false,
            lifecycleUnknown: false,
            permissions: running
              ? [
                  {
                    requestId: "waiting-approval",
                    sessionId: owner.sessionId,
                    toolCall: { title: "Read source", kind: "read" },
                    options: [
                      { optionId: "allow", name: "Allow once" },
                      { optionId: "deny", name: "Deny" },
                    ],
                  },
                ]
              : [],
          },
        });
      },
    );
    await page.route(/\/api\/acp\/session\?view=recent$/, async (route) => {
      const body = route.request().postDataJSON();
      expect(body.session_id).toBe(owner.historySessionId);
      await route.fulfill({
        json: {
          data: body.metadataOnly
            ? []
            : [
                {
                  id: "acp-2-0",
                  role: "agent",
                  text,
                  historySourceId: sourceId,
                },
              ],
          nextCursor: null,
          truncated: false,
          projection: "acp-entries",
          revision: `${sourceId}:${sourceId}`,
          metadata: { historySourceId: sourceId },
        },
      });
    });
    await page.addInitScript((owner) => {
      if (!sessionStorage.getItem("kanban.session.acp.connection-pointer.v1"))
        sessionStorage.setItem(
          "kanban.session.acp.connection-pointer.v1",
          JSON.stringify({
            version: 1,
            ...owner,
            endpoint: `${location.origin}/api/session/api/acp/connection-snapshot`,
            active: true,
          }),
        );
      localStorage.setItem(
        "kanban.session.layout-storage",
        JSON.stringify({
          version: 0,
          state: {
            isSidebarOpen: false,
            isRightPanelOpen: false,
            view: "agent",
          },
        }),
      );
    }, owner);
    const stream = await liveStream(page, baseURL!);
    try {
      await page.goto("/?mode=session");
      await expect(
        page.getByText("仍在执行的原回复", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Allow once", exact: true }),
      ).toBeVisible();
      const input = page.locator(".session-mode textarea").first();
      await input.fill("保留我的未发送草稿");
      for (let refresh = 0; refresh < 2; refresh++) {
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(input).toHaveValue("保留我的未发送草稿");
        await expect(
          page.getByRole("button", { name: "Allow once", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("仍在执行的原回复", { exact: true }),
        ).toBeVisible();
      }
      await expect.poll(() => stream.connections()).toBeGreaterThan(0);
      sourceId = 3;
      text += "，收到同一任务的新进展";
      stream.envelope(1, "acp-message", {
        ...owner,
        kind: "update",
        historySourceId: sourceId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "，收到同一任务的新进展" },
        },
      });
      await expect(page.getByText(text, { exact: true })).toBeVisible();
      running = false;
      text = "同一个任务的最终回答";
      sourceId = 4;
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText(text, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "停止生成", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Allow once", exact: true }),
      ).toHaveCount(0);
      await expect(input).toHaveValue("保留我的未发送草稿");
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
      expect(reads).toBeGreaterThanOrEqual(4);
      await info.attach("provider-recovery.json", {
        contentType: "application/json",
        body: JSON.stringify({ width, reads, writes, errors, owner, sourceId }),
      });
    } finally {
      await stream.close();
    }
  });
