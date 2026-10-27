import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

// Actual production stores in independent module instances and shared browser storage.
// This diagnostic surface intentionally never mounts the application or connects to a runtime.
async function install(context: BrowserContext) {
  const forbidden: Array<{ method: string; url: string }> = [];
  const errors: string[] = [];
  const observe = (page: Page) =>
    page.on("pageerror", (error) => errors.push(String(error)));
  context.pages().forEach(observe);
  context.on("page", observe);
  await context.route("**/api/**", async (route) => {
    forbidden.push({
      method: route.request().method(),
      url: route.request().url(),
    });
    await route.abort();
  });
  await context.route("**/__thread_settings_multitab__", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><meta charset="utf-8"><title>Thread settings fixture</title><pre id="state"></pre><script type="module">
      import * as models from '/src/session-mode/stores/useThreadModelStore.ts';
      window.settingsFixture = models;
      const show = () => document.querySelector('#state').textContent = JSON.stringify(models.useThreadModelStore.getState().threads, null, 2);
      models.useThreadModelStore.subscribe(show); show();
    </script>`,
    }),
  );
  return { forbidden, errors };
}
async function open(page: Page) {
  await page.goto("/__thread_settings_multitab__");
  await page.waitForFunction(() => (window as any).settingsFixture);
}
async function action(page: Page, method: string, args: unknown[]) {
  return page.evaluate(
    async ({ method, args }) => {
      const m = (window as any).settingsFixture;
      const id = args[0];
      if (typeof id === "string") await m.ensureThreadModelSettings?.(id);
      const result = m[method](...args);
      if (typeof id === "string") await m.flushThreadModelSettings?.(id);
      return result;
    },
    { method, args },
  );
}
async function state(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const m = (window as any).settingsFixture;
    await m.ensureThreadModelSettings?.(id);
    return {
      entry: m.useThreadModelStore.getState().threads[id],
      settings: m.getThreadModelSettings(id),
    };
  }, id);
}
async function seed(page: Page) {
  for (const id of ["thread-a", "thread-b"])
    await action(page, "hydrateThreadModel", [
      id,
      {
        model: `native-${id}`,
        modelProvider: "openai",
        reasoningEffort: "medium",
        serviceTier: null,
      },
    ]);
}

for (const secondWrite of ["change", "hydrate"] as const) {
  test(`another page's ${secondWrite} for a different thread preserves unsent model settings after reload`, async ({
    context,
    page,
  }, info) => {
    const guard = await install(context),
      other = await context.newPage();
    try {
      await open(page);
      await seed(page);
      await open(other);
      await action(page, "changeThreadModel", [
        "thread-a",
        { model: "chosen-a", reasoningEffort: "high" },
      ]);
      const chosen = await state(page, "thread-a");
      expect(chosen.entry.pending).toBe(true);
      await action(
        other,
        secondWrite === "change" ? "changeThreadModel" : "hydrateThreadModel",
        [
          "thread-b",
          {
            model: "changed-b",
            modelProvider: "openai",
            reasoningEffort: "low",
          },
        ],
      );
      await open(page);
      const restored = await state(page, "thread-a");
      await writeFile(
        info.outputPath("settings.json"),
        JSON.stringify({ secondWrite, chosen, restored, guard }, null, 2),
      );
      expect(restored.settings).toMatchObject({
        model: "chosen-a",
        reasoningEffort: "high",
      });
      expect(restored.entry.pending).toBe(true);
      expect(restored.entry.pendingFields).toEqual(
        expect.arrayContaining(["model", "reasoningEffort"]),
      );
      expect(guard.forbidden).toEqual([]);
      expect(guard.errors).toEqual([]);
    } finally {
      await other.close();
    }
  });
}

test("different pending fields of one thread survive two pages editing independently", async ({
  context,
  page,
}, info) => {
  const guard = await install(context),
    other = await context.newPage();
  try {
    await open(page);
    await seed(page);
    await open(other);
    await state(other, "thread-a"); // Both pages have the same baseline before either edit.
    await action(page, "changeThreadModel", [
      "thread-a",
      { reasoningEffort: "high" },
    ]);
    await action(other, "changeThreadModel", [
      "thread-a",
      { serviceTier: "fast" },
    ]);
    await open(page);
    const restored = await state(page, "thread-a");
    await writeFile(
      info.outputPath("settings.json"),
      JSON.stringify({ restored, guard }, null, 2),
    );
    expect(restored.settings).toMatchObject({
      reasoningEffort: "high",
      serviceTier: "fast",
    });
    expect(restored.entry.pendingFields).toEqual(
      expect.arrayContaining(["reasoningEffort", "serviceTier"]),
    );
    expect(guard.forbidden).toEqual([]);
    expect(guard.errors).toEqual([]);
  } finally {
    await other.close();
  }
});

test("a snapshot whose read began before another page's edit cannot acknowledge that later pending choice", async ({
  context,
  page,
}, info) => {
  const guard = await install(context),
    other = await context.newPage();
  try {
    await open(page);
    await seed(page);
    await open(other);
    const readAt = await other.evaluate(async () => {
      const m = (window as any).settingsFixture;
      await m.ensureThreadModelSettings?.("thread-a");
      return {
        revision: m.useThreadModelStore.getState().threads["thread-a"].revision,
        ...(m.captureThreadModelRead
          ? { readToken: m.captureThreadModelRead("thread-a") }
          : {}),
      };
    });
    await action(page, "changeThreadModel", [
      "thread-a",
      { serviceTier: "fast" },
    ]);
    await action(other, "hydrateThreadModel", [
      "thread-a",
      {
        model: "native-thread-a",
        modelProvider: "openai",
        reasoningEffort: "medium",
        serviceTier: null,
      },
      readAt,
    ]);
    await open(page);
    const restored = await state(page, "thread-a");
    await writeFile(
      info.outputPath("settings.json"),
      JSON.stringify({ readAt, restored, guard }, null, 2),
    );
    expect(restored.settings.serviceTier).toBe("fast");
    expect(restored.entry.pending).toBe(true);
    expect(restored.entry.pendingFields).toContain("serviceTier");
    expect(guard.forbidden).toEqual([]);
    expect(guard.errors).toEqual([]);
  } finally {
    await other.close();
  }
});

test("native permission observations remain volatile across persistence and another page", async ({
  context,
  page,
}) => {
  const guard = await install(context),
    other = await context.newPage();
  try {
    await open(page);
    await action(page, "hydrateThreadModel", [
      "thread-a",
      {
        model: "native-thread-a",
        modelProvider: "openai",
        reasoningEffort: "medium",
        nativePermissionMetadata: {
          activePermissionProfile: {
            kind: "value",
            value: { id: "fixture-profile", extends: null },
          },
          runtimeWorkspaceRoots: {
            kind: "value",
            value: ["/fixture/volatile-root"],
          },
        },
      },
    ]);
    expect(
      (await state(page, "thread-a")).entry.nativePermissionMetadata,
    ).toBeTruthy();
    const raw = await page.evaluate(async () => {
      const data: unknown[] = Object.keys(localStorage).map((key) =>
        localStorage.getItem(key),
      );
      for (const { name } of await indexedDB.databases()) {
        if (!name) continue;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          for (const store of db.objectStoreNames)
            data.push(
              await new Promise((resolve, reject) => {
                const request = db
                  .transaction(store)
                  .objectStore(store)
                  .getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              }),
            );
        } finally {
          db.close();
        }
      }
      return JSON.stringify(data);
    });
    expect(raw).not.toContain("nativePermissionMetadata");
    expect(raw).not.toContain("fixture-profile");
    await open(other);
    expect(
      (await state(other, "thread-a")).entry.nativePermissionMetadata,
    ).toBeUndefined();
    expect(guard.forbidden).toEqual([]);
    expect(guard.errors).toEqual([]);
  } finally {
    await other.close();
  }
});

test("an old matching-value snapshot cannot acknowledge a newer A-to-B-to-A model edit", async ({
  context,
  page,
}, info) => {
  const guard = await install(context),
    other = await context.newPage();
  try {
    await open(page);
    await seed(page);
    await action(page, "changeThreadModel", [
      "thread-a",
      { model: "chosen-a" },
    ]);
    await open(other);
    const oldRead = await other.evaluate(async () => {
      const m = (window as any).settingsFixture;
      await m.ensureThreadModelSettings?.("thread-a");
      return {
        revision: m.useThreadModelStore.getState().threads["thread-a"].revision,
        ...(m.captureThreadModelRead
          ? { readToken: m.captureThreadModelRead("thread-a") }
          : {}),
      };
    });
    await action(page, "changeThreadModel", [
      "thread-a",
      { model: "intermediate-b" },
    ]);
    await action(page, "changeThreadModel", [
      "thread-a",
      { model: "chosen-a" },
    ]);
    const latest = await state(page, "thread-a");
    await action(other, "hydrateThreadModel", [
      "thread-a",
      { model: "chosen-a", modelProvider: "openai", reasoningEffort: "medium" },
      oldRead,
    ]);
    await open(page);
    const restored = await state(page, "thread-a");
    await writeFile(
      info.outputPath("settings.json"),
      JSON.stringify({ oldRead, latest, restored, guard }, null, 2),
    );
    expect(restored.settings.model).toBe("chosen-a");
    expect(restored.entry.pending).toBe(true);
    expect(restored.entry.pendingFields).toContain("model");
    expect(guard.forbidden).toEqual([]);
    expect(guard.errors).toEqual([]);
  } finally {
    await other.close();
  }
});

test("an initial-only fork observation in another page neither acknowledges pending fields nor replaces a newer notice", async ({
  context,
  page,
}, info) => {
  const guard = await install(context),
    other = await context.newPage();
  try {
    await open(page);
    await seed(page);
    await open(other);
    await state(other, "thread-a");
    await action(page, "changeThreadModel", [
      "thread-a",
      { model: "chosen-after-fork", serviceTier: "fast" },
    ]);
    const latest = await state(page, "thread-a");
    await action(other, "hydrateThreadModel", [
      "thread-a",
      {
        model: "native-thread-a",
        modelProvider: "openai",
        reasoningEffort: "low",
        serviceTier: null,
      },
      { initialOnly: true },
    ]);
    await open(page);
    const restored = await state(page, "thread-a");
    await writeFile(
      info.outputPath("settings.json"),
      JSON.stringify({ latest, restored, guard }, null, 2),
    );
    expect(restored.settings).toMatchObject({
      model: "chosen-after-fork",
      serviceTier: "fast",
    });
    expect(restored.entry.pendingFields).toEqual(
      expect.arrayContaining(["model", "serviceTier"]),
    );
    expect(restored.entry.notice).toEqual(latest.entry.notice);
    expect(guard.forbidden).toEqual([]);
    expect(guard.errors).toEqual([]);
  } finally {
    await other.close();
  }
});

test("same-group conflict keeps the local choice until explicit retry and preserves another remote group", async ({
  context,
  page,
}, info) => {
  const guard = await install(context),
    other = await context.newPage();
  // A delayed notification is legal. Keep B's observed baseline stale without replacing IDB.
  await other.addInitScript(() => {
    const Native = window.BroadcastChannel;
    class QuietChannel extends Native {}
    Object.defineProperty(QuietChannel.prototype, "onmessage", {
      get: () => null,
      set: (_handler: unknown) => {},
    });
    window.BroadcastChannel = QuietChannel;
  });
  try {
    await open(page);
    await seed(page);
    await open(other);
    await state(other, "thread-a");
    await action(page, "changeThreadModel", [
      "thread-a",
      { model: "page-a-choice" },
    ]);
    const conflict = await other.evaluate(async () => {
      const m = (window as any).settingsFixture;
      m.changeThreadModel("thread-a", { model: "page-b-choice" });
      let error = "";
      try {
        await m.flushThreadModelSettings("thread-a");
      } catch (e) {
        error = String(e);
      }
      return {
        error,
        entry: m.useThreadModelStore.getState().threads["thread-a"],
        status: m.useThreadModelStore.getState().storage["thread-a"],
      };
    });
    expect(conflict.status.status).toBe("conflict");
    expect(conflict.entry.model).toBe("page-b-choice");
    await action(page, "changeThreadModel", [
      "thread-a",
      { serviceTier: "fast" },
    ]);
    await open(page);
    expect((await state(page, "thread-a")).settings.model).toBe(
      "page-a-choice",
    );
    await other.evaluate(async () => {
      const m = (window as any).settingsFixture;
      await m.retryThreadModelSettings("thread-a");
      await m.flushThreadModelSettings("thread-a");
    });
    await open(page);
    const restored = await state(page, "thread-a");
    await writeFile(
      info.outputPath("settings.json"),
      JSON.stringify({ conflict, restored, guard }, null, 2),
    );
    expect(restored.settings).toMatchObject({
      model: "page-b-choice",
      serviceTier: "fast",
    });
    expect(guard.forbidden).toEqual([]);
    expect(guard.errors).toEqual([]);
  } finally {
    await other.close();
  }
});

test("legacy permission metadata remains in its read-only backup but never enters migrated settings", async ({
  context,
  page,
}, info) => {
  const guard = await install(context);
  const key = "kanban.session.codex-thread-models";
  const entry = {
    model: "legacy-model",
    modelProvider: "openai",
    reasoningEffort: "high",
    providerModels: {},
    revision: 7,
    pending: true,
    pendingFields: ["model"],
    nativePermissionMetadata: {
      activePermissionProfile: {
        kind: "value",
        value: { id: "legacy-private-profile", extends: null },
      },
    },
  };
  const raw = JSON.stringify({
    version: 2,
    state: { threads: { "thread-a": entry } },
  });
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
    key,
    raw,
  });
  await open(page);
  const restored = await state(page, "thread-a");
  const persisted = await page.evaluate(async (key) => {
    const rows: unknown[] = [];
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        for (const store of db.objectStoreNames)
          rows.push(
            await new Promise((resolve, reject) => {
              const r = db.transaction(store).objectStore(store).getAll();
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            }),
          );
      } finally {
        db.close();
      }
    }
    return { backup: localStorage.getItem(key), rows };
  }, key);
  await writeFile(
    info.outputPath("settings.json"),
    JSON.stringify({ restored, persisted, guard }, null, 2),
  );
  expect(restored.entry.nativePermissionMetadata).toBeUndefined();
  expect(restored.settings.model).toBe("legacy-model");
  expect(restored.entry.pending).toBe(true);
  expect(persisted.backup).toBe(raw);
  expect(JSON.stringify(persisted.rows)).not.toContain(
    "nativePermissionMetadata",
  );
  expect(JSON.stringify(persisted.rows)).not.toContain(
    "legacy-private-profile",
  );
  expect(guard.forbidden).toEqual([]);
  expect(guard.errors).toEqual([]);
});

test("an explicit unchanged value in a local model patch does not overwrite a remote edit in another group", async ({
  context,
  page,
}, info) => {
  const guard = await install(context),
    other = await context.newPage();
  await other.addInitScript(() => {
    const Native = window.BroadcastChannel;
    class QuietChannel extends Native {}
    Object.defineProperty(QuietChannel.prototype, "onmessage", {
      get: () => null,
      set: (_handler: unknown) => {},
    });
    window.BroadcastChannel = QuietChannel;
  });
  try {
    await open(page);
    await seed(page);
    await open(other);
    await state(other, "thread-a");
    await action(page, "changeThreadModel", [
      "thread-a",
      { serviceTier: "fast" },
    ]);
    await action(other, "changeThreadModel", [
      "thread-a",
      { model: "new-model", serviceTier: null },
    ]);
    await open(page);
    const restored = await state(page, "thread-a");
    await writeFile(
      info.outputPath("settings.json"),
      JSON.stringify({ restored, guard }, null, 2),
    );
    expect(restored.settings).toMatchObject({
      model: "new-model",
      serviceTier: "fast",
    });
    expect(guard.forbidden).toEqual([]);
    expect(guard.errors).toEqual([]);
  } finally {
    await other.close();
  }
});

test("a delayed notice dismissal follows its exact identity after a merged revision", async ({ page, context }, info) => {
  const fixture = await install(context);
  await open(page);
  const result = await page.evaluate(async () => {
    const m = (window as any).settingsFixture;
    const clients = Array.from({ length: 3 }, () => m.createThreadModelController({
      databaseName: "notice-dismiss-fixture", connectEvents: false, legacy: () => ({}),
    }));
    const [a, b, restored] = clients;
    try {
      await a.persistence.ensure("thread");
      a.hydrate("thread", { model: "native", serviceTier: null });
      await a.flush("thread");
      await b.persistence.ensure("thread");
      b.change("thread", { serviceTier: "fast" });
      await b.flush("thread");
      a.change("thread", { model: "chosen" });
      const captured = { ...a.store.getState().threads.thread.notice };
      await a.flush("thread");
      const committed = { ...a.store.getState().threads.thread.notice };
      a.dismiss("thread", captured.id, captured.identity);
      await a.flush("thread");
      await restored.persistence.ensure("thread");
      const saved = structuredClone(restored.store.getState().threads.thread);
      a.change("thread", { model: "later" });
      await a.flush("thread");
      const newer = { ...a.store.getState().threads.thread.notice };
      a.dismiss("thread", newer.id, captured.identity);
      await a.flush("thread");
      return { captured, committed, saved, newer: a.store.getState().threads.thread.notice };
    } finally {
      await Promise.all(clients.map(c => c.persistence.close()));
    }
  });
  await writeFile(info.outputPath("notice-identity.json"), JSON.stringify(result, null, 2));
  expect(result.committed.id).not.toBe(result.captured.id);
  expect(result.committed.identity).toBe(result.captured.identity);
  expect(result.saved).toMatchObject({ model: "chosen", serviceTier: "fast", notice: { identity: result.captured.identity, dismissed: true } });
  expect(result.newer).toMatchObject({ to: "later", dismissed: false });
  expect(result.newer.identity).not.toBe(result.captured.identity);
  expect(fixture.forbidden).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
