"use strict";

const { createHash } = require("node:crypto");
const {
  adaptProjectFolderPickerChunk,
} = require("./project-folder-picker-policy.cjs");
const {
  adaptDynamicToolsChunk,
  PATCHES,
} = require("./dynamic-tools-routing.cjs");
const ORIGINAL =
  "c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333";
const HOST = "9714f7b4288b3f1df2654b5d215cbf026c05d7b7530bd86dd9f383f938e5422c";
const PICKER =
  "36420b1fcaa514db5d9d22dc1e30fda1a17883f0f66cc9c64ffabe8fe322c30f";
const DYNAMIC =
  "362690aa7cebb9bcdf64a4037cfb6fe1e1ab09b2f4a547db67059502bd963c70";
const COMBINED =
  "0a0c317cca8e59ae237a68e2485e4697dade5589678143aa2bfb82aeae5cf782";
const digest = (body) => createHash("sha256").update(body).digest("hex");
const failure = (code) =>
  Object.assign(new Error("Native application policy unsupported"), { code });

/** Validate both adapters against the same original before composing their edits. */
function adaptNativeAppChunk({ body } = {}) {
  if (!Buffer.isBuffer(body) || digest(body) !== ORIGINAL)
    throw failure("NATIVE_APP_POLICY_DIGEST_MISMATCH");
  const picker = adaptProjectFolderPickerChunk({ body }),
    dynamic = adaptDynamicToolsChunk({ body });
  if (
    picker.nativeHostSha256 !== HOST ||
    picker.adaptedSha256 !== PICKER ||
    dynamic.adaptedSha256 !== DYNAMIC
  )
    throw failure("NATIVE_APP_POLICY_PATCH_MISMATCH");
  let source = picker.body.toString("utf8");
  for (const [before, after] of PATCHES) {
    const at = source.indexOf(before);
    if (at < 0 || at !== source.lastIndexOf(before))
      throw failure("NATIVE_APP_POLICY_PATCH_MISMATCH");
    source = source.slice(0, at) + after + source.slice(at + before.length);
  }
  const adapted = Buffer.from(source, "utf8");
  if (digest(adapted) !== COMBINED)
    throw failure("NATIVE_APP_POLICY_PATCH_MISMATCH");
  return {
    ...picker,
    body: adapted,
    adaptedSha256: COMBINED,
    nativeHostSha256: HOST,
    projectPickerSha256: PICKER,
    dynamicToolsSha256: DYNAMIC,
  };
}

module.exports = { adaptNativeAppChunk };
