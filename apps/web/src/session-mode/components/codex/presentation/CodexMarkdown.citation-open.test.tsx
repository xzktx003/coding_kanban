import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const command = vi.fn();
vi.mock("@session/features/codex-host/bridge", () => ({
  editorHostFor: () => ({ command }),
}));
vi.mock("@session/stores/useVsCodePanelStore", () => ({
  openVsCodePanel: vi.fn(),
}));
vi.mock("@session/stores/useEditorStore", () => ({
  useEditorStore: {
    getState: () => ({ revealFile: vi.fn() }),
  },
}));
const setActiveRightPanelTab = vi.fn();
vi.mock("@session/stores/useLayoutStore", () => ({
  useLayoutStore: {
    getState: () => ({
      setActiveRightPanelTab,
      setRightPanelOpen: vi.fn(),
    }),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "zh" }, t: (key: string) => key }),
}));
vi.mock("../stores/useCodexStore", () => ({
  useCodexStore: (selector: (state: { threads: unknown[] }) => unknown) =>
    selector({
      threads: [{ id: "thread-a", cwd: "/fixture/project" }],
    }),
}));
vi.mock("@session/stores/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (state: { cwd: string }) => unknown) =>
    selector({ cwd: "/fixture/project" }),
}));

import { openVsCodePanel } from "@session/stores/useVsCodePanelStore";
import { CodexMarkdown } from "./CodexMarkdown";

afterEach(() => {
  cleanup();
  command.mockClear();
});

it("opens a cited file in the editor at the cited line", () => {
  const root = "/fixture/project";
  const path = `${root}/src/source.ts`;
  render(
    <CodexMarkdown
      value={`:codex-file-citation{path="${path}" line_range_start="12" line_range_end="14"}`}
      threadId="thread-a"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /source\.ts/ }));
  expect(setActiveRightPanelTab).toHaveBeenCalledWith("files");
  expect(openVsCodePanel).toHaveBeenCalled();
  expect(command).toHaveBeenCalledWith({
    type: "openLocation",
    path,
    line: 12,
    column: 1,
  });
});
