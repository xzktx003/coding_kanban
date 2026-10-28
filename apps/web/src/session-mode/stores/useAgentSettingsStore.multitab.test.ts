import { beforeEach, expect, it, vi } from "vitest";

/**
 * The Agent choice and the instruction scope are two independent same-device
 * preferences sharing one `localStorage`. Zustand's `persist` re-serialized the
 * *whole* state map on every setter, so a page holding a stale map reverted the
 * field it had not touched.
 *
 * `instructionType` is not cosmetic: `AgentsMdView` turns it into the file path
 * it reads and writes — `system` resolves to `~/.codex/AGENTS.md` (or
 * `~/.claude/CLAUDE.md`), `project` to `$cwd/AGENTS.md`. A silent revert points
 * the editor at the user's home-level instructions while the header still shows
 * the path the *other* page chose, so a save lands in the wrong file.
 *
 * `docs/designs/session-render-alignment/thread-settings-multitab-audit-20261027.md`
 * named this store as reviewed-but-unproven ("本轮仅审阅这两个 store，没有实证双页
 * 反例"). Both directions reproduce, so each field owns its own key, the way
 * `useFollowupSettingsStore` and `useConfigStore` already do.
 *
 * Boundary: same-origin `localStorage` per-key write semantics, not cross-device
 * sync and not a CAS. Two pages writing the same field resolve to the last
 * successful write.
 */

const PREFIX = "kanban.session.agent-settings.v2.";
const LEGACY_KEY = "kanban.session.agent-settings";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

/** A fresh module instance: the same code a second browser page would run. */
const page = async () =>
  (await import("./useAgentSettingsStore")).useAgentSettingsStore;

it("keeps a stale page from reverting another page's instruction scope", async () => {
  const a = await page();
  vi.resetModules();
  const b = await page();

  // A switches the editor to the project's own AGENTS.md.
  a.getState().setInstructionType("project");
  // B still holds the map it loaded before that, and only picks an Agent.
  b.getState().setSelectedAgent("cc");

  vi.resetModules();
  expect((await page()).getState()).toMatchObject({
    instructionType: "project",
    selectedAgent: "cc",
  });
});

it("keeps a stale page from reverting another page's Agent choice", async () => {
  const a = await page();
  vi.resetModules();
  const b = await page();

  b.getState().setSelectedAgent("cc");
  // A's map predates that choice, and A only changes the instruction scope.
  a.getState().setInstructionType("project");

  vi.resetModules();
  expect((await page()).getState()).toMatchObject({
    instructionType: "project",
    selectedAgent: "cc",
  });
});

it("writes only the field a setter actually changes", async () => {
  const store = await page();
  const writes = vi.spyOn(Storage.prototype, "setItem");
  try {
    store.getState().setSelectedAgent("cc");
    expect(writes.mock.calls.map(([key]) => key)).toEqual([
      `${PREFIX}selectedAgent`,
    ]);
  } finally {
    writes.mockRestore();
  }
});

it("resolves a same-field race by last successful write", async () => {
  const a = await page();
  vi.resetModules();
  const b = await page();

  a.getState().setSelectedAgent("codex");
  b.getState().setSelectedAgent("cc");

  vi.resetModules();
  expect((await page()).getState().selectedAgent).toBe("cc");
});

it("reads the legacy whole-map backup for fields with no new key", async () => {
  localStorage.setItem(
    LEGACY_KEY,
    JSON.stringify({
      version: 1,
      state: { selectedAgent: "cc", instructionType: "project" },
    }),
  );
  expect((await page()).getState()).toMatchObject({
    selectedAgent: "cc",
    instructionType: "project",
  });
});

it("never writes back the legacy backup an old page may still own", async () => {
  // An old page keeps rewriting that whole map. If we migrated into it, its next
  // write would resurrect the stale scope over a choice already saved here.
  const backup = JSON.stringify({
    version: 1,
    state: { selectedAgent: "cc", instructionType: "project" },
  });
  localStorage.setItem(LEGACY_KEY, backup);

  const store = await page();
  store.getState().setInstructionType("system");
  expect(localStorage.getItem(LEGACY_KEY)).toBe(backup);

  vi.resetModules();
  expect((await page()).getState()).toMatchObject({
    selectedAgent: "cc",
    instructionType: "system",
  });
});

it("falls back to the default when a stored field is corrupt or unknown", async () => {
  // An unknown Agent kind would reach `AgentsMdView` and resolve to neither
  // config dir; a corrupt value must not throw past initialization either.
  localStorage.setItem(`${PREFIX}selectedAgent`, JSON.stringify("gemini"));
  localStorage.setItem(`${PREFIX}instructionType`, "{not json");
  expect((await page()).getState()).toMatchObject({
    selectedAgent: "codex",
    instructionType: "system",
  });
});

it("picks up another page's change on a storage event", async () => {
  const a = await page();
  const stop = (
    await import("./useAgentSettingsStore")
  ).startAgentSettingsSync();
  try {
    // Another page writes the key directly; the event carries no usable value
    // when it arrives late, so the store must re-read what is there now.
    localStorage.setItem(`${PREFIX}instructionType`, JSON.stringify("project"));
    window.dispatchEvent(
      new StorageEvent("storage", { key: `${PREFIX}instructionType` }),
    );
    expect(a.getState().instructionType).toBe("project");
  } finally {
    stop();
  }
});
