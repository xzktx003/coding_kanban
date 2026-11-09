import { beforeEach, expect, it } from "vitest";
import { useConfigStore } from "./useConfigStore";
beforeEach(() => {
  localStorage.clear();
  useConfigStore.setState(useConfigStore.getInitialState(), true);
});
it("fresh devices follow config, old saved preferences remain manual", async () => {
  await useConfigStore.persist.rehydrate();
  expect(useConfigStore.getState().modelSelectionMode).toBe("follow-config");
  localStorage.setItem(
    "kanban.session.codex-config-storage.v3.model",
    JSON.stringify("saved"),
  );
  await useConfigStore.persist.rehydrate();
  expect(useConfigStore.getState().modelSelectionMode).toBe("manual");
});
it("explicit choices leave follow mode, following does not erase manual values", async () => {
  useConfigStore.getState().setModel("custom");
  expect(useConfigStore.getState().modelSelectionMode).toBe("manual");
  useConfigStore.getState().setModelSelectionMode("follow-config");
  await useConfigStore.persist.rehydrate();
  expect(useConfigStore.getState()).toMatchObject({
    model: "custom",
    modelSelectionMode: "follow-config",
  });
  useConfigStore.getState().setModelProvider("magpie");
  expect(useConfigStore.getState().modelSelectionMode).toBe("manual");
});
