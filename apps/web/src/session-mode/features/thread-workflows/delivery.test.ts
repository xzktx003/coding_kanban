import { beforeEach, expect, it, vi } from "vitest";
import {
  runTurnMutation,
  mutationKey,
  useThreadWorkflowStore,
  MutationUncertainError,
  resolveTurnMutation,
} from "./delivery";
import { SessionApiError } from "@session/services/apiAdapt/shared";
import { MutationNotStartedError } from "@session/services/MutationNotStartedError";
const source = Object.freeze({
  threadId: "original",
  turnId: "t1",
  rowId: "r1",
  itemId: "i1",
});
beforeEach(() =>
  useThreadWorkflowStore.setState({ mutations: {}, inlineEdits: {} }),
);
it("coalesces concurrent captured mutations and preserves successful results across renders", async () => {
  let finish!: (value: string) => void;
  const send = vi.fn(
    () => new Promise<string>((resolve) => (finish = resolve)),
  );
  const first = runTurnMutation("fork", source, send);
  const second = runTurnMutation("fork", source, send);
  expect(send).toHaveBeenCalledTimes(1);
  finish("forked");
  expect(await first).toBe("forked");
  expect(await second).toBe("forked");
  expect(await runTurnMutation("fork", source, send)).toBe("forked");
  expect(send).toHaveBeenCalledTimes(1);
});
it("connection loss is uncertain and cannot be blindly resent even after state rehydration", async () => {
  const send = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(runTurnMutation("restore", source, send)).rejects.toBeInstanceOf(
    MutationUncertainError,
  );
  expect(
    useThreadWorkflowStore.getState().mutations[mutationKey("restore", source)]
      .status,
  ).toBe("uncertain");
  await expect(runTurnMutation("restore", source, send)).rejects.toThrow(
    /确认/,
  );
  expect(send).toHaveBeenCalledTimes(1);
  resolveTurnMutation("restore", source, { threadId: "original" });
  expect(await runTurnMutation("restore", source, send)).toEqual({
    threadId: "original",
  });
  expect(send).toHaveBeenCalledTimes(1);
});
it("only an explicit non-execution rejection may retry and ambiguous server failures stay uncertain", async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(new SessionApiError("bad input", 400))
    .mockResolvedValue("ok");
  await expect(runTurnMutation("fork", source, send)).rejects.toThrow(
    "bad input",
  );
  expect(await runTurnMutation("fork", source, send)).toBe("ok");
  expect(send).toHaveBeenCalledTimes(2);
  await expect(
    runTurnMutation("restore", source, () =>
      Promise.reject(new SessionApiError("gateway lost", 502)),
    ),
  ).rejects.toBeInstanceOf(MutationUncertainError);
});
it("persisted pending outcomes become uncertain on reload, never resend", async () => {
  const key = mutationKey("fork", source);
  useThreadWorkflowStore.setState({
    mutations: {
      [key]: { status: "pending", source, kind: "fork", updatedAt: 1 },
    },
  });
  const send = vi.fn();
  await expect(runTurnMutation("fork", source, send)).rejects.toBeInstanceOf(
    MutationUncertainError,
  );
  expect(send).not.toHaveBeenCalled();
});
it("a typed local rejection before RPC remains retryable and an untyped message cannot claim nonexecution", async () => {
  const rejection = new MutationNotStartedError(
    "The chosen turn has not completed",
  );
  const send = vi
    .fn()
    .mockRejectedValueOnce(rejection)
    .mockResolvedValue("forked");
  await expect(runTurnMutation("fork", source, send)).rejects.toBe(rejection);
  expect(
    useThreadWorkflowStore.getState().mutations[mutationKey("fork", source)]
      .status,
  ).toBe("rejected");
  expect(await runTurnMutation("fork", source, send)).toBe("forked");
  expect(send).toHaveBeenCalledTimes(2);
  await expect(
    runTurnMutation("restore", source, () =>
      Promise.reject(
        new Error("Invalid params reported after a lost response"),
      ),
    ),
  ).rejects.toBeInstanceOf(MutationUncertainError);
  expect(
    useThreadWorkflowStore.getState().mutations[mutationKey("restore", source)]
      .status,
  ).toBe("uncertain");
});
it("inline edit buffers are separate per exact user item and cancellation does not touch other buffers", () => {
  const store = useThreadWorkflowStore.getState();
  store.setInlineEdit(source, "Edited message");
  const other = { ...source, threadId: "other" };
  store.setInlineEdit(other, "Other message");
  store.clearInlineEdit(source);
  expect(
    Object.values(useThreadWorkflowStore.getState().inlineEdits).map(
      (buffer) => buffer.text,
    ),
  ).toEqual(["Other message"]);
});
