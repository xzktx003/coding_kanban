import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const webRequire = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { createServer } = await import(
  pathToFileURL(webRequire.resolve("vite")).href
);
const sourcePaths = {
  drafts:
    process.env.CONTEXT_DRAFT_HMR_SOURCE ??
    "apps/web/src/session-mode/components/codex/composer/v2/drafts.ts",
  draftStorage:
    "apps/web/src/session-mode/components/codex/composer/v2/draftStorage.ts",
  sessionReadQueue: "apps/web/src/session-mode/services/sessionReadQueue.ts",
};
const context = (id: string) => ({
  id,
  kind: "paste",
  name: id,
  text: `unsent ${id}`,
});

for (const scenario of [
  "quota",
  "in-flight",
  "move",
  "late-closure",
  "late-closure-before-hydrate",
  "remove-gap",
  "remove-gap-clean",
] as const) {
  test(`actual context draft HMR retains ${scenario} edits and ignores old module callbacks`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    const root = await mkdtemp(join(tmpdir(), "context-drafts-hmr-"));
    const sources = Object.fromEntries(
      await Promise.all(
        Object.entries(sourcePaths).map(async ([key, path]) => [
          key,
          await readFile(path, "utf8"),
        ]),
      ),
    );
    for (const [key, source] of Object.entries(sources))
      await writeFile(join(root, key + ".ts"), source);
    await writeFile(
      join(root, "main.ts"),
      `
import * as drafts from './drafts';
import {contextDraftStorage} from './draftStorage';
const control={quota:false,pauseSave:false,pauseMove:false,release:null,committed:0,errors:[]};
const originalPut=IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put=function(...args){if(control.quota)throw new DOMException('fixture quota','QuotaExceededError');return originalPut.apply(this,args)};
const originalSave=contextDraftStorage.save;
contextDraftStorage.save=async(...args)=>{const pause=control.pauseSave;control.pauseSave=false;const result=await originalSave(...args);if(pause){control.committed++;await new Promise(resolve=>control.release=resolve);}return result;};
const originalMove=contextDraftStorage.move;
contextDraftStorage.move=async(...args)=>{const pause=control.pauseMove;control.pauseMove=false;const result=await originalMove(...args);if(pause){control.committed++;await new Promise(resolve=>control.release=resolve);}return result;};
window.hmrDraft={current:drafts,storage:contextDraftStorage,control,updates:0,token:Math.random(),oldStores:[]};
if(import.meta.hot)import.meta.hot.accept('./drafts',next=>{const state=window.hmrDraft;state.oldStores.push(state.current.useComposerDraftStore);state.current=next;state.updates++;});
document.body.textContent='Context draft HMR fixture';
`,
    );
    await writeFile(
      join(root, "index.html"),
      '<!doctype html><html><body><script type="module" src="/main.ts"></script></body></html>',
    );
    const server = await createServer({
      configFile: false,
      envFile: false,
      root,
      cacheDir: join(root, ".vite"),
      resolve: {
        alias: [
          {
            find: "@session/services/sessionReadQueue",
            replacement: join(root, "sessionReadQueue.ts"),
          },
          { find: /^react$/, replacement: webRequire.resolve("react") },
          { find: /^zustand$/, replacement: webRequire.resolve("zustand") },
          {
            find: /^uuid$/,
            replacement: resolve(
              dirname(webRequire.resolve("uuid")),
              "../dist/index.js",
            ),
          },
          {
            find: /^fast-sha256$/,
            replacement: webRequire.resolve("fast-sha256"),
          },
        ],
      },
      server: {
        host: "0.0.0.0",
        port: 0,
        watch: { usePolling: true, interval: 50 },
        fs: { allow: [root, resolve("node_modules")] },
      },
      logLevel: "error",
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let token: number;
    const captures: any[] = [];
    const snapshot = async (label: string) => {
      const state = await page.evaluate(() => {
        const p = (window as any).hmrDraft;
        return {
          token: p.token,
          updates: p.updates,
          draft: p.current.composerDrafts.read("owner"),
          target: p.current.composerDrafts.read("target"),
          status: p.current.useComposerDraftStore.getState().status.owner,
          oldStates: p.oldStores.map((store: any) => store.getState()),
          committed: p.control.committed,
        };
      });
      captures.push({ label, ...state });
      return state;
    };
    const replace = async (version: number) => {
      await writeFile(
        join(root, "drafts.ts"),
        sources.drafts +
          `\n// owned HMR replacement ${version} ${".".repeat(version)}\n`,
      );
      await page.waitForFunction(
        (v) => (window as any).hmrDraft?.updates === v,
        version,
        { timeout: 10000 },
      );
      expect((await snapshot("hmr-" + version)).token).toBe(token);
    };
    try {
      await server.listen();
      const host = Object.values(networkInterfaces())
        .flat()
        .find((a) => a?.family === "IPv4" && !a.internal)?.address;
      expect(host).toBeTruthy();
      const url = `http://${host}:${(server.httpServer!.address() as { port: number }).port}`;
      await page.goto(url);
      await page.waitForFunction(() => !!(window as any).hmrDraft);
      token = await page.evaluate(() => (window as any).hmrDraft.token);
      await page.evaluate(async () => {
        await (window as any).hmrDraft.current.composerDrafts.ensure("owner");
      });
      if (scenario === "quota") {
        await page.evaluate(async (item) => {
          const p = (window as any).hmrDraft;
          p.control.quota = true;
          p.current.composerDrafts.add("owner", item);
          await p.current.composerDrafts.flush("owner").catch(() => {});
        }, context("quota-a"));
        expect((await snapshot("quota-before-hmr")).status.phase).toBe("error");
        await replace(1);
        expect((await snapshot("quota-after-hmr")).draft.contexts).toEqual([
          context("quota-a"),
        ]);
        await replace(2);
        expect(
          (await snapshot("quota-after-second-hmr")).draft.contexts,
        ).toEqual([context("quota-a")]);
        await page.evaluate(async () => {
          const p = (window as any).hmrDraft;
          p.control.quota = false;
          await p.current.composerDrafts.retryStorage();
          await p.current.composerDrafts.flush("owner");
        });
      } else if (scenario === "in-flight") {
        await page.evaluate((item) => {
          const p = (window as any).hmrDraft;
          p.control.pauseSave = true;
          p.current.composerDrafts.add("owner", item);
          void p.current.composerDrafts
            .flush("owner")
            .catch((e: Error) => p.control.errors.push(e.message));
        }, context("a"));
        await page.waitForFunction(
          () => typeof (window as any).hmrDraft.control.release === "function",
        );
        await page.evaluate(
          (item) =>
            (window as any).hmrDraft.current.composerDrafts.add("owner", item),
          context("b"),
        );
        await replace(1);
        expect((await snapshot("in-flight-restored")).draft.contexts).toEqual([
          context("a"),
          context("b"),
        ]);
        await page.evaluate(
          (item) =>
            (window as any).hmrDraft.current.composerDrafts.add("owner", item),
          context("c"),
        );
        await replace(2);
        expect((await snapshot("second-in-flight-hmr")).draft.contexts).toEqual(
          [context("a"), context("b"), context("c")],
        );
        await page.evaluate(async () => {
          const p = (window as any).hmrDraft;
          p.control.release();
          await p.current.composerDrafts.flush("owner");
        });
        expect((await snapshot("late-ack-settled")).draft.contexts).toEqual([
          context("a"),
          context("b"),
          context("c"),
        ]);
        await replace(3);
        await page.evaluate(async () => {
          const p = (window as any).hmrDraft;
          await p.current.composerDrafts.ensure("owner");
          await p.current.composerDrafts.flush("owner");
        });
      } else if (scenario === "move") {
        await page.evaluate(async (item) => {
          const p = (window as any).hmrDraft;
          await p.current.composerDrafts.ensure("target");
          p.current.composerDrafts.add("owner", item);
          await p.current.composerDrafts.flush("owner");
          p.control.pauseMove = true;
          void p.current.composerDrafts
            .move("owner", "target")
            .catch((error: Error) => p.control.errors.push(error.message));
        }, context("moved-a"));
        await page.waitForFunction(
          () => typeof (window as any).hmrDraft.control.release === "function",
        );
        await page.evaluate(
          ({ source, target }) => {
            const p = (window as any).hmrDraft;
            p.current.composerDrafts.add("owner", source);
            p.current.composerDrafts.add("target", target);
          },
          { source: context("source-b"), target: context("target-c") },
        );
        await replace(1);
        expect((await snapshot("move-handoff")).draft.contexts).toEqual([
          context("moved-a"),
          context("source-b"),
        ]);
        await page.evaluate(
          (item) =>
            (window as any).hmrDraft.current.composerDrafts.add("owner", item),
          context("source-d"),
        );
        await page.evaluate(async () => {
          const p = (window as any).hmrDraft;
          p.control.release();
          await Promise.all([
            p.current.composerDrafts.flush("owner"),
            p.current.composerDrafts.flush("target"),
          ]);
        });
        const moved = await snapshot("move-late-ack");
        expect(moved.draft.contexts).toEqual([
          context("source-b"),
          context("source-d"),
        ]);
        expect(moved.target.contexts).toEqual([
          context("moved-a"),
          context("target-c"),
        ]);
      } else if (scenario === "remove-gap" || scenario === "remove-gap-clean") {
        const initialItems = [
          context("undo-original"),
          context("keep"),
          ...(scenario === "remove-gap-clean"
            ? [context("protected-remote")]
            : []),
        ];
        let remoteRevision: string | undefined;
        await page.evaluate(
          async ({ items, clean }) => {
            const p = (window as any).hmrDraft;
            p.control.quota = !clean;
            for (const item of items)
              p.current.composerDrafts.add("owner", item);
            await p.current.composerDrafts.flush("owner").catch(() => {});
            p.oldRemove = p.current.composerDrafts.remove;
            p.protectedRevision =
              p.current.composerDrafts.capture("owner").versions[
                "protected-remote"
              ];
          },
          { items: initialItems, clean: scenario === "remove-gap-clean" },
        );
        let releaseModule!: () => void;
        let requestedModule!: () => void;
        const moduleRequested = new Promise<void>((resolve) => {
          requestedModule = resolve;
        });
        const heldModule = new Promise<void>((resolve) => {
          releaseModule = resolve;
        });
        await page.route("**/drafts.ts?t=*", async (route) => {
          requestedModule();
          await heldModule;
          await route.continue();
        });
        try {
          await writeFile(
            join(root, "drafts.ts"),
            sources.drafts + "\n// actual dispose-to-successor gap\n",
          );
          await moduleRequested;
          if (scenario === "remove-gap-clean") {
            const other = await page.context().newPage();
            try {
              await other.goto(url);
              await other.waitForFunction(() => !!(window as any).hmrDraft);
              remoteRevision = await other.evaluate(async (item) => {
                const p = (window as any).hmrDraft;
                await p.current.composerDrafts.ensure("owner");
                p.current.composerDrafts.replace("owner", item.id, item);
                await p.current.composerDrafts.flush("owner");
                return p.current.composerDrafts.capture("owner").versions[
                  item.id
                ];
              }, context("protected-remote"));
              expect(remoteRevision).not.toBe(
                await page.evaluate(
                  () => (window as any).hmrDraft.protectedRevision,
                ),
              );
            } finally {
              await other.close();
            }
          }
          const gap = await page.evaluate((clean) => {
            const p = (window as any).hmrDraft;
            const disposedState = p.current.useComposerDraftStore.getState();
            const undo = p.oldRemove("owner", "undo-original");
            p.gapUndo = undo;
            if (clean) p.oldRemove("owner", "protected-remote");
            p.control.quota = false;
            let error: string | null = null;
            try {
              if (!clean) {
                p.gapUndoPromise = Promise.resolve(undo());
                void p.gapUndoPromise.catch(() => {});
              }
            } catch (failure) {
              error = (failure as Error).name;
            }
            return {
              updates: p.updates,
              disposed: Object.keys(disposedState.drafts).length === 0,
              type: typeof undo,
              error,
            };
          }, scenario === "remove-gap-clean");
          captures.push({ label: "actual-hmr-gap-remove", gap });
          expect(gap).toEqual({
            updates: 0,
            disposed: true,
            type: "function",
            error: null,
          });
        } finally {
          releaseModule();
        }
        await page.waitForFunction(
          () => (window as any).hmrDraft.updates === 1,
        );
        if (scenario === "remove-gap-clean") {
          const removed = await page.evaluate(async () => {
            const p = (window as any).hmrDraft;
            await p.current.composerDrafts.flush("owner");
            const stored = await p.storage.load("owner");
            return {
              memory: p.current.composerDrafts.read("owner").contexts,
              stored: stored.contexts.map((entry: any) => entry.value),
              remoteRevision: stored.contexts.find(
                (entry: any) => entry.value.id === "protected-remote",
              )?.revision,
            };
          });
          captures.push({ label: "gap-remove-before-undo", removed });
          expect(removed).toEqual({
            memory: [context("keep"), context("protected-remote")],
            stored: [context("keep"), context("protected-remote")],
            remoteRevision,
          });
          await page.evaluate(async () => {
            const p = (window as any).hmrDraft;
            await p.gapUndo();
          });
        }
        await page.evaluate(async () => {
          const p = (window as any).hmrDraft;
          await p.gapUndoPromise;
          await p.current.composerDrafts.flush("owner");
        });
        expect((await snapshot("gap-undo-restored")).draft.contexts).toEqual(
          initialItems,
        );
      } else {
        await page.evaluate(
          async (items) => {
            const p = (window as any).hmrDraft;
            for (const item of items)
              p.current.composerDrafts.add("owner", item);
            await p.current.composerDrafts.flush("owner");
            const captured = p.current.composerDrafts.capture("owner");
            p.originalCapture = captured;
            // These const references model an already-running component callback.
            // They intentionally do not look up the replacement module at call time.
            const clear = p.current.composerDrafts.clearSubmitted;
            const add = p.current.composerDrafts.add;
            p.lateAcknowledgement = () =>
              clear("owner", captured.contexts, captured.versions);
            p.lateUpload = (item: unknown) => add("owner", item);
          },
          [
            context("remote-changed"),
            context("same-value-new-version"),
            context("submitted"),
          ],
        );
        const other = await page.context().newPage();
        const replacement = {
          ...context("remote-changed"),
          text: "other page replacement",
        };
        try {
          await other.goto(url);
          await other.waitForFunction(() => !!(window as any).hmrDraft);
          const remoteCapture = await other.evaluate(
            async ({ item, same }) => {
              const p = (window as any).hmrDraft;
              await p.current.composerDrafts.ensure("owner");
              p.current.composerDrafts.replace("owner", item.id, item);
              p.current.composerDrafts.replace("owner", same.id, same);
              await p.current.composerDrafts.flush("owner");
              return p.current.composerDrafts.capture("owner");
            },
            { item: replacement, same: context("same-value-new-version") },
          );
          expect(remoteCapture.versions["same-value-new-version"]).not.toBe(
            await page.evaluate(
              () =>
                (window as any).hmrDraft.originalCapture.versions[
                  "same-value-new-version"
                ],
            ),
          );
        } finally {
          await other.close();
        }
        await replace(1);
        await page.evaluate(
          async (items) => {
            const p = (window as any).hmrDraft;
            await Promise.all([
              p.current.composerDrafts.ensure("owner"),
              p.current.composerDrafts.ensure("target"),
            ]);
            p.current.composerDrafts.add("owner", items[0]);
            p.current.composerDrafts.add("target", items[1]);
            await Promise.all([
              p.current.composerDrafts.flush("owner"),
              p.current.composerDrafts.flush("target"),
            ]);
          },
          [context("new-local"), context("other-owner")],
        );
        // Two generations must forward an original capture to the latest owner.
        await replace(2);
        await page.evaluate(
          async ({ item, beforeHydrate }) => {
            const p = (window as any).hmrDraft;
            if (!beforeHydrate) await p.current.composerDrafts.ensure("owner");
            await p.lateAcknowledgement();
            await p.lateUpload(item);
            await p.current.composerDrafts.flush("owner");
            await p.current.composerDrafts.ensure("target");
          },
          {
            item: context("uploaded-late"),
            beforeHydrate: scenario === "late-closure-before-hydrate",
          },
        );
        const acknowledged = await snapshot("old-public-closure");
        expect(acknowledged.draft.contexts).toEqual([
          replacement,
          context("same-value-new-version"),
          context("new-local"),
          context("uploaded-late"),
        ]);
        expect(acknowledged.target.contexts).toEqual([context("other-owner")]);
      }
      const saved = await snapshot("saved");
      expect(saved.status.phase).toBe("ready");
      for (const old of saved.oldStates) expect(old.drafts).toEqual({});
      await page.reload();
      await page.waitForFunction(() => !!(window as any).hmrDraft);
      await page.evaluate(async () => {
        const p = (window as any).hmrDraft;
        await Promise.all([
          p.current.composerDrafts.ensure("owner"),
          p.current.composerDrafts.ensure("target"),
        ]);
      });
      const reloaded = await snapshot("page-reload");
      expect(reloaded.draft.contexts).toEqual(saved.draft.contexts);
      expect(reloaded.target.contexts).toEqual(saved.target.contexts);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath("context-hmr.json"),
        JSON.stringify(
          {
            scenario,
            url: page.url(),
            errors,
            captures,
            sourceSha256: Object.fromEntries(
              Object.entries(sources).map(([name, source]) => [
                sourcePaths[name as keyof typeof sourcePaths],
                createHash("sha256").update(source).digest("hex"),
              ]),
            ),
            scope:
              "Actual copied module bytes in own Vite; real IndexedDB and HMR, injected quota/late acknowledgement; no task calls, formal server mutations or long memory claim.",
          },
          null,
          2,
        ),
      );
      await page.goto("about:blank");
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
