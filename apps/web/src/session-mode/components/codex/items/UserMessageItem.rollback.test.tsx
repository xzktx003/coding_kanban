import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useCodexStore, useEventPreferencesStore } from "../stores";
import {
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
import { EditableUserMessageItem } from "./UserMessageItem";

const mock = vi.hoisted(() => ({ rollback: vi.fn(), error: vi.fn() }));
vi.mock("@session/services/codexService", () => ({
  codexService: { threadRollback: mock.rollback },
}));
vi.mock("@session/components/ui/use-toast", () => ({
  toast: { error: mock.error },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@session/hooks/useWindowFocus", () => ({
  useWindowFocus: () => true,
}));
vi.mock("@session/components/Markdown", () => ({
  Markdown: ({ value }: { value: string }) => <span>{value}</span>,
}));
vi.mock("@session/components/common", () => ({
  CopyButton: () => null,
  AddToTodo: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  useCodexStore.setState({
    currentThreadId: "thread",
    currentTurnId: null,
    threadStatusMap: {},
    turnTimingMap: {},
  });
  useSessionDraftStore.setState({ drafts: {} });
  useSessionDraftStore
    .getState()
    .setText(sessionDraftKey("codex", "thread"), "existing draft");
  useEventPreferencesStore.setState({ hasConfirmedEditRollback: true });
});
const show = () =>
  render(
    <div className="session-mode">
      <EditableUserMessageItem
        content={[
          { type: "text", text: "original message", text_elements: [] },
        ]}
        threadId="thread"
        turnId="cut"
        rollbackTurns={2}
      />
    </div>,
  );

test("every destructive edit is confirmed, then rolls back once at its exact turn and restores the draft", async () => {
  let resolve!: () => void;
  mock.rollback.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  show();
  fireEvent.click(screen.getByRole("button", { name: "userMessage.edit" }));
  expect(mock.rollback).not.toHaveBeenCalled();
  fireEvent.click(
    await screen.findByRole("button", { name: "common.continue" }),
  );
  expect(mock.rollback).toHaveBeenCalledWith("thread", 2, "cut");
  expect(
    screen
      .getByRole("button", { name: "common.continue" })
      .hasAttribute("disabled"),
  ).toBe(true);
  resolve();
  await waitFor(() =>
    expect(readDraft(sessionDraftKey("codex", "thread")).text).toBe(
      "original message",
    ),
  );
});

test("a rollback failure keeps the existing draft and dialog for retry", async () => {
  mock.rollback.mockRejectedValue(new Error("offline"));
  show();
  fireEvent.click(screen.getByRole("button", { name: "userMessage.edit" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "common.continue" }),
  );
  await waitFor(() => expect(mock.error).toHaveBeenCalled());
  expect(readDraft(sessionDraftKey("codex", "thread")).text).toBe(
    "existing draft",
  );
  expect(
    screen
      .getByRole("button", { name: "common.continue" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

test("running turns cannot be silently rolled back", () => {
  useCodexStore.setState({
    threadStatusMap: { thread: { type: "active", activeFlags: [] } },
  });
  show();
  const edit = screen.getByRole("button", { name: "userMessage.edit" });
  expect(edit.hasAttribute("disabled")).toBe(true);
  fireEvent.click(edit);
  expect(mock.rollback).not.toHaveBeenCalled();
});

test("a delayed rollback restores the original session without overwriting the newly selected draft", async () => {
  let finish!: () => void;
  mock.rollback.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  show();
  fireEvent.click(screen.getByRole("button", { name: "userMessage.edit" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "common.continue" }),
  );
  useCodexStore.getState().setCurrentThreadId("other");
  useSessionDraftStore
    .getState()
    .setText(sessionDraftKey("codex", "other"), "other unfinished text");
  finish();
  await waitFor(() =>
    expect(readDraft(sessionDraftKey("codex", "thread")).text).toBe(
      "original message",
    ),
  );
  expect(readDraft(sessionDraftKey("codex", "other")).text).toBe(
    "other unfinished text",
  );
});
