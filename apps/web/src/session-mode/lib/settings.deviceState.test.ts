import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  getJsonWithOptions: vi.fn(),
  postNoContentWithOptions: vi.fn(),
}));
vi.mock("../services/apiAdapt/shared", () => api);
import { initSettingsSync, loadSettings } from "./settings";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useAgentSettingsStore } from "../stores/useAgentSettingsStore";
beforeEach(() => {
  vi.clearAllMocks();
});
it("remote legacy settings cannot overwrite a devices project, Agent, history or pending cache", async () => {
  useWorkspaceStore.setState({
    projects: ["/local"],
    cwd: "/local",
    historyProjects: ["/local"],
    projectSort: "name_desc",
  });
  useAgentSettingsStore.setState({ selectedAgent: "cc" });
  api.getJsonWithOptions.mockResolvedValue({
    workspace: {
      projects: ["/remote"],
      cwd: "/remote",
      historyProjects: ["/remote"],
      projectSort: "added_asc",
      selectedAgent: "codex",
    },
  });
  await loadSettings();
  expect(useWorkspaceStore.getState().projects).toEqual(["/local"]);
  expect(useWorkspaceStore.getState().cwd).toBe("/local");
  expect(useAgentSettingsStore.getState().selectedAgent).toBe("cc");
});
it("changing device settings persists locally without rewriting the shared settings file", () => {
  const stop = initSettingsSync();
  useWorkspaceStore.getState().setCwd("/phone");
  useAgentSettingsStore.getState().setSelectedAgent("cc");
  expect(api.postNoContentWithOptions).not.toHaveBeenCalled();
  expect(
    JSON.parse(localStorage.getItem("kanban.session.workspace")!).state.cwd,
  ).toBe("/phone");
  expect(
    JSON.parse(localStorage.getItem("kanban.session.agent-settings")!).state
      .selectedAgent,
  ).toBe("cc");
  stop();
});
