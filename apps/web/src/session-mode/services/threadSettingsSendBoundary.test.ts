import { beforeEach, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  capture: vi.fn(),
  flush: vi.fn(),
  assert: vi.fn(),
}));
const api = vi.hoisted(() => ({
  postJsonWithOptions: vi.fn(),
  turnStart: vi.fn(),
}));
vi.mock("../stores/useThreadModelStore", async (original) => ({
  ...(await original<object>()),
  captureThreadModelSelection: boundary.capture,
  flushThreadModelSettings: boundary.flush,
  assertThreadModelSelectionCurrent: boundary.assert,
}));
vi.mock("./apiAdapt/shared", async (original) => ({
  ...(await original<object>()),
  postJsonWithOptions: api.postJsonWithOptions,
}));
vi.mock("./apiAdapt/codex", () => ({
  ...api,
  threadAccess: vi.fn(async () => ({ state: "owned", generation: 1 })),
}));

import { followupService, useFollowupStore } from "./followupService";
import { codexService } from "./codexService";
import { useCodexStore } from "../components/codex/stores";
import { useCodexDeliveryStore } from "../stores/useCodexDeliveryStore";
import { resetCodexAccessCache } from "../stores/useCodexAccessStore";
import { MutationNotStartedError } from "./MutationNotStartedError";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const capture = {
  threadId: "settings-a",
  token: { edit: "captured" },
  settings: {
    model: "chosen-model", modelProvider: "openai", reasoningEffort: "high",
    serviceTier: null, sandbox: "read-only", approvalPolicy: "on-request",
    approvalsReviewer: "user", webSearchRequest: false,
    collaborationMode: "default", providerModels: {}, personality: null,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  boundary.capture.mockReturnValue(structuredClone(capture));
  boundary.flush.mockReset().mockResolvedValue(undefined);
  boundary.assert.mockReset();
  api.postJsonWithOptions.mockReset().mockImplementation(async (_url, body) => ({
    revision: 1, paused: null, items: [{ ...body, status: "queued" }],
  }));
  api.turnStart.mockReset().mockResolvedValue({ turn: { id: "turn-a", status: "completed" } });
  resetCodexAccessCache();
  useCodexDeliveryStore.setState({ entries: {} });
  useFollowupStore.setState({ threads: {}, errors: {} });
  useCodexStore.setState({ currentThreadId: "settings-a", threads: [], events: {}, turnTimingMap: {}, threadStatusMap: {} });
});

for (const route of ["queue", "turn"] as const) {
  const send = () => route === "queue"
    ? followupService.submit("codex:settings-a", { revision: 1, writeId: "edit3_00000000-0000-4000-8000-000000000001" }, "settings-a", "keep draft", [], "queue")
    : codexService.turnStart("settings-a", "keep draft");
  it(`${route}: failed settings persistence rejects before any mutation or delivery echo`, async () => {
    boundary.flush.mockRejectedValueOnce(new Error("设置保存失败"));
    await expect(send()).rejects.toBeInstanceOf(MutationNotStartedError);
    expect(boundary.flush).toHaveBeenCalledWith("settings-a", capture);
    expect(api.postJsonWithOptions).not.toHaveBeenCalled();
    expect(api.turnStart).not.toHaveBeenCalled();
    expect(useCodexDeliveryStore.getState().entries).toEqual({});
  });
  it(`${route}: waits for the captured thread settings and never substitutes a newly selected target`, async () => {
    const gate = deferred();
    boundary.flush.mockReturnValueOnce(gate.promise);
    const pending = send();
    void pending.catch(() => {});
    await vi.waitFor(() => expect(boundary.flush).toHaveBeenCalledWith("settings-a", capture));
    expect(api.postJsonWithOptions).not.toHaveBeenCalled();
    expect(api.turnStart).not.toHaveBeenCalled();
    useCodexStore.setState({ currentThreadId: "settings-b" });
    boundary.capture.mockReturnValue({ ...capture, threadId: "settings-b", settings: { ...capture.settings, model: "other-model" } });
    gate.resolve();
    await pending;
    if (route === "queue") expect(api.postJsonWithOptions.mock.calls[0][1]).toMatchObject({ threadId: "settings-a", parameters: { model: "chosen-model", effort: "high" } });
    else expect(api.turnStart.mock.calls[0][0]).toMatchObject({ threadId: "settings-a", model: "chosen-model", effort: "high" });
  });
}

it("explicit child-native parameters remain independent of main-thread preference storage", async () => {
  boundary.flush.mockRejectedValue(new Error("unrelated preference storage failed"));
  const parameters = { cwd: "/child", model: "native-child-model", effort: "low" };
  await followupService.submit("child-owner", { revision: 1, writeId: "edit3_00000000-0000-4000-8000-000000000002" }, "settings-a", "child draft", [], "queue", undefined, parameters);
  expect(boundary.capture).not.toHaveBeenCalled();
  expect(boundary.flush).not.toHaveBeenCalled();
  expect(api.postJsonWithOptions.mock.calls[0][1].parameters).toEqual(parameters);
});

it("rechecks the captured settings after asynchronous authority checks before publishing a queue mutation", async () => {
  boundary.assert.mockImplementationOnce(() => { throw new Error("连接目标已切换"); });
  await expect(followupService.submit("codex:settings-a", { revision: 1, writeId: "edit3_00000000-0000-4000-8000-000000000003" }, "settings-a", "unchanged draft", [], "queue")).rejects.toBeInstanceOf(MutationNotStartedError);
  expect(boundary.flush).toHaveBeenCalledOnce();
  expect(boundary.assert).toHaveBeenCalledWith(capture);
  expect(api.postJsonWithOptions).not.toHaveBeenCalled();
  expect(useCodexDeliveryStore.getState().entries).toEqual({});
});
vi.mock("./nativeOperationContext", () => ({ readNativeOperationContext: vi.fn(async () => ({ scopeToken: "fixture-runtime-scope", namespace: "fixture-history" })) }));
