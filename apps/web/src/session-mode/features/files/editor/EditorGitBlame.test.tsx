import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { gitBlameLine } from "@session/services/apiAdapt/git";
import { useEditorStore as useCursorStore } from "@session/stores/EditorStore";
import { useEditorStore } from "@session/stores/useEditorStore";
import { EditorGitBlame } from "./EditorGitBlame";

vi.mock("@session/services/apiAdapt/git", () => ({ gitBlameLine: vi.fn() }));

it("shows the current line author and commit while blame is on", async () => {
  vi.mocked(gitBlameLine).mockResolvedValue({
    present: true,
    hash: "abcdef1234567890",
    shortHash: "abcdef1",
    author: "Test",
    date: "2026-10-11",
    summary: "initial",
  });
  useEditorStore.setState({
    gitBlame: true,
    activeFile: "/fixture/note.ts",
    roots: { "/fixture/note.ts": "/fixture" },
  });
  useCursorStore.setState({
    cursorPositions: new Map([["/fixture/note.ts", { row: 2, column: 0 }]]),
  });
  render(<EditorGitBlame cwd="/fixture" filePath="/fixture/note.ts" />);
  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Git 追溯信息" }).textContent,
    ).toBe("作者 Test · 日期 2026-10-11 · 提交 abcdef1 initial"),
  );
  await waitFor(() =>
    expect(gitBlameLine).toHaveBeenCalledWith("/fixture", "/fixture/note.ts", 3),
  );
});
