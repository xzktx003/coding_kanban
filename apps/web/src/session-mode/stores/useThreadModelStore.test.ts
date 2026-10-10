import { beforeEach, expect, it } from "vitest";
import {
  changeThreadModel,
  dismissModelNotice,
  getThreadModelSettings,
  hydrateThreadModel,
  useThreadModelStore,
} from "./useThreadModelStore";
import { useConfigStore } from "../components/codex/stores/useConfigStore";
beforeEach(() => {
  localStorage.clear();
  useThreadModelStore.setState({ threads: {} });
  useConfigStore.setState({
    model: "new-default",
    reasoningEffort: "medium",
    modelProvider: "openai",
    providerModels: { openai: "new-default" },
  });
  hydrateThreadModel("a", {
    model: "astra",
    modelProvider: "openai",
    reasoningEffort: "high",
  });
  hydrateThreadModel("b", {
    model: "sol",
    modelProvider: "custom",
    reasoningEffort: "low",
  });
});
it("keeps model, provider and effort local to one thread and preserves new-chat defaults", () => {
  changeThreadModel("a", { model: "luna", reasoningEffort: "medium" });
  expect(getThreadModelSettings("a")).toMatchObject({
    model: "luna",
    reasoningEffort: "medium",
  });
  expect(getThreadModelSettings("b")).toMatchObject({
    model: "sol",
    modelProvider: "custom",
    reasoningEffort: "low",
  });
  expect(getThreadModelSettings(null).model).toBe("new-default");
  expect(getThreadModelSettings("unknown")).toMatchObject({
    model: "",
    reasoningEffort: null,
  });
});
it("persists per-thread choices and pending notices across browser reload", async () => {
  changeThreadModel("a", { model: "luna" });
  const saved = localStorage.getItem("kanban.session.codex-thread-models")!;
  useThreadModelStore.setState({ threads: {} });
  localStorage.setItem("kanban.session.codex-thread-models", saved);
  await useThreadModelStore.persist.rehydrate();
  expect(getThreadModelSettings("a").model).toBe("luna");
  expect(getThreadModelSettings("b").model).toBe("sol");
  expect(useThreadModelStore.getState().threads.a).toMatchObject({
    pending: true,
    notice: { from: "astra", to: "luna", dismissed: false },
  });
});
it("initial hydration and repeated selection create no switch notice", () => {
  expect(useThreadModelStore.getState().threads.a.notice).toBeUndefined();
  changeThreadModel("a", { model: "astra" });
  changeThreadModel("a", { reasoningEffort: "xhigh" });
  expect(useThreadModelStore.getState().threads.a.notice).toBeUndefined();
});
it("old native settings preserve a pending choice; confirmation changes its effective status only", () => {
  changeThreadModel("a", { model: "luna", reasoningEffort: "low" });
  hydrateThreadModel(
    "a",
    { model: "astra", reasoningEffort: "high" },
    { notify: true },
  );
  expect(useThreadModelStore.getState().threads.a).toMatchObject({
    model: "luna",
    pending: true,
  });
  hydrateThreadModel(
    "a",
    { model: "luna", reasoningEffort: "low" },
    { notify: true },
  );
  expect(useThreadModelStore.getState().threads.a).toMatchObject({
    model: "luna",
    pending: false,
    notice: { from: "astra", to: "luna" },
  });
});
it("a dismissed notice stays dismissed after confirmation, snapshots and duplicates; a later change creates a new notice", () => {
  changeThreadModel("a", { model: "luna" });
  const notice = useThreadModelStore.getState().threads.a.notice!;
  dismissModelNotice("a", notice.id);
  hydrateThreadModel("a", { model: "luna", reasoningEffort: "high" });
  hydrateThreadModel(
    "a",
    { model: "luna", reasoningEffort: "high" },
    { notify: true },
  );
  expect(useThreadModelStore.getState().threads.a.notice?.dismissed).toBe(true);
  changeThreadModel("a", { model: "sol" });
  dismissModelNotice("a", notice.id);
  expect(useThreadModelStore.getState().threads.a.notice).toMatchObject({
    from: "luna",
    to: "sol",
    dismissed: false,
  });
});
it("native changes affect only their own thread, deduplicate and invalidate an older history response", () => {
  const revision = useThreadModelStore.getState().threads.b.revision;
  hydrateThreadModel(
    "b",
    { model: "luna", modelProvider: "custom", reasoningEffort: "low" },
    { notify: true },
  );
  const first = useThreadModelStore.getState().threads.b;
  hydrateThreadModel(
    "b",
    { model: "luna", modelProvider: "custom", reasoningEffort: "low" },
    { notify: true },
  );
  expect(useThreadModelStore.getState().threads.b).toBe(first);
  hydrateThreadModel(
    "b",
    { model: "sol", modelProvider: "custom", reasoningEffort: "low" },
    { revision },
  );
  expect(getThreadModelSettings("b").model).toBe("luna");
  expect(getThreadModelSettings("a").model).toBe("astra");
});

it("a cold snapshot of a changed native model clears an obsolete notice without creating a fake switch", () => {
  changeThreadModel("a", { model: "luna" });
  hydrateThreadModel("a", { model: "luna", reasoningEffort: "high" });
  expect(useThreadModelStore.getState().threads.a.notice?.to).toBe("luna");
  hydrateThreadModel("a", { model: "sol", reasoningEffort: "low" });
  expect(getThreadModelSettings("a").model).toBe("sol");
  expect(useThreadModelStore.getState().threads.a.notice).toBeUndefined();
});

it("isolates service tier, permission and plan choices, and restores them without borrowing a different thread's defaults", async () => {
  const originalB = getThreadModelSettings("b");
  changeThreadModel("a", {
    serviceTier: "fast",
    sandbox: "read-only",
    approvalPolicy: "untrusted",
    webSearchRequest: true,
    collaborationMode: "plan",
  });
  expect(getThreadModelSettings("a")).toMatchObject({
    serviceTier: "fast",
    sandbox: "read-only",
    approvalPolicy: "untrusted",
    webSearchRequest: true,
    collaborationMode: "plan",
  });
  expect(getThreadModelSettings("b")).toEqual(originalB);
  const saved = localStorage.getItem("kanban.session.codex-thread-models")!;
  useThreadModelStore.setState({ threads: {} });
  localStorage.setItem("kanban.session.codex-thread-models", saved);
  await useThreadModelStore.persist.rehydrate();
  expect(getThreadModelSettings("a")).toMatchObject({
    serviceTier: "fast",
    collaborationMode: "plan",
  });
});

it("retains native external policies and ignores late settings until the selected owner's tier and permissions are confirmed", () => {
  hydrateThreadModel("a", {
    model: "astra",
    sandboxPolicy: { type: "externalSandbox", networkAccess: "restricted" },
    approvalPolicy: "on-request",
    serviceTier: null,
  });
  expect(getThreadModelSettings("a").sandboxPolicy).toEqual({
    type: "externalSandbox",
    networkAccess: "restricted",
  });
  changeThreadModel("a", {
    serviceTier: "fast",
    sandbox: "read-only",
    sandboxPolicy: null,
    approvalPolicy: "untrusted",
  });
  hydrateThreadModel("a", {
    model: "astra",
    serviceTier: null,
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: [],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
    approvalPolicy: "on-request",
  });
  expect(getThreadModelSettings("a")).toMatchObject({
    serviceTier: "fast",
    sandbox: "read-only",
    approvalPolicy: "untrusted",
  });
  expect(useThreadModelStore.getState().threads.a.pending).toBe(true);
  hydrateThreadModel("a", {
    model: "astra",
    serviceTier: "fast",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    approvalPolicy: "untrusted",
  });
  expect(useThreadModelStore.getState().threads.a.pending).toBe(false);
});

it("enables auto approval only from the same owner's authoritative native reviewer, preserving another owner's default-off capability", () => {
  expect(getThreadModelSettings("a").autoReviewCapability).toBeNull();
  hydrateThreadModel("a", { model: "astra", approvalsReviewer: "auto_review" });
  expect(getThreadModelSettings("a")).toMatchObject({
    approvalsReviewer: "auto_review",
    autoReviewCapability: "auto_review",
  });
  expect(getThreadModelSettings("b")).toMatchObject({
    approvalsReviewer: "user",
    autoReviewCapability: null,
  });
  changeThreadModel("a", { approvalsReviewer: "user" });
  hydrateThreadModel("a", { model: "astra", approvalsReviewer: "auto_review" });
  expect(getThreadModelSettings("a").approvalsReviewer).toBe("user");
});
