import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
async function nativeFixture(scenario: "m55" | "m03" | "m34" = "m55") {
  const require = createRequire(
    resolve("packages/session-runtime/package.json"),
  );
  const child = spawn(
    process.execPath,
    [
      require.resolve("tsx/cli"),
      resolve("tests/e2e/helpers/session-multiclient-cli-native-server.mts"),
      scenario,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "",
    seq = 0,
    ready!: (v: any) => void,
    reject!: (e: any) => void;
  const started = new Promise<any>((r, j) => {
      ready = r;
      reject = j;
    }),
    exited = new Promise<number | null>((r) => child.once("exit", r)),
    pending = new Map<number, any>();
  child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-12000)));
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let v: any;
    try {
      v = JSON.parse(line);
    } catch {
      return;
    }
    if (v.kind === "ready") return ready(v);
    const p = pending.get(v.id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(v.id);
      v.error ? p.reject(new Error(v.error)) : p.resolve(v.value);
    }
  });
  child.once("exit", (code) => {
    const e = new Error(`M55 native helper exited ${code}: ${stderr}`);
    reject(e);
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    pending.clear();
  });
  const call = (method: string, payload: Record<string, unknown> = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = ++seq,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`M55 ${method} timed out: ${stderr}`));
        }, 45000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, ...payload }) + "\n");
    });
  const timer = setTimeout(
    () => reject(new Error("M55 native fixture start deadline: " + stderr)),
    45000,
  );
  let info: any;
  try {
    info = await started;
  } catch (e) {
    child.kill("SIGTERM");
    await exited;
    throw e;
  } finally {
    clearTimeout(timer);
  }
  return {
    ...info,
    call,
    stderr: () => stderr,
    async close() {
      try {
        return await call("close");
      } finally {
        child.stdin.end();
        await exited;
      }
    },
  };
}
test.use({ ignoreHTTPSErrors: true });
test("M55 three real Session pages send once and refresh the same official tasks while actual CLI shares one task", async ({
  browser,
}, info) => {
  test.skip(
    !process.env.SESSION_CODEX_DAEMON_NATIVE_BIN ||
      !process.env.M55_FRONTEND_SOURCE,
    "Requires explicit pinned official0.163 binary and existing HTTPS LAN frontend; private no-login fixture only",
  );
  test.setTimeout(240000);
  const native = await nativeFixture(),
    contexts: any[] = [],
    pages: any[] = [],
    errors: string[] = [],
    pageRequests: any[] = [],
    ui: any[] = [];
  let metrics: any, activeAfterRefresh: any;
  try {
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({
        viewport: { width: i === 2 ? 393 : 1440, height: 852 },
      });
      contexts.push(context);
      await context.addInitScript(
        ({ cards, selected, project }: any) => {
          localStorage.setItem("kanban.workbench.mode", "session");
          if (!localStorage.getItem("kanban.session.agent-center-store"))
            localStorage.setItem(
              "kanban.session.agent-center-store",
              JSON.stringify({
                version: 5,
                state: {
                  cards,
                  currentAgentCardId: selected,
                  currentAgentCardKind: "codex",
                  cardsViewMode: "solo",
                  sharedTabsInitialized: true,
                },
              }),
            );
          if (!localStorage.getItem("kanban.session.workspace"))
            localStorage.setItem(
              "kanban.session.workspace",
              JSON.stringify({
                version: 1,
                state: {
                  projects: [project],
                  cwd: project,
                  projectsInitialized: true,
                  historyProjects: [project],
                },
              }),
            );
          if (!localStorage.getItem("kanban.session.layout-storage"))
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
        },
        {
          cards: native.cards,
          selected: native.threadIds[i],
          project: native.project,
        },
      );
      const page = await context.newPage();
      pages.push(page);
      page.on("pageerror", (e: any) => errors.push(`page${i}: ${e.message}`));
      page.on("request", (r: any) => {
        if (
          r.method() === "POST" &&
          new URL(r.url()).pathname.startsWith("/api/session/") &&
          /M55_PAGE_[012]_ONLY_ONCE/.test(r.postData() ?? "")
        )
          pageRequests.push({
            page: i,
            path: new URL(r.url()).pathname,
            body: r.postDataJSON(),
          });
      });
    }
    await Promise.all(
      pages.map((p, i) =>
        p.goto(native.origin + "/?mode=session", {
          waitUntil: "domcontentloaded",
        }),
      ),
    );
    for (let i = 0; i < 3; i++)
      await expect(
        pages[i].locator(
          `.session-codex-composer[data-owner-thread="${native.threadIds[i]}"] [contenteditable=true]`,
        ),
      ).toBeVisible({ timeout: 60000 });
    await Promise.all(
      pages.map(async (p, i) => {
        const composer = p.locator(
            `.session-codex-composer[data-owner-thread="${native.threadIds[i]}"]`,
          ),
          editor = composer.locator("[contenteditable=true]");
        await editor.fill(`M55_PAGE_${i}_ONLY_ONCE`);
        await composer.locator("button[type=submit]").click();
      }),
    );
    await expect
      .poll(async () => (await native.call("metrics")).calls.length, {
        timeout: 45000,
      })
      .toBe(3);
    metrics = await native.call("metrics");
    expect(metrics.calls.map((x: any) => x.page).sort()).toEqual([0, 1, 2]);
    expect(metrics.errors).toEqual([]);
    const cli = await native.call("cli");
    expect(cli.threadId).toBe(native.threadIds[0]);
    await expect
      .poll(
        async () =>
          (await native.call("metrics")).cli.tail.includes(
            "M55_PAGE_0_ONLY_ONCE",
          ),
        { timeout: 20000 },
      )
      .toBe(true);
    await Promise.all(
      pages.map((p) => p.reload({ waitUntil: "domcontentloaded" })),
    );
    for (let i = 0; i < 3; i++) {
      const c = pages[i].locator(
        `.session-codex-composer[data-owner-thread="${native.threadIds[i]}"]`,
      );
      await expect(c.locator("[contenteditable=true]")).toBeVisible({
        timeout: 60000,
      });
      await expect(c.locator("[contenteditable=true]")).toBeEmpty();
      await expect(
        c.getByRole("button", { name: "停止生成", exact: true }),
      ).toBeVisible({ timeout: 15000 });
      await expect(
        pages[i].getByLabel("该轮已中断", { exact: true }),
      ).toHaveCount(0);
    }
    metrics = await native.call("metrics");
    activeAfterRefresh = metrics;
    expect(metrics.calls).toHaveLength(3);
    for (const t of metrics.threads) {
      expect(t.history.data).toHaveLength(1);
      expect(t.metadata.thread.status.type).toBe("active");
    }
    await native.call("release");
    await expect
      .poll(
        async () =>
          (await native.call("metrics")).notifications.filter(
            (n: any) => n.method === "turn/completed",
          ).length,
        { timeout: 45000 },
      )
      .toBe(3);
    for (let i = 0; i < 3; i++) {
      const p = pages[i],
        c = p.locator(
          `.session-codex-composer[data-owner-thread="${native.threadIds[i]}"]`,
        );
      await expect(
        p.getByText(`M55_NATIVE_REPLY_${i}_COMPLETED`, { exact: true }),
      ).toBeVisible({ timeout: 30000 });
      await expect(c.locator("[contenteditable=true]")).toBeEmpty();
      await expect(
        c.getByRole("button", { name: "停止生成", exact: true }),
      ).toHaveCount(0);
      await expect(c.locator(".session-composer-send")).toHaveCount(1);
      await expect(p.getByLabel("消息队列", { exact: true })).toHaveCount(0);
      await expect(c.locator("[aria-busy=true]")).toHaveCount(0);
      expect(
        await c.locator(".session-composer-send").getAttribute("aria-busy"),
      ).not.toBe("true");
      ui.push({
        page: i,
        target: native.threadIds[i],
        reply: `M55_NATIVE_REPLY_${i}_COMPLETED`,
        draftEmpty: true,
        stop: false,
        send: true,
      });
    }
    await expect
      .poll(
        async () =>
          (await native.call("metrics")).cli.tail.includes(
            "M55_NATIVE_REPLY_0_COMPLETED",
          ),
        { timeout: 15000 },
      )
      .toBe(true);
    metrics = await native.call("metrics");
    expect(metrics.errors).toEqual([]);
    expect(errors).toEqual([]);
    expect(metrics.calls).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const t = metrics.threads[i];
      expect(t.threadId).toBe(native.threadIds[i]);
      expect(t.history.data).toHaveLength(1);
      expect(t.history.data[0].status).toBe("completed");
      expect(t.queue.data).toEqual([]);
      expect(JSON.stringify(t.history.data[0])).toContain(
        `M55_PAGE_${i}_ONLY_ONCE`,
      );
      expect(JSON.stringify(t.history.data[0])).toContain(
        `M55_NATIVE_REPLY_${i}_COMPLETED`,
      );
    }
    expect(pageRequests).toHaveLength(3);
    expect(
      new Set(pageRequests.map((x) => x.body.threadId ?? x.body.thread_id))
        .size,
    ).toBe(3);
    await writeFile(
      info.outputPath("m55-real-chain.json"),
      JSON.stringify(
        {
          sourceFrontend: process.env.M55_FRONTEND_SOURCE,
          origin: native.origin,
          officialVersion: native.officialVersion,
          identity: native.identity,
          threadIds: native.threadIds,
          cli,
          pageRequests,
          ui,
          activeAfterRefresh,
          metrics,
          errors,
          boundary:
            "Actual UI/no Fetch interception → LAN HTTPS → production gateway → complete runtime → private official0.163/local Responses provider; actual PTY CLI resumes exact same task. Three independent browsercontexts include393px; no real account/defaultIPC/model service. Not a latency benchmark. Unknown HTTP ACK loss and real account policy are not injected; active-task refreshes must not create duplicate native turns/provider calls.",
        },
        null,
        2,
      ),
    );
  } catch (e) {
    try {
      metrics = await native.call("metrics");
    } catch {}
    await writeFile(
      info.outputPath("m55-failure.json"),
      JSON.stringify(
        { metrics, errors, pageRequests, stderr: native.stderr() },
        null,
        2,
      ),
    );
    for (let i = 0; i < pages.length; i++)
      await pages[i]
        .screenshot({ path: info.outputPath(`m55-page-${i}.png`) })
        .catch(() => {});
    throw e;
  } finally {
    for (const c of contexts) await c.close();
    const closed = await native.close();
    await writeFile(
      info.outputPath("m55-owned-cleanup.json"),
      JSON.stringify(closed, null, 2),
    );
    expect(closed.ownedExited).toBe(true);
    expect(closed.cliExited).toBe(true);
  }
});

test("M03 real new chat captures project/model and accepts one native first turn", async ({ browser }, info) => {
  test.skip(
    !process.env.SESSION_CODEX_DAEMON_NATIVE_BIN || !process.env.M55_FRONTEND_SOURCE,
    "Requires explicit pinned official0.163 binary and existing frontend; private no-login fixture only",
  );
  test.setTimeout(240000);
  const native = await nativeFixture("m03"),
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } }),
    page = await context.newPage(),
    errors: string[] = [],
    apiRequests: Array<{ path: string; body: any }> = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() !== "POST" || !new URL(request.url()).pathname.startsWith("/api/session/")) return;
    let body: any;
    try { body = request.postDataJSON(); } catch { body = {}; }
    apiRequests.push({ path: new URL(request.url()).pathname, body });
  });
  try {
    await context.addInitScript(({ project }) => {
      localStorage.setItem("kanban.workbench.mode", "session");
      localStorage.setItem("kanban.session.agent-center-store", JSON.stringify({
        version: 5,
        state: { cards: [], currentAgentCardId: null, currentAgentCardKind: "codex", cardsViewMode: "solo", sharedTabsInitialized: true },
      }));
      localStorage.setItem("kanban.session.workspace", JSON.stringify({
        version: 1,
        state: { projects: [project], cwd: project, projectsInitialized: true, historyProjects: [project] },
      }));
      localStorage.setItem("kanban.session.layout-storage", JSON.stringify({
        version: 0,
        state: { view: "agent", isSidebarOpen: false, isRightPanelOpen: false },
      }));
      const prefix = "kanban.session.codex-config-storage.v3.";
      localStorage.setItem(prefix + "model", JSON.stringify("fixture"));
      localStorage.setItem(prefix + "modelProvider", JSON.stringify("fixture"));
      localStorage.setItem(prefix + "sandbox", JSON.stringify("read-only"));
      localStorage.setItem(prefix + "approvalPolicy", JSON.stringify("untrusted"));
    }, { project: native.project });
    await page.goto(native.origin + "/?mode=session", { waitUntil: "domcontentloaded" });
    const newChat = page.locator(".session-new-tab button");
    await expect(newChat).toBeVisible({ timeout: 60000 });
    await newChat.click();
    const composer = page.locator(".session-native-composer");
    const editor = composer.locator("[contenteditable=true]");
    await expect(editor).toBeVisible();
    expect(await composer.getAttribute("data-owner-thread")).toBeNull();
    await expect.poll(() => apiRequests.filter((request) => request.path.endsWith("/thread/start")).length).toBe(0);

    const prompt = "M03_FIRST_TURN_ONLY_ONCE";
    await editor.fill(prompt);
    await composer.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(() => apiRequests.filter((request) => request.path.endsWith("/thread/start")).length).toBe(1);
    await expect.poll(() => apiRequests.filter((request) => request.path.endsWith("/followups/submit")).length).toBe(1);
    await expect.poll(async () => (await native.call("metrics")).calls.length).toBe(1);
    const start = apiRequests.find((request) => request.path.endsWith("/thread/start"))!;
    const submit = apiRequests.find((request) => request.path.endsWith("/followups/submit"))!;
    expect(start.body).toMatchObject({ cwd: native.project, model: "fixture" });
    expect(submit.body).toMatchObject({ text: prompt, mode: "queue" });
    await expect.poll(async () => composer.getAttribute("data-owner-thread")).not.toBeNull();
    const threadId = await composer.getAttribute("data-owner-thread");
    expect(threadId).toBeTruthy();
    expect(submit.body.threadId).toBe(threadId);
    await expect.poll(async () => {
      const metrics = await native.call("metrics");
      return metrics.notifications.some((event: any) => event.method === "turn/started" && event.threadId === threadId);
    }).toBe(true);
    // The native queue accepted the first turn while the private provider is
    // held, so this checks the exact draft clearing boundary.
    await expect(editor).toBeEmpty();
    const state = await native.call("threadState", { threadId });
    expect(state).toMatchObject({ threadId, cwd: native.project, model: "fixture" });
    await native.call("release");
    await expect(page.getByText("M03_NATIVE_REPLY_COMPLETED", { exact: true })).toBeVisible({ timeout: 45000 });
    const finished = await native.call("threadState", { threadId });
    expect(finished.latestTurn.status).toBe("completed");
    expect((await native.call("metrics")).calls).toHaveLength(1);
    expect((await native.call("metrics")).calls[0]).toMatchObject({
      url: "/v1/responses",
      remoteAddress: "127.0.0.1",
    });
    expect(apiRequests.filter((request) => request.path.endsWith("/thread/start"))).toHaveLength(1);
    expect(apiRequests.filter((request) => request.path.endsWith("/followups/submit"))).toHaveLength(1);
    expect(errors).toEqual([]);
    await writeFile(info.outputPath("m03-native-new-chat.json"), JSON.stringify({
      sourceFrontend: process.env.M55_FRONTEND_SOURCE,
      officialVersion: native.officialVersion,
      identity: native.identity,
      project: native.project,
      threadId,
      start: start.body,
      submit: submit.body,
      state: finished,
      providerCalls: (await native.call("metrics")).calls,
      errors,
      boundary: "Actual new-chat UI through HTTPS frontend/gateway/runtime to an isolated official 0.163 daemon and loopback provider; no real account or external model service.",
    }, null, 2));
  } catch (error) {
    await writeFile(info.outputPath("m03-native-new-chat-failure.json"), JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      apiRequests,
      errors,
      metrics: await native.call("metrics").catch((metricsError: unknown) => ({ error: String(metricsError) })),
    }, null, 2));
    throw error;
  } finally {
    await context.close();
    const closed = await native.close();
    await writeFile(info.outputPath("m03-owned-cleanup.json"), JSON.stringify(closed, null, 2));
    expect(closed.ownedExited).toBe(true);
    expect(closed.cliExited).toBe(true);
  }
});

test("M34 native two-page chat history preserves cursor, clips tool output and survives a cancelled read", async ({ browser }, info) => {
  test.skip(
    !process.env.SESSION_CODEX_DAEMON_NATIVE_BIN || !process.env.M55_FRONTEND_SOURCE,
    "Requires explicit pinned official0.163 binary and existing frontend; private no-login fixture only",
  );
  test.setTimeout(300000);
  const native = await nativeFixture("m34"),
    threadId = native.threadIds[0] as string,
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } }),
    page = await context.newPage(),
    errors: string[] = [],
    failedHistoryCursors: string[] = [],
    historyResponseUrls: string[] = [];
  let proof: any;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.endsWith("/thread/turns/list")) return;
    try {
      const cursor = request.postDataJSON()?.cursor;
      if (typeof cursor === "string") failedHistoryCursors.push(cursor);
    } catch { /* unrelated request body */ }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes("turns/list")) historyResponseUrls.push(`${response.request().method()} ${url.pathname}${url.search} ${response.status()}`);
    if (!url.pathname.endsWith("/thread/turns/list") || url.searchParams.get("view") !== "chat" || response.request().method() !== "POST") return;
  });
  try {
    proof = await native.call("historyProof", { threadId });
    expect(proof.turnCount).toBe(11);
    expect(proof.toolBodyBytes).toBe(65536);
    expect(proof.toolStartMarker).toBe(true);
    expect(proof.toolEndMarker).toBe(true);
    expect((await native.call("metrics")).calls).toHaveLength(12);
    await context.addInitScript(({ cards, selected, project }) => {
      localStorage.setItem("kanban.workbench.mode", "session");
      localStorage.setItem("kanban.session.agent-center-store", JSON.stringify({
        version: 5,
        state: { cards, currentAgentCardId: selected, currentAgentCardKind: "codex", cardsViewMode: "solo", sharedTabsInitialized: true },
      }));
      localStorage.setItem("kanban.session.workspace", JSON.stringify({
        version: 1,
        state: { projects: [project], cwd: project, projectsInitialized: true, historyProjects: [project] },
      }));
      localStorage.setItem("kanban.session.layout-storage", JSON.stringify({
        version: 0,
        state: { view: "agent", isSidebarOpen: false, isRightPanelOpen: false },
      }));
    }, { cards: native.cards, selected: threadId, project: native.project });
    await page.goto(native.origin + "/?mode=session", { waitUntil: "domcontentloaded" });
    const composer = page.locator(".session-codex-composer[data-owner-thread=\"" + threadId + "\"]");
    await expect(composer.locator("[contenteditable=true]")).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("M34_HISTORY_REPLY_10_COMPLETED", { exact: true })).toBeVisible({ timeout: 60000 });
    await expect.poll(async () => (await native.call("historyResponses")).some((response: any) => response.status === 200 && response.cursor === null && typeof response.nextCursor === "string" && response.nextCursor.length > 0)).toBe(true);
    const initial = (await native.call("historyResponses")).find((response: any) => response.status === 200 && response.cursor === null && typeof response.nextCursor === "string" && response.nextCursor.length > 0)!;
    const cursor = String(initial.nextCursor);
    const entry = page.locator(".session-earlier-history");
    await expect(entry.getByRole("button", { name: "加载更早消息", exact: true })).toBeVisible();
    const syncPath = "/src/session-mode/stores/useSessionSyncStore.ts";
    const storedCursor = await page.evaluate(async ({ path, id }) => {
      const moduleUrl = performance.getEntriesByType("resource").findLast((item) => new URL(item.name).pathname === path)?.name ?? path;
      const { useSessionSyncStore } = await import(moduleUrl);
      return useSessionSyncStore.getState().cursors[id] ?? null;
    }, { path: syncPath, id: threadId });
    expect(storedCursor).toBe(cursor);

    // Hold one exact-cursor request at the self-owned HTTPS front door. The
    // native read is not admitted until after the old UI read is cancelled.
    await native.call("resetNativeMethods");
    await native.call("armHistoryGate", { threadId, cursor });
    await entry.getByRole("button", { name: "加载更早消息", exact: true }).click();
    await expect.poll(async () => (await native.call("historyGate"))?.entered).toBe(true);
    const tab = page.locator("[role=\"tab\"][data-tab-key=\"codex:" + threadId + "\"]");
    await tab.hover();
    await tab.locator("..").getByRole("button", { name: /^关闭标签：/ }).click();
    await expect(tab).toHaveCount(0);
    await expect.poll(async () => (await native.call("historyGate"))?.cancelled).toBe(true);
    await expect.poll(async () => (await native.call("historyRequests")).filter((request: any) => request.threadId === threadId && request.cursor === cursor).length).toBe(0);

    // Re-open the exact same tracked session with its original local tab seed.
    // The init script restores only local focus metadata; all history remains native.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(async ({ path, card }) => {
      const moduleUrl = performance.getEntriesByType("resource").findLast((item) => new URL(item.name).pathname === path)?.name ?? path;
      const { useAgentCenterStore } = await import(moduleUrl);
      useAgentCenterStore.getState().addAgentCard(card, { activate: true });
    }, {
      path: "/src/session-mode/stores/useAgentCenterStore.ts",
      card: { kind: "codex", id: threadId, cwd: native.project, preview: "M34 native history" },
    });
    await expect(composer.locator("[contenteditable=true]")).toBeVisible();
    await expect(entry.getByRole("button", { name: "加载更早消息", exact: true })).toBeVisible();
    const reopenedCursor = await page.evaluate(async ({ path, id }) => {
      const moduleUrl = performance.getEntriesByType("resource").findLast((item) => new URL(item.name).pathname === path)?.name ?? path;
      const { useSessionSyncStore } = await import(moduleUrl);
      return useSessionSyncStore.getState().cursors[id] ?? null;
    }, { path: syncPath, id: threadId });
    expect(reopenedCursor).toBe(cursor);
    const viewport = page.locator(".thread-surface").first().locator("xpath=ancestor::*[@data-slot=\"scroll-area-viewport\"]");
    await viewport.evaluate((element) => { element.scrollTop = 0; });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const anchorBefore = await viewport.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const row = [...element.querySelectorAll<HTMLElement>("[data-codex-row]")].find((item) => {
        const box = item.getBoundingClientRect();
        return box.bottom > rect.top && box.top < rect.bottom;
      });
      return row ? { key: row.dataset.codexRow, top: row.getBoundingClientRect().top } : null;
    });
    expect(anchorBefore).not.toBeNull();
    const priorResponseCount = (await native.call("historyResponses")).filter((response: any) => response.cursor === cursor && response.status === 200).length;
    await entry.getByRole("button", { name: "加载更早消息", exact: true }).click();
    await expect.poll(async () => (await native.call("historyResponses")).filter((response: any) => response.cursor === cursor && response.status === 200).length).toBeGreaterThan(priorResponseCount);
    const transcriptProof = await page.evaluate(async ({ path, id }) => {
      const moduleUrl = performance.getEntriesByType("resource").findLast((item) => new URL(item.name).pathname === path)?.name ?? path;
      const { useCodexStore } = await import(moduleUrl);
      const events = useCodexStore.getState().events[id] ?? [];
      return {
        hasOlderReply: events.some((event: any) => event.params?.item?.text === "M34_HISTORY_REPLY_0_COMPLETED"),
        hasToolItem: events.some((event: any) => event.params?.item?.type === "commandExecution" && event.params?.item?.aggregatedOutput === null),
      };
    }, { path: "/src/session-mode/components/codex/stores/useCodexStore.ts", id: threadId });
    expect(transcriptProof.hasOlderReply).toBe(true);
    expect(transcriptProof.hasToolItem).toBe(true);
    const older = (await native.call("historyResponses")).findLast((response: any) => response.cursor === cursor && response.status === 200)!;
    expect(older.body.data.flatMap((turn: any) => turn.items ?? []).some((item: any) => item?.content?.some((part: any) => part?.text === "M34_TURN_0"))).toBe(true);
    const tool = older.body.data.flatMap((turn: any) => turn.items ?? []).find((item: any) => item?.type === "commandExecution");
    expect(tool).toMatchObject({ aggregatedOutput: null, transcriptMetadataOnly: true });
    expect(JSON.stringify(older.body)).not.toContain("M34_TOOL_BODY_BEGIN");
    expect(JSON.stringify(older.body)).not.toContain("M34_TOOL_BODY_END");
    const viewportAfter = await viewport.evaluate((element, key) => {
      const row = [...element.querySelectorAll<HTMLElement>("[data-codex-row]")].find((item) => item.dataset.codexRow === key);
      return row ? { key: row.dataset.codexRow, top: row.getBoundingClientRect().top } : null;
    }, anchorBefore!.key);
    expect(viewportAfter?.key).toBe(anchorBefore!.key);
    expect(Math.abs(viewportAfter!.top - anchorBefore!.top)).toBeLessThan(2);
    await viewport.hover();
    await page.mouse.wheel(0, -10000);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const renderedTranscript = await viewport.evaluate((element) => ({
      scrollTop: element.scrollTop,
      rows: [...element.querySelectorAll<HTMLElement>("[data-codex-row]")].map((row) => ({
        key: row.dataset.codexRow,
        text: row.innerText.slice(0, 300),
      })),
    }));
    await expect(page.getByText("M34_HISTORY_REPLY_0_COMPLETED", { exact: true })).toBeVisible();
    const cursorAfter = await page.evaluate(async ({ path, id }) => {
      const moduleUrl = performance.getEntriesByType("resource").findLast((item) => new URL(item.name).pathname === path)?.name ?? path;
      const { useSessionSyncStore } = await import(moduleUrl);
      return useSessionSyncStore.getState().cursors[id] ?? null;
    }, { path: syncPath, id: threadId });
    expect(cursorAfter).toBeNull();

    const metrics = await native.call("metrics");
    expect(metrics.errors).toEqual([]);
    expect(metrics.calls).toHaveLength(12);
    expect(metrics.notifications.filter((event: any) => event.method === "turn/started" && event.threadId === threadId)).toHaveLength(11);
    const nativeMethods = await native.call("nativeMethods");
    const forbiddenNativeMethods = nativeMethods.filter((method: string) =>
      /^(?:thread\/(?:acquire|start|resume|fork|archive|unarchive|delete)|turn\/(?:start|steer|interrupt)|thread\/queue\/(?:push|clear|remove|change))$/.test(method),
    );
    expect(forbiddenNativeMethods).toEqual([]);
    const forbidden = metrics.requests.filter((request: any) => {
      const path = new URL(request.path, "http://fixture.invalid").pathname;
      return /\/(?:api\/)?codex\/(?:thread\/(?:start|resume|archive|unarchive)|turn\/(?:start|steer|interrupt))$|\/followups\/(?:submit|change|stop)$/.test(path);
    });
    expect(forbidden).toEqual([]);
    const nativeRequests = await native.call("historyRequests");
    expect(nativeRequests.filter((request: any) => request.threadId === threadId && request.cursor === cursor)).toHaveLength(1);
    expect(failedHistoryCursors).toContain(cursor);
    expect(errors).toEqual([]);
    await writeFile(info.outputPath("m34-native-history.json"), JSON.stringify({
      sourceFrontend: process.env.M55_FRONTEND_SOURCE,
      officialVersion: native.officialVersion,
      identity: native.identity,
      threadId,
      nativeHistoryProof: proof,
      initialPage: { cursor: initial.cursor, nextCursor: cursor, turnIds: initial.body.data.map((turn: any) => turn.id) },
      cancelledExactCursor: cursor,
      retryPage: { cursor: older.cursor, nextCursor: older.nextCursor, turnIds: older.body.data.map((turn: any) => turn.id), clippedTool: tool },
      transcriptProof,
      renderedTranscript,
      anchorBefore,
      anchorAfter: viewportAfter,
      nativeRequests,
      nativeMethods,
      forbiddenNativeMethods,
      forbidden,
      errors,
      boundary: "Actual UI/gateway/runtime chat projection over isolated official0.163. The canceled browser read was held at the owned HTTPS front door before runtime admission; the subsequent same-cursor retry traversed the production gateway and native reader. No external account/model, resume, acquire, send or management RPC is used during reads.",
    }, null, 2));
  } catch (error) {
    await writeFile(info.outputPath("m34-native-history-failure.json"), JSON.stringify({
      threadId,
      nativeHistoryProof: proof,
      gatewayHistoryResponses: await native.call("historyResponses").catch((responseError: unknown) => ({ error: String(responseError) })),
      transcriptProof: await page.evaluate(async ({ path, id }) => {
        const moduleUrl = performance.getEntriesByType("resource").findLast((item) => new URL(item.name).pathname === path)?.name ?? path;
        const { useCodexStore } = await import(moduleUrl);
        return (useCodexStore.getState().events[id] ?? []).map((event: any) => ({ method: event.method, type: event.params?.item?.type, text: event.params?.item?.text, outputPresent: typeof event.params?.item?.aggregatedOutput === "string" }));
      }, { path: "/src/session-mode/components/codex/stores/useCodexStore.ts", id: threadId }).catch((stateError: unknown) => ({ error: String(stateError) })),
      renderedTranscript: await page.locator(".thread-surface").first().evaluate((element) => ({ text: (element as HTMLElement).innerText.slice(0, 5000), rows: [...element.querySelectorAll<HTMLElement>("[data-codex-row]")].map((row) => ({ key: row.dataset.codexRow, text: row.innerText.slice(0, 300) })) })).catch((domError: unknown) => ({ error: String(domError) })),
      failedHistoryCursors,
      historyResponseUrls,
      gatewayHistoryRequests: await native.call("historyRequests").catch((requestError: unknown) => ({ error: String(requestError) })),
      nativeMethods: await native.call("nativeMethods").catch((methodError: unknown) => ({ error: String(methodError) })),
      errors,
      stderr: native.stderr(),
    }, null, 2));
    throw error;
  } finally {
    await context.close();
    const closed = await native.close();
    await writeFile(info.outputPath("m34-owned-cleanup.json"), JSON.stringify(closed, null, 2));
    expect(closed.ownedExited).toBe(true);
    expect(closed.cliExited).toBe(true);
  }
});
