import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const turn = (id: string, completed = true) => ({
  id,
  status: completed ? "completed" : "inProgress",
  startedAt: 1,
  durationMs: completed ? 1000 : null,
  error: null,
  items: [
    {
      id: `${id}-user`,
      type: "userMessage",
      content: [{ type: "text", text: `Question ${id}`, text_elements: [] }],
    },
    ...(completed
      ? [
          {
            id: `${id}-answer`,
            type: "agentMessage",
            text: `Complete answer ${id}`,
            phase: "final_answer",
            memoryCitation: null,
          },
        ]
      : []),
  ],
});
async function publish(
  page: Page,
  turns: any[],
  live = false,
  unloaded?: string,
) {
  await page.evaluate(
    async ({ turns, live, unloaded }) => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
      const { useCodexStore } = await module(
        "/src/session-mode/components/codex/stores/useCodexStore.ts",
      );
      const last = turns.at(-1)!;
      const running = last.status === "inProgress";
      const events = turns.flatMap((turn) => [
        {
          method: "turn/started",
          params: { threadId: "ux-0", turn: { ...turn, status: "inProgress" } },
        },
        ...turn.items.map((item: any) => ({
          method:
            item.type === "userMessage" || item.status === "inProgress"
              ? "item/started"
              : "item/completed",
          params: { threadId: "ux-0", turnId: turn.id, item },
        })),
        ...(turn.status === "completed"
          ? [{ method: "turn/completed", params: { threadId: "ux-0", turn } }]
          : []),
      ]);
      useCodexStore.setState((state) => ({
        threads: state.threads.map((t) =>
          t.id === "ux-0"
            ? {
                ...t,
                turns: [
                  ...turns,
                  ...(unloaded
                    ? [
                        {
                          id: unloaded,
                          status: "completed",
                          items: [],
                          itemsView: "notLoaded",
                        },
                      ]
                    : []),
                ],
              }
            : t,
        ),
        events: { ...state.events, "ux-0": events },
        historyLoadedMap: { ...state.historyLoadedMap, "ux-0": true },
        threadStatusMap: {
          ...state.threadStatusMap,
          "ux-0": {
            type: running ? "active" : "idle",
            ...(running ? { activeFlags: [] } : {}),
          },
        },
        turnTimingMap: {
          ...state.turnTimingMap,
          "ux-0": {
            turnId: last.id,
            status: running ? "inProgress" : "completed",
            startedAtMs: 1000,
            durationMs: running ? null : 1000,
          },
        },
        currentThreadId: "ux-0",
        currentTurnId: running ? last.id : null,
        streamingAgentMessages: {
          ...state.streamingAgentMessages,
          "ux-0": live
            ? {
                itemId: `${last.id}-answer`,
                turnId: last.id,
                segments: [],
                current: "Partial answer",
                length: 14,
              }
            : undefined,
        },
      }));
    },
    { turns, live, unloaded },
  );
}
for (const width of [1440, 390])
  test.describe(`${width}px latest action identity`, () => {
    test.use({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const theme of ["dark", "light"])
      test(`completion, new turn and hidden mode (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(60000);
        const fixture = await installSessionUxFixture(page, 1);
        fixture.threads[0].turns = [turn("old"), turn("latest")];
        await page.goto("/?mode=session");
        await page
          .locator(".session-agent-view [contenteditable=true]")
          .first()
          .waitFor();
        await seedSessionUx(page, 1);
        await page.evaluate(async (theme) => {
          const module = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
          const [
            { useAgentCenterStore },
            { useThemeStore },
            { useLayoutStore },
            { useSessionDraftStore, sessionDraftKey },
          ] = await Promise.all([
            module("/src/session-mode/stores/useAgentCenterStore.ts"),
            module("/src/session-mode/stores/settings/useThemeStore.ts"),
            module("/src/session-mode/stores/useLayoutStore.ts"),
            module("/src/session-mode/stores/useSessionDraftStore.ts"),
          ]);
          useThemeStore.getState().setTheme(theme);
          useLayoutStore.setState({
            view: "agent",
            isSidebarOpen: false,
            isRightPanelOpen: false,
          });
          useAgentCenterStore.getState().addAgentCard(
            {
              kind: "codex",
              id: "ux-0",
              cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
              preview: "Latest action fixture",
            },
            { activate: true },
          );
          useSessionDraftStore
            .getState()
            .setText(sessionDraftKey("codex", "ux-0"), "Unsent draft remains");
        }, theme);
        await publish(page, fixture.threads[0].turns);
        await page.mouse.move(width - 5, 60);
        const row = (id: string) =>
          page.locator(`.codex-assistant[data-owner-turn="${id}"]`);
        const actions = (id: string) =>
          row(id).locator(".session-message-actions");
        await expect(actions("latest")).toHaveClass(/(?:^|\s)visible(?:\s|$)/);
        await expect(
          row("latest").getByRole("button", { name: "复制回复", exact: true }),
        ).toBeVisible();
        expect(
          await row("latest")
            .getByRole("button", { name: "复制回复", exact: true })
            .evaluate((button) => {
              const box = button.getBoundingClientRect();
              return button.contains(
                document.elementFromPoint(
                  box.x + box.width / 2,
                  box.y + box.height / 2,
                ),
              );
            }),
        ).toBe(true);
        await expect(actions("old")).toHaveClass(/\binvisible\b/);
        // A complete latest history identifies the row even before lightweight
        // runtime status/timing are available; this is presentation, not authority.
        (fixture.threads[0] as any).status = { type: "notLoaded" };
        const unknownSnapshot = await page.evaluate(async () => {
          const path =
            "/src/session-mode/components/codex/stores/useCodexStore.ts";
          const { useCodexStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          useCodexStore.setState((state) => {
            const timing = { ...state.turnTimingMap };
            delete timing["ux-0"];
            return {
              turnTimingMap: timing,
              currentTurnId: null,
              threadStatusMap: {
                ...state.threadStatusMap,
                "ux-0": { type: "notLoaded" },
              },
            };
          });
          return await new Promise<{
            hasTiming: boolean;
            status: string | undefined;
            classes: string | undefined;
          }>((resolve) =>
            requestAnimationFrame(() => {
              const state = useCodexStore.getState();
              resolve({
                hasTiming: !!state.turnTimingMap["ux-0"],
                status: state.threadStatusMap["ux-0"]?.type,
                classes: document.querySelector(
                  '.codex-assistant[data-owner-turn="latest"] .session-message-actions',
                )?.className,
              });
            }),
          );
        });
        await info.attach("unknown-status-snapshot", {
          body: JSON.stringify(unknownSnapshot),
          contentType: "application/json",
        });
        expect(unknownSnapshot).toMatchObject({
          hasTiming: false,
          status: "notLoaded",
        });
        expect(unknownSnapshot.classes).toMatch(/(?:^|\s)visible(?:\s|$)/);
        (fixture.threads[0] as any).status = { type: "idle" };
        await publish(page, fixture.threads[0].turns);

        if (width === 1440) {
          await expect(
            row("old").getByRole("button", { name: "复制回复", exact: true }),
          ).not.toBeVisible();
          await row("old").hover();
          await expect(
            row("old").getByRole("button", { name: "复制回复", exact: true }),
          ).toBeVisible();
          await row("old")
            .getByRole("button", { name: "复制回复", exact: true })
            .focus();
          await page.mouse.move(width - 5, 60);
          await expect(
            row("old").getByRole("button", { name: "复制回复", exact: true }),
          ).toBeVisible();
          await page
            .locator(".session-codex-composer [contenteditable=true]")
            .first()
            .focus();
        } else {
          for (const id of ["old", "latest"]) {
            const button = row(id).getByRole("button", {
              name: "复制回复",
              exact: true,
            });
            await expect(button).toBeVisible();
            const box = await button.boundingBox();
            expect(box!.width).toBeGreaterThanOrEqual(44);
            expect(box!.height).toBeGreaterThanOrEqual(44);
          }
        }
        fixture.threads[0].turns = [
          turn("old"),
          turn("latest"),
          turn("new", false),
        ];
        await publish(page, fixture.threads[0].turns, true);
        await expect(actions("latest")).toHaveClass(/\binvisible\b/);
        await expect(page.locator("[data-codex-live-message]")).toContainText(
          "Partial answer",
        );
        await expect(
          page.locator("[data-codex-live-message] .session-message-actions"),
        ).toHaveCount(0);
        fixture.threads[0].turns = [turn("old"), turn("latest"), turn("new")];
        await publish(page, fixture.threads[0].turns);
        await expect(actions("new")).toHaveClass(/(?:^|\s)visible(?:\s|$)/);
        await expect(actions("latest")).toHaveClass(/\binvisible\b/);
        const command = {
          id: "after-final",
          type: "commandExecution",
          command: "echo owned-fixture",
          cwd: "/fixture",
          status: "inProgress",
          commandActions: [],
          aggregatedOutput: null,
        };
        fixture.threads[0].turns = [
          turn("old"),
          turn("latest"),
          {
            ...turn("new"),
            status: "inProgress",
            items: [...turn("new").items, command],
          },
        ];
        await publish(page, fixture.threads[0].turns);
        await expect(actions("new")).toHaveClass(/\binvisible\b/);
        fixture.threads[0].turns = [
          turn("old"),
          turn("latest"),
          {
            ...turn("new"),
            items: [
              ...turn("new").items,
              { ...command, status: "completed", exitCode: 0 },
            ],
          },
        ];
        await publish(page, fixture.threads[0].turns);
        await expect(actions("new")).toHaveClass(/(?:^|\s)visible(?:\s|$)/);
        const completeTurns = fixture.threads[0].turns;
        // Keep HTTP metadata and the mounted store consistent: background readonly
        // verification must see the same newly observed unloaded native turn.
        fixture.threads[0].turns = [
          ...completeTurns,
          {
            id: "not-loaded-newer-turn",
            status: "completed",
            items: [],
            itemsView: "notLoaded",
          } as any,
        ];
        await publish(page, completeTurns, false, "not-loaded-newer-turn");
        await expect(actions("new")).toHaveClass(/\binvisible\b/);
        fixture.threads[0].turns = completeTurns;
        await publish(page, completeTurns);
        await expect(actions("new")).toHaveClass(/(?:^|\s)visible(?:\s|$)/);
        await page.evaluate(async () => {
          const path = "/src/session-mode/stores/useLayoutStore.ts";
          const { useLayoutStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          useLayoutStore.getState().setView("settings");
        });
        await expect(row("new")).not.toBeVisible();
        await page.evaluate(async () => {
          const path = "/src/session-mode/stores/useLayoutStore.ts";
          const { useLayoutStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          useLayoutStore.getState().setView("agent");
        });
        await expect(
          row("new").getByRole("button", { name: "复制回复", exact: true }),
        ).toBeVisible();
        await expect(
          page
            .locator(".session-codex-composer [contenteditable=true]")
            .first(),
        ).toContainText("Unsent draft remains");
        expect(
          fixture.calls.filter((call) =>
            /\/(?:thread\/(?:resume|start|fork|rollback)|turn\/(?:start|steer))$/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
        await page.screenshot({ path: info.outputPath("latest-actions.png") });
      });
  });

test("pinned official latest action component retains persistent visibility", async ({
  page,
  request,
}, info) => {
  const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
  test.skip(!reference, "Explicit owned original reference required");
  const url = new URL(reference!);
  const identity = await (
    await request.get(new URL("/reference.json", url).href)
  ).json();
  expect(identity.version).toBe("26.51007.21434");
  const asset = "sites-end-resource-733bd1c6da06.js";
  const response = await request.get(new URL("/assets/" + asset, url).href);
  expect(
    createHash("sha256")
      .update(await response.body())
      .digest("hex"),
  ).toBe("5b45f53d1d05d8a47058cbb7b0f0d4e131805d6036c4a878e5ce951401018a14");
  await page.goto(reference!);
  await page.waitForFunction(() => (window as any).nativeLoaded);
  const splitAsset = "split-items-into-render-groups-a142b98982d4.js";
  expect(
    createHash("sha256")
      .update(
        await (
          await request.get(new URL("/assets/" + splitAsset, url).href)
        ).body(),
      )
      .digest("hex"),
  ).toBe("1ca94839adc799b852a2badbce161f140d7faca6f562bb3de525dabde2c3dccd");
  const grouping = await page.evaluate(async () => {
    const split =
      await import("/assets/split-items-into-render-groups-a142b98982d4.js");
    split.t();
    const answer = (id: string, phase: string, completed = true) => ({
      type: "assistant-message",
      searchItemId: id,
      content: id,
      phase,
      completed,
    });
    return [
      [answer("first", "final_answer"), answer("last", "final_answer")],
      [answer("final", "final_answer"), answer("comment", "commentary")],
      [
        answer("final", "final_answer"),
        answer("partial", "final_answer", false),
      ],
    ].map((items) => {
      const result = split.n(items, "complete", "all", undefined, "local");
      return {
        id: result.assistantItem?.searchItemId,
        completed: result.assistantItem?.completed,
      };
    });
  });
  expect(grouping).toEqual([
    { id: "last", completed: true },
    { id: "comment", completed: true },
    { id: "partial", completed: false },
  ]);
  const trailing = await page.evaluate(async () => {
    const split =
      await import("/assets/split-items-into-render-groups-a142b98982d4.js");
    split.t();
    return ["in_progress", "complete"].flatMap((status) =>
      [false, true].map((completed) => {
        const result = split.n(
          [
            {
              type: "assistant-message",
              searchItemId: "final",
              content: "complete",
              phase: "final_answer",
              completed: true,
            },
            {
              type: "exec",
              id: "tool",
              command: "echo owned fixture",
              completed,
              parsedCmd: { isFinished: completed },
            },
          ],
          status,
          "all",
          undefined,
          "local",
        );
        return {
          status,
          completed,
          assistant: result.assistantItem?.searchItemId ?? null,
        };
      }),
    );
  });
  expect(trailing.map((item) => item.assistant)).toEqual([
    null,
    null,
    null,
    "final",
  ]);
  const results = [];
  for (const latest of [false, true]) {
    await page.evaluate(async (latest) => {
      const w = window as any,
        A = await import("/assets/sites-end-resource-733bd1c6da06.js");
      A.K();
      const { R, root, wrap } = w.nativeGoalCore;
      root.render(
        wrap(
          R.createElement(
            "div",
            { className: "group" },
            R.createElement(A.W, {
              alwaysShowActions: latest,
              copyText: "Complete reference",
              onFork: () => {
                throw Error("No mutation permitted");
              },
              threadId: "fixture",
              turnId: "turn",
            }),
          ),
        ),
      );
    }, latest);
    await page.mouse.move(1200, 880);
    await expect.poll(() => page.locator("#root button").count()).toBe(2);
    const opacity = await page
      .locator("#root button")
      .first()
      .evaluate((e) => {
        let opacity = 1;
        for (let n: Element | null = e; n; n = n.parentElement)
          opacity *= Number(getComputedStyle(n).opacity);
        return opacity;
      });
    expect(opacity).toBe(latest ? 1 : 0);
    results.push({ latest, opacity });
  }
  expect(await page.evaluate(() => (window as any).nativeErrors)).toEqual([]);
  await info.attach("pinned-original-actions", {
    body: JSON.stringify({ results, grouping, trailing }),
    contentType: "application/json",
  });
});
