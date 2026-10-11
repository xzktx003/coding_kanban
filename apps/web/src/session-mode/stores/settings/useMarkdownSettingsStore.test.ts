import { afterEach, expect, it } from "vitest";
import { useMarkdownSettingsStore as store } from "./useMarkdownSettingsStore";

afterEach(() => {
  store.getState().setWordWrap(false);
  store.persist.clearStorage();
});

it("persists and restores only the reader preference without retaining message data", async () => {
  store.getState().setWordWrap(true);
  const saved = localStorage.getItem("kanban.session.markdown-preferences")!;
  expect(JSON.parse(saved).state).toEqual({ wordWrap: true });
  store.getState().setWordWrap(false);
  localStorage.setItem("kanban.session.markdown-preferences", saved);
  await store.persist.rehydrate();
  expect(store.getState().wordWrap).toBe(true);
});

it("ignores invalid stored values and preserves the setter", async () => {
  localStorage.setItem(
    "kanban.session.markdown-preferences",
    JSON.stringify({
      state: { wordWrap: "false", setWordWrap: "invalid" },
      version: 0,
    }),
  );
  await store.persist.rehydrate();
  expect(store.getState().wordWrap).toBe(false);
  store.getState().setWordWrap(true);
  expect(store.getState().wordWrap).toBe(true);
});
