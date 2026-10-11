import {
  applySessionTabAction,
  type FollowedSession,
} from "../../packages/shared/src/session-tabs";
import { applyProjectAction } from "../../packages/shared/src/session-projects";
import type { Page } from "@playwright/test";

export async function installSessionUxFixture(page: Page, count = 40) {
  // Vite loads more than 250 modules. Retain their actual HMR URLs so test-side
  // imports use the mounted stores instead of creating a second module instance.
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10_000);
    // Isolated Vite caches have instance-specific URLs. Product fixture roots
    // must share the mounted React/renderer, never import a second legacy cache.
    (window as any).__sessionFixtureDependency = (file: string) => {
      if (!["react.js", "react-dom_client.js"].includes(file))
        throw new Error("Unexpected fixture dependency");
      const entries = performance
        .getEntriesByType("resource")
        .filter((e) => new URL(e.name).pathname.endsWith(`/deps/${file}`));
      const mounted =
        entries.findLast((e) =>
          new URL(e.name).pathname.includes("/.dev-runtime/vite-cache/"),
        ) ?? entries.at(-1);
      if (!mounted)
        throw new Error(`Mounted fixture dependency unavailable: ${file}`);
      return mounted.name;
    };
  });
  const calls: Array<{ path: string; body: any }> = [];
  const delayedReads: Array<{
    threadId: string;
    release: Promise<void>;
    resolve: () => void;
  }> = [];
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
    if (request.method() !== "GET" && !path.endsWith("/model/list"))
      calls.push({ path, body });
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
        state.paused = "由于你中断了当前响应，队列已暂停";
        state.revision++;
      }
      if (path.endsWith("/change") && body?.action?.type === "retry") {
        const item = state.items.find((entry: any) => entry.id === body.action.id);
        if (item && (item.status === "failed" || item.status === "uncertain")) {
          item.status = "queued";
          item.error = undefined;
          state.revision++;
        }
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
    else if (path.endsWith("/subagents/snapshot"))
      json = {
        threads: [
          {
            id: "bg-child",
            name: "检查测试",
            preview: "检查测试",
            parentThreadId: "ux-0",
            status: { type: "idle" },
            model: "fixture-model",
            turns: [
              {
                id: "bg-turn",
                status: calls.some((call) => call.path.endsWith("/subagents/stop"))
                  ? "interrupted"
                  : "inProgress",
                startedAt: 1,
                items: [],
              },
            ],
            canAcceptDirectInput: false,
          },
        ],
        complete: true,
        errors: [],
        checkedAt: Date.now(),
      };
    else if (path.endsWith("/subagents/roles")) json = { roles: [] };
    else if (path.endsWith("/subagents/stop"))
      json = { results: body?.targets ?? [] };
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
    } else if (path.endsWith("/thread/delete")) {
      threads.splice(
        0,
        threads.length,
        ...threads.filter((thread) => thread.id !== body?.threadId),
      );
      json = {};
    } else if (path.endsWith("/thread/fork")) {
      const parent = threads.find((t) => t.id === body?.threadId) ?? threads[0];
      const id = threads.some((thread) => thread.id === "ux-side")
        ? "ux-fork"
        : "ux-side";
      const thread = makeThread(id, id === "ux-fork" ? "分叉聊天" : "侧边聊天");
      thread.cwd = parent?.cwd ?? thread.cwd;
      thread.turns = parent?.turns ?? [];
      threads.unshift(thread);
      json = { thread, model: "fixture-model", modelProvider: "openai" };
    } else if (path.endsWith("/thread/start")) {
      const thread = makeThread("ux-created", "新的中文任务");
      threads.unshift(thread);
      json = { thread, model: "fixture-model", modelProvider: "openai" };
    } else if (path.endsWith("/thread/turns/list")) {
      const thread = threads.find((t) => t.id === body?.threadId);
      const turns = [...(thread?.turns ?? [])];
      if (body?.sortDirection === "desc") turns.reverse();
      const offset = Number(body?.cursor ?? 0),
        limit = body?.limit ?? 10;
      json = {
        data: turns.slice(offset, offset + limit),
        nextCursor:
          offset + limit < turns.length ? String(offset + limit) : null,
        backwardsCursor: String(offset),
      };
    } else if (path.endsWith("/thread/access"))
      json = { state: "owned", reason: "", generation: 1 };
    else if (path.endsWith("/thread/read")) {
      const hold = delayedReads.find((item) => item.threadId === body?.threadId);
      if (hold) await hold.release;
      json = {
        thread:
          threads.find((t) => t.id === body?.threadId) ??
          makeThread(body?.threadId ?? "missing", "恢复的会话"),
      };
    } else if (path.endsWith("/turn/start"))
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
            upgrade: "fixture-next",
            upgradeInfo: {
              model: "fixture-next",
              upgradeCopy: "目录提供的替换说明",
              modelLink: null,
              migrationMarkdown: null,
              retirementAt: 1800000000,
            },
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
            serviceTiers: [
              { id: "fast", name: "Fast", description: "更快" },
              { id: "ultra", name: "Ultra", description: "最快" },
            ],
            defaultServiceTier: null,
          },
          {
            id: "fixture-next",
            model: "fixture-next",
            displayName: "接替模型",
            description: "替换测试模型",
            isDefault: false,
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "轻度" },
              { reasoningEffort: "medium", description: "标准推理" },
              { reasoningEffort: "high", description: "高" },
            ],
            defaultReasoningEffort: "medium",
            inputModalities: ["text"],
            supportsPersonality: false,
            additionalSpeedTiers: [],
            serviceTiers: [
              { id: "fast", name: "Fast", description: "更快" },
              { id: "ultra", name: "Ultra", description: "最快" },
            ],
            defaultServiceTier: null,
            upgrade: null,
            upgradeInfo: null,
          },
        ],
        nextCursor: null,
      };
    else if (path.endsWith("/files/upload"))
      json = { path: "/fixture/upload.png" };
    else if (path.endsWith("/git/branch-info"))
      json = {
        owner: "fixture",
        repo: "fixture",
        branch: "feature/long-branch-name-for-layout",
        isDetached: false,
      };
    else if (path.endsWith("/git/list-branches"))
      json = {
        current: "feature/long-branch-name-for-layout",
        branches: ["feature/long-branch-name-for-layout", "main"],
      };
    else if (path.endsWith("/git/status"))
      json = {
        entries: [
          { path: "src/app.ts", index_status: "M", worktree_status: " " },
          { path: "src/conflict.ts", index_status: "U", worktree_status: "U" },
        ],
      };
    else if (path.endsWith("/git/file-numstat"))
      json = [
        { path: "src/app.ts", additions: 4, deletions: 1 },
        { path: "src/conflict.ts", additions: 2, deletions: 2 },
      ];
    else if (path.endsWith("/git/commit")) json = "fixture-commit";
    else if (path.endsWith("/git/checkout-branch")) json = {};
    else if (path.endsWith("/git/create-branch")) json = {};
    else if (path.endsWith("/git/blame-line"))
      json = {
        present: true,
        hash: "abcdef1234567890",
        shortHash: "abcdef1",
        author: "Test",
        date: "2026-10-11",
        summary: "initial",
      };
    else if (path.endsWith("/workspace-files/read"))
      json = {
        path: body?.path,
        content: "alpha\nbeta\n目标行\n",
        version: "fixture",
        size: 20,
      };
    else if (path.endsWith("/git/diff-stats"))
      json = {
        staged: { additions: 0, deletions: 0 },
        unstaged: { additions: 0, deletions: 0 },
      };
    else if (path.endsWith("/filesystem/canonicalize-path")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body?.path ?? "/fixture"),
      });
      return;
    }
    else if (path.endsWith("/filesystem/read-directory")) json = [];
    else if (path.endsWith("/ssh-hosts")) json = { hosts: [] };
    else if (path.endsWith("/workbench/projects")) json = { projects: [] };
    else if (
      /(bots\/list|acp\/agents|acp\/sessions|automations\/list|account.*\/list)$/.test(
        path,
      )
    )
      json = [];
    else if (path.endsWith("/skills/list"))
      json = {
        data: [
          {
            cwd: "/fixture",
            errors: [],
            skills: [
              {
                name: "review-skill",
                description: "检查当前改动",
                path: "/fixture/.codex/skills/review-skill",
                scope: "repo",
                enabled: true,
              },
            ],
          },
        ],
      };
    else if (path.endsWith("/mcp/status/list"))
      json = {
        data: [
          {
            name: "fixture-mcp",
            serverInfo: null,
            tools: { ping: {} },
            resources: [],
            resourceTemplates: [],
            authStatus: "unsupported",
          },
        ],
        nextCursor: null,
      };
    else if (path.endsWith("/feedback/upload"))
      json = { threadId: "ux-0" };
    else if (path.endsWith("/guardian-denial/snapshot")) {
      const identity = body?.identity ?? {};
      json = {
        identity,
        runtimeInstance: "fixture-runtime",
        approvalToken: "a".repeat(64),
        canApprove: true,
        canAcceptDirectInput: true,
        state: "available",
        review: {
          ...identity,
          decisionSource: "agent",
          review: {
            status: "denied",
            riskLevel: "high",
            userAuthorization: "unknown",
            rationale: "需要明确授权",
          },
          action: {
            type: "command",
            source: "shell",
            command: "curl target",
            cwd: "/fixture",
          },
        },
      };
    } else if (path.endsWith("/guardian-denial/approve"))
      json = {
        identity: body?.identity,
        runtimeInstance: body?.runtimeInstance,
        clientRequestId: body?.clientRequestId,
        state: "recorded",
      };
    else if (path.endsWith("/git/create-worktree"))
      json = {
        repo_root: "/fixture",
        worktree_path: "/fixture/.codexia/worktrees/slash",
        existed: false,
        copied_env_files: [],
      };
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
    holdRead(threadId: string) {
      let resolve!: () => void;
      const release = new Promise<void>((done) => {
        resolve = done;
      });
      delayedReads.push({ threadId, release, resolve });
      return {
        seen: () =>
          calls.some(
            (call) =>
              call.path.endsWith("/thread/read") && call.body?.threadId === threadId,
          ),
        release: () => resolve(),
      };
    },
  };
}

export async function seedSessionUx(page: Page, count = 1) {
  await page.evaluate(async (count) => {
    const { useCodexStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/components/codex/stores/index.ts",
        )?.name ?? "/src/session-mode/components/codex/stores/index.ts"
    );
    const { useConfigStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/components/codex/stores/useConfigStore.ts",
        )?.name ?? "/src/session-mode/components/codex/stores/useConfigStore.ts"
    );
    const { useWorkspaceStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useWorkspaceStore.ts",
        )?.name ?? "/src/session-mode/stores/useWorkspaceStore.ts"
    );
    const { useLayoutStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useLayoutStore.ts",
        )?.name ?? "/src/session-mode/stores/useLayoutStore.ts"
    );
    const { useAgentSettingsStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast(
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
      historyLoadedMap: {},
      historyLoadingMap: {},
      historyErrorMap: {},
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
  const direct = page.getByRole("button", { name, exact: true });
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  const layout = page.getByRole("button", {
    name: "选择会话布局",
    exact: true,
  });
  if (await layout.isVisible()) await layout.click();
  else
    await page.getByRole("button", { name: "更多功能", exact: true }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}
