import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread, ThreadSettings } from "@session/bindings/v2";
import {
  changeThreadModel,
  getThreadModelSettings,
  hydrateThreadModel,
  useThreadModelStore,
  flushThreadModelSettings,
  resetThreadModelPersistenceForTests,
  type ThreadModelEntry,
} from "./useThreadModelStore";
import { nativeThreadSettings } from "@session/services/nativeThreadSettings";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { useSessionDraftStore, sessionDraftKey } from "./useSessionDraftStore";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { useServerNotificationHandler } from "@session/components/codex/hooks/useServerNotificationHandler";
import { followupParameters } from "@session/services/followupService";
import { codexService } from "@session/services/codexService";

const io = vi.hoisted(() => ({
  turnStart: vi.fn(),
  unexpected: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/codex", () => ({
  turnStart: io.turnStart,
  threadStart: io.unexpected,
  gitCreateWorktree: io.unexpected,
  listThreads: io.unexpected,
  skillList: io.unexpected,
  threadCompactStart: io.unexpected,
  threadFork: io.unexpected,
  threadGoalClear: io.unexpected,
  threadGoalGet: io.unexpected,
  threadGoalSet: io.unexpected,
  threadRead: io.unexpected,
  threadRollback: io.unexpected,
  turnInterrupt: io.unexpected,
  turnSteer: io.unexpected,
  allowSleep: io.unexpected,
  preventSleep: io.unexpected,
}));

vi.mock("@session/services/apiAdapt/git", () => ({ gitCreateWorktree: io.unexpected }));
vi.mock("@session/services/apiAdapt/skills", () => ({ skillList: io.unexpected }));
vi.mock("@session/services/apiAdapt/threadOps", () => ({ threadCompactStart: io.unexpected }));

type Profile = { id: string; extends: string | null };
type Field<T> = { kind: "value"; value: T } | { kind: "invalid" };
type Metadata = {
  activePermissionProfile?: Field<Profile | null>;
  runtimeWorkspaceRoots?: Field<readonly string[]>;
};
type Entry = ThreadModelEntry & { nativePermissionMetadata?: Metadata };
const A = "fixture-e5-store-a";
const B = "fixture-e5-store-b";
const KEY = "kanban.session.codex-thread-models";
const DRAFT = sessionDraftKey("codex", A);
let allowedTurnCalls = 0;
function base(id: string) {
  return {
    model: id === A ? "fixture-model-a" : "fixture-model-b",
    modelProvider: id === A ? "openai" : "fixture-custom",
    reasoningEffort: "medium" as const,
    serviceTier: "fast",
    sandbox: { type: "readOnly" as const, networkAccess: false },
    approvalPolicy: "on-request" as const,
    approvalsReviewer: "user" as const,
    collaborationMode: "default" as const,
  };
}
function native(
  id: string,
  fields: Record<string, unknown> = {},
  options: Parameters<typeof hydrateThreadModel>[2] = {},
) {
  hydrateThreadModel(
    id,
    nativeThreadSettings({ ...base(id), ...fields }),
    options,
  );
}
const entry = (id = A) => useThreadModelStore.getState().threads[id] as Entry;
function protectedRefs() {
  return {
    other: entry(B),
    defaults: useConfigStore.getState(),
    drafts: useSessionDraftStore.getState(),
    current: useCodexStore.getState().currentThreadId,
  };
}
function expectProtected(before: ReturnType<typeof protectedRefs>) {
  expect(entry(B)).toBe(before.other);
  expect(useConfigStore.getState()).toBe(before.defaults);
  expect(useSessionDraftStore.getState()).toBe(before.drafts);
  expect(useCodexStore.getState().currentThreadId).toBe(before.current);
}
function thread(id: string): Thread {
  return {
    id,
    extra: null,
    sessionId: "fixture-session",
    forkedFromId: null,
    parentThreadId: null,
    preview: "fixture",
    ephemeral: false,
    isPinned: false,
    historyMode: "legacy",
    modelProvider: base(id).modelProvider,
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: `/fixture/${id}`,
    cliVersion: "fixture",
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "fixture",
    turns: [],
  };
}
function seed() {
  native(A, {
    activePermissionProfile: { id: "fixture-profile-a", extends: null },
    runtimeWorkspaceRoots: ["/fixture/root-a"],
  });
  native(B, {
    activePermissionProfile: { id: "fixture-profile-b", extends: null },
    runtimeWorkspaceRoots: ["/fixture/root-b"],
  });
}
beforeEach(() => {
  localStorage.clear();
  io.turnStart
    .mockReset()
    .mockResolvedValue({
      turn: { id: "fixture-turn", status: "completed", items: [] },
    });
  io.unexpected.mockReset().mockImplementation(() => {
    throw new Error("Unexpected API in E5 data fixture");
  });
  io.fetch.mockReset().mockImplementation(() => {
    throw new Error("Unexpected network in E5 data fixture");
  });
  allowedTurnCalls = 0;
  vi.stubGlobal("fetch", io.fetch);
  useThreadModelStore.setState({ threads: {} });
  useConfigStore.setState({
    model: "fixture-global",
    modelProvider: "openai",
    reasoningEffort: "high",
    providerModels: {
      openai: "fixture-global",
      "fixture-custom": "fixture-default-custom",
    },
    serviceTier: null,
  });
  useSessionDraftStore.setState({ drafts: {}, migrated: [] });
  useSessionDraftStore
    .getState()
    .setText(DRAFT, "fixture draft remains untouched");
  useCodexStore.setState({
    currentThreadId: A,
    currentTurnId: null,
    activeThreadIds: [A, B],
    threads: [thread(A), thread(B)],
    events: {},
    historyLoadedMap: { [A]: true, [B]: true },
    threadStatusMap: {},
    turnTimingMap: {},
  });
  seed();
});
afterEach(() => {
  expect(io.unexpected).not.toHaveBeenCalled();
  expect(io.fetch).not.toHaveBeenCalled();
  expect(io.turnStart).toHaveBeenCalledTimes(allowedTurnCalls);
  vi.unstubAllGlobals();
});

describe("readonly native permission observations on real thread state", () => {
  it("increments once for metadata-only change, preserves other references and deduplicates equal receipts", () => {
    const protectedBefore = protectedRefs();
    const before = entry();
    const parameters = followupParameters(A);
    const notified = vi.fn();
    const unsubscribe = useThreadModelStore.subscribe(notified);
    try {
      native(A, {
        activePermissionProfile: { id: "fixture-next-profile", extends: null },
      });
      const changed = entry();
      expectProtected(protectedBefore);
      expect(followupParameters(A)).toEqual(parameters);
      expect(changed.revision).toBe(before.revision + 1);
      for (const key of [
        "observed",
        "nativeSettings",
        "providerModels",
        "pendingFields",
        "notice",
        "personalityNotice",
      ] as const)
        expect(changed[key]).toBe(before[key]);
      expect(changed.pending).toBe(before.pending);
      expect(changed.nativePermissionMetadata).toEqual({
        activePermissionProfile: {
          kind: "value",
          value: { id: "fixture-next-profile", extends: null },
        },
        runtimeWorkspaceRoots: { kind: "value", value: ["/fixture/root-a"] },
      });
      expect(changed.nativePermissionMetadata?.runtimeWorkspaceRoots).toBe(
        before.nativePermissionMetadata?.runtimeWorkspaceRoots,
      );
      expect(notified).toHaveBeenCalledTimes(1);
      notified.mockClear();
      const rootBeforeDuplicate = useThreadModelStore.getState();
      native(A, {
        activePermissionProfile: { extends: null, id: "fixture-next-profile" },
        runtimeWorkspaceRoots: ["/fixture/root-a"],
      });
      expect(useThreadModelStore.getState()).toBe(rootBeforeDuplicate);
      expect(entry()).toBe(changed);
      expect(entry().nativePermissionMetadata).toBe(
        changed.nativePermissionMetadata,
      );
      expect(notified).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("combines an ordinary native model change and metadata in one existing revision", () => {
    const before = entry();
    const protectedBefore = protectedRefs();
    native(A, {
      model: "fixture-native-new-model",
      activePermissionProfile: null,
      runtimeWorkspaceRoots: [],
    });
    expectProtected(protectedBefore);
    expect(entry()).toMatchObject({
      model: "fixture-native-new-model",
      pending: false,
      revision: before.revision + 1,
    });
    expect(entry().nativePermissionMetadata).toEqual({
      activePermissionProfile: { kind: "value", value: null },
      runtimeWorkspaceRoots: { kind: "value", value: [] },
    });
    for (const key of [
      "nativePermissionMetadata",
      "activePermissionProfile",
      "runtimeWorkspaceRoots",
    ]) {
      expect(entry().observed).not.toHaveProperty(key);
      expect(entry().nativeSettings).not.toHaveProperty(key);
    }
  });

  it("keeps the old pending/matching algorithm while recording new readonly observations", () => {
    changeThreadModel(A, {
      model: "fixture-local-pending",
      reasoningEffort: "high",
    });
    const pending = entry();
    const protectedBefore = protectedRefs();
    native(A, { activePermissionProfile: null });
    expectProtected(protectedBefore);
    expect(entry()).toMatchObject({
      model: "fixture-local-pending",
      reasoningEffort: "high",
      pending: true,
      revision: pending.revision + 1,
    });
    expect(entry().pendingFields).toBe(pending.pendingFields);
    expect(entry().notice).toBe(pending.notice);
    expect(entry().observed).toBe(pending.observed);
    expect(entry().nativeSettings).toBe(pending.nativeSettings);
    expect(entry().pendingFields).not.toContain("nativePermissionMetadata");
    expect(entry().nativePermissionMetadata?.activePermissionProfile).toEqual({
      kind: "value",
      value: null,
    });
    native(A, {
      model: "fixture-local-pending",
      reasoningEffort: "high",
      activePermissionProfile: null,
    });
    expect(entry()).toMatchObject({
      model: "fixture-local-pending",
      reasoningEffort: "high",
      pending: false,
      pendingFields: [],
    });
    expect(entry().notice).toBe(pending.notice);
  });

  it("uses metadata revisions to reject an older whole store commit and retains the no-model early return", () => {
    const captured = entry().revision;
    native(A, {
      activePermissionProfile: { id: "fixture-newer", extends: null },
    });
    const newer = entry();
    const root = useThreadModelStore.getState();
    const preparedOutsideHydrate = nativeThreadSettings({
      ...base(A),
      activePermissionProfile: { id: "fixture-stale", extends: null },
      runtimeWorkspaceRoots: ["/stale"],
    });
    hydrateThreadModel(A, preparedOutsideHydrate, { revision: captured });
    hydrateThreadModel(
      A,
      nativeThreadSettings({
        activePermissionProfile: null,
        runtimeWorkspaceRoots: [],
      }),
    );
    expect(useThreadModelStore.getState()).toBe(root);
    expect(entry()).toBe(newer);
    expect(entry().nativePermissionMetadata?.activePermissionProfile).toEqual({
      kind: "value",
      value: { id: "fixture-newer", extends: null },
    });
    // Pure normalization already ran above; rejection is only a store-acceptance promise.
  });

  it("initialOnly fills an unseen field but cannot overwrite explicit null or known empty roots", () => {
    useThreadModelStore.setState({ threads: {} });
    native(A, { activePermissionProfile: null });
    native(B);
    const before = entry();
    native(
      A,
      {
        model: "older-fork-model",
        activePermissionProfile: { id: "older-fork-profile", extends: null },
        runtimeWorkspaceRoots: [],
      },
      { initialOnly: true },
    );
    expect(entry().model).toBe(before.model);
    expect(entry().observed).toBe(before.observed);
    expect(entry().nativeSettings).toBe(before.nativeSettings);
    expect(entry().nativePermissionMetadata).toEqual({
      activePermissionProfile: { kind: "value", value: null },
      runtimeWorkspaceRoots: { kind: "value", value: [] },
    });
    const accepted = entry();
    native(
      A,
      {
        activePermissionProfile: { id: "still-older", extends: null },
        runtimeWorkspaceRoots: ["/must-not-replace-empty"],
      },
      { initialOnly: true },
    );
    expect(entry()).toBe(accepted);
  });

  it("initialOnly preserves invalid observations, while an ordinary good receipt replaces them", () => {
    native(A, {
      activePermissionProfile: { id: 3, extends: null },
      runtimeWorkspaceRoots: null,
    });
    const invalid = entry();
    native(
      A,
      {
        activePermissionProfile: { id: "older-valid", extends: null },
        runtimeWorkspaceRoots: ["/older-valid"],
      },
      { initialOnly: true },
    );
    expect(entry()).toBe(invalid);
    expect(entry().nativePermissionMetadata).toEqual({
      activePermissionProfile: { kind: "invalid" },
      runtimeWorkspaceRoots: { kind: "invalid" },
    });
    native(A, {
      activePermissionProfile: { id: "new-valid", extends: null },
      runtimeWorkspaceRoots: ["/new-valid"],
    });
    expect(entry().nativePermissionMetadata).toEqual({
      activePermissionProfile: {
        kind: "value",
        value: { id: "new-valid", extends: null },
      },
      runtimeWorkspaceRoots: { kind: "value", value: ["/new-valid"] },
    });
  });

  it("seeds only missing readonly observations on a legacy initialOnly entry without relaxing editable protection", () => {
    useThreadModelStore.setState((s) => {
      const legacy = { ...s.threads[A] } as Entry;
      const legacyRecord = legacy as unknown as Record<string, unknown>;
      delete legacyRecord.nativeSettings;
      delete legacyRecord.nativePermissionMetadata;
      return { threads: { ...s.threads, [A]: legacy } };
    });
    changeThreadModel(A, {
      model: "fixture-user-legacy-pending",
      sandbox: "read-only",
      sandboxPolicy: null,
    });
    const before = entry();
    const projected = getThreadModelSettings(A);
    const protectedBefore = protectedRefs();
    native(
      A,
      {
        model: "fork-must-not-change-user-model",
        sandbox: { type: "dangerFullAccess" },
        activePermissionProfile: { id: "fresh-explicit", extends: null },
        runtimeWorkspaceRoots: ["/fresh-explicit"],
      },
      { initialOnly: true },
    );
    expectProtected(protectedBefore);
    expect(getThreadModelSettings(A)).toMatchObject({
      model: projected.model,
      sandbox: projected.sandbox,
      sandboxPolicy: projected.sandboxPolicy,
      reasoningEffort: projected.reasoningEffort,
    });
    for (const key of [
      "observed",
      "nativeSettings",
      "providerModels",
      "pendingFields",
      "notice",
    ] as const)
      expect(entry()[key]).toBe(before[key]);
    expect(entry().pending).toBe(before.pending);
    expect(entry().revision).toBe(before.revision + 1);
    expect(entry().nativePermissionMetadata).toEqual({
      activePermissionProfile: {
        kind: "value",
        value: { id: "fresh-explicit", extends: null },
      },
      runtimeWorkspaceRoots: { kind: "value", value: ["/fresh-explicit"] },
    });
  });

  it("routes a real profile-only settings notification to B and retains B roots as independent last observation", () => {
    const beforeA = entry(A);
    const beforeB = entry(B);
    const defaults = useConfigStore.getState();
    const drafts = useSessionDraftStore.getState();
    const { result, unmount } = renderHook(() =>
      useServerNotificationHandler(
        {
          isCodexThreadActiveRef: { current: true },
          taskCompleteBeepModeRef: { current: "never" },
          preventSleepDuringTasksRef: { current: false },
        },
        async () => {
          throw new Error("Unexpected account refresh");
        },
      ),
    );
    const settings: ThreadSettings = {
      cwd: `/fixture/${B}`,
      model: base(B).model,
      modelProvider: base(B).modelProvider,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      activePermissionProfile: null,
      effort: "medium",
      serviceTier: "fast",
      summary: null,
      collaborationMode: {
        mode: "default",
        settings: {
          model: base(B).model,
          reasoning_effort: "medium",
          developer_instructions: null,
        },
      },
      multiAgentMode: "explicitRequestOnly",
      personality: null,
    };
    try {
      act(() =>
        result.current({
          method: "thread/settings/updated",
          params: { threadId: B, threadSettings: settings },
        }),
      );
      expect(entry(A)).toBe(beforeA);
      expect(useConfigStore.getState()).toBe(defaults);
      expect(useSessionDraftStore.getState()).toBe(drafts);
      expect(useCodexStore.getState().currentThreadId).toBe(A);
      expect(useCodexStore.getState().events).toEqual({});
      expect(entry(B).revision).toBe(beforeB.revision + 1);
      expect(entry(B).nativePermissionMetadata).toEqual({
        activePermissionProfile: { kind: "value", value: null },
        runtimeWorkspaceRoots: { kind: "value", value: ["/fixture/root-b"] },
      });
      const once = entry(B);
      act(() =>
        result.current({
          method: "thread/settings/updated",
          params: { threadId: B, threadSettings: { ...settings } },
        }),
      );
      expect(entry(B)).toBe(once);
    } finally {
      unmount();
    }
  });

  it.each([{ version: 2 }, { version: 1 }])(
    "strips volatile data on IDB writes and legacy version $version migration without dropping saved settings",
    async ({ version }) => {
      await Promise.all([
        flushThreadModelSettings(A),
        flushThreadModelSettings(B),
      ]);
      const readPersisted = async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("kanban.session.thread-models.v1", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<Record<string, ThreadModelEntry>>(
            (resolve, reject) => {
              const request = db
                .transaction("threads")
                .objectStore("threads")
                .getAll();
              request.onsuccess = () =>
                resolve(
                  Object.fromEntries(
                    request.result.map((row) => [row.id, row.entry]),
                  ),
                );
              request.onerror = () => reject(request.error);
            },
          );
        } finally {
          db.close();
        }
      };
      const saved = await readPersisted();
      expect(saved[A]).not.toHaveProperty("nativePermissionMetadata");
      const originalA = saved[A];
      const residue = {
        threads: {
          ...saved,
          [A]: {
            ...originalA,
            nativePermissionMetadata: {
              activePermissionProfile: {
                kind: "value",
                value: { id: ":danger-full-access", extends: null },
              },
              runtimeWorkspaceRoots: {
                kind: "value",
                value: ["/cached/not-current"],
              },
            },
          },
        },
      };
      await resetThreadModelPersistenceForTests();
      const backup = JSON.stringify({ state: residue, version });
      localStorage.setItem(KEY, backup);
      await useThreadModelStore.persist.rehydrate();
      expect(entry().nativePermissionMetadata).toBeUndefined();
      expect(entry()).toMatchObject({
        model: originalA.model,
        reasoningEffort: originalA.reasoningEffort,
        sandbox: originalA.sandbox,
        serviceTier: originalA.serviceTier,
        approvalPolicy: originalA.approvalPolicy,
      });
      expect(entry().observed).toEqual(originalA.observed);
      expect(entry().nativeSettings).toEqual(originalA.nativeSettings);
      expect(entry(B).model).toBe(base(B).model);
      changeThreadModel(A, { reasoningEffort: "high" });
      await flushThreadModelSettings(A);
      expect((await readPersisted())[A]).not.toHaveProperty(
        "nativePermissionMetadata",
      );
      expect(localStorage.getItem(KEY)).toBe(backup);
    },
  );

  it("excludes observations from runtime settings, captured hook edits, followup parameters and the actual turn DTO", async () => {
    const protectedBefore = protectedRefs();
    const metadataBefore = entry().nativePermissionMetadata;
    const { result, rerender, unmount } = renderHook(
      ({ id }) => useThreadModelSettings(id),
      { initialProps: { id: A } },
    );
    try {
      const runtimeSettings = getThreadModelSettings(A);
      expect(Object.hasOwn(runtimeSettings, "nativePermissionMetadata")).toBe(
        false,
      );
      expect(runtimeSettings).toMatchObject({
        model: entry().model,
        revision: entry().revision,
        pending: entry().pending,
      });
      for (const key of [
        "observed",
        "nativeSettings",
        "providerModels",
        "pendingFields",
      ] as const)
        expect(Reflect.get(runtimeSettings, key)).toBe(entry()[key]);
      expect(Object.hasOwn(result.current, "nativePermissionMetadata")).toBe(
        false,
      );
      const capturedA = result.current.setModelSelection;
      rerender({ id: B });
      act(() =>
        capturedA({
          model: "fixture-explicit-local-a",
          reasoningEffort: "high",
        }),
      );
      expect(entry().model).toBe("fixture-explicit-local-a");
      expect(entry().nativePermissionMetadata).toBe(metadataBefore);
      expectProtected(protectedBefore);
      expect(followupParameters(A)).not.toHaveProperty(
        "nativePermissionMetadata",
      );
      expect(followupParameters(A)).not.toHaveProperty(
        "activePermissionProfile",
      );
      expect(followupParameters(A)).not.toHaveProperty("runtimeWorkspaceRoots");
      expect(followupParameters(A)).not.toHaveProperty("permissions");
      allowedTurnCalls = 1;
      await codexService.turnStart(A, "fixture explicit DTO capture");
      expect(io.turnStart).toHaveBeenCalledTimes(1);
      const params = io.turnStart.mock.calls[0][0];
      expect(params).toMatchObject({
        threadId: A,
        model: "fixture-explicit-local-a",
        effort: "high",
      });
      for (const key of [
        "nativePermissionMetadata",
        "activePermissionProfile",
        "runtimeWorkspaceRoots",
        "permissions",
      ])
        expect(params).not.toHaveProperty(key);
      expect(entry().nativePermissionMetadata).toBe(metadataBefore);
      expectProtected(protectedBefore);
      expect(metadataBefore).toEqual({
        activePermissionProfile: {
          kind: "value",
          value: { id: "fixture-profile-a", extends: null },
        },
        runtimeWorkspaceRoots: { kind: "value", value: ["/fixture/root-a"] },
      });
    } finally {
      unmount();
    }
    // One local DTO capture uses the existing transport mock; no native/API execution or visible-owner authorization is claimed.
  });

  it("still acknowledges a matching model-only selection and deduplicates without requiring permission metadata", () => {
    useThreadModelStore.setState({ threads: {} });
    native(A);
    changeThreadModel(A, { model: "fixture-plain-local" });
    native(A, { model: "fixture-plain-local" });
    expect(entry()).toMatchObject({
      model: "fixture-plain-local",
      pending: false,
    });
    expect(entry().nativePermissionMetadata).toBeUndefined();
    const before = entry();
    native(A, { model: "fixture-plain-local" });
    expect(entry()).toBe(before);
  });
});
