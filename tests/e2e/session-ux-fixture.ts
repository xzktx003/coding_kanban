import {
  applySessionTabAction,
  type FollowedSession,
} from "../../packages/shared/src/session-tabs";
import { applyProjectAction } from "../../packages/shared/src/session-projects";
import type { Page } from "@playwright/test";

export async function installSessionUxFixture(page: Page, count = 40) {
  // Vite loads more than 250 modules. Retain their actual HMR URLs so test-side
  // imports use the mounted stores instead of creating a second module instance.
  await page.addInitScript(() => performance.setResourceTimingBufferSize(10_000));
  const calls: Array<{ path: string; body: any }> = [];
  let followed: FollowedSession[] = [];
  let projects = ["/fixture/项目/very-long-project-path-for-ui-regression"];
  const tabSequences = new Map<string, number>(),
    projectSequences = new Map<string, number>();
  const followups = new Map<string, any>();
  let listError = false;
  let healthError = false;
  const makeThread = (id: string, name: string) => ({
    id,
    name,
    preview: name,
    cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
    createdAt: 1,
    updatedAt: 2,
    modelProvider: "openai",
    status: { type: "idle" },
    turns: [],
  });
  const threads = Array.from({ length: count }, (_, i) =>
    makeThread(`ux-${i}`, `中文会话 ${i} ${"长标题".repeat(6)}`),
  );
  await page.routeWebSocket(/.*/, (ws) => ws.close());
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    if (request.method() !== "GET") calls.push({ path, body });
    let json: any = {};
    if (path === "/api/session/tabs" || path === "/api/session/projects") {
      const tabs = path.endsWith("/tabs"),
        sequences = tabs ? tabSequences : projectSequences;
      const client = body?.clientId ?? "fixture";
      let sequence = sequences.get(client) ?? 0;
      for (const operation of body?.operations ?? []) {
        if (operation.seq <= sequence) continue;
        if (tabs) followed = applySessionTabAction(followed, operation.action);
        else projects = applyProjectAction(projects, operation.action);
        sequence = operation.seq;
      }
      sequences.set(client, sequence);
      await route.fulfill({
        json: {
          initialized: true,
          revision: 1,
          sequence,
          ...(tabs ? { cards: followed } : { projects }),
        },
      });
      return;
    }

    if (path.startsWith("/api/session/followups")) {
      const threadId =
        body?.threadId ?? new URL(request.url()).searchParams.get("threadId");
      const state = followups.get(threadId) ?? {
        revision: 0,
        paused: null,
        items: [],
      };
      if (
        path.endsWith("/submit") &&
        !state.items.some((item: any) => item.id === body.id)
      ) {
        state.items.push({
          ...body,
          status: "sent",
          createdAt: Date.now(),
          turnId: `ux-turn-${threadId}`,
        });
        state.revision++;
      }
      if (path.endsWith("/stop")) {
        state.paused = "你已停止当前任务，队列已暂停";
        state.revision++;
      }
      followups.set(threadId, state);
      await route.fulfill({ json: state });
      return;
    }
    if (path.endsWith("/events")) {
      await route.fulfill({
        contentType: "text/event-stream",
        body: ": isolated fixture\n\n",
      });
      return;
    }
    if (path.includes("/health") || path.endsWith("/status"))
      json = {
        status: "ok",
        instance: "ux-fixture",
        capabilities: { acpImages: true },
        entries: [],
      };
    if (path.includes("/health") && healthError) {
      await route.fulfill({ status: 503, json: { error: "fixture offline" } });
      return;
    }
    if (path === "/api/agent-sessions")
      json = {
        items: [],
        activeAgentSessionId: null,
        updatedAt: new Date().toISOString(),
      };
    else if (path.endsWith("/settings")) json = {};
    else if (path.endsWith("/plugin/installed")) json = { marketplaces: [] };
    else if (path.endsWith("/cc/installed-skills")) json = [];
    else if (path.endsWith("/cc/slash-commands"))
      json = ["help", "compact", "review"];
    else if (path.endsWith("/account/get"))
      json = {
        account: {
          type: "chatgpt",
          email: "fixture@example.invalid",
          chatgptPlanType: "plus",
        },
        requiresOpenaiAuth: false,
      };
    else if (path.endsWith("/config/read")) json = { config: {} };
    else if (path.endsWith("/thread/list")) {
      if (listError) {
        await route.fulfill({
          status: 500,
          json: { error: "fixture list failure" },
        });
        return;
      }
      const offset = Number(body?.cursor ?? 0);
      const limit = body?.limit ?? 50;
      json = {
        data: threads.slice(offset, offset + limit),
        nextCursor:
          offset + limit < threads.length ? String(offset + limit) : null,
      };
    } else if (path.endsWith("/thread/start")) {
      const thread = makeThread("ux-created", "新的中文任务");
      threads.unshift(thread);
      json = { thread, model: "fixture-model", modelProvider: "openai" };
    } else if (path.endsWith("/thread/resume"))
      json = {
        thread:
          threads.find((t) => t.id === body?.threadId) ??
          makeThread(body?.threadId ?? "missing", "恢复的会话"),
      };
    else if (path.endsWith("/turn/start"))
      json = {
        turn: {
          id: "ux-turn",
          status: "inProgress",
          items: [],
          startedAt: 1,
          durationMs: null,
        },
      };
    else if (path.endsWith("/models") || path.endsWith("/model/list"))
      json = {
        data: [
          {
            id: "fixture-model",
            model: "fixture-model",
            displayName: "测试模型",
            description: "隔离测试模型",
            isDefault: true,
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "标准推理" },
            ],
            defaultReasoningEffort: "medium",
            inputModalities: ["text", "image"],
            supportsPersonality: false,
            additionalSpeedTiers: [],
            serviceTiers: [],
            defaultServiceTier: null,
          },
        ],
        nextCursor: null,
      };
    else if (path.endsWith("/files/upload"))
      json = { path: "/fixture/upload.png" };
    else if (path.endsWith("/git/branch-info"))
      json = {
        branch: "feature/long-branch-name-for-layout",
        isDetached: false,
      };
    else if (path.endsWith("/git/diff-stats"))
      json = {
        staged: { additions: 0, deletions: 0 },
        unstaged: { additions: 0, deletions: 0 },
      };
    else if (path.endsWith("/ssh-hosts")) json = { hosts: [] };
    else if (path.endsWith("/workbench/projects")) json = { projects: [] };
    else if (
      /(read-directory|bots\/list|acp\/agents|acp\/sessions|automations\/list|account.*\/list)$/.test(
        path,
      )
    )
      json = [];
    else if (path.endsWith("/skills/list")) json = { data: [] };
    else if (
      /\/codex\/(provider\/(list|presets)|model\/list-other)$/.test(path)
    )
      json = [];
    await route.fulfill({ json });
  });
  return {
    calls,
    threads,
    setListError: (value: boolean) => {
      listError = value;
    },
    setHealthError: (value: boolean) => {
      healthError = value;
    },
  };
}

export async function seedSessionUx(page: Page, count = 1) {
  await page.evaluate(async (count) => {
    const { useCodexStore } = await import(
      performance
        .getEntriesByType("resource")
        .find(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/components/codex/stores/index.ts",
        )?.name ?? "/src/session-mode/components/codex/stores/index.ts"
    );
    const { useConfigStore } = await import(
      performance
        .getEntriesByType("resource")
        .find(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/components/codex/stores/useConfigStore.ts",
        )?.name ?? "/src/session-mode/components/codex/stores/useConfigStore.ts"
    );
    const { useWorkspaceStore } = await import(
      performance
        .getEntriesByType("resource")
        .find(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useWorkspaceStore.ts",
        )?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts"
    );
    const { useLayoutStore } = await import(
      performance
        .getEntriesByType("resource")
        .find(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useLayoutStore.ts",
        )?.name ?? "/src/session-mode/stores/useLayoutStore.ts"
    );
    const { useAgentSettingsStore } = await import(
      performance
        .getEntriesByType("resource")
        .find(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useAgentSettingsStore.ts",
        )?.name ?? "/src/session-mode/stores/useAgentSettingsStore.ts"
    );
    const { useAgentCenterStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) =>
          e.name.includes("/src/session-mode/stores/useAgentCenterStore.ts"),
        )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
    );
    const { useAcpStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) =>
          entry.name.includes("/src/session-mode/stores/useAcpStore.ts"),
        )?.name ?? "/src/session-mode/stores/useAcpStore.ts"
    );
    const cwd = "/fixture/项目/very-long-project-path-for-ui-regression";
    const threads = Array.from({ length: count }, (_, i) => ({
      id: `ux-${i}`,
      name: `中文会话 ${i} ${"长标题".repeat(6)}`,
      preview: `中文会话 ${i}`,
      cwd,
      status: { type: "idle" },
      turns: [],
    }));
    useAcpStore.setState({ active: false });
    useAgentSettingsStore.setState({ selectedAgent: "codex" });
    useConfigStore.setState({ model: "fixture-model", threadCwdMode: "local" });
    useWorkspaceStore.setState({ projects: [cwd], cwd });
    useLayoutStore.setState({
      view: "agent",
      isSidebarOpen: true,
      isRightPanelOpen: false,
    });
    useCodexStore.setState({
      threads,
      currentThreadId: count ? "ux-0" : null,
      currentTurnId: null,
      events: { "ux-0": [] },
      threadStatusMap: {},
      turnTimingMap: {},
      activeThreadIds: threads.map((t) => t.id),
    });
    useAgentCenterStore.setState({
      cards: [],
      currentAgentCardId: null,
      cardsViewMode: "solo",
    });
  }, count);
}

/** Compact single-group navigation keeps layout choices in the layout menu. */
export async function chooseSessionLayout(page: Page, name: string) {
  const direct = page.getByRole('button', { name, exact: true });
  if (await direct.isVisible()) { await direct.click(); return; }
  const layout = page.getByRole('button', { name: '选择会话布局', exact: true });
  if (await layout.isVisible()) await layout.click();
  else await page.getByRole('button', { name: '更多功能', exact: true }).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
}
