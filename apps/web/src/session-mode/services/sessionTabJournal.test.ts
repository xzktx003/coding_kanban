import { beforeEach, expect, it, vi } from "vitest";
import {
  acknowledgeTabOperations,
  readTabOperations,
  saveTabOperation,
  TAB_OPERATION_PREFIX,
} from "./sessionTabJournal";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "a" }],
    pendingTabOperations: [],
    nextTabSequence: 1,
  });
});
it("acknowledges only the matching immutable action, even when local sequence numbers collide", () => {
  const a = saveTabOperation(
    { type: "add", card: { kind: "codex", id: "a" } },
    1,
  );
  const b = saveTabOperation({ type: "remove", key: "codex:a" }, 1);
  expect(a.id).not.toBe(b.id);
  acknowledgeTabOperations([a.id!]);
  expect(readTabOperations()).toEqual([b]);
});
it("never hides a tab if its close action could not be saved", () => {
  const write = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key.startsWith(TAB_OPERATION_PREFIX))
      throw new DOMException("full", "QuotaExceededError");
    return write.call(this, key, value);
  });
  expect(() =>
    useAgentCenterStore.getState().removeCard({ kind: "codex", id: "a" }),
  ).toThrow("full");
  expect(useAgentCenterStore.getState().cards.map((c) => c.id)).toEqual(["a"]);
});
it("reusing an upgrade recovery identity retains its original order and payload", () => {
  const op = saveTabOperation(
    { type: "remove", key: "codex:a" },
    1,
    "recovery-id",
  );
  const next = saveTabOperation(
    { type: "add", card: { kind: "codex", id: "a" } },
    2,
  );
  expect(
    saveTabOperation({ type: "remove", key: "codex:a" }, 1, "recovery-id"),
  ).toEqual(op);
  expect(readTabOperations()).toEqual([op, next]);
});
