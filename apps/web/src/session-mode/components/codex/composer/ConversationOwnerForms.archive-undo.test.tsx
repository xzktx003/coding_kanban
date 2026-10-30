import { resetAppActionHistory, canUndoAppAction, undoAppAction, redoAppAction } from "./appActionHistory";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { resetConversationFormDraftsForTests } from "./conversationFormDrafts";
import { captureConversationForm } from "./conversationOwnerFormContext";
import { ConversationOwnerForms } from "./ConversationOwnerForms";
import { useCodexStore } from "../stores/useCodexStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import {
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";

/**
 * Original local-thread archive is a `bu`/`Tx` undo transaction (41ab chunk
 * @2425337) whose undo calls `unarchiveConversation` and whose success toast is
 * `appUndo.threadArchived` = 聊天已恢复. The archive itself therefore has to
 * stay undoable; a terminal "已归档聊天" message with no way back is the gap.
 *
 * The official ChatGPT-conversation flow (`sSi` @3563895) has a second "查看"
 * action, but it opens chatgpt.com/#settings/DataControls/ArchivedChats and is
 * reached only through `chatgpt:${id}`, so it is deliberately not asserted here.
 */

const api = vi.hoisted(() => ({
  archiveThread: vi.fn(),
  unarchiveThread: vi.fn(),
  deleteThread: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/codex", () => ({
  ...api,
  threadAccess: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/git", () => api);
const toastCalls = vi.hoisted(() => ({
  message: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastCalls }));
vi.mock("@session/services/codexService", () => ({
  codexService: { setCurrentThread: vi.fn() },
}));

/**
 * Built through the production capture so the operation scope is a real one;
 * `run` rejects a hand-rolled target before it ever reaches the write.
 */
function archiveForm(kind: "archive" | "delete" = "archive") {
  return captureConversationForm(kind, {
    threadId: "arch-a",
    cwd: "/fixture/a",
    title: "Arch A",
    draftOwner: "arch-a",
  });
}

beforeEach(() => {
  resetConversationFormDraftsForTests();
  resetAppActionHistory();
  vi.clearAllMocks();
  for (const fn of Object.values(api)) fn.mockResolvedValue({});
  useLayoutStore.setState({ view: "settings" });
  useCodexStore.setState({
    currentThreadId: "arch-a",
    threads: [{ id: "arch-a", name: "Arch A", cwd: "/fixture/a" }] as never,
  });
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "arch-a", cwd: "/fixture/a" }] as never,
  });
  useSessionDraftStore.setState({
    drafts: {
      [sessionDraftKey("codex", "arch-a")]: { text: "DRAFT-A", revision: 1 },
    },
  });
});

function mountArchive() {
  return render(
    <div className="session-mode">
      <ConversationOwnerForms
        form={archiveForm()}
        onClose={() => {}}
        onChange={() => {}}
      />
    </div>,
  );
}

async function confirmArchive() {
  const view = mountArchive();
  const confirm = await screen.findByRole("button", { name: "确认归档" });
  fireEvent.click(confirm);
  await waitFor(() => expect(api.archiveThread).toHaveBeenCalledWith("arch-a"));
  return view;
}

/** The toast options object our code hands sonner for the archive notice. */
function archiveNotice() {
  const call = toastCalls.message.mock.calls.at(-1);
  return { body: call?.[0], options: call?.[1] as Record<string, unknown> };
}

it("offers an undo action on the archive notice", async () => {
  await confirmArchive();
  await waitFor(() => expect(toastCalls.message).toHaveBeenCalled());
  const { options } = archiveNotice();
  const action = options?.action as { label?: string } | undefined;
  expect(action?.label).toBe("撤销");
});

it("unarchives the same thread when the undo action runs", async () => {
  await confirmArchive();
  await waitFor(() => expect(toastCalls.message).toHaveBeenCalled());
  const { options } = archiveNotice();
  const action = options?.action as { onClick: () => void };
  action.onClick();
  await waitFor(() =>
    expect(api.unarchiveThread).toHaveBeenCalledWith("arch-a"),
  );
});

it("reports the official restored copy after a successful undo", async () => {
  await confirmArchive();
  await waitFor(() => expect(toastCalls.message).toHaveBeenCalled());
  const { options } = archiveNotice();
  (options?.action as { onClick: () => void }).onClick();
  await waitFor(() => expect(api.unarchiveThread).toHaveBeenCalled());
  // Official `appUndo.threadArchived` zh string.
  await waitFor(() =>
    expect(toastCalls.success).toHaveBeenCalledWith(
      "聊天已恢复",
      expect.anything(),
    ),
  );
});

it("restores the thread into the list and the focused cards on undo", async () => {
  await confirmArchive();
  await waitFor(() =>
    expect(
      useCodexStore.getState().threads.some((t) => t.id === "arch-a"),
    ).toBe(false),
  );
  const { options } = archiveNotice();
  (options?.action as { onClick: () => void }).onClick();
  await waitFor(() => expect(api.unarchiveThread).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      useCodexStore.getState().threads.some((t) => t.id === "arch-a"),
    ).toBe(true),
  );
  expect(
    useAgentCenterStore
      .getState()
      .cards.some((c) => c.kind === "codex" && c.id === "arch-a"),
  ).toBe(true);
});

it("surfaces the official failure copy and keeps the thread archived when undo fails", async () => {
  await confirmArchive();
  api.unarchiveThread.mockRejectedValueOnce(new Error("nope"));
  const { options } = archiveNotice();
  (options?.action as { onClick: () => void }).onClick();
  // Official `localTaskRow.unarchiveError` zh string.
  await waitFor(() =>
    expect(toastCalls.error).toHaveBeenCalledWith(
      "取消归档对话失败",
      expect.anything(),
    ),
  );
  expect(useCodexStore.getState().threads.some((t) => t.id === "arch-a")).toBe(
    false,
  );
});

it("does not offer undo on the delete notice", async () => {
  render(
    <div className="session-mode">
      <ConversationOwnerForms
        form={archiveForm("delete")}
        onClose={() => {}}
        onChange={() => {}}
      />
    </div>,
  );
  const confirm = await screen.findByRole("button", { name: "删除" });
  fireEvent.click(confirm);
  await waitFor(() => expect(api.deleteThread).toHaveBeenCalledWith("arch-a"));
  await waitFor(() => expect(toastCalls.message).toHaveBeenCalled());
  // Deleting is permanent on the official side too, so there is nothing to undo.
  const { body, options } = archiveNotice();
  expect(body).toBe("任务已删除");
  expect(options?.action).toBeUndefined();
});

it("keeps the undo bound to the archived thread, not the current one", async () => {
  await confirmArchive();
  // A later selection must not redirect the undo at a different thread.
  useCodexStore.setState({ currentThreadId: "other-thread" });
  const { options } = archiveNotice();
  (options?.action as { onClick: () => void }).onClick();
  await waitFor(() =>
    expect(api.unarchiveThread).toHaveBeenCalledWith("arch-a"),
  );
  expect(api.unarchiveThread).not.toHaveBeenCalledWith("other-thread");
});

it("ignores a second undo click so one archive cannot unarchive twice", async () => {
  await confirmArchive();
  const { options } = archiveNotice();
  const action = options?.action as { onClick: () => void };
  action.onClick();
  action.onClick();
  await waitFor(() => expect(api.unarchiveThread).toHaveBeenCalled());
  expect(api.unarchiveThread).toHaveBeenCalledTimes(1);
});

it("separates ordinary archive from explicitly stopping and archiving", async () => {
  mountArchive();
  const heading = await screen.findByText("归档聊天");
  expect(heading).toBeTruthy();
  expect(
    within(document.body).getByText(
      /普通归档仅适用于空闲且没有待发内容/,
    ),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "停止并归档" })).toBeTruthy();
  expect(api.archiveThread).not.toHaveBeenCalled();
});

it("records archive in global history and keeps pending undo until unarchive is acknowledged", async () => {
  await confirmArchive();
  await waitFor(() => expect(toastCalls.message).toHaveBeenCalled());
  expect(canUndoAppAction()).toBe(true);
  let acknowledge!: () => void;
  api.unarchiveThread.mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve; }));
  const pending = undoAppAction();
  await waitFor(() => expect(api.unarchiveThread).toHaveBeenCalled());
  expect(useCodexStore.getState().threads.some(thread => thread.id === "arch-a")).toBe(false);
  acknowledge(); await pending;
  expect(useCodexStore.getState().threads.some(thread => thread.id === "arch-a")).toBe(true);
  await redoAppAction();
  expect(api.archiveThread).toHaveBeenLastCalledWith("arch-a");
  expect(useCodexStore.getState().threads.some(thread => thread.id === "arch-a")).toBe(false);
});
