import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { viteDocumentContinuity } from "./vite-document-continuity.mjs";

const clientPath = resolve("apps/web/node_modules/vite/dist/client/client.mjs");
const clientSource = await readFile(clientPath, "utf8");

test("the installed Vite client reconnects unchanged sessions and prompts for newer code", () => {
  const plugin = viteDocumentContinuity();
  const transformed = plugin.transform(clientSource, clientPath).code;

  assert.match(transformed, /workbenchHmrInstance/);
  assert.match(transformed, /workbenchHmrRevision/);
  assert.match(
    transformed,
    /transport\.connect\(createWorkbenchHmrHandler\(\)\)/,
  );
  assert.match(transformed, /state\.revision !== workbenchHmrRevision/);
  assert.match(transformed, /workbench-update-available/);
  assert.match(transformed, /AbortSignal\.timeout\(5000\)/);
  assert.match(transformed, /document\.visibilityState === "hidden"/);
  assert.match(
    transformed,
    /clearInterval\(pingIntervalId\);\s*onDisconnection\(\);/,
  );
  assert.doesNotMatch(
    transformed,
    /await waitForSuccessfulPing\(url\.href\)/,
  );
  // Incompatible updates need a user gesture; ordinary HMR remains available.
  assert.match(transformed, /case "full-reload"/);
  assert.doesNotMatch(transformed, /location\.reload\(\)/);
  assert.match(transformed, /workbenchUpdatePending/);
  assert.match(transformed, /hmrClient\.queueUpdate\(update\)/);
});

test("the HMR state endpoint distinguishes server restarts and missed updates", () => {
  const plugin = viteDocumentContinuity();
  let middleware;
  plugin.configureServer({
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
  });

  const readState = () => {
    const headers = {};
    let body = "";
    middleware(
      { url: "/__workbench_hmr_state" },
      {
        setHeader(name, value) {
          headers[name] = value;
        },
        end(value) {
          body = value;
        },
        statusCode: 0,
      },
      () => assert.fail("state endpoint fell through"),
    );
    return { headers, body: JSON.parse(body) };
  };

  const before = readState();
  plugin.handleHotUpdate();
  const after = readState();
  assert.equal(before.headers["cache-control"], "no-store");
  assert.equal(before.body.instanceId, after.body.instanceId);
  assert.equal(after.body.revision, before.body.revision + 1);
});

test("unsupported Vite client changes fail closed", () => {
  const plugin = viteDocumentContinuity();
  assert.throws(
    () => plugin.transform("const client = true;", clientPath),
    /Vite reconnect contract changed/,
  );
});
