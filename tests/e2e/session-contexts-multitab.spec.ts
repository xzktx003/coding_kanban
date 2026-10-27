import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { openComposerStatus } from "./session-composer-actions";

const owner = (id: number) =>
  JSON.stringify(["codex", "", "session", `ux-${id}`]);
const file = {
  id: "file-a",
  kind: "file",
  name: "project-a.ts",
  path: "/fixture/project-a.ts",
  text: "export const projectA = 1;",
};
const quote = {
  id: "quote-b",
  kind: "quote",
  name: "项目 B 回答引用",
  sourceThreadId: "ux-1",
  text: "另一会话的引用必须保留",
};
const sketch = (id: string) => ({
  version: 1,
  width: 1200,
  height: 800,
  marks: [
    {
      id,
      kind: "rect",
      points: [
        { x: 120, y: 80 },
        { x: 360, y: 240 },
      ],
      color: "#d76b26",
      width: 4,
    },
  ],
});

async function draftAction(page: Page, action: string, args: unknown[]) {
  return page.evaluate(
    async ({ action, args }) => {
      const path = "/src/session-mode/components/codex/composer/v2/drafts.ts";
      const url =
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path;
      const { composerDrafts } = await import(url);
      if (composerDrafts.ensure && typeof args[0] === "string")
        await composerDrafts.ensure(args[0]);
      const result =
        action === "capture" && !composerDrafts.capture
          ? { contexts: composerDrafts.read(args[0]).contexts }
          : composerDrafts[action](...args);
      if (
        !["read", "capture"].includes(action) &&
        composerDrafts.flush &&
        typeof args[0] === "string"
      )
        await composerDrafts.flush(args[0]);
      return result;
    },
    { action, args },
  );
}
const chips = (page: Page) =>
  page.locator(".session-native-composer .session-context-chip:not(.is-image)");
async function selectOwner(page: Page, id: number) {
  await page
    .locator(`[data-tab-key="codex:ux-${id}"] .session-identity-title`)
    .click();
  await expect(page.locator(".session-native-composer")).toHaveAttribute(
    "data-owner-thread",
    `ux-${id}`,
  );
}
async function showFile(page: Page, name: string, text: string) {
  await page
    .getByRole("button", {
      name: new RegExp(
        `^查看上下文 ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `,
      ),
    })
    .first()
    .click();
  await expect(page.locator(".session-context-preview")).toHaveText(text);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function removeContext(page: Page, name: string) {
  await page
    .getByRole("button", {
      name: new RegExp(
        `^查看上下文 ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `,
      ),
    })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "移除", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function openSketch(page: Page) {
  await page
    .locator(".session-native-composer")
    .getByRole("button", { name: "附加文件", exact: true })
    .click();
  await page.getByRole("button", { name: "画草图", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "绘图画布", exact: true }),
  ).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    expect(
      await dialog.evaluate(
        (element) => element.getBoundingClientRect().right - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
}
async function state(page: Page) {
  return {
    a: await draftAction(page, "read", [owner(0)]),
    b: await draftAction(page, "read", [owner(1)]),
  };
}
async function diagnosticState(page: Page) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      state(page),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ diagnosticTimeout: true }), 3000);
      }),
    ]);
  } catch (error) {
    return { diagnosticError: String(error) };
  } finally {
    clearTimeout(timer);
  }
}
async function prepare(page: Page) {
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  const dialogs: Array<{ type: string; message: string; cleanup: boolean }> =
    [];
  let cleanup = false;
  const onDialog = async (dialog: import("@playwright/test").Dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message(), cleanup });
    await (cleanup ? dialog.accept() : dialog.dismiss());
  };
  page.on("dialog", onDialog);
  const fixture = await setup(page, false, async () => {
    await page.addInitScript(() => {
      class Stream {
        onopen: (() => void) | null = null;
        onmessage = null;
        onerror = null;
        closed = false;
        constructor() {
          setTimeout(() => {
            if (!this.closed) this.onopen?.();
          }, 30);
        }
        close() {
          this.closed = true;
        }
      }
      (window as any).EventSource = Stream;
    });
  });
  return {
    ...fixture,
    dialogs,
    close: async () => {
      cleanup = true;
      await fixture.close();
      page.off("dialog", onDialog);
    },
  };
}
function forbidden(f: Awaited<ReturnType<typeof setup>>) {
  expect(f.calls).toEqual([]);
  expect(
    f.fixture.calls.filter((call) =>
      /\/(turn\/(start|steer|interrupt)|thread\/(start|resume|delete|fork)|followups\/(submit|change|stop))$/.test(
        call.path,
      ),
    ),
  ).toEqual([]);
  expect(f.errors).toEqual([]);
}

test("two same-origin pages preserve different owners' file, quote and drawing drafts through reload on desktop and phone", async ({
  context,
  page,
}, info) => {
  test.setTimeout(90000);
  const other = await context.newPage();
  const a = await prepare(page),
    b = await prepare(other);
  let phase = "initial edits";
  try {
    await selectOwner(other, 1);
    await draftAction(page, "add", [owner(0), file]);
    await draftAction(page, "drawing", [owner(0), "sketch", sketch("rect-a")]);
    await draftAction(other, "add", [owner(1), quote]);
    await draftAction(other, "drawing", [owner(1), "sketch", sketch("rect-b")]);
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(other)).toHaveCount(1);
    await showFile(page, file.name, file.text);
    await showFile(other, quote.name, quote.text);
    await writeFile(
      info.outputPath("before-reload.json"),
      JSON.stringify({ a: await state(page), b: await state(other) }, null, 2),
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await selectOwner(page, 0);
    await expect(chips(page)).toHaveCount(1);
    await showFile(page, file.name, file.text);
    expect(
      (await draftAction(page, "read", [owner(0)])).contexts,
    ).toContainEqual(file);
    await openSketch(page);
    await expect(
      page
        .getByRole("img", { name: "绘图画布", exact: true })
        .locator("rect[stroke]"),
    ).toHaveCount(1);
    expect(
      (await draftAction(page, "read", [owner(0)])).drawings.sketch.marks.map(
        (mark: any) => mark.id,
      ),
    ).toEqual(["rect-a"]);
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath("desktop-restored-drawing.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    phase = "phone viewport";
    await other.setViewportSize({ width: 390, height: 844 });
    phase = "phone reload";
    await other.reload({ waitUntil: "domcontentloaded" });
    phase = "phone select owner";
    await selectOwner(other, 1);
    await expect(chips(other)).toHaveCount(1);
    await showFile(other, quote.name, quote.text);
    phase = "phone sketch";
    await noOverflow(other);
    await openSketch(other);
    await expect(
      other
        .getByRole("img", { name: "绘图画布", exact: true })
        .locator("rect[stroke]"),
    ).toHaveCount(1);
    expect(
      (await draftAction(other, "read", [owner(1)])).drawings.sketch.marks.map(
        (mark: any) => mark.id,
      ),
    ).toEqual(["rect-b"]);
    await noOverflow(other);
    await other.screenshot({
      path: info.outputPath("phone-restored-drawing.png"),
      animations: "disabled",
    });
    expect(
      (await draftAction(other, "read", [owner(1)])).contexts,
    ).toContainEqual(quote);
    forbidden(a);
    forbidden(b);
  } catch (error) {
    await writeFile(
      info.outputPath("first-error.json"),
      JSON.stringify(
        { phase, error: String(error), dialogs: [a.dialogs, b.dialogs] },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await writeFile(
      info.outputPath("final-state.json"),
      JSON.stringify(
        {
          a: await diagnosticState(page),
          b: await diagnosticState(other),
          dialogs: [a.dialogs, b.dialogs],
          errors: [...a.errors, ...b.errors],
        },
        null,
        2,
      ),
    );
    await a.close();
    await b.close();
    await other.close();
  }
});

test("a delayed clear removes only the captured context while preserving another page's additions and changed file identity", async ({
  context,
  page,
}, info) => {
  test.setTimeout(90000);
  const other = await context.newPage();
  const a = await prepare(page),
    b = await prepare(other);
  const old = { ...file, id: "mutable-file", text: "original file" };
  const keep = { ...quote, id: "new-quote", sourceThreadId: "ux-0" };
  const changed = {
    ...old,
    path: "/fixture/replaced.ts",
    range: { start: 4, end: 7 },
  };
  try {
    await draftAction(page, "add", [owner(0), old]);
    await draftAction(page, "add", [
      owner(0),
      { ...quote, id: "submitted-quote" },
    ]);
    const captured = await draftAction(page, "capture", [owner(0)]);
    await other.reload({ waitUntil: "domcontentloaded" });
    await expect(chips(other)).toHaveCount(2);
    await draftAction(other, "replace", [owner(0), old.id, changed]);
    await draftAction(other, "add", [owner(0), keep]);
    await draftAction(page, "clearSubmitted", [
      owner(0),
      captured.contexts,
      captured.versions,
    ]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(chips(page)).toHaveCount(2);
    await showFile(page, old.name, old.text);
    await showFile(page, keep.name, keep.text);
    const saved = await draftAction(page, "read", [owner(0)]);
    expect(saved.contexts).toContainEqual(changed);
    expect(saved.contexts).toContainEqual(keep);
    expect(
      saved.contexts.some((item: any) => item.id === "submitted-quote"),
    ).toBe(false);
    await other.reload({ waitUntil: "domcontentloaded" });
    await expect(chips(other)).toHaveCount(2);
    await noOverflow(page);
    await noOverflow(other);
    await writeFile(
      info.outputPath("receipt.json"),
      JSON.stringify({ captured, changed, saved }, null, 2),
    );
    await page.screenshot({
      path: info.outputPath("late-clear-survivors.png"),
      animations: "disabled",
    });
    forbidden(a);
    forbidden(b);
  } finally {
    await writeFile(
      info.outputPath("final-state.json"),
      JSON.stringify(
        {
          a: await state(page),
          b: await state(other),
          errors: [...a.errors, ...b.errors],
        },
        null,
        2,
      ),
    );
    await a.close();
    await b.close();
    await other.close();
  }
});

test("legacy context migration keeps its backup and does not resurrect cleared contexts when an older page rewrites the backup", async ({
  context,
  page,
}, info) => {
  test.setTimeout(90000);
  const key = "kanban.session.composer-v2";
  const backup = JSON.stringify({
    [owner(0)]: {
      contexts: [file],
      drawings: { sketch: sketch("legacy-drawing") },
      expanded: false,
      plain: false,
    },
  });
  await context.addInitScript(
    ({ key, backup }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, backup);
    },
    { key, backup },
  );
  const other = await context.newPage();
  const a = await prepare(page),
    b = await prepare(other);
  try {
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(other)).toHaveCount(1);
    await showFile(page, file.name, file.text);
    const captured = await draftAction(page, "capture", [owner(0)]);
    await draftAction(page, "clearSubmitted", [
      owner(0),
      captured.contexts,
      captured.versions,
    ]);
    await expect(chips(page)).toHaveCount(0);
    // Simulate an already-open pre-migration page saving its stale collection.
    await other.evaluate(
      ({ key, backup }) => localStorage.setItem(key, backup),
      { key, backup },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".session-native-composer")).toBeVisible();
    await expect(chips(page)).toHaveCount(0);
    await other.reload({ waitUntil: "domcontentloaded" });
    await expect(other.locator(".session-native-composer")).toBeVisible();
    await expect(chips(other)).toHaveCount(0);
    const saved = await draftAction(page, "read", [owner(0)]);
    expect(saved.contexts).toEqual([]);
    expect(saved.drawings.sketch.marks.map((mark: any) => mark.id)).toEqual([
      "legacy-drawing",
    ]);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      backup,
    );
    await writeFile(
      info.outputPath("migration.json"),
      JSON.stringify({ saved, legacyBackupUnchanged: true }, null, 2),
    );
    forbidden(a);
    forbidden(b);
  } finally {
    await writeFile(
      info.outputPath("final-state.json"),
      JSON.stringify(
        {
          a: await state(page),
          b: await state(other),
          errors: [...a.errors, ...b.errors],
        },
        null,
        2,
      ),
    );
    await a.close();
    await b.close();
    await other.close();
  }
});

test("undoing a context removal preserves another page's newly added context", async ({
  context,
  page,
}, info) => {
  test.setTimeout(90000);
  const other = await context.newPage();
  const a = await prepare(page),
    b = await prepare(other);
  try {
    await draftAction(page, "add", [owner(0), file]);
    await other.reload({ waitUntil: "domcontentloaded" });
    await expect(chips(other)).toHaveCount(1);
    await removeContext(page, file.name);
    await expect(chips(page)).toHaveCount(0);
    await page.getByRole("button", { name: "撤销", exact: true }).focus();
    await draftAction(other, "add", [owner(0), quote]);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    // Observe persistence via a fresh realm rather than the optimistic UI.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(chips(page)).toHaveCount(2);
    await showFile(page, file.name, file.text);
    await showFile(page, quote.name, quote.text);
    const saved = await draftAction(page, "read", [owner(0)]);
    expect(saved.contexts.map((item: any) => item.id).sort()).toEqual(
      [file.id, quote.id].sort(),
    );
    await writeFile(
      info.outputPath("undo.json"),
      JSON.stringify(saved, null, 2),
    );
    forbidden(a);
    forbidden(b);
  } finally {
    await a.close();
    await b.close();
    await other.close();
  }
});

test("a quota failure on the second owner write aborts the whole move and preserves both owners after reload", async ({
  context,
  page,
}, info) => {
  test.setTimeout(90000);
  const other = await context.newPage();
  const a = await prepare(page),
    b = await prepare(other);
  try {
    await draftAction(page, "add", [owner(0), file]);
    await draftAction(page, "drawing", [
      owner(0),
      "sketch",
      sketch("quota-source"),
    ]);
    await draftAction(other, "add", [owner(1), quote]);
    await draftAction(page, "read", [owner(1)]); // Finish destination hydration before faulting the move.
    const result = await page.evaluate(
      async ({ from, to }) => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
        const { composerDrafts } = await load(
          "/src/session-mode/components/codex/composer/v2/drafts.ts",
        );
        const { CONTEXT_DATABASE } = await load(
          "/src/session-mode/components/codex/composer/v2/draftStorage.ts",
        );
        await composerDrafts.ensure(from);
        await composerDrafts.ensure(to);
        await composerDrafts.flush(from);
        await composerDrafts.flush(to);
        const original = IDBObjectStore.prototype.put;
        let injected = 0;
        IDBObjectStore.prototype.put = function (value, key) {
          if (this.transaction.db.name === CONTEXT_DATABASE && key === to) {
            injected++;
            throw new DOMException(
              "isolated quota failure on move destination",
              "QuotaExceededError",
            );
          }
          return original.call(this, value, key);
        };
        try {
          await composerDrafts.move(from, to);
          return { injected, resolved: true };
        } catch (error) {
          return { injected, resolved: false, error: String(error) };
        } finally {
          IDBObjectStore.prototype.put = original;
        }
      },
      { from: owner(0), to: owner(1) },
    );
    expect(result.injected).toBe(1);
    expect(result.resolved).toBe(false);
    await expect(chips(page)).toHaveCount(1);
    await other.reload({ waitUntil: "domcontentloaded" });
    await selectOwner(other, 0);
    await expect(chips(other)).toHaveCount(1);
    await showFile(other, file.name, file.text);
    const source = await draftAction(other, "read", [owner(0)]);
    expect(source.contexts.map((item: any) => item.id)).toEqual([file.id]);
    expect(source.drawings.sketch.marks.map((mark: any) => mark.id)).toEqual([
      "quota-source",
    ]);
    await selectOwner(other, 1);
    await expect(chips(other)).toHaveCount(1);
    await showFile(other, quote.name, quote.text);
    const target = await draftAction(other, "read", [owner(1)]);
    expect(target.contexts.map((item: any) => item.id)).toEqual([quote.id]);
    await writeFile(
      info.outputPath("quota-move.json"),
      JSON.stringify({ result, source, target }, null, 2),
    );
    forbidden(a);
    forbidden(b);
  } finally {
    await a.close();
    await b.close();
    await other.close();
  }
});

test("retrying Undo after a failed IndexedDB write persists the restored context before dismissing the notice", async ({
  context,
  page,
}, info) => {
  test.setTimeout(90000);
  const other = await context.newPage();
  const a = await prepare(page),
    b = await prepare(other);
  try {
    await draftAction(page, "add", [owner(0), file]);
    await removeContext(page, file.name);
    await draftAction(page, "flush", [owner(0)]);
    await page.getByRole("button", { name: "撤销", exact: true }).focus();
    await page.evaluate(async (owner) => {
      const path =
        "/src/session-mode/components/codex/composer/v2/draftStorage.ts";
      const { CONTEXT_DATABASE } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
      const original = IDBObjectStore.prototype.put;
      (window as any).__undoQuotaFailures = 0;
      (window as any).__restoreContextPut = () => {
        IDBObjectStore.prototype.put = original;
      };
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.transaction.db.name === CONTEXT_DATABASE && key === owner) {
          (window as any).__undoQuotaFailures++;
          throw new DOMException(
            "isolated undo quota failure",
            "QuotaExceededError",
          );
        }
        return original.call(this, value, key);
      };
    }, owner(0));
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(
      page.getByText(/isolated undo quota failure/).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "撤销", exact: true }),
    ).toBeEnabled();
    const failures = await page.evaluate(() => {
      (window as any).__restoreContextPut();
      return (window as any).__undoQuotaFailures;
    });
    expect(failures).toBeGreaterThan(0);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "撤销", exact: true }),
    ).toHaveCount(0);
    await other.reload({ waitUntil: "domcontentloaded" });
    await expect(chips(other)).toHaveCount(1);
    await showFile(other, file.name, file.text);
    const saved = await draftAction(other, "read", [owner(0)]);
    await writeFile(
      info.outputPath("undo-quota.json"),
      JSON.stringify({ failures, saved }, null, 2),
    );
    forbidden(a);
    forbidden(b);
  } finally {
    await page.evaluate(() => (window as any).__restoreContextPut?.());
    await a.close();
    await b.close();
    await other.close();
  }
});

test("a committed move rebases later source edits and target additions while duplicate requests share one transaction", async ({
  context,
  page,
}, info) => {
  test.setTimeout(90000);
  const other = await context.newPage();
  const a = await prepare(page),
    b = await prepare(other);
  const edited = { ...file, text: "export const projectA = 2;" };
  const added = {
    ...quote,
    id: "after-move-target",
    name: "移动中的新引用",
    text: "目标在事务回执返回前新增",
  };
  try {
    await draftAction(page, "add", [owner(0), file]);
    await draftAction(page, "drawing", [
      owner(0),
      "sketch",
      sketch("before-move"),
    ]);
    await draftAction(other, "add", [owner(1), quote]);
    await page.evaluate(
      async ({ from, to }) => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
        const { composerDrafts } = await load(
          "/src/session-mode/components/codex/composer/v2/drafts.ts",
        );
        const { contextDraftStorage } = await load(
          "/src/session-mode/components/codex/composer/v2/draftStorage.ts",
        );
        await composerDrafts.ensure(from);
        await composerDrafts.ensure(to);
        await composerDrafts.flush(from);
        await composerDrafts.flush(to);
        const original = contextDraftStorage.move;
        const probe: any = {
          calls: 0,
          committed: false,
          drafts: composerDrafts,
          from,
          to,
        };
        probe.restore = () => {
          contextDraftStorage.move = original;
        };
        contextDraftStorage.move = async (...args: any[]) => {
          probe.calls++;
          const saved = await original(...args); // The real IndexedDB transaction completes first.
          probe.committed = true;
          await new Promise<void>((resolve) => {
            probe.release = resolve;
          });
          return saved;
        };
        probe.first = composerDrafts.move(from, to);
        probe.second = composerDrafts.move(from, to);
        probe.shared = probe.first === probe.second;
        void probe.first.catch(() => {});
        void probe.second.catch(() => {});
        (window as any).__contextMoveProbe = probe;
      },
      { from: owner(0), to: owner(1) },
    );
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__contextMoveProbe.committed),
      )
      .toBe(true);
    const committed = await other.evaluate(
      async ({ from, to }) => {
        const path =
          "/src/session-mode/components/codex/composer/v2/draftStorage.ts";
        const { contextDraftStorage } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
        return {
          from: await contextDraftStorage.load(from),
          to: await contextDraftStorage.load(to),
        };
      },
      { from: owner(0), to: owner(1) },
    );
    expect(committed.from.contexts).toHaveLength(0);
    expect(
      committed.to.contexts.map((entry: any) => entry.value.id).sort(),
    ).toEqual([file.id, quote.id].sort());
    const result = await page.evaluate(
      async ({ edited, added, drawing }) => {
        const probe = (window as any).__contextMoveProbe;
        // These edits happen after durable commit but before this page receives its result.
        probe.drafts.replace(probe.from, edited.id, edited);
        probe.drafts.drawing(probe.from, "sketch", drawing);
        probe.drafts.add(probe.to, added);
        probe.release();
        await Promise.all([probe.first, probe.second]);
        await probe.drafts.flush(probe.from);
        await probe.drafts.flush(probe.to);
        probe.restore();
        return { calls: probe.calls, shared: probe.shared };
      },
      { edited, added, drawing: sketch("after-move-source") },
    );
    expect(result).toEqual({ calls: 1, shared: true });
    await other.reload({ waitUntil: "domcontentloaded" });
    await selectOwner(other, 0);
    await expect(chips(other)).toHaveCount(1);
    await showFile(other, file.name, edited.text);
    const source = await draftAction(other, "read", [owner(0)]);
    expect(source.drawings.sketch.marks.map((mark: any) => mark.id)).toEqual([
      "after-move-source",
    ]);
    await selectOwner(other, 1);
    await expect(chips(other)).toHaveCount(3);
    await showFile(other, file.name, file.text);
    await showFile(other, added.name, added.text);
    const target = await draftAction(other, "read", [owner(1)]);
    expect(target.drawings.sketch.marks.map((mark: any) => mark.id)).toEqual([
      "before-move",
    ]);
    await writeFile(
      info.outputPath("committed-move.json"),
      JSON.stringify({ committed, result, source, target }, null, 2),
    );
    forbidden(a);
    forbidden(b);
  } finally {
    await page.evaluate(() => {
      const probe = (window as any).__contextMoveProbe;
      probe?.release?.();
      probe?.restore?.();
    });
    await a.close();
    await b.close();
    await other.close();
  }
});

test("a late captured clear cannot remove the same public context identity restored by another page's Undo", async ({
  context,
  page,
}, info) => {
  test.setTimeout(90000);
  const other = await context.newPage();
  const a = await prepare(page),
    b = await prepare(other);
  try {
    await draftAction(page, "add", [owner(0), file]);
    const captured = await draftAction(page, "capture", [owner(0)]);
    await other.reload({ waitUntil: "domcontentloaded" });
    await expect(chips(other)).toHaveCount(1);
    await removeContext(other, file.name);
    await other.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(
      other.getByRole("button", { name: "撤销", exact: true }),
    ).toHaveCount(0);
    const restored = await draftAction(other, "capture", [owner(0)]);
    expect(restored.contexts.map((item: any) => item.id)).toEqual([file.id]);
    expect(restored.versions[file.id]).not.toBe(captured.versions[file.id]);
    await draftAction(page, "clearSubmitted", [
      owner(0),
      captured.contexts,
      captured.versions,
    ]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(chips(page)).toHaveCount(1);
    await showFile(page, file.name, file.text);
    const persisted = await draftAction(page, "capture", [owner(0)]);
    expect(persisted.versions[file.id]).toBe(restored.versions[file.id]);
    await writeFile(
      info.outputPath("undo-identity.json"),
      JSON.stringify({ captured, restored, persisted }, null, 2),
    );
    forbidden(a);
    forbidden(b);
  } finally {
    await a.close();
    await b.close();
    await other.close();
  }
});

test("a new-thread context move failure retains the created input target and explicit retry never creates or sends again", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const fixture = await prepare(page);
  const posts: Array<{ path: string; body: unknown }> = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      /\/(thread\/start|turn\/start|followups\/submit)$/.test(path)
    )
      posts.push({ path, body: request.postDataJSON() });
  });
  const target = JSON.stringify(["codex", "", "session", "ux-created"]);
  try {
    await page
      .locator("[data-session-group]")
      .getByRole("button", { name: "新聊天", exact: true })
      .click();
    const composer = page.locator(".session-native-composer");
    await expect(composer).not.toHaveAttribute("data-owner-thread", /.+/);
    const source = await composer.getAttribute("data-draft-owner");
    expect(source).toBeTruthy();
    await draftAction(page, "add", [source!, file]);
    await composer
      .locator("[contenteditable=true]")
      .fill("创建成功但上下文保存失败后必须保留这份草稿");
    await page.evaluate(
      async ({ source, target }) => {
        const path =
          "/src/session-mode/components/codex/composer/v2/draftStorage.ts";
        const { CONTEXT_DATABASE } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
        const get = IDBObjectStore.prototype.get,
          put = IDBObjectStore.prototype.put;
        const touched = new WeakMap<IDBTransaction, Set<string>>();
        const probe: any = {
          failures: 0,
          restore: () => {
            IDBObjectStore.prototype.get = get;
            IDBObjectStore.prototype.put = put;
          },
        };
        IDBObjectStore.prototype.get = function (key) {
          if (this.transaction.db.name === CONTEXT_DATABASE) {
            const keys = touched.get(this.transaction) ?? new Set<string>();
            keys.add(String(key));
            touched.set(this.transaction, keys);
          }
          return get.call(this, key);
        };
        IDBObjectStore.prototype.put = function (value, key) {
          if (
            this.transaction.db.name === CONTEXT_DATABASE &&
            key === target &&
            touched.get(this.transaction)?.has(source)
          ) {
            probe.failures++;
            throw new DOMException(
              "isolated created-thread move quota",
              "QuotaExceededError",
            );
          }
          return put.call(this, value, key);
        };
        (window as any).__createdContextMove = probe;
      },
      { source: source!, target },
    );
    await composer
      .getByRole("button", { name: "发送消息", exact: true })
      .click();
    await expect
      .poll(
        () =>
          posts.filter((post) => post.path.endsWith("/thread/start")).length,
      )
      .toBe(1);
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__createdContextMove.failures),
      )
      .toBeGreaterThan(0);
    await expect(composer).toHaveAttribute("data-owner-thread", "ux-created");
    await expect(
      page.locator('[data-tab-key="codex:ux-created"]'),
    ).toHaveAttribute("aria-selected", "true");
    await expect(composer.locator("[contenteditable=true]")).toHaveText(
      "创建成功但上下文保存失败后必须保留这份草稿",
    );
    await expect(
      page.locator('.session-native-composer-status[role="alert"]'),
    ).toHaveText("上下文保存失败，打开状态面板重试");
    await page.evaluate(() => (window as any).__createdContextMove.restore());
    await openComposerStatus(page);
    await page
      .getByRole("button", { name: "重试保存上下文", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "重试保存上下文", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(composer).toHaveAttribute("data-owner-thread", "ux-created");
    await expect(chips(page)).toHaveCount(1);
    await showFile(page, file.name, file.text);
    const movedSource = await draftAction(page, "read", [source!]);
    const movedTarget = await draftAction(page, "read", [target]);
    expect(movedSource.contexts).toEqual([]);
    expect(movedTarget.contexts).toContainEqual(file);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(composer).toHaveAttribute("data-owner-thread", "ux-created");
    await expect(composer.locator("[contenteditable=true]")).toHaveText(
      "创建成功但上下文保存失败后必须保留这份草稿",
    );
    await expect(chips(page)).toHaveCount(1);
    expect(posts).toHaveLength(1);
    expect(fixture.calls).toEqual([]);
    expect(fixture.errors).toEqual([]);
    await page.screenshot({
      path: info.outputPath("created-thread-retry.png"),
      animations: "disabled",
    });
    await writeFile(
      info.outputPath("created-thread-retry.json"),
      JSON.stringify(
        { source, target, posts, movedSource, movedTarget },
        null,
        2,
      ),
    );
  } finally {
    await page.evaluate(() => (window as any).__createdContextMove?.restore());
    await fixture.close();
  }
});
