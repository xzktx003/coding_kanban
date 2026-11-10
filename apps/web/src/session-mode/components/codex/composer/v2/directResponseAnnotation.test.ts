import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  flush: vi.fn(),
  clear: vi.fn(),
  submit: vi.fn(),
  readDraft: vi.fn(),
  runtime: vi.fn(),
  preference: vi.fn(),
  captureSettings: vi.fn(),
  parameters: vi.fn(),
}));
vi.mock("./drafts", () => ({
  composerDrafts: {
    capture: mocks.capture,
    flush: mocks.flush,
    clearSubmitted: mocks.clear,
  },
}));
vi.mock("@session/stores/useSessionDraftStore", () => ({
  readDraft: mocks.readDraft,
}));
vi.mock("@session/services/followupService", () => ({
  followupService: { submit: mocks.submit },
  followupParameters: mocks.parameters,
}));
vi.mock("@session/stores/useThreadModelStore", () => ({
  captureThreadModelSelection: mocks.captureSettings,
}));
vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: { getState: () => ({}) },
}));
vi.mock("@session/stores/useFollowupSettingsStore", () => ({
  useFollowupSettingsStore: { getState: mocks.preference },
}));
vi.mock("@session/utils/codexRuntimeState", () => ({
  codexRuntimeState: mocks.runtime,
}));

import { sendResponseAnnotation } from "./directResponseAnnotation";
import { acquireComposerSubmission } from "./composerSubmissionLock";

const selected = {
  id: "selected",
  kind: "quote" as const,
  name: "选中的文本",
  text: "选中文本",
  sourceThreadId: "thread-a",
  sourceItemId: "response-a",
  responseSelection: { start: 0, end: 4 },
  annotation: "请解释",
};
const other = {
  id: "other",
  kind: "quote" as const,
  name: "另一个选区",
  text: "其他内容",
};
const capture = (entry = selected, version = "version-1") => ({
  contexts: [entry, other],
  versions: { selected: version, other: "other-version" },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.capture.mockReturnValue(capture());
  mocks.flush.mockResolvedValue(undefined);
  mocks.readDraft.mockReturnValue({
    revision: 7,
    writeId: "draft-version",
    text: "未发送的其他草稿",
  });
  mocks.runtime.mockReturnValue({ running: true, turnId: "turn-a" });
  mocks.preference.mockReturnValue({ mode: "steer" });
  mocks.captureSettings.mockReturnValue({
    threadId: "thread-a",
    settings: { model: "captured-model" },
  });
  mocks.parameters.mockReturnValue({ model: "captured-model" });
  mocks.submit.mockResolvedValue({ items: [], paused: null });
});

it("directly submits only the selected annotation to its own running thread and preserves the other draft", async () => {
  const result = await sendResponseAnnotation(
    "owner-a",
    "thread-a",
    "selected",
  );
  expect(mocks.submit).toHaveBeenCalledOnce();
  const args = mocks.submit.mock.calls[0];
  expect(args.slice(0, 7)).toEqual([
    "owner-a",
    {
      revision: 7,
      writeId: "draft-version",
      attachmentIds: [],
      contextIds: ["selected"],
    },
    "thread-a",
    "",
    [],
    "steer",
    "turn-a",
  ]);
  expect(args[8]).toHaveLength(1);
  expect(args[8][0]).toMatchObject({
    id: "selected",
    text: "所选文本：\n选中文本\n\n用户评论：\n请解释",
    sourceThreadId: "thread-a",
  });
  expect(args[8][0]).not.toHaveProperty("responseSelection");
  expect(args[7]).toEqual({ model: "captured-model" });
  expect(args[10]).toMatchObject({
    threadId: "thread-a",
    settings: { model: "captured-model" },
  });
  expect(mocks.clear).toHaveBeenCalledWith("owner-a", [selected], {
    selected: "version-1",
    other: "other-version",
  });
  expect(result.removed).toBe(true);
});

it("does not send a changed annotation after saving the captured version", async () => {
  mocks.capture
    .mockReturnValueOnce(capture())
    .mockReturnValueOnce(
      capture({ ...selected, annotation: "更新后的评论" }, "version-2"),
    );
  await expect(
    sendResponseAnnotation("owner-a", "thread-a", "selected"),
  ).rejects.toThrow("批注已变化");
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled();
});

it("uses the model selection captured before waiting for draft storage", async () => {
  let release!: () => void;
  mocks.flush.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const sending = sendResponseAnnotation("owner-a", "thread-a", "selected");
  mocks.captureSettings.mockReturnValue({ threadId: "thread-a", settings: { model: "later-model" } });
  mocks.parameters.mockReturnValue({ model: "later-model" });
  release();
  await sending;
  expect(mocks.submit.mock.calls[0][7]).toEqual({ model: "captured-model" });
  expect(mocks.submit.mock.calls[0][10].settings.model).toBe("captured-model");
});

it("retains the annotation when submission fails or its result is unknown", async () => {
  mocks.submit.mockRejectedValueOnce(new Error("送达待确认"));
  await expect(sendResponseAnnotation("owner-a", "thread-a", "selected")).rejects.toThrow("送达待确认");
  expect(mocks.clear).not.toHaveBeenCalled();
});

it("retains a comment edited while submission is in flight and rejects a duplicate click", async () => {
  let release!: (value: unknown) => void;
  mocks.submit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = sendResponseAnnotation("owner-a", "thread-a", "selected");
  await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  await expect(
    sendResponseAnnotation("owner-a", "thread-a", "selected"),
  ).rejects.toThrow("正在发送");
  mocks.capture.mockReturnValue(
    capture({ ...selected, annotation: "发送期间的新评论" }, "version-2"),
  );
  release({ items: [], paused: null });
  expect((await first).removed).toBe(false);
  expect(mocks.clear).not.toHaveBeenCalled();
});

it("does not submit while another composer is already sending for this owner", async () => {
  const release = acquireComposerSubmission("owner-a");
  expect(release).not.toBeNull();
  try {
    await expect(
      sendResponseAnnotation("owner-a", "thread-a", "selected"),
    ).rejects.toThrow("正在发送");
    expect(mocks.submit).not.toHaveBeenCalled();
  } finally {
    release?.();
  }
  await expect(
    sendResponseAnnotation("owner-a", "thread-a", "selected"),
  ).resolves.toEqual({ removed: true });
});

it("keeps owners independent and makes an old release harmless", () => {
  const releaseA = acquireComposerSubmission("owner-a")!;
  const releaseB = acquireComposerSubmission("owner-b")!;
  expect(acquireComposerSubmission("owner-a")).toBeNull();
  releaseA();
  const releaseNextA = acquireComposerSubmission("owner-a")!;
  releaseA();
  expect(acquireComposerSubmission("owner-a")).toBeNull();
  releaseNextA();
  releaseB();
  const verify = acquireComposerSubmission("owner-b");
  expect(verify).not.toBeNull();
  verify?.();
});

it("does not send if the selected source belongs to another thread or its active turn is unknown", async () => {
  await expect(
    sendResponseAnnotation("owner-a", "thread-b", "selected"),
  ).rejects.toThrow("当前会话");
  mocks.runtime.mockReturnValue({ running: true, turnId: null });
  await expect(
    sendResponseAnnotation("owner-a", "thread-a", "selected"),
  ).rejects.toThrow("当前任务");
  expect(mocks.submit).not.toHaveBeenCalled();
});
