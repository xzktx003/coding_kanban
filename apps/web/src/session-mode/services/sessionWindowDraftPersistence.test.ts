import { afterEach, beforeEach, expect, test, vi } from "vitest";
const id = "40bd1159-560e-4977-b808-b32aaf93265c";
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  window.history.replaceState(null, "", `/?mode=session&sessionWindow=${id}`);
});
afterEach(() => window.history.replaceState(null, "", "/"));
test.each(["plugin", "agent"])(
  "the new window never copies or overwrites the source page's %s mention drafts",
  async (kind) => {
    const name =
      kind === "plugin"
        ? "kanban.session.plugin-inputs"
        : "kanban.session.agent-mentions";
    const original = JSON.stringify({
      version: 1,
      state: {
        drafts: {
          original: [{ name: "Original", path: "plugin://original@market" }],
        },
      },
    });
    localStorage.setItem(name, original);
    const state =
      kind === "plugin"
        ? (await import("@session/features/plugins/pluginInputs"))
            .usePluginInputDrafts
        : (await import("@session/features/subagents/mentions"))
            .useAgentMentionDrafts;
    expect(state.getState().drafts).toEqual({});
    state.setState({
      drafts: {
        "window-owner": [{ name: "New window", path: "plugin://new@market" }],
      },
    });
    expect(localStorage.getItem(name)).toBe(original);
    expect(
      JSON.parse(localStorage.getItem(`${name}.window.${id}`)!).state.drafts,
    ).toEqual({
      "window-owner": [{ name: "New window", path: "plugin://new@market" }],
    });
  },
);
