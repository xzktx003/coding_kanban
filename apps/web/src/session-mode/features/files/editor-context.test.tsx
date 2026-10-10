import {
  composerDrafts,
  useComposerDraftStore,
} from "@session/components/codex/composer/v2/drafts";
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { FileViewer } from "./explorer/FileViewer";
import { useInputStore } from "@session/stores/useInputStore";
import { useCodexStore } from "@session/components/codex/stores";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useVsCodePanelStore } from "@session/stores/useVsCodePanelStore";
import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
import {
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
vi.mock("./editor/CodeEditor", () => ({
  CodeEditor: ({ onSendToAI }: any) => (
    <button
      onClick={() => onSendToAI("const selected = true;", { start: 4, end: 6 })}
    >
      测试代码选区
    </button>
  ),
}));
vi.mock("./explorer/OfficeView", () => ({ OfficeView: () => null }));
vi.mock("@session/hooks/useDirWatch", () => ({ useDirWatch: () => {} }));
vi.mock("@session/services/workspaceFiles", () => ({
  readWorkspaceText: async () => ({ content: "fixture", version: "one" }),
  saveWorkspaceText: vi.fn(),
}));
test("selected code captures a file context with line range without overwriting either conversation", async () => {
  useAcpStore.setState({ active: false });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useCodexStore.setState({
    currentThreadId: "context-owner",
    threads: [{ id: "context-owner", cwd: "/fixture" } as never],
  });
  useWorkspaceStore.setState({ cwd: "/fixture" });
  useEditorStore.setState({ roots: { "/fixture/example.ts": "/fixture" } });
  useVsCodePanelStore.setState({ aliases: {} });
  useFileDocumentStore.setState({ documents: {} });
  useComposerDraftStore.setState({ drafts: {}, error: null });
  useSessionDraftStore.setState({ drafts: {} });
  const owner = sessionDraftKey("codex", "context-owner"),
    other = sessionDraftKey("codex", "other");
  useSessionDraftStore.getState().setText(owner, "已有问题");
  useSessionDraftStore.getState().setText(other, "其他会话");
  render(<FileViewer filePath="/fixture/example.ts" />);
  fireEvent.click(await screen.findByRole("button", { name: "测试代码选区" }));
  expect(readDraft(owner).text).toBe("已有问题");
  expect(composerDrafts.read(owner).contexts.at(-1)).toMatchObject({
    path: "/fixture/example.ts",
    range: { start: 4, end: 6 },
    text: "const selected = true;",
  });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(composerDrafts.read(other).contexts).toHaveLength(0);
  expect(readDraft(other).text).toBe("其他会话");
  expect(useInputStore.getState().inputValue).toContain("已有问题");
});
