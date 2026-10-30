import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ threadRead: vi.fn(), threadGoalGet: vi.fn() }));
vi.mock("./apiAdapt/codex", () => api);
import { codexService, resetCodexRuntimeState } from "./codexService";
import { HistoryReadScopeChangedError } from "./HistoryReadScopeChangedError";
import { useCodexStore } from "../components/codex/stores";
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  resetCodexRuntimeState();
  useCodexStore.setState({
    currentThreadId: "scope-contract",
    threads: [],
    events: {},
    historyLoadedMap: {},
    historyLoadingMap: {},
    historyErrorMap: {},
    turnTimingMap: {},
    threadStatusMap: {},
    accountNamespace: "before",
  });
  api.threadGoalGet.mockResolvedValue({ goal: null });
});
afterEach(() => vi.restoreAllMocks());
for (const first of ["ui", "scheduler"] as const)
  it(`each consumer handles a shared raw scope cancellation independently when ${first} starts first`, async () => {
    const gate = deferred();
    api.threadRead.mockReturnValue(gate.promise);
    const ui = () => codexService.loadThreadHistory("scope-contract");
    const scheduler = () =>
      codexService.loadThreadHistory("scope-contract", undefined, {
        reportScopeChanges: true,
      });
    const a = first === "ui" ? ui() : scheduler();
    const b = first === "ui" ? scheduler() : ui();
    void a.catch(() => {});
    void b.catch(() => {});
    await vi.waitFor(() => expect(api.threadRead).toHaveBeenCalledOnce());
    useCodexStore.setState({ accountNamespace: "after" });
    gate.resolve({ thread: { id: "scope-contract", turns: [] } });
    await expect(first === "ui" ? a : b).resolves.toBeUndefined();
    await expect(first === "scheduler" ? a : b).rejects.toBeInstanceOf(
      HistoryReadScopeChangedError,
    );
    expect(
      useCodexStore.getState().historyLoadedMap["scope-contract"],
    ).toBeUndefined();
    expect(
      useCodexStore.getState().historyErrorMap["scope-contract"],
    ).toBeUndefined();
  });
it("ordinary setCurrentThread navigation resolves a revoked read without an uncaught UI rejection", async () => {
  const gate = deferred();
  api.threadRead.mockReturnValue(gate.promise);
  const navigation = codexService.setCurrentThread("scope-contract");
  void navigation.catch(() => {});
  await vi.waitFor(() => expect(api.threadRead).toHaveBeenCalledOnce());
  useCodexStore.setState({ accountNamespace: "after" });
  gate.resolve({ thread: { id: "scope-contract", turns: [] } });
  await expect(navigation).resolves.toBeUndefined();
  expect(
    useCodexStore.getState().historyLoadedMap["scope-contract"],
  ).toBeUndefined();
});
it("real read failures still reject for UI and scheduler and retain the actionable history error", async () => {
  const gate = deferred();
  api.threadRead.mockReturnValue(gate.promise);
  const ui = codexService.loadThreadHistory("scope-contract");
  const scheduler = codexService.loadThreadHistory(
    "scope-contract",
    undefined,
    { reportScopeChanges: true },
  );
  void ui.catch(() => {});
  void scheduler.catch(() => {});
  await vi.waitFor(() => expect(api.threadRead).toHaveBeenCalledOnce());
  // A native failure within the current scope is not a cancellation.
  gate.resolve(Promise.reject(new Error("actual history read failure")));
  await expect(ui).rejects.toThrow("actual history read failure");
  await expect(scheduler).rejects.toThrow("actual history read failure");
  expect(useCodexStore.getState().historyErrorMap["scope-contract"]).toBe(
    "actual history read failure",
  );
});
