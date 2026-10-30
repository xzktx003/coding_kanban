import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { sampleRendererRss } from "../../scripts/session-renderer-memory.mjs";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

test("CC and ACP warm bodies share the real retention budget, keep approvals and restore read-only", async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  await installSessionUxFixture(page, 1);
  const cards = [
    {
      kind: "codex",
      id: "ux-0",
      cwd: "/fixture/project",
      preview: "Visible Codex",
    },
    ...["cc-memory-one", "cc-memory-two"].map((id) => ({
      kind: "cc",
      id,
      cwd: "/fixture/provider",
      preview: id,
    })),
  ];
  await page.route("**/api/session/tabs", (route) =>
    route.fulfill({
      json: { cards, initialized: true, revision: 1, sequence: 0 },
    }),
  );
  const writes: string[] = [],
    reads: Array<{
      provider: string;
      sessionId: string;
      metadataOnly: boolean;
    }> = [];
  for (const provider of ["cc", "acp"])
    await page.route(
      new RegExp(
        `/api/${provider}/(?:start|new-session|load-session|resume-session|resume|cancel|stop|prompt)(?:\\?|$)`,
      ),
      async (route) => {
        writes.push(new URL(route.request().url()).pathname);
        await route.fulfill({
          status: 409,
          json: { error: "No implicit Agent mutation permitted" },
        });
      },
    );
  await page.route(
    /\/api\/(cc\/session-messages|acp\/session)\?view=recent$/,
    async (route) => {
      const body = route.request().postDataJSON(),
        provider = route.request().url().includes("/cc/") ? "cc" : "acp";
      reads.push({
        provider,
        sessionId: body.session_id,
        metadataOnly: !!body.metadataOnly,
      });
      const text =
        `${body.session_id} original persisted final ` +
        "history ".repeat(80_000);
      await route.fulfill({
        json: {
          projection: provider === "cc" ? "cc-messages" : "acp-entries",
          revision: "source-1",
          data: body.metadataOnly
            ? []
            : provider === "cc"
              ? [
                  {
                    type: "assistant",
                    uuid: `answer-${body.session_id}`,
                    session_id: body.session_id,
                    message: {
                      role: "assistant",
                      content: [{ type: "text", text }],
                    },
                  },
                ]
              : [{ id: "acp-1-0", role: "agent", text, historySourceId: 1 }],
          nextCursor: null,
          truncated: false,
          metadata: provider === "acp" ? { historySourceId: 1 } : {},
        },
      });
    },
  );
  await page.addInitScript((cards) => {
    localStorage.setItem(
      "kanban.session.agent-center-store",
      JSON.stringify({
        version: 5,
        state: {
          cards,
          currentAgentCardId: "ux-0",
          currentAgentCardKind: "codex",
          cardsViewMode: "solo",
          sharedTabsInitialized: true,
        },
      }),
    );
    localStorage.setItem(
      "kanban.session.layout-storage",
      JSON.stringify({
        version: 0,
        state: { isSidebarOpen: false, isRightPanelOpen: false, view: "agent" },
      }),
    );
    localStorage.setItem(
      "kanban.session.settings-storage",
      JSON.stringify({ version: 13, state: { warmFollowedSessions: true } }),
    );
  }, cards);
  const stream = await liveStream(page, baseURL!),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const cdp = await context.newCDPSession(page),
    browserCdp = await context.browser()!.newBrowserCDPSession(),
    samples: any[] = [];
  const start = Date.now();
  async function snapshot() {
    return page.evaluate(() => {
      const m = (window as any).__providerMemory;
      return {
        cc: Object.fromEntries(
          Object.entries(m.cc.getState().sessionMessagesMap).map(
            ([id, rows]: [string, any]) => [
              id,
              {
                body: rows.filter((r: any) => r.type === "assistant").length,
                permissions: rows
                  .filter((r: any) => r.type === "permission_request")
                  .map((r: any) => r.requestId),
              },
            ],
          ),
        ),
        acp: {
          body: m.acp.getState().entries.length,
          permission: m.acp.getState().permission?.requestId,
          pending: Object.values(m.acp.getState().pendingPermissions)
            .flat()
            .map((p: any) => p.requestId),
          running: m.acp.getState().running,
        },
        metadata: m.metadata.getState().entries,
      };
    });
  }
  async function observe(phase: string) {
    const heap = await cdp.send("Runtime.getHeapUsage"),
      processes = await browserCdp.send("SystemInfo.getProcessInfo");
    samples.push({
      phase,
      seconds: (Date.now() - start) / 1000,
      heapBytes: heap.usedSize,
      backingStorageBytes: heap.backingStorageSize,
      ...sampleRendererRss(processes.processInfo),
      snapshot: await snapshot(),
    });
  }
  try {
    await page.goto("/?mode=session");
    await expect(
      page.locator(".session-codex-composer [contenteditable=true]"),
    ).toBeVisible();
    await page.evaluate(async () => {
      const load = (p: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === p)?.name ?? p
        );
      const [
        { useCCStore: cc },
        { useAcpStore: acp },
        { useProviderTranscriptStore: metadata },
        { refreshAcpTranscript },
        { refreshClaudeHistory },
      ] = await Promise.all([
        load("/src/session-mode/stores/cc/index.ts"),
        load("/src/session-mode/stores/useAcpStore.ts"),
        load("/src/session-mode/services/sessionProviderTranscriptState.ts"),
        load("/src/session-mode/services/acpTranscriptRead.ts"),
        load("/src/session-mode/services/followedSessionAuxSync.ts"),
      ]);
      acp.setState({
        active: false,
        agentId: "memory-agent",
        connectionId: "memory-connection",
        sessionId: "acp-memory",
        sessionCwd: "/fixture/provider",
        running: true,
        connecting: false,
      });
      (window as any).__providerMemory = { cc, acp, metadata };
      await Promise.all([
        refreshClaudeHistory("cc-memory-one"),
        refreshClaudeHistory("cc-memory-two"),
        refreshAcpTranscript({
          agentId: "memory-agent",
          connectionId: "memory-connection",
          sessionId: "acp-memory",
        }),
      ]);
      cc.getState().addMessageToSession("cc-memory-one", {
        type: "permission_request",
        requestId: "cc-pending",
        sessionId: "cc-memory-one",
        toolName: "Read",
        toolInput: { path: "/fixture/source" },
      });
      acp
        .getState()
        .setPermission({
          connectionId: "memory-connection",
          sessionId: "acp-memory",
          requestId: "acp-pending",
          title: "ACP pending",
          options: [{ optionId: "allow", name: "Allow" }],
        });
    });
    await expect
      .poll(
        async () =>
          Object.values((await snapshot()).cc).filter(
            (row: any) => row.body > 0,
          ).length,
      )
      .toBe(2);
    expect((await snapshot()).acp.body).toBeGreaterThan(0);
    await observe("initial-warm");
    await page.waitForTimeout(120_000);
    let state = await snapshot();
    expect(state.cc["cc-memory-one"].body).toBeGreaterThan(0);
    expect(state.cc["cc-memory-two"].body).toBeGreaterThan(0);
    expect(state.acp.body).toBeGreaterThan(0);
    await observe("resource-sufficient-120s");
    for (let i = 1; i <= 9; i++)
      stream.emit(i, {
        method: "item/completed",
        params: {
          threadId: "ux-0",
          turnId: "pressure-probe",
          item: {
            type: "agentMessage",
            id: "pressure-reply",
            text: "p".repeat(1024 * 1024),
          },
        },
      });
    await expect
      .poll(
        async () => {
          const s = await snapshot();
          return (
            s.cc["cc-memory-one"].body + s.cc["cc-memory-two"].body + s.acp.body
          );
        },
        { timeout: 15_000 },
      )
      .toBe(0);
    state = await snapshot();
    expect(state.cc["cc-memory-one"].permissions).toContain("cc-pending");
    expect(state.acp).toMatchObject({
      permission: "acp-pending",
      running: true,
    });
    await observe("pressure-reclaimed");
    stream.envelope(10, "cc-message", {
      type: "assistant",
      uuid: "late-cc",
      session_id: "cc-memory-one",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "late body must stay dormant" }],
      },
    });
    stream.envelope(11, "acp-message", {
      agentId: "memory-agent",
      connectionId: "memory-connection",
      sessionId: "acp-memory",
      kind: "update",
      historySourceId: 2,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "late body must stay dormant" },
      },
    });
    stream.envelope(12, "acp-message", {
      agentId: "memory-agent",
      connectionId: "memory-connection",
      sessionId: "acp-memory",
      kind: "permission",
      requestId: "late-acp-pending",
      toolCall: { title: "Late background approval" },
      options: [{ optionId: "allow", name: "Allow" }],
    });
    await expect
      .poll(async () => (await snapshot()).acp.pending)
      .toContain("late-acp-pending");
    await page.waitForTimeout(1000);
    state = await snapshot();
    expect(state.cc["cc-memory-one"].body).toBe(0);
    expect(state.acp.body).toBe(0);
    const before = reads.filter((r) => !r.metadataOnly).length;
    await page
      .locator('[data-tab-key="cc:cc-memory-one"]')
      .first()
      .click({ position: { x: 30, y: 12 } });
    await expect(
      page.getByText(/cc-memory-one original persisted final/),
    ).toBeVisible();
    await page.evaluate(() => {
      const m = (window as any).__providerMemory;
      m.acp.setState({ active: true });
    });
    await expect(
      page.getByText(/acp-memory original persisted final/),
    ).toBeVisible();
    await expect
      .poll(async () => reads.filter((r) => !r.metadataOnly).length)
      .toBeGreaterThan(before);
    await observe("readonly-visible-restored");
    await page.waitForTimeout(45_000);
    await observe("readonly-visible-settled-natural-gc");
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await writeFile(
      info.outputPath("provider-memory-observations.json"),
      JSON.stringify(
        {
          samples,
          reads,
          writes,
          errors,
          boundary:
            "Real clock, EventSource and browser allocation/RSS. Explicit fixture store establishes existing native owner; only recent-page HTTP reads restore visible body. No forced GC, direct release, fake clock, refresh or Agent stop.",
        },
        null,
        2,
      ),
    );
    await stream.close();
  }
});
