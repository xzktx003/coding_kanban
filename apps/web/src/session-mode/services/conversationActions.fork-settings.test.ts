// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxPolicy, Thread, ThreadForkResponse } from "../bindings/v2";

const api = vi.hoisted(() => ({
  threadFork: vi.fn(),
  threadAccess: vi.fn(),
  threadMetadata: vi.fn(),
  getJsonWithOptions: vi.fn(),
  postJsonWithOptions: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("./apiAdapt/codex", () => ({
  threadFork: api.threadFork,
  threadAccess: api.threadAccess,
  threadMetadata: api.threadMetadata,
}));
vi.mock("./apiAdapt/shared", async (original) => ({
  ...(await original<object>()),
  getJsonWithOptions: api.getJsonWithOptions,
  postJsonWithOptions: api.postJsonWithOptions,
}));

import { createSideChat } from "./conversationActions";
import { nativeThreadSettings } from "./nativeThreadSettings";
import { followupParameters } from "./followupService";
import { useCodexStore, useConfigStore } from "../components/codex/stores";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useSessionDraftStore } from "../stores/useSessionDraftStore";
import { useSideChatStore } from "../stores/useSideChatStore";
import {
  changeThreadModel,
  getThreadModelSettings,
  hydrateThreadModel,
  useThreadModelStore,
  type ThreadModelSettings,
} from "../stores/useThreadModelStore";

const PARENT = "fixture-fork-parent";
const CHILD = "fixture-fork-child";
const workspacePolicy: SandboxPolicy = {
  type: "workspaceWrite",
  writableRoots: ["/fixture/allowed", "/fixture/第二目录"],
  networkAccess: false,
  excludeTmpdirEnvVar: true,
  excludeSlashTmp: true,
};
const granularApproval = {
  granular: {
    sandbox_approval: true,
    rules: false,
    skill_approval: true,
    request_permissions: false,
    mcp_elicitations: true,
  },
} as const;
const fixtureThread = (id: string, cwd: string): Thread => ({
  id,
  extra: null,
  sessionId: "fixture-session",
  forkedFromId: id === CHILD ? PARENT : null,
  parentThreadId: null,
  preview: "fixture",
  ephemeral: false,
  isPinned: false,
  historyMode: "legacy",
  modelProvider: "fixture-provider",
  createdAt: 1,
  updatedAt: 1,
  recencyAt: 1,
  status: { type: "idle" },
  path: null,
  cwd,
  cliVersion: "fixture",
  source: "appServer",
  canAcceptDirectInput: true,
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: "fixture",
  turns: [],
});
const response = (
  patch: Partial<ThreadForkResponse> = {},
): ThreadForkResponse => ({
  thread: fixtureThread(CHILD, "/fixture/fork"),
  model: "fork-model",
  modelProvider: "fixture-provider",
  reasoningEffort: null,
  serviceTier: "fast",
  cwd: "/fixture/fork",
  runtimeWorkspaceRoots: ["/fixture/allowed"],
  instructionSources: ["/fixture/AGENTS.md"],
  approvalPolicy: granularApproval,
  approvalsReviewer: "auto_review",
  sandbox: structuredClone(workspacePolicy),
  activePermissionProfile: { id: "fixture-effective-profile", extends: null },
  multiAgentMode: "explicitRequestOnly",
  ...patch,
});

const outstanding: Array<{
  accept: () => void;
  task: Promise<string>;
}> = [];
function pendingFork(result = response()) {
  let accept!: () => void;
  const ack = new Promise<ThreadForkResponse>((resolve) => {
    accept = () => resolve(result);
  });
  api.threadFork.mockReturnValueOnce(ack);
  const task = createSideChat(PARENT);
  const entry = { accept, task };
  outstanding.push(entry);
  return async () => {
    accept();
    expect(await task).toBe(CHILD);
  };
}
function native(value: unknown) {
  hydrateThreadModel(CHILD, nativeThreadSettings(value));
}
function submit() {
  return followupParameters(CHILD);
}

beforeEach(() => {
  vi.resetAllMocks();
  const forbidden = () => {
    throw new Error("Unexpected IO in fork settings fixture");
  };
  for (const mock of [
    api.threadAccess,
    api.threadMetadata,
    api.getJsonWithOptions,
    api.postJsonWithOptions,
    api.fetch,
  ])
    mock.mockImplementation(forbidden);
  vi.stubGlobal("fetch", api.fetch);
  localStorage.clear();
  useThreadModelStore.setState({ threads: {} });
  useConfigStore.setState({
    model: "global-model",
    modelProvider: "openai",
    reasoningEffort: "medium",
    providerModels: { openai: "global-model" },
    serviceTier: "flex",
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    webSearchRequest: true,
    collaborationMode: "default",
    personality: null,
  });
  hydrateThreadModel(PARENT, {
    model: "parent-model",
    modelProvider: "parent-provider",
    reasoningEffort: "high",
    serviceTier: "flex",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    approvalPolicy: "untrusted",
    approvalsReviewer: "user",
  });
  useCodexStore.setState({
    currentThreadId: PARENT,
    currentTurnId: "fixture-parent-turn",
    threads: [fixtureThread(PARENT, "/fixture/parent")],
    events: {},
    activeThreadIds: [PARENT],
    threadStatusMap: { [PARENT]: { type: "idle" } },
    turnTimingMap: {},
  });
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: PARENT, cwd: "/fixture/parent" }],
    currentAgentCardId: PARENT,
    currentAgentCardKind: "codex",
    detachedCard: null,
    pendingTabOperations: [],
    nextTabSequence: 1,
    sharedTabsInitialized: false,
  });
  useSessionDraftStore.setState({ drafts: {}, migrated: [] });
  useSideChatStore.setState({ chat: null, focusTrigger: 0 });
});

afterEach(async () => {
  for (const entry of outstanding) entry.accept();
  await Promise.allSettled(outstanding.map((entry) => entry.task));
  outstanding.length = 0;
  for (const mock of [
    api.threadAccess,
    api.threadMetadata,
    api.getJsonWithOptions,
    api.postJsonWithOptions,
    api.fetch,
  ])
    expect(mock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("side-fork effective native settings", () => {
  it.each(["fast", null])(
    "uses the returned complex policy, reviewer, approval and tier %s in a followup",
    async (serviceTier) => {
      const result = response({ serviceTier });
      const accept = pendingFork(result);
      await accept();
      expect(submit()).toMatchObject({
        cwd: "/fixture/fork",
        model: result.model,
        effort: null,
        serviceTier,
        approvalPolicy: result.approvalPolicy,
        approvalsReviewer: result.approvalsReviewer,
        sandboxPolicy: result.sandbox,
      });
      expect(getThreadModelSettings(CHILD)).toMatchObject({
        modelProvider: result.modelProvider,
        sandbox: "workspace-write",
        webSearchRequest: false,
        autoReviewCapability: "auto_review",
      });
      expect(submit().sandboxPolicy).not.toBe(result.sandbox);
    },
  );

  it("retains an externalSandbox policy rather than reducing it to its display mode", async () => {
    const result = response({
      sandbox: { type: "externalSandbox", networkAccess: "restricted" },
      approvalPolicy: "on-request",
      approvalsReviewer: "guardian_subagent",
    });
    await pendingFork(result)();
    expect(submit()).toMatchObject({
      sandboxPolicy: result.sandbox,
      approvalPolicy: "on-request",
      approvalsReviewer: "guardian_subagent",
    });
  });

  it("keeps source choices, new-chat defaults, selection and the original fork wire unchanged", async () => {
    const source = structuredClone(getThreadModelSettings(PARENT));
    const defaults = {
      ...getThreadModelSettings(null),
      providerModels: { ...getThreadModelSettings(null).providerModels },
    };
    const result = response();
    const returned = structuredClone(result);
    await pendingFork(result)();
    expect(api.threadFork.mock.calls).toEqual([[{ threadId: PARENT }]]);
    expect(result).toEqual(returned);
    expect(getThreadModelSettings(PARENT)).toEqual(source);
    expect(getThreadModelSettings(null)).toEqual(defaults);
    expect(useCodexStore.getState()).toMatchObject({
      currentThreadId: PARENT,
      currentTurnId: "fixture-parent-turn",
    });
    expect(useAgentCenterStore.getState()).toMatchObject({
      currentAgentCardId: PARENT,
      currentAgentCardKind: "codex",
    });
    expect(useSideChatStore.getState().chat).toMatchObject({
      id: CHILD,
      parentId: PARENT,
    });
  });

  // These are ordered store-input fixtures while a deferred HTTP ACK is held.
  // They do not claim real SSE admission, delivery order or a native execution.
  it("fills missing permissions after model-only metadata without rolling its newer model back", async () => {
    const result = response();
    const accept = pendingFork(result);
    native({ model: "metadata-new-model" });
    await accept();
    expect(submit()).toMatchObject({
      model: "metadata-new-model",
      serviceTier: result.serviceTier,
      approvalPolicy: result.approvalPolicy,
      approvalsReviewer: result.approvalsReviewer,
      sandboxPolicy: result.sandbox,
    });
  });

  it("preserves newer full native settings after sparse metadata and a late fork ACK", async () => {
    const accept = pendingFork();
    native({
      model: "native-new-model",
      modelProvider: "native-new-provider",
      reasoningEffort: "high",
      serviceTier: null,
      sandbox: { type: "readOnly", networkAccess: true },
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
    });
    native({ model: "metadata-newest-model" });
    await accept();
    expect(getThreadModelSettings(CHILD)).toMatchObject({
      model: "metadata-newest-model",
      modelProvider: "native-new-provider",
      reasoningEffort: "high",
    });
    expect(submit()).toMatchObject({
      serviceTier: null,
      sandboxPolicy: { type: "readOnly", networkAccess: true },
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
    });
  });

  it("recovers newer native permissions received during only-model pending, despite a later sparse snapshot", async () => {
    const accept = pendingFork();
    native({
      model: "initial-model",
      modelProvider: "openai",
      effort: "medium",
    });
    changeThreadModel(CHILD, { model: "local-user-choice" });
    const notice = structuredClone(
      useThreadModelStore.getState().threads[CHILD].notice,
    );
    native({
      model: "native-new-model",
      modelProvider: "openai",
      effort: "medium",
      serviceTier: "flex",
      sandbox: { type: "readOnly", networkAccess: false },
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
    });
    const observed = structuredClone(
      useThreadModelStore.getState().threads[CHILD].observed,
    );
    native({ model: "metadata-newest-model" });
    await accept();
    expect(observed).toMatchObject({
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      serviceTier: "flex",
    });
    expect(submit()).toMatchObject({
      model: "local-user-choice",
      serviceTier: "flex",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
    });
    expect(useThreadModelStore.getState().threads[CHILD]).toMatchObject({
      pending: true,
      pendingFields: ["model"],
      notice,
    });
  });

  const pendingCases: Array<{
    name: string;
    patch: Partial<ThreadModelSettings>;
    parameters: Record<string, unknown>;
  }> = [
    {
      name: "sandbox and its null policy",
      patch: {
        sandbox: "read-only",
        sandboxPolicy: null,
        approvalPolicy: "untrusted",
      },
      parameters: {
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        approvalPolicy: "untrusted",
      },
    },
    {
      name: "web search and the complete native policy",
      patch: {
        webSearchRequest: true,
        sandboxPolicy: { ...workspacePolicy, networkAccess: true },
      },
      parameters: {
        sandboxPolicy: { ...workspacePolicy, networkAccess: true },
      },
    },
    {
      name: "reviewer",
      patch: { approvalsReviewer: "user" },
      parameters: { approvalsReviewer: "user" },
    },
    {
      name: "explicit null tier",
      patch: { serviceTier: null },
      parameters: { serviceTier: null },
    },
  ];
  it.each(pendingCases)(
    "preserves a newer user pending $name",
    async ({ patch, parameters }) => {
      const result = response();
      const accept = pendingFork(result);
      native(result);
      changeThreadModel(CHILD, patch);
      const before = useThreadModelStore.getState().threads[CHILD];
      await accept();
      expect(submit()).toMatchObject(parameters);
      expect(useThreadModelStore.getState().threads[CHILD]).toMatchObject({
        pending: true,
        pendingFields: before.pendingFields,
      });
      expect(useThreadModelStore.getState().threads[CHILD].notice).toEqual(
        before.notice,
      );
    },
  );

  it("does not restore a deliberately null policy and preserves its explicit same-value intent after sparse metadata", async () => {
    const result = response({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
    });
    const accept = pendingFork(result);
    native(result);
    changeThreadModel(CHILD, {
      sandbox: "workspace-write",
      sandboxPolicy: null,
      approvalPolicy: "on-request",
    });
    const pendingFields = [
      ...(useThreadModelStore.getState().threads[CHILD].pendingFields ?? []),
    ];
    native({ model: result.model });
    const afterSparse = useThreadModelStore.getState().threads[CHILD];
    await accept();
    expect(pendingFields).toEqual(["sandbox", "approvalPolicy"]);
    expect(afterSparse.pending).toBe(true);
    expect(getThreadModelSettings(CHILD).sandboxPolicy).toBeNull();
    expect(submit().sandboxPolicy).toEqual({
      type: "workspaceWrite",
      writableRoots: [],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    });
  });

  it("retains explicitly supplied provider and null effort even when they equal earlier inferred defaults", async () => {
    const result = response({ reasoningEffort: "high" });
    const accept = pendingFork(result);
    native({ model: result.model });
    native({ model: result.model, modelProvider: "openai", effort: null });
    await accept();
    expect(getThreadModelSettings(CHILD)).toMatchObject({
      model: result.model,
      modelProvider: "openai",
      reasoningEffort: null,
    });
    expect(submit().effort).toBeNull();
  });

  it("does not notify settings subscribers for repeated native confirmation or an identical fork seed", async () => {
    const result = response();
    await pendingFork(result)();
    native(result);
    const before = useThreadModelStore.getState().threads[CHILD];
    const notified = vi.fn();
    const unsubscribe = useThreadModelStore.subscribe(notified);
    try {
      native(result);
      native(result);
      await pendingFork(result)();
      expect(notified).not.toHaveBeenCalled();
      expect(useThreadModelStore.getState().threads[CHILD]).toBe(before);
    } finally {
      unsubscribe();
    }
  });

  it("keeps legacy entries conservative after sparse hydration instead of guessing provenance from defaults", async () => {
    const accept = pendingFork();
    native({ model: "legacy-model" });
    // Simulate the old persisted shape; never fabricate a canonical native value.
    useThreadModelStore.setState((state) => {
      const legacy = { ...state.threads[CHILD] };
      delete (legacy as unknown as Record<string, unknown>).nativeSettings;
      return { threads: { ...state.threads, [CHILD]: legacy } };
    });
    native({ model: "legacy-later-metadata" });
    const before = structuredClone(getThreadModelSettings(CHILD));
    await accept();
    expect(getThreadModelSettings(CHILD)).toMatchObject({
      model: before.model,
      modelProvider: before.modelProvider,
      serviceTier: before.serviceTier,
      sandbox: before.sandbox,
      approvalPolicy: before.approvalPolicy,
      approvalsReviewer: before.approvalsReviewer,
    });
  });

  it("does not use a revision-rejected native snapshot to supply the later fork's missing permissions", async () => {
    const result = response();
    const accept = pendingFork(result);
    native({ model: "initial-model" });
    const revision = useThreadModelStore.getState().threads[CHILD].revision;
    native({ model: "newer-model" });
    hydrateThreadModel(
      CHILD,
      nativeThreadSettings({
        model: "stale-model",
        serviceTier: "flex",
        sandbox: { type: "readOnly", networkAccess: false },
        approvalPolicy: "untrusted",
      }),
      { revision },
    );
    await accept();
    expect(submit()).toMatchObject({
      model: "newer-model",
      serviceTier: result.serviceTier,
      sandboxPolicy: result.sandbox,
      approvalPolicy: result.approvalPolicy,
    });
  });

  it.each(["mode", "network"] as const)(
    "keeps the current permission group when newer native metadata supplies only %s",
    async (field) => {
      const accept = pendingFork();
      const currentPolicy = { type: "readOnly", networkAccess: false } as const;
      native({
        model: "initial-model",
        sandbox: currentPolicy,
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
      });
      changeThreadModel(CHILD, { model: "local-user-choice" });
      native({
        model: "partial-native-model",
        ...(field === "mode"
          ? { sandbox: "workspace-write" }
          : { webSearchRequest: true }),
      });
      const notice = useThreadModelStore.getState().threads[CHILD].notice;
      await accept();
      expect(getThreadModelSettings(CHILD)).toMatchObject({
        model: "local-user-choice",
        sandbox: "read-only",
        sandboxPolicy: currentPolicy,
        webSearchRequest: false,
      });
      expect(submit()).toMatchObject({
        model: "local-user-choice",
        sandboxPolicy: currentPolicy,
        approvalPolicy: "untrusted",
      });
      expect(useThreadModelStore.getState().threads[CHILD]).toMatchObject({
        pending: true,
        pendingFields: ["model"],
        notice,
      });
    },
  );

  it("fills the fork's missing settings while preserving the original observed native snapshot", async () => {
    const result = response();
    const accept = pendingFork(result);
    native({ model: "metadata-model" });
    const observed = useThreadModelStore.getState().threads[CHILD].observed;
    const observedBefore = structuredClone(observed);
    await accept();
    expect(submit()).toMatchObject({
      model: "metadata-model",
      sandboxPolicy: result.sandbox,
      approvalPolicy: result.approvalPolicy,
      approvalsReviewer: result.approvalsReviewer,
      serviceTier: result.serviceTier,
    });
    expect(useThreadModelStore.getState().threads[CHILD].observed).toBe(
      observed,
    );
    expect(useThreadModelStore.getState().threads[CHILD].observed).toEqual(
      observedBefore,
    );
  });
});
