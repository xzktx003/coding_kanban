"use strict";

// This policy applies only to the reviewed, newly prepared Linux host. It is
// compiled in memory and never changes the upstream ASAR or executable.
const { createHash } = require("node:crypto");
const ORIGINAL_SHA256 = "c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333";
const failure = (code, message) => Object.assign(new Error(message), { code });
const unsupported = 'throw Object.assign(new Error("Work executor is unsupported in this Codex surface"),{code:"WORK_EXECUTOR_UNSUPPORTED"});';
const patches = Object.freeze([
  [
    'async clearRegistrations(){if(this.clearingRegistrations)',
    'async clearRegistrations(){' + unsupported + 'if(this.clearingRegistrations)',
  ],
  [
    '}setDisplayName(e){let t=e.trim();',
    '}setDisplayName(e){' + unsupported + 'let t=e.trim();',
  ],
  [
    'async setAuthorization(e){let t,r=this.authorizationRevision;',
    'async setAuthorization(e){if(e?.enabled)' + unsupported + 'let t,r=this.authorizationRevision;',
  ],
  [
    '}setEnabled(e,t="disabled"){return e?this.start():',
    '}setEnabled(e,t="disabled"){if(e)' + unsupported + 'return e?this.start():',
  ],
  [
    '}start(){if(this.clearingRegistrations||',
    '}start(){' + unsupported + 'if(this.clearingRegistrations||',
  ],
  [
    '}restart(){return this.disposed||!this.enabled?Promise.resolve():(this.stop("planned_restart"),this.start())}',
    '}restart(){if(this.enabled)' + unsupported + 'return this.disposed||!this.enabled?Promise.resolve():(this.stop("planned_restart"),this.start())}',
  ],
]);
const digest = body => createHash("sha256").update(body).digest("hex");

function assertCodexOnlyEnvironment(env) {
  if (!env || typeof env !== "object") throw failure("CODEX_POLICY_INVALID", "Environment is required");
  if (env.CODEX_TPP_LOCAL_EXECUTOR_ENABLED === "1") throw failure("WORK_EXECUTOR_UNSUPPORTED", "Work executor cannot be enabled for this Codex surface");
}

function adaptCodexNativeChunk({ body } = {}) {
  if (!Buffer.isBuffer(body) || digest(body) !== ORIGINAL_SHA256) throw failure("CODEX_POLICY_DIGEST_MISMATCH", "Unsupported native application chunk");
  let source;
  try { source = new TextDecoder("utf-8", { fatal:true }).decode(body); }
  catch { throw failure("CODEX_POLICY_PATCH_MISMATCH", "Native application chunk is not UTF-8"); }
  for (const [before, after] of patches) {
    const first = source.indexOf(before);
    if (first < 0 || first !== source.lastIndexOf(before)) throw failure("CODEX_POLICY_PATCH_MISMATCH", "Native executor patch target differs");
    source = source.slice(0, first) + after + source.slice(first + before.length);
  }
  const adapted = Buffer.from(source, "utf8");
  return { body:adapted, originalSha256:ORIGINAL_SHA256, adaptedSha256:digest(adapted) };
}
module.exports = { adaptCodexNativeChunk, assertCodexOnlyEnvironment };
