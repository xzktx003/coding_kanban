import { beforeEach, expect, it, vi } from "vitest";

/**
 * New-chat defaults are a global, same-device preference, and two browser pages
 * on one machine share one `localStorage`. The old Zustand `persist` wrote the
 * *whole* state map on every setter, so a page holding a stale map reverted
 * every field it had not touched — including `sandbox`/`approvalPolicy`, which
 * decide how much disk and network the next chat may reach.
 *
 * `docs/designs/session-render-alignment/thread-settings-multitab-audit-20261027.md`
 * named this store as reviewed-but-unproven ("本轮仅审阅这两个 store，没有实证双页
 * 反例"). Both directions reproduce, so each field now owns its own key, the way
 * `useFollowupSettingsStore` already does.
 *
 * This is same-origin `localStorage` per-key write semantics, not cross-device
 * sync and not a CAS: two pages writing the *same* field still resolve to the
 * last successful write. Per-thread native settings are a different store with
 * a real transaction (`useThreadModelStore`); nothing here is a thread setting.
 */

const PREFIX = "kanban.session.codex-config-storage.v3.";
const LEGACY_KEY = "kanban.session.codex-config-storage";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

/** A fresh module instance: the same code a second browser page would run. */
const page = async () =>
  (await import("./useConfigStore")).useConfigStore;

it("keeps a stale page from reverting another page's permission choice", async () => {
  const a = await page();
  vi.resetModules();
  const b = await page();

  // A narrows the next chat to read-only.
  a.getState().setAccessMode("read-only");
  // B still holds the map it loaded before that, and only picks a model.
  b.getState().setModel("page-b-model");

  vi.resetModules();
  const reloaded = await page();
  expect(reloaded.getState()).toMatchObject({
    sandbox: "read-only",
    approvalPolicy: "untrusted",
    model: "page-b-model",
  });
});

it("keeps a stale page from reverting another page's model choice", async () => {
  const a = await page();
  vi.resetModules();
  const b = await page();

  b.getState().setModel("page-b-model");
  // A's map predates that model, and A only touches permissions.
  a.getState().setAccessMode("read-only");

  vi.resetModules();
  const reloaded = await page();
  expect(reloaded.getState()).toMatchObject({
    sandbox: "read-only",
    model: "page-b-model",
  });
});

it("writes only the fields a setter actually changes", async () => {
  const store = await page();
  const writes = vi.spyOn(Storage.prototype, "setItem");

  store.getState().setReasoningEffort("xhigh");
  expect(writes.mock.calls.map(([key]) => key)).toEqual([
    `${PREFIX}reasoningEffort`,
  ]);

  // Choosing a sandbox also clears a previously selected named permission
  // profile. These three fields belong to the same explicit permission intent.
  store.getState().setPermissions("fixture-named-profile");
  writes.mockClear();
  store.getState().setAccessMode("workspace-write");
  expect(new Set(writes.mock.calls.map(([key]) => key))).toEqual(
    new Set([`${PREFIX}sandbox`, `${PREFIX}permissions`, `${PREFIX}approvalPolicy`]),
  );
  expect(writes).toHaveBeenCalledTimes(3);
  expect(store.getState()).toMatchObject({
    sandbox: "workspace-write", permissions: null,
    approvalPolicy: "on-request", reasoningEffort: "xhigh",
  });
  expect(localStorage.getItem(`${PREFIX}permissions`)).toBe("null");
  writes.mockRestore();
});

it("resolves a same-field race by last successful write", async () => {
  // Two pages editing the *same* preference is a genuine conflict with no
  // local CAS available. Last write wins; neither page loses an unrelated field.
  const a = await page();
  vi.resetModules();
  const b = await page();

  a.getState().setReasoningEffort("low");
  b.getState().setReasoningEffort("max");

  vi.resetModules();
  expect((await page()).getState().reasoningEffort).toBe("max");
});

it("keeps the paired sandbox and approval policy consistent across pages", async () => {
  // These two are one permission decision. Splitting them per key must not let
  // a reload assemble a combination no menu row can produce — a read-only
  // sandbox with `never` approvals would silently widen the next chat.
  const a = await page();
  vi.resetModules();
  const b = await page();

  a.getState().setAccessMode("read-only");
  b.getState().setModel("unrelated");

  vi.resetModules();
  const { sandbox, approvalPolicy } = (await page()).getState();
  const { SANDBOX_APPROVAL_MAP } = await import("./useConfigStore");
  expect(approvalPolicy).toBe(SANDBOX_APPROVAL_MAP[sandbox]);
});

it("reads the legacy whole-map backup for fields with no new key", async () => {
  localStorage.setItem(
    LEGACY_KEY,
    JSON.stringify({
      version: 2,
      state: {
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        model: "legacy-model",
        reasoningEffort: "high",
      },
    }),
  );
  const store = await page();
  expect(store.getState()).toMatchObject({
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    model: "legacy-model",
    reasoningEffort: "high",
  });
});

it("never writes back the legacy backup an old page may still own", async () => {
  // An old page keeps rewriting that whole map. If we migrated into it, its next
  // write would resurrect stale permissions over a choice already saved here.
  const backup = JSON.stringify({
    version: 2,
    state: { sandbox: "workspace-write", approvalPolicy: "on-request" },
  });
  localStorage.setItem(LEGACY_KEY, backup);

  const store = await page();
  store.getState().setAccessMode("read-only");
  expect(localStorage.getItem(LEGACY_KEY)).toBe(backup);

  vi.resetModules();
  expect((await page()).getState()).toMatchObject({
    sandbox: "read-only",
    approvalPolicy: "untrusted",
  });
});

it("still applies the legacy permission default migration once", async () => {
  // The v2 migration moved the old workspace-write/on-request *default* to full
  // access. Per-key storage must not quietly drop that one-time rewrite.
  localStorage.setItem(
    LEGACY_KEY,
    JSON.stringify({
      version: 1,
      state: {
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        model: "kept-model",
      },
    }),
  );
  expect((await page()).getState()).toMatchObject({
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    model: "kept-model",
  });
});

it("picks up another page's change on a storage event", async () => {
  const a = await page();
  const stop = (await import("./useConfigStore")).startConfigStoreSync();
  try {
    // Another page writes the key directly; the event carries no usable value
    // when it arrives late, so the store must re-read what is there now.
    localStorage.setItem(`${PREFIX}reasoningEffort`, JSON.stringify("max"));
    window.dispatchEvent(
      new StorageEvent("storage", { key: `${PREFIX}reasoningEffort` }),
    );
    expect(a.getState().reasoningEffort).toBe("max");
  } finally {
    stop();
  }
});

it("keeps the current value when a stored field is corrupt", async () => {
  const store = await page();
  store.getState().setReasoningEffort("xhigh");
  localStorage.setItem(`${PREFIX}reasoningEffort`, "{not json");

  vi.resetModules();
  // A corrupt field must fall back to the default rather than throw past
  // initialization and leave the whole composer without defaults.
  expect((await page()).getState().reasoningEffort).toBe("medium");
});

it("remembers a model per provider without clobbering the other slot", async () => {
  const a = await page();
  a.getState().setModelProvider("openai");
  a.getState().setModel("openai-model");

  vi.resetModules();
  const b = await page();
  b.getState().setModelProvider("custom");
  b.getState().setModel("custom-model");

  vi.resetModules();
  const reloaded = await page();
  expect(reloaded.getState().providerModels).toMatchObject({
    openai: "openai-model",
    custom: "custom-model",
  });
});
