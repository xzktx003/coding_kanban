import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const command = vi.fn();
vi.mock("@session/features/codex-host/bridge", () => ({
  editorHostFor: () => ({ command }),
}));
vi.mock("@session/stores/useVsCodePanelStore", () => ({
  openVsCodePanel: vi.fn(),
}));
vi.mock("@session/services/workspaceFiles", () => ({
  resolveWorkspaceFileReference: vi.fn(async (root: string, path: string) => ({ root, path })),
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
vi.mock("@session/stores/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (state: { cwd: string }) => unknown) =>
    selector({ cwd: "/fixture/project" }),
}));

import { openVsCodePanel } from "@session/stores/useVsCodePanelStore";
import { useEditorStore } from "@session/stores/useEditorStore";
import { resolveWorkspaceFileReference } from "@session/services/workspaceFiles";
import { CodexMarkdown } from "./CodexMarkdown";
import { useCodexStore } from "../stores/useCodexStore";

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.getState().resetFiles();
  useCodexStore.setState({ threads: [{ id: "thread-a", cwd: "/fixture/project" }] as any });
  vi.mocked(resolveWorkspaceFileReference).mockImplementation(async (root, path) => ({ root, path }));
});
afterEach(() => {
  cleanup();
  command.mockClear();
});

it("opens a cited file in the editor at the cited line", async () => {
  const root = "/fixture/project";
  const path = `${root}/src/source.ts`;
  render(
    <CodexMarkdown
      value={`:codex-file-citation{path="${path}" line_range_start="12" line_range_end="14"}`}
      threadId="thread-a"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /source\.ts/ }));
  await waitFor(() => expect(setActiveRightPanelTab).toHaveBeenCalledWith("files"));
  expect(useEditorStore.getState().activeFile).toBe(path);
  expect(useEditorStore.getState().revealLocation).toMatchObject({ path, line: 12, column: 1, endLine: 14 });
  expect(openVsCodePanel).toHaveBeenCalled();
  expect(command).toHaveBeenCalledWith({ type: "openLocation", path, line: 12, column: 1 });
});

it("opens the resolved registered-project path in the project file workspace", async () => {
  vi.mocked(resolveWorkspaceFileReference).mockResolvedValue({ root: "/registered", path: "/registered/source.ts" });
  render(<CodexMarkdown threadId="thread-a" value=':codex-file-citation{path="/fixture/project/link/source.ts" line_range_start="12" line_range_end="14"}' />);
  fireEvent.click(screen.getByRole("button", { name: /source\.ts/ }));
  await waitFor(() => expect(useEditorStore.getState().revealLocation).toMatchObject({ path: "/registered/source.ts", line: 12, column: 1 }));
  expect(command).toHaveBeenCalledWith({ type: "openLocation", path: "/registered/source.ts", line: 12, column: 1 });
});

it("does not open the editor host when resolution is rejected", async () => {
  vi.mocked(resolveWorkspaceFileReference).mockRejectedValue(new Error("unregistered target"));
  render(<CodexMarkdown threadId="thread-a" value=':codex-file-citation{path="/fixture/project/source.ts" line_range_start="12"}' />);
  fireEvent.click(screen.getByRole("button", { name: /source\.ts/ }));
  await waitFor(() => expect(resolveWorkspaceFileReference).toHaveBeenCalled());
  expect(command).not.toHaveBeenCalled();
  expect(openVsCodePanel).not.toHaveBeenCalled();
  expect(useEditorStore.getState().activeFile).toBeNull();
});
