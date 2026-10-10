import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { EditableUserMessageItem } from "./UserMessageItem";
import { useCodexStore } from "../stores";
import {
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
import { useThreadWorkflowStore } from "@session/features/thread-workflows/delivery";
const mocks = vi.hoisted(() => ({ edit: vi.fn() }));
vi.mock("@session/features/thread-workflows/edit", () => ({
  editLastUserMessage: mocks.edit,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@session/hooks/useWindowFocus", () => ({
  useWindowFocus: () => true,
}));
vi.mock("../presentation/CodexMarkdown", () => ({
  CodexMarkdown: ({ value }: { value: string }) => <span>{value}</span>,
}));
vi.mock("@session/components/common", () => ({
  CopyButton: () => null,
  AddToTodo: () => null,
}));
beforeEach(() => {
  vi.clearAllMocks();
  useThreadWorkflowStore.setState({ inlineEdits: {}, mutations: {} });
  useCodexStore.setState({
    threadStatusMap: {},
    turnTimingMap: {},
    currentThreadId: "owner",
  });
  useSessionDraftStore.setState({ drafts: {} });
  useSessionDraftStore
    .getState()
    .setText(sessionDraftKey("codex", "owner"), "Unsent detached draft");
});
const content = [
  { type: "text", text: "Original message", text_elements: [] },
  { type: "image", url: "https://example.test/image.png" },
] as never;
const show = () =>
  render(
    <div className="session-mode">
      <EditableUserMessageItem
        nativeEdit
        content={content}
        threadId="owner"
        turnId="chosen"
        rollbackTurns={1}
      />
    </div>,
  );
it("opens native inline editor, edits independently, cancels without touching detached draft", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "userMessage.edit" }));
  const editor = screen.getByRole("textbox", { name: "编辑上一条用户消息" });
  expect(editor.textContent).toBe("Original message");
  editor.textContent = "Changed message";
  fireEvent.input(editor);
  expect(readDraft(sessionDraftKey("codex", "owner")).text).toBe(
    "Unsent detached draft",
  );
  fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(mocks.edit).not.toHaveBeenCalled();
});
it("IME composition Enter does not submit; send requires visible rollback confirmation and captures changed text plus original attachments", async () => {
  mocks.edit.mockResolvedValue("replacement");
  show();
  fireEvent.click(screen.getByRole("button", { name: "userMessage.edit" }));
  const editor = screen.getByRole("textbox");
  editor.textContent = "修改后的文字";
  fireEvent.input(editor);
  fireEvent.keyDown(editor, { key: "Enter", code: "Enter", isComposing: true });
  expect(screen.queryByRole("button", { name: "common.continue" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "发送编辑消息" }));
  expect(mocks.edit).not.toHaveBeenCalled();
  fireEvent.click(
    await screen.findByRole("button", { name: "common.continue" }),
  );
  await waitFor(() =>
    expect(mocks.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "owner",
        turnId: "chosen",
        itemId: expect.any(String),
      }),
      "修改后的文字",
      content,
    ),
  );
  expect(readDraft(sessionDraftKey("codex", "owner")).text).toBe(
    "Unsent detached draft",
  );
});
it("keeps failed edit buffer after collapsing editor and reopening", async () => {
  mocks.edit.mockRejectedValue(new Error("Rejected before execution"));
  show();
  fireEvent.click(screen.getByRole("button", { name: "userMessage.edit" }));
  screen.getByRole("textbox").textContent = "Saved changed text";
  fireEvent.input(screen.getByRole("textbox"));
  fireEvent.click(screen.getByRole("button", { name: "发送编辑消息" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "common.continue" }),
  );
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
  expect(screen.getByRole("textbox").textContent).toBe("Saved changed text");
});
it("does not clear a newer buffer preserved by the service when its text equals the pending submit", async () => {
  let finish!: (value: string) => void;
  mocks.edit.mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  show();
  fireEvent.click(screen.getByRole("button", { name: "userMessage.edit" }));
  screen.getByRole("textbox").textContent = "Submitted text";
  fireEvent.input(screen.getByRole("textbox"));
  fireEvent.click(screen.getByRole("button", { name: "发送编辑消息" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "common.continue" }),
  );
  await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
  const source = mocks.edit.mock.calls[0][0],
    store = useThreadWorkflowStore.getState();
  store.setInlineEdit(source, "A newer independent value");
  store.setInlineEdit(source, "Submitted text");
  const expected = Object.values(
    useThreadWorkflowStore.getState().inlineEdits,
  )[0];
  finish("replacement");
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "common.continue" }),
    ).toBeNull(),
  );
  expect(Object.values(useThreadWorkflowStore.getState().inlineEdits)).toEqual([
    expected,
  ]);
  expect(screen.getByRole("textbox").textContent).toBe("Submitted text");
  expect(readDraft(sessionDraftKey("codex", "owner")).text).toBe(
    "Unsent detached draft",
  );
});
