import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  getJsonWithOptions: vi.fn(),
  postNoContentWithOptions: vi.fn(),
}));
vi.mock("../services/apiAdapt/shared", () => api);
import { loadSettings, saveSessionName } from "./settings";
import { useSessionNameStore } from "../stores/useSessionNameStore";
beforeEach(() => {
  vi.resetAllMocks();
  useSessionNameStore.setState({ names: {} });
});
it("serializes rename writes and preserves workspace and backend-owned settings", async () => {
  let stored: Record<string, unknown> = {
    version: 1,
    workspace: { cwd: "/workspace" },
    remote: { enabled: true },
  };
  api.getJsonWithOptions.mockImplementation(async () =>
    structuredClone(stored),
  );
  api.postNoContentWithOptions.mockImplementation(async (_path, value) => {
    stored = structuredClone(value);
  });
  await Promise.all([
    saveSessionName("cc:first", "Claude"),
    saveSessionName("acp:agent:second", "ACP"),
  ]);
  expect(stored).toEqual({
    version: 1,
    workspace: { cwd: "/workspace" },
    remote: { enabled: true },
    sessionNames: { "cc:first": "Claude", "acp:agent:second": "ACP" },
  });
  await loadSettings();
  expect(useSessionNameStore.getState().names).toEqual(stored.sessionNames);
});
it("never overwrites existing settings after a read failure", async () => {
  api.getJsonWithOptions.mockRejectedValueOnce(new Error("offline"));
  await expect(saveSessionName("cc:session", "New")).rejects.toThrow("offline");
  expect(api.postNoContentWithOptions).not.toHaveBeenCalled();
  api.getJsonWithOptions.mockResolvedValueOnce({ remote: { enabled: true } });
  await saveSessionName("cc:session", "Retry");
  expect(api.postNoContentWithOptions).toHaveBeenCalledTimes(1);
});
