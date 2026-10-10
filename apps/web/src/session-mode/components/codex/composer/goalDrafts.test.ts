import { beforeEach, expect, it } from "vitest";
import { goalDrafts, useGoalDraftStore } from "./goalDrafts";
beforeEach(() => {
  localStorage.clear();
  useGoalDraftStore.setState({ owners: {}, legacyMigrated: false });
});
it("delayed goal A success clears only captured A and keeps another owner's opt-in", async () => {
  goalDrafts.set("a", true);
  const captured = goalDrafts.read("a");
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  }).then(() => goalDrafts.complete("a", captured));
  goalDrafts.set("b", true);
  resolve();
  await pending;
  expect(goalDrafts.read("a").enabled).toBe(false);
  expect(goalDrafts.read("b").enabled).toBe(true);
});
it("goal success cannot clear a newer opt-in from the same owner", () => {
  goalDrafts.set("a", true);
  const captured = goalDrafts.read("a");
  goalDrafts.set("a", false);
  goalDrafts.set("a", true);
  goalDrafts.complete("a", captured);
  expect(goalDrafts.read("a").enabled).toBe(true);
});
it("same-owner unchanged success consumes the exact goal revision", () => {
  goalDrafts.set("a", true);
  const captured = goalDrafts.read("a");
  goalDrafts.complete("a", captured);
  expect(goalDrafts.read("a")).toEqual({
    enabled: false,
    revision: captured.revision + 1,
  });
});
it("new-thread identity transfers the latest goal draft revision and an old submission cannot clear a later toggle", () => {
  goalDrafts.set("new-project", true);
  const captured = goalDrafts.read("new-project");
  goalDrafts.set("new-project", false);
  goalDrafts.set("new-project", true);
  expect(goalDrafts.move("new-project", "created-thread")).toBe(true);
  goalDrafts.complete("created-thread", captured);
  expect(goalDrafts.read("new-project").enabled).toBe(false);
  expect(goalDrafts.read("created-thread").enabled).toBe(true);
});
it("preserves owner opt-ins and revisions after reload, and attributes the live legacy flag only once", async () => {
  goalDrafts.migrateLegacy("legacy-owner", true);
  goalDrafts.migrateLegacy("another-owner", true);
  expect(goalDrafts.read("another-owner").enabled).toBe(false);
  goalDrafts.set("another-owner", true);
  const saved = localStorage.getItem("kanban.session.codex-goal-drafts")!;
  useGoalDraftStore.setState({ owners: {}, legacyMigrated: false });
  localStorage.setItem("kanban.session.codex-goal-drafts", saved);
  await useGoalDraftStore.persist.rehydrate();
  expect(goalDrafts.read("legacy-owner")).toEqual({
    enabled: true,
    revision: 1,
  });
  expect(goalDrafts.read("another-owner")).toEqual({
    enabled: true,
    revision: 1,
  });
  expect(goalDrafts.read("unknown-owner").enabled).toBe(false);
});
it("migrates earlier owner booleans while preserving an existing owner's revision and opt-in", async () => {
  localStorage.setItem(
    "kanban.session.codex-goal-drafts",
    JSON.stringify({
      version: 0,
      state: {
        owners: { a: true, b: { enabled: true, revision: 4 } },
        legacyMigrated: true,
      },
    }),
  );
  await useGoalDraftStore.persist.rehydrate();
  expect(goalDrafts.read("a")).toEqual({ enabled: true, revision: 0 });
  expect(goalDrafts.read("b")).toEqual({ enabled: true, revision: 4 });
});
