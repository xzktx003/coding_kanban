import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

test("Claude shared HTTP recovery survives one consumer cancellation and reopens after the final cancellation", async ({
  page,
  baseURL,
}) => {
  await installSessionUxFixture(page, 0);
  const stream = await liveStream(page, baseURL!);
  const releases: Array<() => void> = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(() => release());
  const reads: string[] = [];
  await page.route("**/api/cc/session-messages", async (route) => {
    const id = route.request().postDataJSON().session_id;
    reads.push(id);
    if (
      id === "shared-http" ||
      (id === "reopened-http" && reads.filter((x) => x === id).length === 1)
    )
      await held;
    await route
      .fulfill({
        json: [
          { type: "assistant", uuid: "http-final", message: { content: [] } },
        ],
      })
      .catch(() => {});
  });
  try {
    await page.goto("/?mode=session");
    await expect(
      page.locator(".session-codex-composer [contenteditable=true]"),
    ).toBeVisible();
    await page.evaluate(async () => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
      const [{ refreshClaudeHistory }, { useCCStore }] = await Promise.all([
        module("/src/session-mode/services/followedSessionAuxSync.ts"),
        module("/src/session-mode/stores/cc/index.ts"),
      ]);
      const controller = new AbortController();
      const first = refreshClaudeHistory("shared-http", controller.signal).then(
        () => "resolved",
        (error: Error) => error.name,
      );
      const visible = refreshClaudeHistory("shared-http");
      (window as any).__sharedClaudeHttp = {
        refreshClaudeHistory,
        useCCStore,
        controller,
        first,
        visible,
      };
    });
    await expect
      .poll(() => reads.filter((id) => id === "shared-http").length)
      .toBe(1);
    expect(
      await page.evaluate(async () => {
        const w = (window as any).__sharedClaudeHttp;
        w.controller.abort();
        return await w.first;
      }),
    ).toBe("AbortError");
    release();
    await page.evaluate(async () => {
      await (window as any).__sharedClaudeHttp.visible;
    });
    expect(reads.filter((id) => id === "shared-http")).toHaveLength(1);
    // A separate hold is needed for the final-consumer path.
    let releaseReopen!: () => void;
    const holdReopen = new Promise<void>((resolve) => {
      releaseReopen = resolve;
    });
    releases.push(() => releaseReopen());
    await page.route("**/api/cc/session-messages", async (route) => {
      const id = route.request().postDataJSON().session_id;
      reads.push(id);
      if (reads.filter((x) => x === id).length === 1) await holdReopen;
      await route
        .fulfill({
          json: [
            {
              type: "assistant",
              uuid: "fresh-http-final",
              message: { content: [] },
            },
          ],
        })
        .catch(() => {});
    });
    await page.evaluate(() => {
      const w = (window as any).__sharedClaudeHttp;
      w.lastController = new AbortController();
      w.last = w
        .refreshClaudeHistory("reopened-http", w.lastController.signal)
        .catch((e: Error) => e.name);
    });
    await expect
      .poll(() => reads.filter((id) => id === "reopened-http").length)
      .toBe(1);
    const result = await page.evaluate(async () => {
      const w = (window as any).__sharedClaudeHttp;
      w.lastController.abort();
      const fresh = w.refreshClaudeHistory("reopened-http");
      const cancelled = await w.last;
      await fresh;
      return {
        cancelled,
        shared:
          w.useCCStore.getState().sessionMessagesMap["shared-http"][0].uuid,
        fresh:
          w.useCCStore.getState().sessionMessagesMap["reopened-http"][0].uuid,
      };
    });
    releaseReopen();
    expect(result).toEqual({
      cancelled: "AbortError",
      shared: "http-final",
      fresh: "fresh-http-final",
    });
    expect(reads.filter((id) => id === "reopened-http")).toHaveLength(2);
  } finally {
    releases.forEach((release) => release());
    await stream.close();
  }
});

test("Claude full-history recovery measures unchanged reads and preserves external completion", async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 0);
  const stream = await liveStream(page, baseURL!);
  const histories = new Map(
    Array.from({ length: 8 }, (_, session) => [
      `cost-${session}`,
      Array.from({ length: 500 }, (_, i) => ({
        type: "assistant",
        uuid: `row-${i}`,
        message: {
          content: [
            {
              type: "text",
              text:
                `Session ${session} history ${i} ` + "readable ".repeat(256),
            },
          ],
        },
      })),
    ]),
  );
  const reads: Array<{ session: string; bytes: number }> = [];
  await page.route("**/api/cc/session-messages", async (route) => {
    const session = route.request().postDataJSON().session_id;
    const body = JSON.stringify(histories.get(session) ?? []);
    reads.push({ session, bytes: Buffer.byteLength(body) });
    await route.fulfill({ contentType: "application/json", body });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
  try {
    await page.goto("/?mode=session");
    await expect(
      page.locator(".session-codex-composer [contenteditable=true]"),
    ).toBeVisible();
    await page.evaluate(async () => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
      const [{ refreshClaudeHistory }, { useCCStore }] = await Promise.all([
        module("/src/session-mode/services/followedSessionAuxSync.ts"),
        module("/src/session-mode/stores/cc/index.ts"),
      ]);
      const ids = Array.from({ length: 8 }, (_, i) => `cost-${i}`);
      await Promise.all(ids.map((id) => refreshClaudeHistory(id)));
      let notifications = 0;
      const before = useCCStore.getState().sessionMessagesMap;
      const stop = useCCStore.subscribe(() => notifications++);
      (window as any).__claudeCost = {
        refreshClaudeHistory,
        useCCStore,
        ids,
        before,
        stop,
        notifications: () => notifications,
      };
    });
    const beforeMetrics = await metrics(),
      started = Date.now(),
      readsBefore = reads.length;
    const unchanged = await page.evaluate(async () => {
      const w = (window as any).__claudeCost;
      for (let i = 0; i < 3; i++)
        await Promise.all(
          w.ids.map((id: string) => w.refreshClaudeHistory(id)),
        );
      w.stop();
      return {
        notifications: w.notifications(),
        shared: w.ids.every(
          (id: string) =>
            w.before[id] === w.useCCStore.getState().sessionMessagesMap[id],
        ),
      };
    });
    const afterMetrics = await metrics(),
      unchangedWallMs = Date.now() - started;
    expect(unchanged).toEqual({ notifications: 0, shared: true });
    expect(reads.length - readsBefore).toBe(24);
    const external = {
      type: "assistant",
      uuid: "external-final",
      message: {
        content: [{ type: "text", text: "External completed reply" }],
      },
    };
    histories.get("cost-7")!.push(external);
    const recovery = await page.evaluate(async () => {
      const w = (window as any).__claudeCost;
      const permission = {
        type: "permission_request",
        requestId: "cost-approval",
        sessionId: "cost-7",
        toolName: "Read",
        toolInput: {},
      };
      w.useCCStore.setState((s: any) => ({
        sessionMessagesMap: {
          ...s.sessionMessagesMap,
          "cost-7": [...s.sessionMessagesMap["cost-7"], permission],
        },
      }));
      await w.refreshClaudeHistory("cost-7");
      const current = w.useCCStore.getState().sessionMessagesMap["cost-7"];
      return {
        external: current.some((m: any) => m.uuid === "external-final"),
        permission: current.includes(permission),
        firstShared: current[0] === w.before["cost-7"][0],
      };
    });
    expect(recovery).toEqual({
      external: true,
      permission: true,
      firstShared: true,
    });
    await writeFile(
      info.outputPath("claude-history-cost.json"),
      JSON.stringify(
        {
          sessions: 8,
          messagesPerSession: 500,
          repeatedRounds: 3,
          unchanged,
          unchangedReadCount: reads.length - readsBefore - 1,
          unchangedResponseBytes: reads
            .slice(readsBefore, -1)
            .reduce((n, r) => n + r.bytes, 0),
          unchangedWallMs,
          scriptCpuMs:
            (afterMetrics.ScriptDuration - beforeMetrics.ScriptDuration) * 1000,
          taskCpuMs:
            (afterMetrics.TaskDuration - beforeMetrics.TaskDuration) * 1000,
          recovery,
          reads,
          boundary:
            "Real HTTP browser reads and production projection/sharing; synthetic SDK snapshots, manual recovery triggers, one page. CPU includes browser work during those reads; unchanged native full-history transport remains necessary.",
        },
        null,
        2,
      ),
    );
    expect(
      fixture.calls.filter((r) =>
        /\/(?:send-message|resume-session|interrupt)$/.test(r.path),
      ),
    ).toEqual([]);
  } finally {
    await stream.close();
  }
});
