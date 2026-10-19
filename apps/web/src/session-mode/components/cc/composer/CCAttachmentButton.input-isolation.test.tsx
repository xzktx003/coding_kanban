import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CCAttachmentButton } from "./CCAttachmentButton";
import * as utils from "@session/lib/utils";
import { open } from "@session/browser-dialog";
import { useInputStore } from "@session/stores/useInputStore";
import {
  useSessionDraftStore,
  readDraft,
  sessionDraftKey,
} from "@session/stores/useSessionDraftStore";
import { useCCStore } from "@session/stores/cc/ccStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useAcpStore } from "@session/stores/useAcpStore";

vi.mock("@session/browser-dialog", () => ({
  open: vi.fn(),
  pickBrowserFiles: vi.fn(),
  uploadBrowserFile: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  useSessionDraftStore.setState({ drafts: {}, migrated: [] });
  useAgentSettingsStore.setState({ selectedAgent: "cc" });
  useCCStore.setState({ activeSessionId: "attachment-a" });
  useWorkspaceStore.setState({ cwd: "/fixture" });
  useAcpStore.setState({ active: false });
});
afterEach(() => vi.restoreAllMocks());

test("typing does not rerender the action-only attachment control", () => {
  const classNames = vi.spyOn(utils, "cn");
  render(<CCAttachmentButton />);
  expect(screen.getByRole("button", { name: "添加附件与上下文" })).toBeTruthy();
  classNames.mockClear();
  for (const value of ["t", "ty", "type"]) {
    act(() => useInputStore.getState().setInputValue(value));
  }
  expect(classNames).not.toHaveBeenCalled();
});

test("file attachment insertion reads the current Claude session at click time", async () => {
  vi.mocked(open).mockResolvedValue(["/fixture/entry.ts"]);
  render(<CCAttachmentButton />);
  act(() => useCCStore.setState({ activeSessionId: "attachment-b" }));
  fireEvent.click(screen.getByRole("button", { name: "添加附件与上下文" }));
  fireEvent.click(screen.getByRole("button", { name: "文件和文件夹" }));
  await waitFor(() =>
    expect(readDraft(sessionDraftKey("cc", "attachment-b")).text).toBe(
      "[entry.ts](entry.ts)",
    ),
  );
  expect(readDraft(sessionDraftKey("cc", "attachment-a")).text).toBe("");
});
