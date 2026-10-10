import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FileViewer } from "./FileViewer";
import { useCodexStore } from "@session/components/codex/stores";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useVsCodePanelStore } from "@session/stores/useVsCodePanelStore";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
import {
  sessionDraftKey,
  readDraft,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
import {
  composerDrafts,
  useComposerDraftStore,
} from "@session/components/codex/composer/v2/drafts";
import { useCCStore } from "@session/stores/cc/ccStore";
vi.mock("@session/services/workspaceFiles", () => ({
  readWorkspaceText: async (_root: string, path: string) => ({
    path,
    content: "Original file",
    version: "v1",
    size: 13,
  }),
  saveWorkspaceText: vi.fn(),
}));
vi.mock("@session/hooks/useDirWatch", () => ({ useDirWatch: () => {} }));
vi.mock("./OfficeView", () => ({ OfficeView: () => null }));
vi.mock("../editor/CodeEditor", () => ({
  CodeEditor: ({
    onSendToAI,
  }: {
    onSendToAI: (text: string, range: { start: number; end: number }) => void;
  }) => (
    <button
      onClick={() => onSendToAI("Unsaved selected text", { start: 3, end: 4 })}
    >
      Send editor selection
    </button>
  ),
}));
const owner = sessionDraftKey("codex", "owner");
beforeEach(() => {
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useCodexStore.setState({
    currentThreadId: "owner",
    threads: [
      { id: "owner", cwd: "/owner" } as never,
      { id: "other", cwd: "/other" } as never,
    ],
  });
  useWorkspaceStore.setState({ cwd: "/owner", projects: ["/owner", "/other"] });
  useVsCodePanelStore.setState({ aliases: {} });
  useEditorStore.setState({ roots: { "/owner/source.ts": "/owner" } });
  useFileDocumentStore.setState({ documents: {} });
  useComposerDraftStore.setState({ drafts: {}, error: null });
  useSessionDraftStore.setState({ drafts: {} });
  useSessionDraftStore.getState().setText(owner, "Detached original draft");
});
it("adds the original file selection through the validated owner and retains detached text", async () => {
  render(<FileViewer filePath="/owner/source.ts" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Send editor selection" }),
  );
  expect(composerDrafts.read(owner).contexts).toMatchObject([
    {
      path: "/owner/source.ts",
      text: "Unsaved selected text",
      range: { start: 3, end: 4 },
    },
  ]);
  expect(readDraft(owner).text).toBe("Detached original draft");
});
it("rejects a project-pinned file after input changes to another owner without switching targets", async () => {
  render(<FileViewer filePath="/owner/source.ts" />);
  const send = await screen.findByRole("button", {
    name: "Send editor selection",
  });
  useCodexStore.setState({ currentThreadId: "other" });
  useWorkspaceStore.setState({ cwd: "/other" });
  fireEvent.click(send);
  expect(
    composerDrafts.read(sessionDraftKey("codex", "other")).contexts,
  ).toHaveLength(0);
  expect(composerDrafts.read(owner).contexts).toHaveLength(0);
  expect(screen.getByRole("alert").textContent).toContain("原会话项目");
  expect(useCodexStore.getState().currentThreadId).toBe("other");
  expect(useWorkspaceStore.getState().cwd).toBe("/other");
});
it("uses trusted canonical aliases without retargeting the original draft key", async () => {
  useVsCodePanelStore.setState({ aliases: { "/owner": "/canonical" } });
  useEditorStore.setState({ roots: { "/canonical/source.ts": "/owner" } });
  render(<FileViewer filePath="/canonical/source.ts" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Send editor selection" }),
  );
  expect(composerDrafts.read(owner).contexts).toMatchObject([
    { path: "/canonical/source.ts", range: { start: 3, end: 4 } },
  ]);
});
it("rejects escaping file paths and preserves the existing Claude text append behavior", async () => {
  render(<FileViewer filePath="/owner/../outside.ts" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Send editor selection" }),
  );
  expect(composerDrafts.read(owner).contexts).toHaveLength(0);
  useAgentSettingsStore.setState({ selectedAgent: "cc" });
  useCCStore.setState({ activeSessionId: "claude-owner" });
  fireEvent.click(
    screen.getByRole("button", { name: "Send editor selection" }),
  );
  expect(readDraft(sessionDraftKey("cc", "claude-owner")).text).toContain(
    "Unsaved selected text",
  );
  expect(composerDrafts.read(owner).contexts).toHaveLength(0);
});
