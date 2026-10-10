import { beforeEach, expect, it, vi } from "vitest";
import { editLastUserMessage } from "./edit";
import { useThreadWorkflowStore, MutationUncertainError } from "./delivery";
import { useCodexStore } from "@session/components/codex/stores";
import {
  changeThreadModel,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import {
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  rollback: vi.fn(),
  start: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/codex", () => ({ threadRead: mocks.read }));
vi.mock("@session/services/codexService", () => ({
  codexService: { threadRollback: mocks.rollback, turnStart: mocks.start },
}));
const source = {
  threadId: "owner",
  turnId: "chosen",
  itemId: "user",
  rowId: "row:user",
};
const inputs = [
  { type: "text", text: "original", text_elements: [] },
  { type: "image", url: "data:image/png;base64,original" },
  { type: "localImage", path: "/owner/image.png" },
] as const;
const turn = {
  id: "chosen",
  status: "completed",
  items: [{ id: "user", type: "userMessage", content: inputs }],
};
beforeEach(() => {
  vi.clearAllMocks();
  useThreadWorkflowStore.setState({ mutations: {}, inlineEdits: {} });
  useCodexStore.setState({
    threadStatusMap: {},
    turnTimingMap: {},
    currentThreadId: "other",
  });
  useSessionDraftStore.setState({ drafts: {} });
  useThreadModelStore.setState({ threads: {} });
  useSessionDraftStore
    .getState()
    .setText(sessionDraftKey("codex", "owner"), "Detached draft");
  mocks.read
    .mockResolvedValueOnce({
      thread: { id: "owner", status: { type: "idle" }, turns: [turn] },
    })
    .mockResolvedValue({
      thread: { id: "owner", status: { type: "idle" }, turns: [] },
    });
  mocks.rollback.mockResolvedValue({ id: "owner", turns: [] });
  mocks.start.mockResolvedValue({ id: "replacement" });
});
it("reads actual last completed turn then confirms exact rollback and sends captured attachment inputs without touching drafts", async () => {
  const id = await editLastUserMessage(source, "edited", inputs as never);
  expect(id).toBe("replacement");
  expect(mocks.rollback).toHaveBeenCalledWith("owner", 1, "chosen");
  expect(mocks.start.mock.calls[0]).toEqual([
    "owner",
    "edited",
    [],
    expect.any(String),
    [{ type: "text", text: "edited", text_elements: [] }, inputs[1], inputs[2]],
    expect.any(Object),
  ]);
  expect(readDraft(sessionDraftKey("codex", "owner")).text).toBe(
    "Detached draft",
  );
  expect(useCodexStore.getState().currentThreadId).toBe("other");
});
it("a different newest turn or active turn blocks mutation before discarding history", async () => {
  mocks.read.mockReset().mockResolvedValue({
    thread: {
      id: "owner",
      status: { type: "idle" },
      turns: [turn, { ...turn, id: "newer" }],
    },
  });
  await expect(
    editLastUserMessage(source, "edited", inputs as never),
  ).rejects.toThrow(/最后/);
  expect(mocks.rollback).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
});
it("unknown rollback keeps buffer and prevents retry or send", async () => {
  mocks.rollback.mockRejectedValue(new TypeError("lost response"));
  await expect(
    editLastUserMessage(source, "edited", inputs as never),
  ).rejects.toBeInstanceOf(MutationUncertainError);
  await expect(
    editLastUserMessage(source, "edited", inputs as never),
  ).rejects.toBeInstanceOf(MutationUncertainError);
  expect(mocks.rollback).toHaveBeenCalledTimes(1);
  expect(mocks.start).not.toHaveBeenCalled();
});
it("new history arriving between rollback and send blocks replacement and keeps drafts", async () => {
  mocks.read
    .mockReset()
    .mockResolvedValueOnce({
      thread: { id: "owner", status: { type: "idle" }, turns: [turn] },
    })
    .mockResolvedValue({
      thread: {
        id: "owner",
        status: { type: "idle" },
        turns: [{ ...turn, id: "other-device" }],
      },
    });
  await expect(
    editLastUserMessage(source, "edited", inputs as never),
  ).rejects.toThrow(/改变/);
  expect(mocks.rollback).toHaveBeenCalledTimes(1);
  expect(mocks.start).not.toHaveBeenCalled();
});
it("unknown replacement send is not repeated, rollback is not repeated, original input remains untouched", async () => {
  mocks.start.mockRejectedValue(new TypeError("lost send"));
  await expect(
    editLastUserMessage(source, "edited", inputs as never),
  ).rejects.toBeInstanceOf(MutationUncertainError);
  await expect(
    editLastUserMessage(source, "edited", inputs as never),
  ).rejects.toBeInstanceOf(MutationUncertainError);
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(mocks.rollback).toHaveBeenCalledTimes(1);
  expect(inputs[0].text).toBe("original");
});
it("captures the original owner's service tier, reviewer and permissions before delayed reads and a different active owner", async () => {
  useCodexStore.setState({
    threads: [{ id: "owner", cwd: "/original-owner" }] as never,
  });
  changeThreadModel("owner", {
    model: "captured-model",
    reasoningEffort: "high",
    serviceTier: "fast",
    approvalsReviewer: "guardian_subagent",
    approvalPolicy: "on-request",
    sandbox: "read-only",
    webSearchRequest: true,
    collaborationMode: "default",
  });
  let finishRead!: (value: unknown) => void;
  mocks.read
    .mockReset()
    .mockImplementationOnce(
      () => new Promise((resolve) => (finishRead = resolve)),
    )
    .mockResolvedValue({
      thread: { id: "owner", status: { type: "idle" }, turns: [] },
    });
  const sending = editLastUserMessage(source, "edited", inputs as never);
  changeThreadModel("owner", {
    model: "later-model",
    serviceTier: "flex",
    approvalsReviewer: "user",
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    webSearchRequest: false,
    collaborationMode: "plan",
  });
  changeThreadModel("other", { model: "other-model", serviceTier: null });
  useCodexStore.setState({ currentThreadId: "other" });
  finishRead({
    thread: { id: "owner", status: { type: "idle" }, turns: [turn] },
  });
  await sending;
  expect(mocks.start.mock.calls[0][5]).toMatchObject({
    cwd: "/original-owner",
    model: "captured-model",
    effort: "high",
    serviceTier: "fast",
    approvalsReviewer: "guardian_subagent",
    approvalPolicy: "on-request",
    sandboxPolicy: { type: "readOnly", networkAccess: true },
    collaborationMode: {
      mode: "default",
      settings: { model: "captured-model" },
    },
  });
  expect(useCodexStore.getState().currentThreadId).toBe("other");
  expect(readDraft(sessionDraftKey("codex", "owner")).text).toBe(
    "Detached draft",
  );
});
it("a newer edit buffer revision survives a delayed successful send even when its text returns to the submitted value", async () => {
  const store = useThreadWorkflowStore.getState();
  store.setInlineEdit(source, "edited");
  let finishSend!: (value: unknown) => void;
  mocks.start.mockImplementationOnce(
    () => new Promise((resolve) => (finishSend = resolve)),
  );
  const sending = editLastUserMessage(source, "edited", inputs as never);
  await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
  store.setInlineEdit(source, "Newer independent edit");
  store.setInlineEdit(source, "edited");
  const expected = Object.values(
    useThreadWorkflowStore.getState().inlineEdits,
  )[0];
  finishSend({ id: "replacement" });
  await sending;
  expect(Object.values(useThreadWorkflowStore.getState().inlineEdits)).toEqual([
    expected,
  ]);
  expect(readDraft(sessionDraftKey("codex", "owner")).text).toBe(
    "Detached draft",
  );
});
