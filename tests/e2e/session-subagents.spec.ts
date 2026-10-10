import { test, expect, type Page } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
async function setup(page: Page, options: { oldRound?: boolean; approval?: boolean } = {}) {
  const fixture = await installSessionUxFixture(page, 2), calls: any[] = [];
  const errorEvents: Array<{text:string,at:number}> = [], navigationAborts:number[]=[];
  const pendingReads=new Set<import("@playwright/test").Request>();
  page.on("request",r=>{if(/\/thread\/(read|turns\/list)$/.test(new URL(r.url()).pathname))pendingReads.add(r);});
  page.on("requestfinished",r=>pendingReads.delete(r));
  page.on("requestfailed",r=>{if(pendingReads.has(r)&&r.failure()?.errorText==="net::ERR_ABORTED")navigationAborts.push(Date.now());pendingReads.delete(r);});
  const errors=()=>errorEvents.filter(e=>!(e.text.includes("[CodexService] threadResume error: TypeError: Failed to fetch")&&navigationAborts.some(at=>Math.abs(at-e.at)<100))).map(e=>e.text);
  page.on("pageerror", e => errorEvents.push({text:e.message,at:Date.now()}));
  page.on("console", m => { if (m.type() === "error" && !m.text().startsWith("[vite]") && !m.text().includes("AbortError")) errorEvents.push({text:m.text().slice(0,1500),at:Date.now()}); });
  const now = Math.floor(Date.now() / 1000);
  const children: any[] = [
    { id: "child-atlas", parentThreadId: "ux-0", agentNickname: "Atlas", agentRole: "explorer", canAcceptDirectInput: true, status: { type: "active" }, preview: "检查状态同步", cwd: fixture.threads[0].cwd, createdAt: now - 5, updatedAt: now, turns: [{ id: "atlas-turn", status: "inProgress", startedAt: now - 5, durationMs: null, completedAt: null, items: [] }] },
    { id: "child-iris", parentThreadId: "ux-0", agentNickname: "Iris", agentRole: "reviewer", canAcceptDirectInput: false, status: { type: "active" }, preview: "检查审批路由", cwd: fixture.threads[0].cwd, createdAt: now - 5, updatedAt: now, turns: [{ id: "iris-turn", status: "inProgress", startedAt: now - 5, durationMs: null, completedAt: null, items: [] }] },
    { id: "child-echo", parentThreadId: "child-atlas", agentNickname: "Echo", canAcceptDirectInput: false, status: { type: "idle" }, preview: "嵌套任务", cwd: fixture.threads[0].cwd, turns: [{ id: "echo-turn", status: "completed", items: [] }] },
  ];
  (fixture.threads[0] as any).turns = [{ id: "parent-turn", status: "completed", startedAt: now - 8, completedAt: now - 5, durationMs: 3000, items: [{ id: "spawn", type: "collabAgentToolCall", tool: "spawnAgent", status: "completed", senderThreadId: "ux-0", receiverThreadIds: children.slice(0, 2).map(c => c.id), prompt: "并行检查", agentsStates: {}, model: "fixture-model", reasoningEffort: "high" }] }];
  if (options.oldRound) {
    const spawn = (fixture.threads[0] as any).turns[0].items[0];
    (fixture.threads[0] as any).turns = [
      { id: "old-parent", status: "completed", items: [{ ...spawn, id: "old-spawn", receiverThreadIds: ["child-iris"] }] },
      { id: "parent-turn", status: "completed", items: [{ ...spawn, receiverThreadIds: ["child-atlas"] }] },
    ];
  }
  const discovery = { complete: true, errors: [] as string[], unavailableIds: [] as string[] };
  if (options.approval) await page.route("**/api/session/api/events**", r => r.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ seq: 0, event: "codex/pending-requests-snapshot", payload: { requests: [{ event: "codex/approval-request", payload: { type: "commandExecution", threadId: "child-iris", turnId: "iris-turn", itemId: "cmd-iris", requestId: 17, command: ["pwd"], cwd: fixture.threads[0].cwd, reason: "子线程审批验收", proposedExecpolicyAmendment: null, startedAtMs: 1 } }] } })}\n\n` }));
  const cards = fixture.threads.map(t => ({ kind: "codex", id: t.id, cwd: t.cwd, preview: t.name }));
  await page.route("**/api/session/tabs", r => r.fulfill({ json: { cards, initialized: true, revision: 1, sequence: 0 } }));
  await page.addInitScript(cards => {
    localStorage.setItem("kanban.session.agent-center-store", JSON.stringify({ version: 5, state: { cards, currentAgentCardId: "ux-0", currentAgentCardKind: "codex", cardsViewMode: "solo", sharedTabsInitialized: true } }));
  }, cards);
  await page.route("**/api/session/subagents/**", async r => {
    const body = r.request().postDataJSON(), path = new URL(r.request().url()).pathname; calls.push({ body, path });
    if (path.endsWith("snapshot")) return r.fulfill({ json: { threads: body.rootId === "ux-0" ? children : [], ...discovery, checkedAt: Date.now() } });
    if (path.endsWith("verify")) return r.fulfill({ json: { thread: children.find(c => c.id === body.threadId) } });
    if (path.endsWith("roles")) return r.fulfill({ json: { roles: [{ name: "reviewer", description: "审查变更" }] } });
    return r.fulfill({ json: { results: body.targets.map((t: any) => ({ ...t, phase: "requested" })) } });
  });
  await page.route("**/api/session/api/codex/thread/turns/list", async r => {
    const body = r.request().postDataJSON(), child = children.find(c => c.id === body.threadId);
    if (!child) return r.fallback();
    return r.fulfill({ json: { data: child.turns, nextCursor: null } });
  });
  await page.route("**/api/session/files/upload", r => r.fulfill({ json: { path: "/fixture/child-draft.png" } }));
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page.locator(".session-agent-view [contenteditable=true]").first(); await editor.waitFor({ timeout: 8000 }).catch(e => { console.log(errors()); throw e; });
  await page.getByRole("button", { name: "查看子任务", exact: true }).click();
  (page as any).sessionOptFixture = {calls,get errors(){return errors();},navigationAborts};
  return { fixture, calls, get errors(){return errors();}, editor, children, discovery, pendingReads };
}
test.afterEach(async ({page},info) => {
  if(info.status === info.expectedStatus) return;
  const data = await page.evaluate(async () => {
    const module = async (suffix:string) => import(performance.getEntriesByType("resource").findLast(e=>e.name.includes(suffix))?.name ?? `/src/session-mode/${suffix}`);
    const {useSubagentStore}=await module("features/subagents/store.ts");
    const {useCodexStore}=await module("components/codex/stores/index.ts");
    const s=useSubagentStore.getState(),c=useCodexStore.getState();
    return {selection:s.selection,families:s.families,scope:s.scope,nodes:s.nodes,epoch:s.runtimeEpoch,currentThread:c.currentThreadId,timing:c.turnTimingMap,events:c.events};
  });
  await info.attach("subagent-failure-state",{body:JSON.stringify({data,...(page as any).sessionOptFixture},null,2),contentType:"application/json"});
});
test("child inspection preserves parent input and project; native V2 child is read-only", async ({ page }) => {
  const f = await setup(page);
  await f.editor.fill("主会话草稿保留");
  await page.locator('[data-subagent-id="child-iris"]').click({timeout:10000}).catch(async error => {
    const stores = await page.evaluate(async () => {
      const module = async (suffix: string) => import(performance.getEntriesByType("resource").findLast(e => e.name.includes(suffix))?.name ?? `/src/session-mode/${suffix}`);
      const {useSubagentStore} = await module("features/subagents/store.ts");
      const {useCodexStore} = await module("components/codex/stores/index.ts");
      const s=useSubagentStore.getState(), c=useCodexStore.getState();
      return {selection:s.selection,families:s.families,scope:s.scope,nodes:s.nodes,currentThread:c.currentThreadId,timing:c.turnTimingMap,events:c.events};
    });
    await test.info().attach("subagent-first-open-state",{body:JSON.stringify({stores,calls:f.calls,errors:f.errors},null,2),contentType:"application/json"});
    throw error;
  });
  await expect(page.getByText("由主 Agent 调度 · 子线程只读")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "发送给 Iris" })).toHaveCount(0);
  await page.screenshot({ path: ".dev-runtime/subagent-tests/desktop-detail.png", fullPage: true });
  await page.getByRole("button", { name: "在主会话中跟进 Iris" }).click();
  await expect(f.editor).toContainText("主会话草稿保留"); await expect(f.editor).toContainText("@Iris");
  expect(f.fixture.calls.filter(c => /thread\/resume|turn\/start/.test(c.path))).toEqual([]);
  await expect(page.locator('[role=tab][data-tab-key="codex:ux-0"]')).toHaveAttribute("aria-selected", "true");
  expect(f.errors).toEqual([]);
});
test("interactive child draft and image restore after refresh without changing the main target", async ({ page }) => {
  const f = await setup(page);
  await f.editor.fill("主草稿");
  await page.locator('[data-subagent-id="child-atlas"]').click();
  const childDraft = page.getByRole("textbox", { name: "发送给 Atlas", exact: true });
  await childDraft.fill("子草稿输入一半");
  await page.locator('.session-subagent-input input[type=file]').setInputFiles({ name: "draft.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF5cAAAAASUVORK5CYII=", "base64") });
  await expect(page.locator('.session-subagent-input')).toContainText("ready");
  await page.getByRole("button", { name: "收起子任务", exact: true }).click();
  await page.getByRole("button", { name: "查看子任务", exact: true }).click();
  await expect(childDraft).toHaveValue("子草稿输入一半");
  // This case verifies durable drafts after completed reads; navigation-aborted
  // background reads are exercised separately from page runtime errors.
  await expect.poll(() => f.pendingReads.size).toBe(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(childDraft).toHaveValue("子草稿输入一半").catch(async error => {
    const stores = await page.evaluate(async () => {
      const module = async (suffix: string) => import(performance.getEntriesByType("resource").findLast(e => e.name.includes(suffix))?.name ?? `/src/session-mode/${suffix}`);
      const {useSubagentStore} = await module("features/subagents/store.ts");
      const {useCodexStore} = await module("components/codex/stores/useCodexStore.ts");
      const s=useSubagentStore.getState(), c=useCodexStore.getState();
      return {selection:s.selection, families:s.families, scope:s.scope, nodes:s.nodes, currentThread:c.currentThreadId, timing:c.turnTimingMap, storage:Object.keys(localStorage).filter(k=>k.includes("subagent")).map(k=>[k,localStorage.getItem(k)])};
    });
    await test.info().attach("subagent-reload-state", {body:JSON.stringify({stores,calls:f.calls,errors:f.errors},null,2),contentType:"application/json"});
    throw error;
  });
  await expect(page.locator('.session-subagent-input')).toContainText("draft.png");
  await expect(f.editor).toHaveText("主草稿");
  expect(f.errors).toEqual([]);
});
test("role mentions retain native identity in a parent submission; stop scope uses real child turns", async ({ page }) => {
  const f = await setup(page);
  await page.locator('.session-subagent-filters').getByRole("button", { name: "全部历史" }).click();
  await page.getByRole("button", { name: "停止全部历史中的运行子任务…" }).click();
  await expect(page.getByRole("dialog")).toContainText("Atlas"); await expect(page.getByRole("dialog")).toContainText("Iris");
  await page.getByRole("button", { name: "确认停止", exact: true }).click();
  await expect.poll(() => f.calls.filter(c => c.path.endsWith("/stop")).length).toBe(1);
  expect(f.calls.find(c => c.path.endsWith("/stop")).body.targets).toEqual([{ threadId: "child-atlas", turnId: "atlas-turn" }, { threadId: "child-iris", turnId: "iris-turn" }]);
  await page.getByRole("button", { name: "收起子任务", exact: true }).click();
  await page.getByRole("button", { name: "引用子 Agent 或配置角色" }).click();
  await page.locator('.session-agent-mention-menu').getByRole("button", { name: "reviewer" }).click();
  await f.editor.fill("请审查变更");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(() => f.fixture.calls.filter(c => c.path.endsWith("/followups/submit")).length).toBe(1);
  expect(f.fixture.calls.find(c => c.path.endsWith("/followups/submit"))!.body.mentions).toEqual([{ name: "reviewer", path: "subagent://reviewer" }]);
  expect(f.errors).toEqual([]);
});
test("mobile child panel returns using the same entry and preserves input", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const f = await setup(page);
  await page.locator('[data-subagent-id="child-iris"]').click();
  await page.getByRole("button", { name: "返回子任务列表" }).click();
  await expect(page.locator('[data-subagent-id="child-atlas"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".dev-runtime/subagent-tests/mobile-list.png", fullPage: true });
  expect(f.errors).toEqual([]);
});

test("current-round stop excludes old running children even when they remain visible", async ({ page }) => {
  const f = await setup(page, { oldRound: true });
  await expect(page.locator('[data-subagent-id="child-iris"]')).toContainText("其他或未记录轮次");
  await page.getByRole("button", { name: "停止本轮运行子任务…" }).click();
  await expect(page.getByRole("dialog")).toContainText("Atlas");
  await expect(page.getByRole("dialog")).not.toContainText("Iris");
  await page.getByRole("button", { name: "确认停止", exact: true }).click();
  await expect.poll(() => f.calls.filter(c => c.path.endsWith("/stop")).length).toBe(1);
  expect(f.calls.find(c => c.path.endsWith("/stop")).body.targets).toEqual([{ threadId: "child-atlas", turnId: "atlas-turn" }]);
  expect(f.errors).toEqual([]);
});
test("incomplete discovery retains unavailable identities and avoids claiming completion", async ({ page }) => {
  const f = await setup(page);
  f.children.splice(f.children.findIndex(c => c.id === "child-atlas"), 1);
  f.discovery.complete = false; f.discovery.errors = ["fixture history unavailable"]; f.discovery.unavailableIds = ["child-atlas"];
  await page.locator('.session-subagent-filters').getByRole("button", { name: "刷新", exact: true }).click();
  await page.locator('.session-subagent-filters').getByRole("button", { name: "全部历史" }).click();
  await expect(page.locator('[data-subagent-id="child-atlas"]')).toContainText("状态待确认");
  await expect(page.getByText("子任务信息未完整确认，保留已知记录", { exact: false })).toBeVisible();
  expect(f.errors).toEqual([]);
});
test("nested descendants can fold and detail selection survives parent tab switching", async ({ page }) => {
  const f = await setup(page);
  await page.locator('.session-subagent-filters').getByRole("button", { name: "全部历史" }).click();
  await expect(page.locator('[data-subagent-id="child-echo"]')).toBeVisible();
  await page.getByRole("button", { name: "收起 Atlas 的后代" }).click();
  await expect(page.locator('[data-subagent-id="child-echo"]')).toHaveCount(0);
  await page.getByRole("button", { name: "展开 Atlas 的后代" }).click();
  await page.locator('[data-subagent-id="child-echo"]').click();
  await expect(page.locator('.session-subagent-detail-meta')).toContainText("Atlas / Echo");
  await page.locator('[role=tab][data-tab-key="codex:ux-1"]').click();
  await expect(page.locator('.session-subagent-panel')).not.toContainText("Atlas / Echo");
  await page.locator('[role=tab][data-tab-key="codex:ux-0"]').click();
  await expect(page.locator('.session-subagent-detail-meta')).toContainText("Atlas / Echo");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-subagent-id="child-echo"]')).toBeFocused();
  expect(f.errors).toEqual([]);
});
test("restricted child approval replies retain the child's RPC identity after parent completion", async ({ page }) => {
  const f = await setup(page, { approval: true });
  await page.locator('[data-subagent-id="child-iris"]').click();
  // Native approval cards keep the reason visible, including read-only child panes.
  await expect(page.locator('.session-subagent-panel').getByText("子线程审批验收", { exact: true })).toBeVisible();
  await page.locator('.session-subagent-panel').getByRole("button", { name: /拒绝|Decline/ }).click();
  await expect.poll(() => f.fixture.calls.filter(c => /approval\/command-execution/.test(c.path)).length).toBe(1);
  const reply = f.fixture.calls.find(c => /approval\/command-execution/.test(c.path))!;
  expect(reply.body.request_id).toBe(17);
  expect(reply.body.request).toEqual({ threadId: "child-iris", requestId: 17, turnId: "iris-turn", itemId: "cmd-iris" });
  expect(reply.body.decision).toBe("decline");
  expect(f.fixture.calls.filter(c => /thread\/resume|turn\/start/.test(c.path))).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("light theme and partial stop results remain explicit without changing the parent draft", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kanban.session.theme-storage", JSON.stringify({ version: 0, state: { theme: "light", accent: "default" } })));
  const f = await setup(page);
  await f.editor.fill("浅色主草稿");
  await page.route("**/api/session/subagents/stop", r => r.fulfill({ json: { results: [
    { threadId: "child-atlas", turnId: "atlas-turn", phase: "uncertain", message: "测试停止回执缺失" },
    { threadId: "child-iris", turnId: "iris-turn", phase: "superseded", message: "已开始新轮，原轮未停止" },
  ] } }));
  await page.locator('.session-subagent-filters').getByRole("button", { name: "全部历史" }).click();
  await page.getByRole("button", { name: "停止全部历史中的运行子任务…" }).click();
  await page.getByRole("button", { name: "确认停止", exact: true }).click();
  await expect(page.locator('.session-subagent-results')).toContainText("停止回执待确认");
  await expect(page.locator('.session-subagent-results')).toContainText("原轮已结束或已换轮");
  await expect(f.editor).toHaveText("浅色主草稿");
  await page.screenshot({ path: ".dev-runtime/subagent-tests/light-results.png", fullPage: true });
  expect(f.errors).toEqual([]);
});

test("unconfirmed inspection can be retried without granting child input or changing the parent", async ({ page }) => {
  const f = await setup(page);
  await f.editor.fill("验证失败也保留主草稿");
  await page.route("**/api/session/subagents/verify", r => r.fulfill({ json: { thread: { id: "foreign", canAcceptDirectInput: true } } }));
  await page.locator('[data-subagent-id="child-atlas"]').click();
  await expect(page.locator('.session-subagent-panel').getByRole("alert")).toContainText("身份尚未确认");
  await expect(page.getByRole("textbox", { name: "发送给 Atlas", exact: true })).toHaveCount(0);
  await page.unroute("**/api/session/subagents/verify");
  await page.getByRole("button", { name: "重新核对子任务" }).click();
  await expect(page.getByRole("textbox", { name: "发送给 Atlas", exact: true })).toBeVisible();
  await expect(f.editor).toHaveText("验证失败也保留主草稿");
  expect(f.fixture.calls.filter(c => /thread\/resume|turn\/start/.test(c.path))).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("allowed child submission sends its own target and native settings while preserving the parent", async ({ page }) => {
  const f = await setup(page);
  f.children[0].model = "child-specific-model"; f.children[0].reasoningEffort = "medium";
  await f.editor.fill("主会话继续保留");
  await page.locator('[data-subagent-id="child-atlas"]').click();
  await page.getByRole("textbox", { name: "发送给 Atlas", exact: true }).fill("子线程继续");
  await page.locator('.session-subagent-input').getByRole("button", { name: "发送给 Atlas", exact: true }).click();
  await expect.poll(() => f.fixture.calls.filter(c => c.path.endsWith("/followups/submit")).length).toBe(1);
  const submitted = f.fixture.calls.find(c => c.path.endsWith("/followups/submit"))!.body;
  expect(submitted.threadId).toBe("child-atlas"); expect(submitted.text).toBe("子线程继续");
  expect(submitted.parameters).toEqual({ cwd: f.children[0].cwd, model: "child-specific-model", effort: "medium" });
  await expect(page.getByRole("textbox", { name: "发送给 Atlas", exact: true })).toHaveValue("");
  await expect(f.editor).toHaveText("主会话继续保留");
  await expect(page.locator('[role=tab][data-tab-key="codex:ux-0"]')).toHaveAttribute("aria-selected", "true");
  expect(f.errors).toEqual([]);
});

test("a restored agent preference cannot hide the selected Codex family's inspector", async ({ page }) => {
  const f = await setup(page);
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useAgentSettingsStore.ts";
    const { useAgentSettingsStore } = await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path);
    useAgentSettingsStore.setState({ selectedAgent: "cc" });
  });
  await expect(page.locator('[data-subagent-id="child-atlas"]')).toBeVisible();
  await page.locator('[data-subagent-id="child-iris"]').click();
  await expect(page.locator('.session-subagent-panel')).toContainText("Iris");
  expect(f.errors).toEqual([]);
});
