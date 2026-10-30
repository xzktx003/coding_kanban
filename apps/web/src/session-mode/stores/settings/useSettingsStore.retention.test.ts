import { afterEach, beforeEach, expect, it, vi } from "vitest";

const KEY = "kanban.session.settings-storage";

beforeEach(() => {
  localStorage.removeItem(KEY);
  vi.resetModules();
});

afterEach(() => localStorage.removeItem(KEY));

async function load(state?: Record<string, unknown>, version = 13) {
  if (state) localStorage.setItem(KEY, JSON.stringify({ state, version }));
  const { useSettingsStore } = await import("./useSettingsStore");
  await useSettingsStore.persist.rehydrate();
  return useSettingsStore;
}

it("keeps followed recent pages warm by default within the shared resource budget", async () => {
  const store = await load();
  expect(store.getState().warmFollowedSessions).toBe(true);
  expect(localStorage.getItem(KEY)).toBeNull();
  store.getState().setShowReasoning(false);
  expect(
    JSON.parse(localStorage.getItem(KEY)!).state.warmFollowedSessions,
  ).toBe(true);
});

it.each([12, 13])(
  "uses the approved default when v%s settings lack the retention key",
  async (version) => {
    const store = await load(
      { showReasoning: false, taskDetail: "stepsWithOutput" },
      version,
    );
    expect(store.getState().warmFollowedSessions).toBe(true);
    expect(store.getState().showReasoning).toBe(false);
    expect(store.getState().taskDetail).toBe("stepsWithOutput");
  },
);

it.each([true, false])(
  "preserves the stored retention preference %s without a migration",
  async (warmFollowedSessions) => {
    const store = await load({ warmFollowedSessions, showReasoning: false });
    expect(store.getState().warmFollowedSessions).toBe(warmFollowedSessions);
    expect(store.getState().showReasoning).toBe(false);
    store.getState().setTaskDetail("stepsWithCommand");
    expect(
      JSON.parse(localStorage.getItem(KEY)!).state.warmFollowedSessions,
    ).toBe(warmFollowedSessions);
  },
);

it("persists and restores a device changing either retention setting", async () => {
  const store = await load();
  for (const enabled of [true, false]) {
    store.getState().setWarmFollowedSessions(enabled);
    const saved = localStorage.getItem(KEY)!;
    expect(JSON.parse(saved).state.warmFollowedSessions).toBe(enabled);
    store.setState({ warmFollowedSessions: !enabled });
    localStorage.setItem(KEY, saved);
    await store.persist.rehydrate();
    expect(store.getState().warmFollowedSessions).toBe(enabled);
  }
});
