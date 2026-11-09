"use strict";

// This adapter applies only to the pinned Linux native chunk. The upstream
// ASAR is unchanged; both patches are checked for a unique exact target.
const { AsyncLocalStorage } = require("node:async_hooks");
const { createHash } = require("node:crypto");
const { types: { isPromise } } = require("node:util");
const { adaptCodexNativeChunk } = require("./codex-surface-policy.cjs");
const POLICY_SHA256 = "f8fa2affe8e3ddfc04e36548afb9a7fd9c2bf5c851959904f3231aedfd90815e";
const ADAPTED_SHA256 = "007f0a854dd57f5e25e8b62abe4321e4d1cdf12622a1902a983206ce418fc960";
const digest = (body) => createHash("sha256").update(body).digest("hex");
const failure = () => Object.assign(new Error("Private project routing unavailable"), { code: "PROJECT_CONSENT_PATCH_MISMATCH" });
const patches = Object.freeze([
  [
    'let u=ea.BrowserWindow.getFocusedWindow(),h=null!=u&&this.#iO.has(u.webContents.id)?u:await this.ensureWindow();',
    'let z=globalThis.__kanbanSelectConsentWindow(),u=void 0===z?ea.BrowserWindow.getFocusedWindow():null,h=void 0!==z?z:null!=u&&this.#iO.has(u.webContents.id)?u:await this.ensureWindow();',
  ],
  [
    'projects:this.projectsManager,projectChatGptProvisioning:',
    'projects:globalThis.__kanbanBindProjects(this.projectsManager,e),projectChatGptProvisioning:',
  ],
]);

function adaptProjectConsentChunk({ body } = {}) {
  const base = adaptCodexNativeChunk({ body });
  if (base.adaptedSha256 !== POLICY_SHA256) throw failure();
  let source = base.body.toString("utf8");
  for (const [before, after] of patches) {
    const index = source.indexOf(before);
    if (index < 0 || index !== source.lastIndexOf(before)) throw failure();
    source = source.slice(0, index) + after + source.slice(index + before.length);
  }
  const adapted = Buffer.from(source, "utf8");
  if (digest(adapted) !== ADAPTED_SHA256) throw failure();
  return { body: adapted, originalSha256: base.originalSha256, codexPolicySha256: POLICY_SHA256, adaptedSha256: ADAPTED_SHA256 };
}

function createProjectConsentRouter({ getRecord, getOwnedRecord }) {
  if (typeof getRecord !== "function" || typeof getOwnedRecord !== "function") throw failure();
  const scope = new AsyncLocalStorage();
  function selectWindow() {
    const context = scope.getStore();
    if (!context) return undefined;
    // An async descendant can outlive its request. It is still a private
    // request, but no longer has authority to select any window.
    if (!context.active) return null;
    const record = context.record;
    try {
      if (getRecord(record.senderId) !== record || record.failed ||
          record.window.isDestroyed() || record.window.webContents.isDestroyed()) return null;
      return record.window;
    } catch { return null; }
  }
  function bindProjects(projects, sender) {
    // Retain a weak identity for a retired sender as well: its late AppHost
    // must fail closed rather than becoming an ordinary unscoped service.
    const record = sender && getOwnedRecord(sender);
    if (!record) return projects;
    if (!projects || typeof projects !== "object" || record.window.webContents !== sender) throw failure();
    const methods = new Map();
    return new Proxy(projects, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function" || key === "constructor") return value;
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (descriptor && descriptor.configurable === false && descriptor.writable === false) throw failure();
        const previous = methods.get(key);
        if (previous?.value === value) return previous.bound;
        const bound = function (...args) {
          const context = { record, active: true };
          let result;
          try { result = scope.run(context, () => Reflect.apply(value, target, args)); }
          catch (error) { context.active = false; throw error; }
          if (isPromise(result))
            void Promise.prototype.then.call(result, () => { context.active = false; }, () => { context.active = false; });
          else context.active = false;
          return result;
        };
        methods.set(key, { value, bound });
        return bound;
      },
    });
  }
  return Object.freeze({ bindProjects, selectWindow });
}

module.exports = { adaptProjectConsentChunk, createProjectConsentRouter };
