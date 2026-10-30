import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ turnStart: vi.fn(), post: vi.fn() }));
vi.mock("./apiAdapt/shared", async original => ({ ...(await original<object>()), postJsonWithOptions: api.post }));
vi.mock("./apiAdapt/codex", async original => ({ ...(await original<object>()), turnStart: api.turnStart, threadAccess: vi.fn(async () => ({ state: "owned", generation: 1 })) }));
import { codexService } from "./codexService";
import { followupService, useFollowupStore } from "./followupService";
import { changeThreadModel, ensureThreadModelSettings, flushThreadModelSettings, hydrateThreadModel } from "../stores/useThreadModelStore";
import { useCodexStore } from "../components/codex/stores";
import { useCodexDeliveryStore } from "../stores/useCodexDeliveryStore";
import { resetCodexAccessCache } from "../stores/useCodexAccessStore";
import { MutationNotStartedError } from "./MutationNotStartedError";
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); resetCodexAccessCache();
  api.turnStart.mockResolvedValue({ turn: { id: "isolated-turn", status: "completed" } });
  api.post.mockImplementation(async (_url, body) => ({ revision: 1, paused: null, items: [{ ...body, status: "queued" }] }));
  useCodexStore.setState({ currentThreadId: "permission-send", threads: [], events: {}, turnTimingMap: {}, threadStatusMap: {} });
  useCodexDeliveryStore.setState({ entries: {} }); useFollowupStore.setState({ threads: {}, errors: {} });
});
for (const route of ["queue", "turn"] as const) {
  const send = () => route === "queue"
    ? followupService.submit("codex:permission-send", { revision: 1, writeId: "edit3_00000000-0000-4000-8000-000000000091" }, "permission-send", "permission retained", [], "queue")
    : codexService.turnStart("permission-send", "permission retained");
  const sent = () => route === "queue" ? api.post.mock.calls[0][1].parameters : api.turnStart.mock.calls[0][0];
  it.each(["unknown", "model-only"])(`${route} omits unobserved permission defaults (%s)`, async kind => {
    await ensureThreadModelSettings("permission-send");
    if (kind === "model-only") { hydrateThreadModel("permission-send", { model: "native" }); await flushThreadModelSettings("permission-send"); }
    await send();
    expect(sent()).not.toHaveProperty("approvalPolicy"); expect(sent()).not.toHaveProperty("sandboxPolicy"); expect(sent()).not.toHaveProperty("approvalsReviewer");
  });
  it(`${route} preserves explicit full-access without a model`, async () => {
    await ensureThreadModelSettings("permission-send");
    changeThreadModel("permission-send", { sandbox: "danger-full-access", sandboxPolicy: null, approvalPolicy: "never", approvalsReviewer: "user" });
    await send();
    expect(sent()).toMatchObject({ model: null, approvalPolicy: "never", approvalsReviewer: "user", sandboxPolicy: { type: "dangerFullAccess" } });
  });
  it(`${route} preserves native complete permissions including custom roots`, async () => {
    await ensureThreadModelSettings("permission-send");
    hydrateThreadModel("permission-send", { model: "native", approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/only-this"], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } });
    await send();
    expect(sent()).toMatchObject({ approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/only-this"], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } });
  });
  it(`${route} rejects an inexpressible network-only edit before submission or echo`, async () => {
    await ensureThreadModelSettings("permission-send"); changeThreadModel("permission-send", { webSearchRequest: true }); await flushThreadModelSettings("permission-send");
    await expect(send()).rejects.toBeInstanceOf(MutationNotStartedError);
    expect(api.turnStart).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled(); expect(useCodexDeliveryStore.getState().entries).toEqual({});
  });
}
it("explicit frozen child/retry parameters bypass unrelated unknown permission preferences in both transports", async () => {
  await ensureThreadModelSettings("permission-send"); changeThreadModel("permission-send", { webSearchRequest: true }); await flushThreadModelSettings("permission-send");
  const frozen = { model: "child-native", sandboxPolicy: { type: "readOnly" as const, networkAccess: false } };
  await codexService.turnStart("permission-send", "retry", [], undefined, undefined, frozen);
  expect(api.turnStart.mock.calls[0][0]).toMatchObject(frozen);
  expect(api.turnStart.mock.calls[0][0]).not.toHaveProperty("approvalPolicy");
  await followupService.submit("child", { revision: 1, writeId: "edit3_00000000-0000-4000-8000-000000000092" }, "permission-send", "retry", [], "queue", undefined, frozen);
  expect(api.post.mock.calls[0][1].parameters).toEqual(frozen);
});
vi.mock("./nativeOperationContext", () => ({ readNativeOperationContext: vi.fn(async () => ({ scopeToken: "fixture-runtime-scope", namespace: "fixture-history" })) }));
