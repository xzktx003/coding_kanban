import { beforeEach, expect, it, vi } from "vitest";
import { forkAtTurn } from "./service";
import { MutationUncertainError, useThreadWorkflowStore } from "./delivery";

const mocks = vi.hoisted(() => ({
  fork: vi.fn(),
  add: vi.fn(),
  quote: vi.fn(),
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { threadFork: mocks.fork },
}));
vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: { getState: () => ({ currentThreadId: "other" }) },
}));
vi.mock("@session/stores/useAgentCenterStore", () => ({
  useAgentCenterStore: { getState: () => ({ addAgentCard: mocks.add }) },
}));
vi.mock("@session/stores/useAgentSettingsStore", () => ({
  useAgentSettingsStore: { getState: () => ({ selectedAgent: "codex" }) },
}));
vi.mock("@session/components/codex/composer/v2/drafts", () => ({
  composerDrafts: { add: mocks.quote },
}));
const source = {
  threadId: "owner",
  turnId: "turn",
  itemId: "item",
  rowId: "row",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fork.mockReset();
  useThreadWorkflowStore.setState({ mutations: {}, inlineEdits: {} });
});
it("allows a later explicit successful fork while coalescing concurrent invocations", async () => {
  let finish!: (value: { id: string; cwd: string }) => void;
  mocks.fork.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = forkAtTurn(source),
    duplicate = forkAtTurn(source);
  expect(mocks.fork).toHaveBeenCalledTimes(1);
  finish({ id: "fork-one", cwd: "/owner" });
  expect(await first).toBe("fork-one");
  expect(await duplicate).toBe("fork-one");
  mocks.fork.mockResolvedValueOnce({ id: "fork-two", cwd: "/owner" });
  expect(await forkAtTurn(source)).toBe("fork-two");
  expect(mocks.fork).toHaveBeenCalledTimes(2);
});
it("preserves immutable source identity across awaits and unknown results remain blocked", async () => {
  const chosen = { ...source };
  let finish!: (value: { id: string; cwd: string }) => void;
  mocks.fork.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const task = forkAtTurn(chosen, "Selected original reply");
  chosen.threadId = "newer";
  chosen.itemId = "newer-item";
  finish({ id: "forked", cwd: "/owner" });
  await task;
  expect(mocks.quote.mock.calls[0][1]).toMatchObject({
    sourceThreadId: "owner",
    sourceItemId: "item",
  });
  const uncertain = { ...source, turnId: "unknown" };
  mocks.fork.mockRejectedValueOnce(new TypeError("lost response"));
  await expect(forkAtTurn(uncertain)).rejects.toBeInstanceOf(
    MutationUncertainError,
  );
  await expect(forkAtTurn(uncertain)).rejects.toBeInstanceOf(
    MutationUncertainError,
  );
  expect(mocks.fork).toHaveBeenCalledTimes(2);
});
