import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReasoningEffort } from "@session/bindings";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";
import { useThreadModelSettings } from "./useThreadModelSettings";
import {
  changeThreadModel,
  hydrateThreadModel,
  useThreadModelStore,
  type ThreadModelEntry,
} from "@session/stores/useThreadModelStore";
import { useModelSettingsStore } from "@session/stores/settings/useModelSettingsStore";
import { useSessionDraftStore } from "@session/stores/useSessionDraftStore";
import { useComposerDraftStore } from "@session/components/codex/composer/v2/drafts";

// Local structural type compiles against the OLD product; no import of a new export.
type Selection = { model: string; reasoningEffort: ReasoningEffort; serviceTier?: string | null };
type Select = (selection: Selection) => void;
const OWNER_A = JSON.stringify(["codex", "", "session", "A"]);
const OWNER_B = JSON.stringify(["codex", "", "session", "B"]);
const forbiddenFetch = vi.fn(() => { throw Error("R28B_UNEXPECTED_NETWORK"); });

function actualSelection(actions: object): Select {
  const value: unknown = Reflect.get(actions, "setModelSelection");
  expect(typeof value, "new local joint action setModelSelection must be available").toBe("function");
  // The assertion above is the intended OLD-product failure, not a later TypeError.
  if (typeof value !== "function") throw Error("unreachable: missing joint action");
  return value as Select;
}

function resetFixture() {
  localStorage.clear();
  useConfigStore.setState(useConfigStore.getInitialState(), true);
  useConfigStore.setState({
    model: "defaults-terra", modelProvider: "openai", reasoningEffort: "low", serviceTier: "fast",
    providerModels: { openai: "defaults-terra", custom: "saved-custom", other: "saved-other" },
    sandbox: "read-only", approvalPolicy: "untrusted", approvalsReviewer: "user",
    webSearchRequest: false, personality: "friendly", collaborationMode: "plan", threadCwdMode: "worktree",
  });
  useThreadModelStore.setState({ threads: {} });
  hydrateThreadModel("A", {
    model: "terra", modelProvider: "openai", reasoningEffort: "low", serviceTier: "fast",
    sandboxPolicy: { type: "externalSandbox", networkAccess: "restricted" },
    approvalPolicy: "on-request", approvalsReviewer: "auto_review", personality: "pragmatic", collaborationMode: "plan",
  });
  hydrateThreadModel("B", {
    model: "other-owner", modelProvider: "other", reasoningEffort: "xhigh", serviceTier: null,
    sandboxPolicy: { type: "readOnly", networkAccess: false }, approvalPolicy: "untrusted", approvalsReviewer: "user",
  });
  useThreadModelStore.setState(s => ({ threads: { ...s.threads, A: { ...s.threads.A,
    providerModels: { ...s.threads.A.providerModels, other: "keep-thread-other" } } } }));
  useModelSettingsStore.setState({ models: { custom: [{ id: "saved-custom", name: "Keep custom label" }] } });
  useSessionDraftStore.setState({ drafts: {
    [OWNER_A]: { text: "A draft and attachment mention", revision: 3 },
    [OWNER_B]: { text: "B draft", revision: 7 },
  }, migrated: [OWNER_A, OWNER_B] });
  useComposerDraftStore.setState({ drafts: {
    [OWNER_A]: { contexts: [{ id: "quote-A", kind: "quote", name: "A quote", text: "retained A context", sourceThreadId: "A" }],
      drawings: {}, expanded: false, plain: false },
    [OWNER_B]: { contexts: [{ id: "paste-B", kind: "paste", name: "B paste", text: "retained B context" }],
      drawings: {}, expanded: false, plain: true },
  }, error: null });
}
function dataSnapshot(value: object) {
  return structuredClone(Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item !== "function")));
}
function stableDefaults(value: Record<string, unknown>) {
  const { model, reasoningEffort, serviceTier, providerModels, ...rest } = value;
  return rest;
}
function capture() {
  const threads = useThreadModelStore.getState();
  return { threads, a: threads.threads.A, b: threads.threads.B, defaults: useConfigStore.getState(),
    custom: useModelSettingsStore.getState(), text: useSessionDraftStore.getState(), rich: useComposerDraftStore.getState(),
    values: { a: structuredClone(threads.threads.A), b: structuredClone(threads.threads.B),
      defaults: dataSnapshot(useConfigStore.getState()), custom: dataSnapshot(useModelSettingsStore.getState()),
      text: dataSnapshot(useSessionDraftStore.getState()), rich: dataSnapshot(useComposerDraftStore.getState()) } };
}
function commonProtected(before: ReturnType<typeof capture>) {
  expect(useModelSettingsStore.getState()).toBe(before.custom);
  expect(useSessionDraftStore.getState()).toBe(before.text);
  expect(useComposerDraftStore.getState()).toBe(before.rich);
  expect(useThreadModelStore.getState().threads.B).toBe(before.b);
  expect(useThreadModelStore.getState().threads.B).toEqual(before.values.b);
  expect(dataSnapshot(useModelSettingsStore.getState())).toEqual(before.values.custom);
  expect(dataSnapshot(useSessionDraftStore.getState())).toEqual(before.values.text);
  expect(dataSnapshot(useComposerDraftStore.getState())).toEqual(before.values.rich);
  expect(forbiddenFetch).not.toHaveBeenCalled();
}
function defaultsProtected(before: ReturnType<typeof capture>) {
  commonProtected(before);
  expect(useThreadModelStore.getState()).toBe(before.threads);
  expect(useThreadModelStore.getState().threads.A).toBe(before.a);
  expect(useThreadModelStore.getState().threads.A).toEqual(before.values.a);
  const { model: _m, reasoningEffort: _e, serviceTier: _t, providerModels: _p, ...rest } = before.defaults;
  const { model: _m2, reasoningEffort: _e2, serviceTier: _t2, providerModels: _p2, ...after } = useConfigStore.getState();
  expect(after).toEqual(rest);
  expect(stableDefaults(dataSnapshot(useConfigStore.getState()))).toEqual(stableDefaults(before.values.defaults));
  expect(dataSnapshot(before.defaults)).toEqual(before.values.defaults);
}
function threadProtected(before: ReturnType<typeof capture>) {
  commonProtected(before);
  expect(useConfigStore.getState()).toBe(before.defaults);
  expect(dataSnapshot(useConfigStore.getState())).toEqual(before.values.defaults);
  expect(before.a).toEqual(before.values.a);
  const current = useThreadModelStore.getState().threads.A;
  const stable = (entry: ThreadModelEntry) => {
    const { model, reasoningEffort, serviceTier, providerModels, revision, pending, pendingFields, notice, ...rest } = entry;
    return rest;
  };
  expect(stable(current)).toEqual(stable(before.values.a));
  expect(current.nativeSettings).toBe(before.a.nativeSettings);
  expect(current.observed).toBe(before.a.observed);
  expect(current.sandboxPolicy).toBe(before.a.sandboxPolicy);
  const { [before.a.modelProvider]: _beforeCurrent, ...otherProvidersBefore } = before.a.providerModels;
  const { [before.a.modelProvider]: _afterCurrent, ...otherProvidersAfter } = current.providerModels;
  expect(otherProvidersAfter).toEqual(otherProvidersBefore);
  return current;
}
function listenA() {
  const seen: ThreadModelEntry[] = [];
  const release = useThreadModelStore.subscribe(s => { seen.push(s.threads.A); });
  return { seen, release };
}
beforeEach(() => { resetFixture(); forbiddenFetch.mockClear(); vi.stubGlobal("fetch", forbiddenFetch); });
afterEach(() => {
  cleanup();
  try { expect(forbiddenFetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

it("exposes a defaults joint action that emits only the final pair and current-provider bookkeeping", () => {
  const before = capture(), seen: ReturnType<typeof useConfigStore.getState>[] = [];
  const release = useConfigStore.subscribe(s => { seen.push(s); });
  try {
    const select = actualSelection(useConfigStore.getState());
    act(() => select({ model: "sol", reasoningEffort: "high" }));
    defaultsProtected(before);
    const after = useConfigStore.getState();
    expect(after).toMatchObject({ model: "sol", reasoningEffort: "high", serviceTier: "fast", modelProvider: "openai",
      providerModels: { openai: "sol", custom: "saved-custom", other: "saved-other" } });
    expect(seen).toHaveLength(1); expect(seen[0]).toBe(after);
  } finally { release(); }
});

it("keeps an exact selected defaults pair and equal explicit tier as a no-op", () => {
  useConfigStore.setState(s => ({ providerModels: { ...s.providerModels, openai: "stale-remembered-only" } }));
  const before = capture(), seen: unknown[] = [];
  const release = useConfigStore.subscribe(s => { seen.push(s); });
  try {
    const select = actualSelection(useConfigStore.getState());
    act(() => {
      select({ model: "defaults-terra", reasoningEffort: "low" });
      select({ model: "defaults-terra", reasoningEffort: "low", serviceTier: "fast" });
    });
    defaultsProtected(before); expect(useConfigStore.getState()).toBe(before.defaults);
    expect(useConfigStore.getState().providerModels).toBe(before.defaults.providerModels); expect(seen).toEqual([]);
  } finally { release(); }
});

it("honors an explicit defaults tier-only change on the same raw pair", () => {
  const before = capture(), seen: unknown[] = [];
  const release = useConfigStore.subscribe(value => { seen.push(value); });
  try {
    const select = actualSelection(useConfigStore.getState());
    act(() => select({ model: "defaults-terra", reasoningEffort: "low", serviceTier: null }));
    defaultsProtected(before);
    const after = useConfigStore.getState();
    expect(after).toMatchObject({ model: "defaults-terra", reasoningEffort: "low", serviceTier: null });
    expect(after.providerModels).toEqual(before.defaults.providerModels);
    expect(seen).toEqual([after]);
  } finally { release(); }
});

it("handles omitted, undefined, null and explicit defaults tier without inference", () => {
  const cases: Array<{ selection: Selection; tier: string | null }> = [
    { selection: { model: "sol", reasoningEffort: "high" }, tier: "fast" },
    { selection: { model: "sol", reasoningEffort: "high", serviceTier: undefined }, tier: "fast" },
    { selection: { model: "sol", reasoningEffort: "high", serviceTier: null }, tier: null },
    { selection: { model: "sol", reasoningEffort: "high", serviceTier: "priority" }, tier: "priority" },
  ];
  for (const c of cases) {
    resetFixture(); const before = capture(), seen: unknown[] = [];
    const release = useConfigStore.subscribe(s => { seen.push(s); });
    try {
      const select = actualSelection(useConfigStore.getState());
      act(() => select(c.selection)); defaultsProtected(before);
      expect(useConfigStore.getState()).toMatchObject({ model: "sol", reasoningEffort: "high", serviceTier: c.tier });
      expect(seen).toHaveLength(1);
    } finally { release(); }
  }
});

it("uses commit-time provider bookkeeping through a captured new-chat hook action", () => {
  const view = renderHook(() => useThreadModelSettings(null));
  try {
    const select = actualSelection(view.result.current);
    act(() => useConfigStore.getState().setModelProvider("custom"));
    const before = capture(), seen: unknown[] = [];
    const release = useConfigStore.subscribe(s => { seen.push(s); });
    try {
      act(() => select({ model: "explicit-custom", reasoningEffort: "high" })); defaultsProtected(before);
      expect(useConfigStore.getState()).toMatchObject({ modelProvider: "custom", model: "explicit-custom", reasoningEffort: "high",
        providerModels: { openai: "defaults-terra", custom: "explicit-custom", other: "saved-other" } });
      expect(seen).toHaveLength(1);
    } finally { release(); }
  } finally { view.unmount(); }
});

it("exposes an existing-thread joint hook action with one revision and one final snapshot", () => {
  const view = renderHook(() => useThreadModelSettings("A")), before = capture(), observer = listenA();
  try {
    const select = actualSelection(view.result.current);
    act(() => select({ model: "sol", reasoningEffort: "high" }));
    const after = threadProtected(before);
    expect(after).toMatchObject({ model: "sol", reasoningEffort: "high", serviceTier: "fast", revision: before.a.revision + 1, pending: true,
      providerModels: { openai: "sol", other: "keep-thread-other" } });
    expect(after.pendingFields).toEqual(["model", "reasoningEffort"]);
    expect(after.notice).toMatchObject({ id: after.revision, from: "terra", to: "sol", dismissed: false });
    expect(observer.seen).toEqual([after]);
  } finally { observer.release(); view.unmount(); }
});

it("preserves saved thread tier for omitted and explicit undefined input", () => {
  for (const selection of [{ model: "sol", reasoningEffort: "high" },
    { model: "sol", reasoningEffort: "high", serviceTier: undefined }] satisfies Selection[]) {
    resetFixture(); const view = renderHook(() => useThreadModelSettings("A")), before = capture(), observer = listenA();
    try {
      const select = actualSelection(view.result.current);
      act(() => select(selection)); const after = threadProtected(before);
      expect(after.serviceTier).toBe("fast"); expect(after.revision).toBe(before.a.revision + 1);
      expect(after.pendingFields).toEqual(["model", "reasoningEffort"]); expect(observer.seen).toEqual([after]);
    } finally { observer.release(); view.unmount(); }
  }
});

it("forwards explicit thread null or string tier in the same pair commit", () => {
  for (const tier of [null, "priority"] as const) {
    resetFixture(); const view = renderHook(() => useThreadModelSettings("A")), before = capture(), observer = listenA();
    try {
      const select = actualSelection(view.result.current);
      act(() => select({ model: "sol", reasoningEffort: "high", serviceTier: tier }));
      const after = threadProtected(before);
      expect(after).toMatchObject({ model: "sol", reasoningEffort: "high", serviceTier: tier, revision: before.a.revision + 1 });
      expect(after.pendingFields).toEqual(["model", "reasoningEffort", "serviceTier"]); expect(observer.seen).toEqual([after]);
    } finally { observer.release(); view.unmount(); }
  }
});

it("honors an explicit tier-only change on the same raw pair", () => {
  const view = renderHook(() => useThreadModelSettings("A")), before = capture(), observer = listenA();
  try {
    const select = actualSelection(view.result.current);
    act(() => select({ model: "terra", reasoningEffort: "low", serviceTier: null }));
    const after = threadProtected(before);
    expect(after).toMatchObject({ model: "terra", reasoningEffort: "low", serviceTier: null, revision: before.a.revision + 1, pending: true });
    expect(after.pendingFields).toEqual(["serviceTier"]); expect(after.notice).toBe(before.a.notice); expect(observer.seen).toEqual([after]);
  } finally { observer.release(); view.unmount(); }
});

it("keeps exact selected thread pair, equal tier and pending/notice identities unchanged", () => {
  changeThreadModel("A", { personality: "friendly" });
  useThreadModelStore.setState(s => ({ threads: { ...s.threads, A: { ...s.threads.A,
    providerModels: { ...s.threads.A.providerModels, openai: "stale-thread-remembered-only" } } } }));
  const view = renderHook(() => useThreadModelSettings("A")), before = capture(), observer = listenA();
  try {
    const select = actualSelection(view.result.current);
    act(() => {
      select({ model: "terra", reasoningEffort: "low" });
      select({ model: "terra", reasoningEffort: "low", serviceTier: "fast" });
    });
    expect(threadProtected(before)).toBe(before.a); expect(useThreadModelStore.getState()).toBe(before.threads);
    expect(observer.seen).toEqual([]);
  } finally { observer.release(); view.unmount(); }
});

it("unions existing pending fields while preserving accepted native and observed snapshots", () => {
  changeThreadModel("A", { personality: "friendly" });
  const view = renderHook(() => useThreadModelSettings("A")), before = capture(), observer = listenA();
  try {
    const select = actualSelection(view.result.current);
    act(() => select({ model: "sol", reasoningEffort: "high" })); const after = threadProtected(before);
    expect(after.revision).toBe(before.a.revision + 1); expect(after.pending).toBe(true);
    expect(after.pendingFields).toEqual(["personality", "model", "reasoningEffort"]);
    expect(after.personalityNotice).toBe(before.a.personalityNotice); expect(observer.seen).toEqual([after]);
  } finally { observer.release(); view.unmount(); }
});

it("does not fabricate canonical nativeSettings for an old persisted legacy entry", () => {
  const legacy = { ...useThreadModelStore.getState().threads.A };
  delete legacy.nativeSettings; // Explicitly simulate old persisted format only.
  useThreadModelStore.setState(s => ({ threads: { ...s.threads, A: legacy } }));
  const view = renderHook(() => useThreadModelSettings("A")), before = capture(), observer = listenA();
  try {
    const select = actualSelection(view.result.current);
    act(() => select({ model: "sol", reasoningEffort: "high" })); const after = threadProtected(before);
    expect(after.nativeSettings).toBeUndefined(); expect(after.observed).toBe(before.a.observed);
    expect(after.revision).toBe(before.a.revision + 1); expect(observer.seen).toEqual([after]);
  } finally { observer.release(); view.unmount(); }
});

it("does not repair raw null during hook mount, rerender or unmount", () => {
  hydrateThreadModel("A", { model: "terra", modelProvider: "openai", reasoningEffort: null });
  useConfigStore.setState({ reasoningEffort: "high" });
  const before = capture(), observer = listenA();
  const view = renderHook(({ id }: { id: string | null }) => useThreadModelSettings(id), { initialProps: { id: "A" } });
  try {
    view.rerender({ id: "A" });
    expect(view.result.current.reasoningEffort).toBeNull();
    expect(threadProtected(before)).toBe(before.a); expect(observer.seen).toEqual([]);
  } finally { view.unmount(); observer.release(); }
  expect(useThreadModelStore.getState()).toBe(before.threads); expect(useConfigStore.getState()).toBe(before.defaults);
});

it("retains captured hook thread routing without retargeting to a later hook target", () => {
  const view = renderHook(({ id }: { id: string | null }) => useThreadModelSettings(id), { initialProps: { id: "A" } });
  try {
    const selectA = actualSelection(view.result.current);
    view.rerender({ id: "B" });
    const before = capture(), observer = listenA();
    try {
      act(() => selectA({ model: "sol", reasoningEffort: "high" }));
      const after = threadProtected(before);
      expect(after).toMatchObject({ model: "sol", reasoningEffort: "high", revision: before.a.revision + 1 });
      expect(observer.seen).toEqual([after]); expect(view.result.current.model).toBe("other-owner");
    } finally { observer.release(); }
    // This explicitly invoked captured function is routing evidence, not current UI authority.
  } finally { view.unmount(); }
});

it("already supports one combined changeThreadModel patch as an existing GREEN control", () => {
  const before = capture(), observer = listenA();
  try {
    act(() => changeThreadModel("A", { model: "sol", reasoningEffort: "high", serviceTier: null }));
    const after = threadProtected(before);
    expect(after).toMatchObject({ model: "sol", reasoningEffort: "high", serviceTier: null, revision: before.a.revision + 1 });
    expect(after.pendingFields).toEqual(["model", "reasoningEffort", "serviceTier"]); expect(observer.seen).toEqual([after]);
  } finally { observer.release(); }
});

it("limits the defaults joint intent to model, effort and explicit tier", () => {
  const before = capture(), seen: unknown[] = [];
  const release = useConfigStore.subscribe(value => { seen.push(value); });
  const selection = { model: "sol", reasoningEffort: "high", serviceTier: null,
    modelProvider: "other", sandbox: "danger-full-access", approvalPolicy: "never", approvalsReviewer: "guardian_subagent",
    webSearchRequest: true, unexpectedSelectionData: "must not be stored" };
  try {
    const select = actualSelection(useConfigStore.getState());
    act(() => select(selection)); defaultsProtected(before);
    const after = useConfigStore.getState();
    expect(after).toMatchObject({ model: "sol", reasoningEffort: "high", serviceTier: null, modelProvider: "openai" });
    expect(after.providerModels).toEqual({ openai: "sol", custom: "saved-custom", other: "saved-other" });
    expect(seen).toEqual([after]);
  } finally { release(); }
});

it("limits the thread joint intent to model, effort and explicit tier", () => {
  const view = renderHook(() => useThreadModelSettings("A")), before = capture(), observer = listenA();
  const selection = { model: "sol", reasoningEffort: "high", serviceTier: null,
    modelProvider: "other", sandbox: "danger-full-access", approvalPolicy: "never", approvalsReviewer: "guardian_subagent",
    webSearchRequest: true, unexpectedSelectionData: "must not be stored" };
  try {
    const select = actualSelection(view.result.current);
    act(() => select(selection)); const after = threadProtected(before);
    expect(after).toMatchObject({ model: "sol", reasoningEffort: "high", serviceTier: null, modelProvider: "openai",
      revision: before.a.revision + 1 });
    expect(after.pendingFields).toEqual(["model", "reasoningEffort", "serviceTier"]);
    expect(after.providerModels).toEqual({ ...before.a.providerModels, openai: "sol" });
    expect(observer.seen).toEqual([after]);
  } finally { observer.release(); view.unmount(); }
});
