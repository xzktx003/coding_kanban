import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CodexMarkdown } from "./CodexMarkdown";
import { useCodexStore } from "../stores/useCodexStore";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { resolveWorkspaceFileReference } from "@session/services/workspaceFiles";

vi.mock("@session/services/workspaceFiles", () => ({
  resolveWorkspaceFileReference: vi.fn(async (root: string, path: string) => ({
    root,
    path,
  })),
}));
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "zh-CN" },
    t: (key: string) => key,
  }),
}));

beforeEach(() => {
  useCodexStore.setState({
    threads: [{ id: "citation-owner", cwd: "/modelzoo" } as never],
  });
  useWorkspaceStore.setState({ cwd: "/other" });
  useEditorStore.getState().resetFiles();
  vi.mocked(resolveWorkspaceFileReference).mockImplementation(
    async (root: string, path: string) => ({ root, path }),
  );
});

it("opens an ordinary markdown file link through the shared async resolver", async () => {
  vi.mocked(resolveWorkspaceFileReference).mockResolvedValue({
    root: "/quanttool",
    path: "/quanttool/xhquant/file.py",
  });
  render(
    <CodexMarkdown
      threadId="citation-owner"
      value="[operator](/modelzoo/xhquant/file.py:12:4)"
    />,
  );

  fireEvent.click(screen.getByRole("link", { name: "operator" }));

  await waitFor(() =>
    expect(resolveWorkspaceFileReference).toHaveBeenCalledWith(
      "/modelzoo",
      "/modelzoo/xhquant/file.py",
    ),
  );
  await waitFor(() =>
    expect(useEditorStore.getState().activeFile).toBe(
      "/quanttool/xhquant/file.py",
    ),
  );
  expect(useEditorStore.getState().roots["/quanttool/xhquant/file.py"]).toBe(
    "/quanttool",
  );
  expect(useEditorStore.getState().revealLocation).toMatchObject({
    path: "/quanttool/xhquant/file.py",
    line: 12,
    column: 4,
  });
  expect(useWorkspaceStore.getState().cwd).toBe("/other");
});

it("opens a native citation at the resolved symlink target without changing the current workspace", async () => {
  vi.mocked(resolveWorkspaceFileReference).mockResolvedValue({
    root: "/quanttool",
    path: "/quanttool/xhquant/file.py",
  });

  render(
    <CodexMarkdown
      threadId="citation-owner"
      value=':codex-file-citation{path="/modelzoo/xhquant/file.py" line_range_start="7" line_range_end="9"}'
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /file\.py.*7-9/ }));

  await waitFor(() =>
    expect(resolveWorkspaceFileReference).toHaveBeenCalledWith(
      "/modelzoo",
      "/modelzoo/xhquant/file.py",
    ),
  );
  await waitFor(() =>
    expect(useEditorStore.getState().activeFile).toBe(
      "/quanttool/xhquant/file.py",
    ),
  );
  expect(useEditorStore.getState().roots["/quanttool/xhquant/file.py"]).toBe(
    "/quanttool",
  );
  expect(useEditorStore.getState().revealLocation).toMatchObject({
    path: "/quanttool/xhquant/file.py",
    line: 7,
    endLine: 9,
  });
  expect(useWorkspaceStore.getState().cwd).toBe("/other");
});
