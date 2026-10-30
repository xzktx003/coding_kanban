import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

for (const width of [1440, 393])
  test(`ACP independent owners, background approval and explicit history continuation at ${width}px`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    await installSessionUxFixture(page, 0);
    const errors: string[] = [];
    const diagnostics: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text().slice(0, 2000);
        // The isolated snapshot deliberately disables and closes Vite HMR.
        if (text.startsWith("[vite] failed to connect to websocket."))
          diagnostics.push(text);
        else errors.push(text);
      }
    });
    const writes: Array<{ path: string; body: any }> = [],
      reads: string[] = [];
    const cwd = "/fixture/acp";
    const identities = {
      A: {
        runtimeInstance: "runtime",
        connectionId: "connection-A",
        agentId: "fixture",
        sessionId: "s1",
        historySessionId: "history-AAAAAAAA",
      },
      B: {
        runtimeInstance: "runtime",
        connectionId: "connection-B",
        agentId: "fixture",
        sessionId: "s1",
        historySessionId: "history-BBBBBBBB",
      },
      C: {
        runtimeInstance: "runtime",
        connectionId: "connection-C",
        agentId: "fixture",
        sessionId: "fresh-C",
        historySessionId: "history-fresh-C",
      },
    };
    const initialize = {
      agentInfo: { title: "Fixture Agent" },
      agentCapabilities: { loadSession: true },
      authMethods: [],
    };
    let aPending = false,
      aRunning = true,
      starts = 0;
    const rows = [
      {
        sessionId: "history-stored-C",
        nativeSessionId: "stored-native-C",
        historyScope: "scoped",
        agentId: "fixture",
        agentTitle: "Fixture Agent",
        title: "Stored C",
        cwd,
        createdAt: "2026-10-30T00:00:00Z",
        updatedAt: "2026-10-30T00:00:00Z",
      },
    ];
    await page.route("**/api/session/projects", (route) =>
      route.fulfill({
        json: { projects: [cwd], initialized: true, revision: 1, sequence: 0 },
      }),
    );
    await page.route(/\/api\/acp\//, async (route) => {
      const path = new URL(route.request().url()).pathname.split("/acp/")[1],
        body =
          route.request().method() === "POST"
            ? route.request().postDataJSON()
            : {};
      if (
        [
          "start",
          "new-session",
          "load-session",
          "cancel",
          "stop",
          "prompt",
          "respond-permission",
        ].includes(path)
      )
        writes.push({ path, body });
      if (path === "agents")
        return route.fulfill({
          json: [
            {
              id: "fixture",
              name: "Fixture Agent",
              command: "fixture",
              args: [],
              env: {},
              available: true,
              local: true,
            },
          ],
        });
      if (path === "sessions") return route.fulfill({ json: rows });
      if (path === "connection-snapshot") {
        const owner = Object.values(identities).find(
          (item) => item.connectionId === body.connection_id,
        );
        expect(owner).toBeTruthy();
        expect(body.session_id).toBe(owner!.sessionId);
        expect(body.expected_runtime_instance).toBe("runtime");
        return route.fulfill({
          json: {
            ...owner,
            cwd,
            initialize,
            session: {
              sessionId: owner!.sessionId,
              historySessionId: owner!.historySessionId,
            },
            settingsKnown: true,
            running: owner === identities.A && aRunning,
            deliveryUnknown: false,
            lifecycleUnknown: false,
            permissions:
              owner === identities.A && aPending
                ? [
                    {
                      requestId: "approval-A",
                      sessionId: "s1",
                      toolCall: { title: "Read A", kind: "read" },
                      options: [
                        {
                          optionId: "allow",
                          name: "Allow A once",
                          kind: "allow_once",
                        },
                        {
                          optionId: "deny",
                          name: "Deny A",
                          kind: "reject_once",
                        },
                      ],
                    },
                  ]
                : [],
          },
        });
      }
      if (path === "session") {
        reads.push(body.session_id);
        const text =
          body.session_id === "history-stored-C"
            ? "C stored read-only source"
            : body.session_id === "history-AAAAAAAA"
              ? "A running original history"
              : body.session_id === "history-BBBBBBBB"
                ? "B isolated body"
                : body.session_id === "history-loaded-C"
                  ? "C native loaded context"
                  : "";
        return route.fulfill({
          json: {
            data: body.metadataOnly
              ? []
              : [{ id: "source-1", role: "agent", text, historySourceId: 1 }],
            projection: "acp-entries",
            nextCursor: null,
            truncated: false,
            revision: "1:1",
            metadata: { historySourceId: 1 },
          },
        });
      }
      if (path === "start") {
        starts++;
        expect(body.agent_id).toBe("fixture");
        expect(body.cwd).toBe(cwd);
        const owner = starts === 1 ? identities.B : identities.C;
        return route.fulfill({
          json: {
            ...owner,
            initialize,
            session: {
              sessionId: owner.sessionId,
              historySessionId: owner.historySessionId,
            },
            sessionError: null,
          },
        });
      }
      if (path === "load-session") {
        expect(body).toMatchObject({
          connection_id: "connection-C",
          session_id: "stored-native-C",
          cwd,
        });
        identities.C.sessionId = "stored-native-C";
        identities.C.historySessionId = "history-loaded-C";
        return route.fulfill({
          json: {
            sessionId: "stored-native-C",
            historySessionId: "history-loaded-C",
          },
        });
      }
      if (path === "respond-permission") {
        expect(body).toMatchObject({
          connection_id: "connection-A",
          request_id: "approval-A",
          option_id: "allow",
        });
        aPending = false;
        return route.fulfill({ json: {} });
      }
      if (["new-session", "cancel", "stop", "prompt"].includes(path))
        return route.fulfill({
          status: 409,
          json: { error: "unexpected native action" },
        });
      return route.fulfill({ json: {} });
    });
    await page.addInitScript(
      ({ owner, cwd }) => {
        sessionStorage.setItem(
          "kanban.session.acp.connection-pointer.v1",
          JSON.stringify({
            version: 1,
            ...owner,
            endpoint:
              location.origin + "/api/session/api/acp/connection-snapshot",
            active: true,
          }),
        );
        localStorage.setItem(
          "kanban.session.layout-storage",
          JSON.stringify({
            version: 0,
            state: {
              view: "agent",
              isSidebarOpen: false,
              isRightPanelOpen: false,
            },
          }),
        );
        localStorage.setItem(
          "kanban.session.workspace-storage",
          JSON.stringify({ version: 1, state: { cwd, projects: [cwd] } }),
        );
      },
      { owner: identities.A, cwd },
    );
    const stream = await liveStream(page, baseURL!);
    const current = () =>
      page.evaluate(async () => {
        const name =
          performance
            .getEntriesByType("resource")
            .findLast((entry) =>
              entry.name.includes("/src/session-mode/stores/useAcpStore.ts"),
            )?.name ?? "/src/session-mode/stores/useAcpStore.ts";
        const { useAcpStore } = await import(name);
        const state = useAcpStore.getState();
        return {
          connectionId: state.connectionId,
          sessionId: state.sessionId,
          historySessionId: state.historySessionId,
          running: state.running,
        };
      });
    const input = page.getByRole("textbox", { name: "ACP 消息输入" });
    try {
      await page.goto("/?mode=session");
      await expect(
        page.getByText("A running original history", { exact: true }),
      ).toBeVisible();
      await input.fill("Draft A exact owner");
      if (width < 768) {
        await page
          .getByRole("button", { name: "更多功能", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "新聊天", exact: true })
          .click();
      } else await page.keyboard.press("Control+n");
      await expect.poll(current).toMatchObject({
        connectionId: "connection-B",
        historySessionId: "history-BBBBBBBB",
        running: false,
      });
      await expect(input).toHaveValue("");
      await input.fill("Draft B isolated despite same native s1");
      await expect.poll(() => stream.connections()).toBeGreaterThan(0);
      stream.envelope(1, "acp-message", {
        ...identities.B,
        kind: "update",
        historySourceId: 1,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "B isolated body" },
        },
      });
      await expect(
        page.getByText("B isolated body", { exact: true }),
      ).toBeVisible();
      aPending = true;
      await expect.poll(() => stream.connections()).toBeGreaterThan(0);
      stream.envelope(2, "acp-message", {
        ...identities.A,
        kind: "permission",
        requestId: "approval-A",
        toolCall: { title: "Read A", kind: "read" },
        options: [
          { optionId: "allow", name: "Allow A once", kind: "allow_once" },
        ],
      });
      const ownerA = page.locator('[data-acp-owner-connection="connection-A"]');
      await expect(ownerA).toContainText("待审批 1");
      await expect(
        page.getByRole("button", { name: "Allow A once", exact: true }),
      ).toHaveCount(0);
      await ownerA.click();
      await expect.poll(current).toMatchObject({
        connectionId: "connection-A",
        historySessionId: "history-AAAAAAAA",
        running: true,
      });
      await expect(input).toHaveValue("Draft A exact owner");
      await expect(
        page.getByRole("button", { name: "Allow A once", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Allow A once", exact: true })
        .click();
      await page.locator('[data-acp-owner-connection="connection-B"]').click();
      await expect.poll(current).toMatchObject({
        connectionId: "connection-B",
        historySessionId: "history-BBBBBBBB",
      });
      await expect(input).toHaveValue(
        "Draft B isolated despite same native s1",
      );
      const before = writes.length;
      await page
        .getByRole("button", { name: "展开项目列表", exact: true })
        .first()
        .click();
      await page
        .locator('.session-nav-row[role="button"]')
        .filter({ hasText: "Stored C" })
        .click();
      if (width < 768) await page.keyboard.press("Escape");
      await expect(
        page.getByText("C stored read-only source", { exact: true }),
      ).toBeVisible();
      expect(writes.length).toBe(before);
      await expect.poll(current).toMatchObject({
        connectionId: "connection-B",
        historySessionId: "history-BBBBBBBB",
      });
      await expect(input).toHaveValue(
        "Draft B isolated despite same native s1",
      );
      await page
        .getByRole("button", { name: "继续此会话", exact: true })
        .click();
      await expect.poll(current).toMatchObject({
        connectionId: "connection-C",
        sessionId: "stored-native-C",
        historySessionId: "history-loaded-C",
      });
      await expect(
        page.getByText("C native loaded context", { exact: true }),
      ).toBeVisible();
      await expect(input).toHaveValue("");
      await page.locator('[data-acp-owner-connection="connection-A"]').click();
      await expect.poll(current).toMatchObject({
        connectionId: "connection-A",
        historySessionId: "history-AAAAAAAA",
        running: true,
      });
      await expect(input).toHaveValue("Draft A exact owner");
      await page.locator('[data-acp-owner-connection="connection-B"]').click();
      await expect.poll(current).toMatchObject({
        connectionId: "connection-B",
        historySessionId: "history-BBBBBBBB",
      });
      await expect(input).toHaveValue(
        "Draft B isolated despite same native s1",
      );
      expect(writes.map((row) => row.path)).toEqual([
        "start",
        "respond-permission",
        "start",
        "load-session",
      ]);
      expect(errors).toEqual([]);
      await info.attach("acp-multiowner.json", {
        contentType: "application/json",
        body: JSON.stringify({
          width,
          writes,
          reads,
          errors,
          diagnostics,
          identities,
        }),
      });
    } finally {
      await info.attach("acp-state-last.json", {
        contentType: "application/json",
        body: JSON.stringify({
          writes,
          reads,
          errors,
          state: await current().catch(() => null),
          body: await page.locator("body").innerText(),
        }),
      });
      await stream.close();
    }
  });
