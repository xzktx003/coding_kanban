import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  shouldDeferWorkbenchHotMessage,
  viteChatgptDocumentContinuity,
} from "./vite-chatgpt-document-continuity.mjs";

const clientPath = resolve("apps/web/node_modules/vite/dist/client/client.mjs");
const clientSource = await readFile(clientPath, "utf8");

test("only standalone CSS updates pass the protected document", () => {
  assert.equal(shouldDeferWorkbenchHotMessage({ type: "connected" }), false);
  assert.equal(shouldDeferWorkbenchHotMessage({ type: "full-reload" }), true);
  assert.equal(
    shouldDeferWorkbenchHotMessage({
      type: "update",
      updates: [{ type: "css-update" }],
    }),
    false,
  );
  assert.equal(
    shouldDeferWorkbenchHotMessage({
      type: "update",
      updates: [{ type: "js-update" }],
    }),
    true,
  );
  assert.equal(
    shouldDeferWorkbenchHotMessage({
      type: "update",
      updates: [{ type: "css-update" }, { type: "js-update" }],
    }),
    true,
  );
  assert.equal(
    shouldDeferWorkbenchHotMessage({
      type: "update",
      updates: [{ type: "unknown" }],
    }),
    true,
  );
  assert.equal(
    shouldDeferWorkbenchHotMessage({ type: "update", updates: [] }),
    true,
  );
  assert.equal(shouldDeferWorkbenchHotMessage({ type: "update" }), true);
  assert.equal(
    shouldDeferWorkbenchHotMessage({ type: "prune", paths: [] }),
    true,
  );
});

test("the opt-in plugin guards before module execution and retains existing continuity", () => {
  const plugin = viteChatgptDocumentContinuity();
  const code = plugin.transform(clientSource, clientPath).code;
  assert.equal(plugin.apply, "serve");
  assert.match(code, /shouldDeferWorkbenchHotMessage/);
  assert.ok(
    code.indexOf("shouldDeferWorkbenchHotMessage") <
      code.indexOf("await handleMessage(payload)"),
  );
  assert.match(code, /workbench-update-available/);
  assert.match(code, /state\.revision !== workbenchHmrRevision/);
  assert.match(code, /case "update":\s*if \(workbenchUpdatePending\) return/);
  assert.doesNotMatch(code, /location\.reload\(\)/);
  assert.equal(
    plugin.transform("export default 1", "/tmp/unrelated.js"),
    undefined,
  );
});

test("an unsupported Vite client fails closed", () => {
  assert.throws(
    () =>
      viteChatgptDocumentContinuity().transform(
        "const client = true;",
        clientPath,
      ),
    /Vite reconnect contract changed/,
  );
});
