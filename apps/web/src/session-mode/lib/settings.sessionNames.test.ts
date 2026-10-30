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
  useSessionNameStore.setState({ names: {}, sources: {} });
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

it("a late settings read cannot replace a name edited while it was pending", async () => {
  let resolve!: (value: unknown) => void;
  api.getJsonWithOptions.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const loading = loadSettings();
  useSessionNameStore.getState().setName("codex", "current", "My new name");
  resolve({
    sessionNames: {
      "codex:current": "Old remote name",
      "cc:other": "Remote other",
    },
  });
  await loading;
  expect(useSessionNameStore.getState().names).toEqual({
    "codex:current": "My new name",
    "cc:other": "Remote other",
  });
});

it("even a same-valued explicit rename fences a pending remote read", async () => {
  useSessionNameStore.getState().setName("cc", "current", "Keep this name");
  let resolve!: (value: unknown) => void;
  api.getJsonWithOptions.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const loading = loadSettings();
  useSessionNameStore.getState().setName("cc", "current", "Keep this name");
  resolve({ sessionNames: { "cc:current": "Stale remote" } });
  await loading;
  expect(useSessionNameStore.getState().names["cc:current"]).toBe(
    "Keep this name",
  );
});

it("cancelling settings hydration rejects and prevents a late transport result from publishing", async () => {
  let resolve!: (value: unknown) => void;
  api.getJsonWithOptions.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const controller = new AbortController();
  const loading = loadSettings(controller.signal);
  const rejected = expect(loading).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  resolve({ sessionNames: { "cc:late": "Must not appear" } });
  await rejected;
  expect(useSessionNameStore.getState().names).toEqual({});
  expect(api.getJsonWithOptions.mock.calls[0][1].signal).toBe(
    controller.signal,
  );
});

it("a failed display-name hydration is observable for a local retry", async () => {
  api.getJsonWithOptions.mockRejectedValueOnce(new Error("settings offline"));
  await expect(loadSettings()).rejects.toThrow("settings offline");
  expect(useSessionNameStore.getState().names).toEqual({});
});
