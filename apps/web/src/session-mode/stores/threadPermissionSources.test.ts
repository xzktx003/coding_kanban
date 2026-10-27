import { afterEach, beforeEach, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createThreadModelController, type ThreadModelEntry } from "./useThreadModelStore";
import { followupParameters } from "../services/followupService";
let factory: IDBFactory;
let clients: ReturnType<typeof createThreadModelController>[];
beforeEach(() => { factory = new IDBFactory(); clients = []; });
afterEach(async () => { await Promise.all(clients.map(c => c.persistence.close())); });
function client(legacy: () => Record<string, ThreadModelEntry> = () => ({})) {
  const c = createThreadModelController({ indexedDB: factory, databaseName: "permission-sources", connectEvents: false, legacy });
  clients.push(c); return c;
}
async function parameters(c: ReturnType<typeof client>) {
  const capture = c.capture("a"); await c.flush("a", capture);
  return followupParameters("a", capture.settings);
}
const full = { sandbox: "danger-full-access", sandboxPolicy: null, approvalPolicy: "never" } as const;
it.each(["unknown", "model-only", "legacy"])("does not override native permissions for %s settings", async kind => {
  const c = client((): Record<string, ThreadModelEntry> => kind === "legacy" ? { a: { model: "legacy", modelProvider: "openai", reasoningEffort: null, providerModels: {}, sandbox: "danger-full-access", approvalPolicy: "never", revision: 0, pending: false } } : {});
  await c.persistence.ensure("a");
  if (kind === "model-only") { c.hydrate("a", { model: "native" }); await c.flush("a"); }
  const p = await parameters(c);
  expect(p).not.toHaveProperty("approvalPolicy"); expect(p).not.toHaveProperty("sandboxPolicy"); expect(p).not.toHaveProperty("approvalsReviewer");
});
it("persists an explicit same-value full-access choice, including a separately chosen user reviewer, without a model", async () => {
  const a = client(); await a.persistence.ensure("a"); a.change("a", full); a.change("a", { approvalsReviewer: "user" }); await a.flush("a");
  expect(a.store.getState().threads.a.pendingFields).toEqual(expect.arrayContaining(["sandbox", "approvalPolicy", "approvalsReviewer"]));
  const b = client(); await b.persistence.ensure("a");
  expect(await parameters(b)).toMatchObject({ model: null, approvalPolicy: "never", approvalsReviewer: "user", sandboxPolicy: { type: "dangerFullAccess" } });
});
it("keeps an explicit restrictive no-model choice", async () => {
  const a = client(); await a.persistence.ensure("a"); a.change("a", { sandbox: "read-only", sandboxPolicy: null, approvalPolicy: "on-request" }); await a.flush("a");
  expect(await parameters(a)).toMatchObject({ model: null, approvalPolicy: "on-request", sandboxPolicy: { type: "readOnly", networkAccess: false } });
});
it("preserves modern persisted native fields but does not invent a reviewer", async () => {
  const native = { model: "native", approvalPolicy: "on-request", sandbox: "read-only", sandboxPolicy: { type: "readOnly", networkAccess: true }, webSearchRequest: true } as const;
  const c = client(() => ({ a: { ...native, modelProvider: "openai", reasoningEffort: null, providerModels: {}, nativeSettings: native, revision: 0, pending: false } }));
  await c.persistence.ensure("a"); const p = await parameters(c);
  expect(p).toMatchObject({ approvalPolicy: "on-request", sandboxPolicy: native.sandboxPolicy }); expect(p).not.toHaveProperty("approvalsReviewer");
});
it("a sparse model ACK cannot erase the pending same-value full-access intent", async () => {
  const c = client(); await c.persistence.ensure("a"); c.hydrate("a", { model: "native" }); await c.flush("a");
  c.change("a", full); await c.flush("a"); c.hydrate("a", { model: "native" }, {}, "ack"); await c.flush("a");
  expect(c.store.getState().threads.a.pending).toBe(true);
  expect(await parameters(c)).toMatchObject({ approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } });
});
it("captures source identity so another page's same-value choice cannot be silently omitted", async () => {
  const a = client(), b = client(); await a.persistence.ensure("a"); await b.persistence.ensure("a");
  b.change("a", { approvalPolicy: "never" }); await b.flush("a");
  const capture = a.capture("a"); await expect(a.flush("a", capture)).rejects.toMatchObject({ kind: "changed" });
});
it("keeps the captured permission prefix while a later edit changes the mode", async () => {
  const c = client(); await c.persistence.ensure("a"); c.change("a", full);
  const capture = c.capture("a"); c.change("a", { sandbox: "read-only", sandboxPolicy: null, approvalPolicy: "on-request" });
  await c.flush("a", capture); await c.flush("a");
  expect(followupParameters("a", capture.settings)).toMatchObject({ approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } });
  expect(await parameters(c)).toMatchObject({ approvalPolicy: "on-request", sandboxPolicy: { type: "readOnly" } });
});
it("does not manufacture a sandbox for a network-only edit on an unknown existing thread", async () => {
  const c = client(); await c.persistence.ensure("a"); c.change("a", { webSearchRequest: true }); await c.flush("a");
  await expect(parameters(c)).rejects.toThrow(/权限|沙箱/);
});
it("upgrades modern pending permission choices without assigning model-only edits permission provenance", async () => {
  const c = client(() => ({ a: {
    model: "local-model", modelProvider: "openai", reasoningEffort: null, providerModels: {},
    sandbox: "read-only", sandboxPolicy: null, approvalPolicy: "never", approvalsReviewer: "user", revision: 3, pending: true,
    pendingFields: ["model", "sandbox", "approvalPolicy"], nativeSettings: { model: "native", sandbox: "workspace-write", approvalPolicy: "on-request" },
  } }));
  await c.persistence.ensure("a"); const p = await parameters(c);
  expect(p).toMatchObject({ model: "local-model", approvalPolicy: "never", sandboxPolicy: { type: "readOnly", networkAccess: false } });
  expect(p).not.toHaveProperty("approvalsReviewer");
});
it("a modern model-only pending row has no inferred local permissions", async () => {
  const c = client(() => ({ a: { model: "local", modelProvider: "openai", reasoningEffort: null, providerModels: {}, sandbox: "danger-full-access", approvalPolicy: "never", revision: 1, pending: true, pendingFields: ["model"], nativeSettings: { model: "native" } } }));
  await c.persistence.ensure("a"); const p = await parameters(c);
  expect(p).not.toHaveProperty("approvalPolicy"); expect(p).not.toHaveProperty("sandboxPolicy");
});
it("applies a direct network-only edit to the exact complete policy without dropping custom roots", async () => {
  const c = client(); await c.persistence.ensure("a");
  c.hydrate("a", { model: "native", sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/fixture-authorized"], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } }); await c.flush("a");
  c.change("a", { webSearchRequest: true }); await c.flush("a");
  expect(await parameters(c)).toMatchObject({ sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/fixture-authorized"], networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true } });
});
it("retains explicit sources and captures across an in-flight HMR controller handoff", async () => {
  const a = client(); await a.persistence.ensure("a"); a.change("a", full); const capture = a.capture("a");
  a.persistence.suspend();
  const next = createThreadModelController({ indexedDB: factory, databaseName: "permission-sources", connectEvents: false, legacy: () => ({}) }, a); clients.push(next);
  await next.flush("a", capture);
  expect(followupParameters("a", capture.settings)).toMatchObject({ approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } });
  const reloaded = client(); await reloaded.persistence.ensure("a"); expect(await parameters(reloaded)).toMatchObject({ approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } });
});
it("does not acknowledge a same-value intent from a read started before that choice", async () => {
  const c = client(); await c.persistence.ensure("a"); c.hydrate("a", { model: "native" }); await c.flush("a"); const readToken = c.persistence.token("a");
  c.change("a", full); await c.flush("a"); c.hydrate("a", { model: "native", sandbox: "danger-full-access", approvalPolicy: "never" }, { readToken }, "ack"); await c.flush("a");
  expect(c.store.getState().threads.a.pending).toBe(true);
  expect(await parameters(c)).toMatchObject({ approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } });
});
it("keeps a no-prefix capture valid when a later local choice is queued while its read is pending", async () => {
  const c = client(); await c.persistence.ensure("a"); c.change("a", full); await c.flush("a");
  const capture = c.capture("a");
  c.change("a", { sandbox: "read-only", sandboxPolicy: null, approvalPolicy: "on-request" });
  await c.flush("a", capture); await c.flush("a");
  expect(followupParameters("a", capture.settings)).toMatchObject({ approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } });
  expect(await parameters(c)).toMatchObject({ approvalPolicy: "on-request", sandboxPolicy: { type: "readOnly" } });
});
it("does not reuse a previously selected local mode as provenance for a later mode-only native change", async () => {
  const c = client(); await c.persistence.ensure("a"); c.hydrate("a", { model: "native" }); await c.flush("a");
  c.change("a", full); await c.flush("a");
  c.hydrate("a", { model: "native", sandbox: "danger-full-access", approvalPolicy: "never" }, {}, "ack"); await c.flush("a");
  expect(c.store.getState().threads.a.pending).toBe(false);
  c.hydrate("a", { model: "native", sandbox: "workspace-write", approvalPolicy: "on-request" }); await c.flush("a");
  expect(await parameters(c)).not.toHaveProperty("sandboxPolicy");
});
it("retains an opaque old same-value full-access row but requires a fresh explicit confirmation to recover its lost source", async () => {
  const c = client(() => ({ a: { model: "", modelProvider: "openai", reasoningEffort: null, providerModels: {}, ...full, nativeSettings: {}, revision: 1, pending: true, pendingFields: [] } }));
  await c.persistence.ensure("a"); const before = await parameters(c);
  expect(before).not.toHaveProperty("approvalPolicy"); expect(before).not.toHaveProperty("sandboxPolicy");
  expect(c.store.getState().threads.a).toMatchObject({ ...full, pending: true });
  c.change("a", full); await c.flush("a");
  expect(await parameters(c)).toMatchObject({ approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } });
});
it("invalidates the old complete policy source when a network-only native update is actually applied", async () => {
  const c = client(); await c.persistence.ensure("a");
  c.hydrate("a", { model: "native", approvalPolicy: "on-request", sandboxPolicy: { type: "readOnly", networkAccess: false } }); await c.flush("a");
  c.hydrate("a", { model: "native", webSearchRequest: true }); await c.flush("a");
  expect(c.store.getState().threads.a.webSearchRequest).toBe(true);
  expect(await parameters(c)).not.toHaveProperty("sandboxPolicy");
});
it("persists the canonical permission sources actually applied by a late fork seed behind model-only pending", async () => {
  const c = client(); await c.persistence.ensure("a"); c.hydrate("a", { model: "initial" }); await c.flush("a");
  c.change("a", { model: "local" }); await c.flush("a");
  c.hydrate("a", { model: "newer-native", approvalPolicy: "untrusted", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly", networkAccess: false } }); await c.flush("a");
  c.hydrate("a", { model: "sparse-native" }); await c.flush("a");
  c.hydrate("a", { model: "old-fork", approvalPolicy: "never", approvalsReviewer: "auto_review", sandboxPolicy: { type: "dangerFullAccess" } }, { initialOnly: true }); await c.flush("a");
  const restored = client(); await restored.persistence.ensure("a");
  expect(await parameters(restored)).toMatchObject({ model: "local", approvalPolicy: "untrusted", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly", networkAccess: false } });
  expect(restored.store.getState().threads.a).toMatchObject({ pending: true, pendingFields: ["model"] });
});
