import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FileViewer } from "./FileViewer";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
vi.mock("../editor/CodeEditor", () => ({
  CodeEditor: ({
    content,
    isReadOnly,
  }: {
    content: string;
    isReadOnly: boolean;
  }) => (
    <div data-testid="range-file" data-read-only={String(isReadOnly)}>
      {content}
    </div>
  ),
}));
vi.mock("./OfficeView", () => ({ OfficeView: () => null }));
vi.mock("@session/hooks/useDirWatch", () => ({ useDirWatch: () => {} }));
vi.mock("@session/services/workspaceFiles", () => ({
  readWorkspaceText: async () => ({
    content: Array.from({ length: 600 }, (_, i) => `line ${i + 1}`).join("\n"),
    version: "fixture",
  }),
  saveWorkspaceText: vi.fn(),
}));
beforeEach(() => {
  useEditorStore.getState().resetFiles();
  useWorkspaceStore.setState({ cwd: "/other" });
  useFileDocumentStore.setState({ documents: {} });
});
it("reveals native range beyond the preview while preserving explicit permission to edit", async () => {
  (useEditorStore.getState().revealFile as (...args: unknown[]) => void)(
    "/owner/file.ts",
    "/owner",
    512,
    1,
    514,
  );
  render(<FileViewer filePath="/owner/file.ts" />);
  const editor = await screen.findByTestId("range-file");
  expect(editor.textContent).toContain("line 514");
  expect(editor.getAttribute("data-read-only")).toBe("true");
  expect(screen.getByRole("button", { name: "加载全文以编辑" })).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "保存文件（Ctrl+S）" }),
  ).toBeNull();
});
