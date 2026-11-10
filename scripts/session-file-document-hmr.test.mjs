import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(repository, "apps/web/package.json"));

test(
  "file drafts retain newer edits across an actual store hot update and late save receipt",
  {
    timeout: 45000,
    skip:
      process.env.SESSION_FILE_HMR_LIVE_RUN !== "1" &&
      "Set SESSION_FILE_HMR_LIVE_RUN=1 to run the isolated browser test",
  },
  async () => {
    const vite = await import(pathToFileURL(require.resolve("vite")).href);
    const { chromium } = require("playwright");
    const directory = await mkdtemp(
      resolve(tmpdir(), "kanban-file-draft-hmr-"),
    );
    const sourcePath = resolve(directory, "document.ts");
    const original = await readFile(
      resolve(
        repository,
        "apps/web/src/session-mode/stores/useFileDocumentStore.ts",
      ),
      "utf8",
    );
    const oldFilter = "([, d]) => d.draft !== d.base || d.saveUnconfirmed,";
    assert.ok(original.includes(oldFilter));
    const initial = original.replace(
      oldFilter,
      "([, d]) => d.draft !== d.base,",
    );
    const oldDiscard = "draft: s.documents[path].base,";
    assert.ok(original.includes(oldDiscard));
    const updated = original.replace(
      oldDiscard,
      'draft: s.documents[path].base + " [hot]",',
    );
    await writeFile(sourcePath, initial);
    await symlink(
      resolve(repository, "apps/web/node_modules"),
      resolve(directory, "node_modules"),
      "dir",
    );
    await writeFile(
      resolve(directory, "index.html"),
      '<!doctype html><script type="module" src="/main.ts"></script>',
    );
    await writeFile(
      resolve(directory, "main.ts"),
      `
    import { useFileDocumentStore } from "/document.ts";
    window.fixture = { first: useFileDocumentStore, current: useFileDocumentStore, updates: 0 };
    import.meta.hot.accept("/document.ts", (module) => {
      window.fixture.current = module.useFileDocumentStore;
      window.fixture.updates++;
    });
  `,
    );
    const port = await new Promise((resolvePort, reject) => {
      const probe = createNetServer();
      probe.once("error", reject);
      probe.listen(0, "0.0.0.0", () => {
        const address = probe.address();
        probe.close((error) =>
          error ? reject(error) : resolvePort(address.port),
        );
      });
    });
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((item) => item?.family === "IPv4" && !item.internal);
    const lanAddress =
      addresses.find(
        (item) =>
          item.address.startsWith("10.") || item.address.startsWith("192.168."),
      )?.address ??
      addresses[0]?.address ??
      "127.0.0.1";
    const server = await vite.createServer({
      configFile: false,
      root: directory,
      server: {
        host: "0.0.0.0",
        port,
        strictPort: true,
        // Exercise the store update independently of host file-watcher limits.
        watch: { usePolling: true, interval: 150 },
        fs: { allow: [directory, repository] },
      },
      logLevel: "error",
    });
    const watcherEvents = [];
    server.watcher.on("all", (event, path) => {
      if (path === sourcePath) watcherEvents.push(event);
    });
    server.watcher.on("error", (error) => watcherEvents.push(String(error)));
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const errors = [];
      const sockets = [];
      const frames = [];
      page.on("websocket", (socket) => {
        sockets.push("connected");
        socket.on("close", () => sockets.push("closed"));
        socket.on("framereceived", ({ payload }) => {
          try {
            const message = JSON.parse(String(payload));
            frames.push(message.type);
          } catch {
            frames.push("non-json");
          }
        });
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://${lanAddress}:${port}/`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(() => window.fixture?.first);
      await page.evaluate(() => {
        const store = window.fixture.first.getState();
        store.load("/fixture/a.ts", "/fixture", "before", "v1");
        store.edit("/fixture/a.ts", "submitted");
        store.markSaveUnconfirmed("/fixture/a.ts");
      });
      await writeFile(sourcePath, updated);
      try {
        await page.waitForFunction(() => window.fixture.updates === 1, null, {
          timeout: 10000,
        });
      } catch (error) {
        const diagnostics = {
          sockets,
          updates: await page.evaluate(() => window.fixture?.updates),
          watched: server.watcher
            .getWatched()
            [directory]?.includes("document.ts"),
          watcherEvents,
          frames,
          errors,
        };
        throw new Error(
          `Hot update was not observed: ${JSON.stringify(diagnostics)}`,
          {
            cause: error,
          },
        );
      }
      const result = await page.evaluate(() => {
        const { first, current } = window.fixture;
        current.getState().edit("/fixture/a.ts", "newer draft");
        first.getState().saved("/fixture/a.ts", "submitted", "v2");
        const persisted = JSON.parse(
          localStorage.getItem("kanban.session.file-drafts"),
        );
        current.getState().load("/fixture/b.ts", "/fixture", "old base", "b1");
        current.getState().markSaveUnconfirmed("/fixture/b.ts");
        const unconfirmed = JSON.parse(
          localStorage.getItem("kanban.session.file-drafts"),
        ).state.documents["/fixture/b.ts"];
        current.getState().discard("/fixture/b.ts");
        return {
          sameStore: first === current,
          currentDraft: current.getState().documents["/fixture/a.ts"].draft,
          persistedDraft: persisted.state.documents["/fixture/a.ts"]?.draft,
          unconfirmed: unconfirmed?.saveUnconfirmed,
          discardUsesNewCode:
            current.getState().documents["/fixture/b.ts"].draft,
        };
      });
      assert.equal(result.persistedDraft, "newer draft");
      assert.equal(result.sameStore, true);
      assert.equal(result.currentDraft, "newer draft");
      assert.equal(result.unconfirmed, true);
      assert.equal(result.discardUsesNewCode, "old base [hot]");
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      server.httpServer?.closeAllConnections?.();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
