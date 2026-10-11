import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("initializes session navigation and split identifiers on nonsecure LAN HTTP", async () => {
  const original = crypto;
  vi.stubGlobal("crypto", {
    getRandomValues: original.getRandomValues.bind(original),
  });
  const { useAgentCenterStore } = await import("./useAgentCenterStore");
  const { useSessionSplitStore } = await import("./useSessionSplitStore");
  expect(useAgentCenterStore.getState().syncClientId).toMatch(
    /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
  );
  expect(useSessionSplitStore.getState()).toBeDefined();
});
