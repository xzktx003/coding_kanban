import assert from "node:assert/strict";
import test from "node:test";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  assertExternalSourceMapContract,
  externalSourceMapUrl,
  viteExternalSourceMaps,
} from "./vite-external-sourcemaps.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(repository, "apps/web/package.json"));
const vite = await import(pathToFileURL(require.resolve("vite")).href);

test(
  "Vite serves external real maps, stable conditional responses and updated HMR query maps",
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "kanban-vite-maps-"));
    const source = resolve(directory, "source.ts");
    const initial = 'export const greeting: string = "hello";\n';
    await writeFile(source, initial);
    let acknowledgeHotUpdate;
    const hotUpdate = new Promise((resolveUpdate) => {
      acknowledgeHotUpdate = resolveUpdate;
    });
    // Vite treats port:0 as its default port. Reserve an actual OS-selected
    // port instead of colliding with another owned development listener.
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
    const request = async (url, options = {}) => {
      try {
        return await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(5000),
        });
      } catch (error) {
        throw new Error(`Source map fixture request failed: ${String(url)}`, {
          cause: error,
        });
      }
    };
    const server = await vite.createServer({
      configFile: false,
      root: directory,
      plugins: [
        viteExternalSourceMaps(),
        {
          name: "fixture-hot-update-observer",
          handleHotUpdate(context) {
            if (context.file === source) acknowledgeHotUpdate();
          },
        },
      ],
      server: { host: "0.0.0.0", port, strictPort: true },
      logLevel: "error",
    });
    try {
      await server.listen();
      const base = `http://127.0.0.1:${server.httpServer.address().port}`;
      const response = await request(`${base}/source.ts?fixture=1`);
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.doesNotMatch(body, /sourceMappingURL=data:/);
      const comment = body.match(/sourceMappingURL=(\S+)/)?.[1];
      assert.equal(comment, "/source.ts.map?fixture=1");
      const mapResponse = await request(new URL(comment, base));
      assert.equal(mapResponse.status, 200);
      const map = await mapResponse.json();
      assert.ok(map.mappings.length > 0);
      assert.ok(map.sourcesContent.includes(initial));
      const cached = await request(`${base}/source.ts?fixture=1`, {
        headers: { "if-none-match": response.headers.get("etag") },
      });
      assert.equal(cached.status, 304);
      assert.equal(await cached.text(), "");
      const next = 'export const greeting: string = "updated";\n';
      await writeFile(source, next);
      let deadline;
      try {
        await Promise.race([
          hotUpdate,
          new Promise((_, reject) => {
            deadline = setTimeout(
              () => reject(new Error("Vite HMR update did not occur")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(deadline);
      }
      const updated = await request(
        `${base}/source.ts?t=${Date.now()}&fixture=1`,
      );
      const updatedCode = await updated.text();
      assert.match(updatedCode, /updated/);
      assert.doesNotMatch(updatedCode, /sourceMappingURL=data:/);
      const nextComment = updatedCode.match(/sourceMappingURL=(\S+)/)?.[1];
      const nextMap = await (await request(new URL(nextComment, base))).json();
      assert.ok(nextMap.sourcesContent.includes(next));
      assert.equal(new URL(nextComment, base).origin, base);
      const head = await request(`${base}/source.ts?fixture=1`, {
        method: "HEAD",
      });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), "");
      const imported = await (await request(`${base}/source.ts?import`)).text();
      assert.doesNotMatch(imported, /sourceMappingURL=data:/);
      const importedMap = await (
        await request(
          new URL(imported.match(/sourceMappingURL=(\S+)/)[1], base),
        )
      ).json();
      assert.ok(importedMap.sourcesContent.includes(next));
      const unrelated = await request(`${base}/missing.ts.map`);
      assert.notEqual(unrelated.status, 200);
      await unrelated.arrayBuffer();
    } finally {
      server.httpServer?.closeAllConnections?.();
      let closeDeadline;
      try {
        await Promise.race([
          server.close(),
          new Promise((_, reject) => {
            closeDeadline = setTimeout(
              () =>
                reject(new Error("Source map fixture Vite close timed out")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(closeDeadline);
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
);

test("source map adaptation admits only the verified Vite contract and same-origin request paths", () => {
  assert.doesNotThrow(() => assertExternalSourceMapContract("7.3.1"));
  assert.throws(() => assertExternalSourceMapContract("7.3.2"), /Revalidate/);
  assert.equal(
    externalSourceMapUrl("/nested/source.ts?import&t=123"),
    "/nested/source.ts.map?import&t=123",
  );
  for (const url of [
    "https://example.invalid/source.ts",
    "//example.invalid/source.ts",
    undefined,
  ])
    assert.equal(externalSourceMapUrl(url), null);
});
