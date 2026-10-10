import "ace-builds/src-noconflict/ace";
import { useEffect } from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CodeEditor } from "./CodeEditor";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useEditorStore as usePreferences } from "@session/stores/EditorStore";

const ace = vi.hoisted(() => ({
  gotoLine: vi.fn(),
  focus: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  getCursorPosition: () => ({ row: 0, column: 0 }),
  selection: { setSelectionRange: vi.fn() },
  session: { getLine: (row: number) => `line ${row + 1}` },
}));
vi.mock("react-ace", () => ({
  default: ({ onLoad }: { onLoad: (editor: unknown) => void }) => {
    useEffect(() => onLoad(ace), [onLoad]);
    return <div data-testid="citation-range-editor" />;
  },
}));
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.getState().resetFiles();
  usePreferences.setState({ cursorPositions: new Map(), showSearch: false });
});
afterEach(() => vi.useRealTimers());
const revealRange = (
  path: string,
  root: string,
  line: number,
  endLine: number,
) =>
  (useEditorStore.getState().revealFile as (...args: unknown[]) => void)(
    path,
    root,
    line,
    1,
    endLine,
  );

it("retains native start/end lines and selects the supplied inclusive range without focusing", () => {
  revealRange("/owner/file.ts", "/owner", 42, 45);
  expect(useEditorStore.getState().revealLocation).toMatchObject({
    path: "/owner/file.ts",
    line: 42,
    endLine: 45,
  });
  render(
    <CodeEditor
      content={Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join("\n")}
      filePath="/owner/file.ts"
    />,
  );
  expect(ace.gotoLine).toHaveBeenCalledWith(42, 0, false);
  expect(ace.selection.setSelectionRange).toHaveBeenCalledWith({
    start: { row: 41, column: 0 },
    end: { row: 44, column: 7 },
  });
  expect(ace.focus).not.toHaveBeenCalled();
});

it("rejects reversed/unsafe ranges and never applies another file's range", () => {
  const before = useEditorStore.getState().revealLocation;
  revealRange("/owner/file.ts", "/owner", 42, 40);
  expect(useEditorStore.getState().revealLocation).toBe(before);
  revealRange("/owner/file.ts", "/owner", 42, Number.MAX_SAFE_INTEGER + 1);
  expect(useEditorStore.getState().revealLocation).toBe(before);
  revealRange("/other/file.ts", "/owner", 42, 45);
  expect(useEditorStore.getState().revealLocation).toBe(before);
  revealRange("/owner/../other/file.ts", "/owner", 42, 45);
  expect(useEditorStore.getState().revealLocation).toBe(before);
  revealRange("/owner/file.ts", "/owner", 0, 45);
  expect(useEditorStore.getState().revealLocation).toBe(before);
  revealRange("/owner/file.ts", "/owner", 42, 45);
  render(<CodeEditor content="another project" filePath="/other/file.ts" />);
  expect(ace.gotoLine).not.toHaveBeenCalled();
  expect(ace.selection.setSelectionRange).not.toHaveBeenCalled();
});

it("does not let a saved cursor restore overwrite the newly requested citation range", () => {
  vi.useFakeTimers();
  usePreferences.setState({
    cursorPositions: new Map([["/owner/file.ts", { row: 2, column: 1 }]]),
  });
  revealRange("/owner/file.ts", "/owner", 42, 45);
  render(
    <CodeEditor
      content={Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join("\n")}
      filePath="/owner/file.ts"
    />,
  );
  act(() => vi.advanceTimersByTime(100));
  expect(ace.gotoLine).toHaveBeenLastCalledWith(42, 0, false);
  expect(ace.focus).not.toHaveBeenCalled();
});

it("waits for the actual requested lines and applies a revision once without stealing later edits", () => {
  revealRange("/owner/file.ts", "/owner", 42, 45);
  const view = render(
    <CodeEditor content="loading preview" filePath="/owner/file.ts" />,
  );
  expect(ace.selection.setSelectionRange).not.toHaveBeenCalled();
  const complete = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join(
    "\n",
  );
  view.rerender(<CodeEditor content={complete} filePath="/owner/file.ts" />);
  expect(ace.selection.setSelectionRange).toHaveBeenCalledTimes(1);
  view.rerender(
    <CodeEditor
      content={complete + "\nlater typing"}
      filePath="/owner/file.ts"
    />,
  );
  expect(ace.selection.setSelectionRange).toHaveBeenCalledTimes(1);
  expect(ace.focus).not.toHaveBeenCalled();
});
