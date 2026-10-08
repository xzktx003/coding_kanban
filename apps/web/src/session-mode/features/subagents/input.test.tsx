import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
const mock = vi.hoisted(() => ({
  verify: vi.fn(),
  submit: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("./service", () => ({ subagentService: { verify: mock.verify } }));
vi.mock("./AgentMentionPicker", () => ({ AgentMentionPicker: () => null }));
vi.mock("@session/services/followupService", () => ({
  followupService: { submit: mock.submit },
  followupParameters: () => ({
    model: "parent-model",
    approvalPolicy: "never",
  }),
}));
vi.mock("@session/components/common/useImageAttachments", () => ({
  useImageAttachments: () => ({
    blocked: false,
    paths: [],
    attachments: [],
    clear: mock.clear,
  }),
}));
import { SubagentInput } from "./SubagentInput";
import { sessionDraftSubmissions } from "./submissions";
const owner = sessionDraftKey("codex", "child");
it("child input preserves native child settings instead of inheriting the open parent's controls", async () => {
  mock.verify.mockResolvedValue({
    id: "child",
    canAcceptDirectInput: true,
    cwd: "/child",
    model: "child-model",
    reasoningEffort: "medium",
  });
  useSessionDraftStore.getState().setText(owner, "continue child");
  render(<SubagentInput root="root" id="child" name="Atlas" />);
  fireEvent.click(screen.getByRole("button", { name: "发送给 Atlas" }));
  await waitFor(() => expect(mock.submit).toHaveBeenCalledTimes(1));
  expect(mock.submit.mock.calls[0][7]).toEqual({
    cwd: "/child",
    model: "child-model",
    effort: "medium",
  });
});
beforeEach(() => {
  vi.clearAllMocks();
  sessionDraftSubmissions.clear();
  useSessionDraftStore.setState({ drafts: {} });
  mock.verify.mockResolvedValue({
    id: "child",
    parentThreadId: "root",
    canAcceptDirectInput: true,
  });
  mock.submit.mockResolvedValue({ items: [] });
});
it("unrelated old queue failure does not invalidate this accepted submission", async () => {
  mock.submit.mockResolvedValue({
    items: [
      { id: "old", status: "failed" },
      { id: "accepted", status: "queued" },
    ],
  });
  useSessionDraftStore.getState().setText(owner, "new input");
  render(<SubagentInput root="root" id="child" name="Atlas" />);
  fireEvent.click(screen.getByRole("button", { name: "发送给 Atlas" }));
  await waitFor(() => expect(readDraft(owner).text).toBe(""));
});
it("restricted permission is checked before submission and preserves the draft", async () => {
  mock.verify.mockResolvedValue({ id: "child", canAcceptDirectInput: false });
  useSessionDraftStore.getState().setText(owner, "keep");
  render(<SubagentInput root="root" id="child" name="Atlas" />);
  fireEvent.click(screen.getByRole("button", { name: "发送给 Atlas" }));
  await screen.findByText(/不允许直接输入/);
  expect(mock.submit).not.toHaveBeenCalled();
  expect(readDraft(owner).text).toBe("keep");
});
it("two editor views share a submission lock and late acceptance preserves newer typing", async () => {
  let resolve!: (value: unknown) => void;
  mock.submit.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  useSessionDraftStore.getState().setText(owner, "captured");
  render(
    <>
      <SubagentInput root="root" id="child" name="One" />
      <SubagentInput root="root" id="child" name="Two" />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "发送给 One" }));
  fireEvent.click(screen.getByRole("button", { name: "发送给 Two" }));
  await waitFor(() => expect(mock.submit).toHaveBeenCalledTimes(1));
  act(() => useSessionDraftStore.getState().setText(owner, "newer draft"));
  await act(async () => resolve({ items: [{ status: "queued" }] }));
  expect(mock.submit.mock.calls[0].slice(0, 4)).toEqual([
    owner,
    1,
    "child",
    "captured",
  ]);
  expect(readDraft(owner).text).toBe("newer draft");
});
