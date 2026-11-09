import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";

const require = createRequire(import.meta.url);
const { adaptNativeAppChunk } = require("../src/native-app-policy.cjs");
const { adaptNativeHostChunk } = require("../src/native-host-policy.cjs");
const {
  adaptProjectFolderPickerChunk,
} = require("../src/project-folder-picker-policy.cjs");
const {
  adaptDynamicToolsChunk,
  PATCHES,
} = require("../src/dynamic-tools-routing.cjs");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originalPath = process.env.CHATGPT_DESKTOP_TEST_NATIVE_CHUNK;

test("native app policy refuses unpinned and already adapted source", () => {
  for (const body of [
    undefined,
    "",
    Buffer.alloc(0),
    Buffer.from("different version"),
  ]) {
    assert.throws(() => adaptNativeAppChunk({ body, skipVerification: true }), {
      code: "NATIVE_APP_POLICY_DIGEST_MISMATCH",
    });
  }
});

test(
  "native app composition retains folder and host policies and adds only both verified dynamic tools routes",
  {
    skip:
      !originalPath &&
      "Requires the explicitly supplied original native member",
  },
  async () => {
    const original = await readFile(originalPath),
      before = Buffer.from(original);
    const host = adaptNativeHostChunk({ body: original });
    const picker = adaptProjectFolderPickerChunk({ body: original });
    const dynamic = adaptDynamicToolsChunk({ body: original });
    const result = adaptNativeAppChunk({ body: original });
    assert.equal(result.nativeHostSha256, host.adaptedSha256);
    assert.equal(result.projectPickerSha256, picker.adaptedSha256);
    assert.equal(result.dynamicToolsSha256, dynamic.adaptedSha256);
    assert.equal(
      result.adaptedSha256,
      "0a0c317cca8e59ae237a68e2485e4697dade5589678143aa2bfb82aeae5cf782",
    );
    assert.equal(hash(result.body), result.adaptedSha256);
    let expected = picker.body.toString("utf8");
    for (const [old, next] of PATCHES) {
      assert.equal(expected.indexOf(old), expected.lastIndexOf(old));
      assert.ok(expected.includes(old));
      expected = expected.replace(old, next);
    }
    assert.equal(result.body.toString("utf8"), expected);
    assert.deepEqual(original, before);
    assert.throws(() => adaptNativeAppChunk({ body: result.body }), {
      code: "NATIVE_APP_POLICY_DIGEST_MISMATCH",
    });
    new Script(result.body.toString("utf8"));
  },
);
