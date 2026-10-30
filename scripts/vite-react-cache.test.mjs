import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import * as cache from "./vite-dev-cache.mjs";

const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { default: react } = await import(pathToFileURL(requireWeb.resolve("@vitejs/plugin-react")).href);
const source = 'import { jsx } from "react/jsx-runtime"; export function Fixture() { return jsx("button", {children: "Ready"}); }';
const transform = () => {
  const plugin = react(cache.webDevReactOptions?.() ?? {}).find((p) => p.name === "vite:react-babel");
  plugin.configResolved({ root: "/sandbox", base: "/", experimental: {}, isProduction: false, command: "serve", server: { hmr: true }, plugins: [] });
  assert.equal(typeof plugin?.transform?.handler, "function", "installed React transform contract changed");
  return plugin.transform.handler;
};

test("isolated optimized dependencies skip a second React transform", async () => {
  const run = transform();
  const id = "/sandbox/.dev-runtime/vite-cache/web-opaque-123/deps/fixture.js?v=123";
  assert.equal(await run.call({}, source, id), undefined);
});

test("application components retain Fast Refresh, including isolated acceptance sources", async () => {
  const run = transform();
  for (const id of ["/sandbox/apps/web/src/Fixture.tsx", "/sandbox/.dev-runtime/acceptance/apps/web/src/Fixture.tsx"]) {
    const result = await run.call({}, source, id);
    assert.match(result.code, /\$RefreshReg\$/);
  }
  assert.equal(await run.call({}, source, "/sandbox/node_modules/lib/index.js"), undefined);
});
