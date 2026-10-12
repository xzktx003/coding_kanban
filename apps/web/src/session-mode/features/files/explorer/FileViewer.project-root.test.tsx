import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FileViewer } from "./FileViewer";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
vi.mock("@session/services/workspaceFiles", () => ({
  readWorkspaceText: async (_root: string, path: string) => ({
    path,
    content: "file content",
    version: "fixture-version",
    size: 12,
  }),
  saveWorkspaceText: vi.fn(),
}));
vi.mock("@session/hooks/useDirWatch", () => ({ useDirWatch: () => {} }));
vi.mock("./OfficeView", () => ({ OfficeView: () => null }));
vi.mock("../editor/CodeEditor", () => ({
  CodeEditor: () => <div>file editor</div>,
}));
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
beforeEach(() => {
  useEditorStore.getState().resetFiles();
  useFileDocumentStore.setState({ documents: {} });
  useWorkspaceStore.setState({ cwd: "/fixture" });
});
it("keeps hooks stable when a fallback project becomes an explicit resolved file root", async () => {
  render(<FileViewer filePath="/fixture/file.ts" />);
  await screen.findByText("file editor");
  await act(async () => {
    useEditorStore.setState({ roots: { "/fixture/file.ts": "/fixture" } });
  });
  expect(screen.getByText("file editor")).toBeTruthy();
  await act(async () => {
    useEditorStore.setState({ roots: {} });
  });
  expect(screen.getByText("file editor")).toBeTruthy();
});
