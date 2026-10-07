import { expect, it, vi } from "vitest";
it("loads the agent graph before hydrating and subscribing compatibility draft facades", async () => {
  vi.resetModules();
  const { useCodexStore } =
    await import("../components/codex/stores/useCodexStore");
  const { useInputStore, startInputFacadeSync } =
    await import("./useInputStore");
  const { useCCInputStore, startCCInputFacadeSync } =
    await import("./cc/useCCInputStore");
  const stop = startInputFacadeSync(),
    stopCC = startCCInputFacadeSync();
  useCodexStore.setState({ currentThreadId: "bootstrap-draft" });
  useInputStore.getState().setInputValue("startup draft");
  expect(useInputStore.getState().inputValue).toBe("startup draft");
  expect(typeof useCCInputStore.getState().inputValue).toBe("string");
  stop();
  stopCC();
});
