import { beforeEach, expect, it } from "vitest";
import { useConfigStore } from "./useConfigStore";

const key = "kanban.session.codex-config-storage";
beforeEach(() => {
  localStorage.removeItem(key);
  useConfigStore.setState(useConfigStore.getInitialState(), true);
});
it("defaults new chats to full access without approval prompts", () => {
  expect(useConfigStore.getInitialState()).toMatchObject({
    sandbox: "danger-full-access",
    approvalPolicy: "never",
  });
});
it("updates the legacy default while preserving model preferences", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 0,
      state: {
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        model: "my-model",
        reasoningEffort: "high",
      },
    }),
  );
  await useConfigStore.persist.rehydrate();
  expect(useConfigStore.getState()).toMatchObject({
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    model: "my-model",
    reasoningEffort: "high",
  });
});
it("preserves a previously saved read-only choice", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 0,
      state: {
        sandbox: "read-only",
        approvalPolicy: "untrusted",
      },
    }),
  );
  await useConfigStore.persist.rehydrate();
  expect(useConfigStore.getState()).toMatchObject({
    sandbox: "read-only",
    approvalPolicy: "untrusted",
  });
});
it("keeps subsequent workspace-write choices after reload", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      state: {
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
      },
    }),
  );
  await useConfigStore.persist.rehydrate();
  expect(useConfigStore.getState()).toMatchObject({
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
  });
});
