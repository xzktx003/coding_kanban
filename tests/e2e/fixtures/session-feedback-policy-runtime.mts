import { createRequire } from "node:module";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Json, JsonObject } from "../../../packages/session-runtime/src/core/json";
export const ACCOUNT = { account: { type: "apiKey" }, requiresOpenaiAuth: false } as const;
export const INSTANCE = "feedback-r21-policy-fixture";
export const variants = ["requirements-deny", "project-deny", "submit-deny", "endpoint-503", "malformed", "deferred-switch", "deferred-aba", "deferred-hidden", "deferred-other-dialog", "submit-logs-on", "submit-unknown-logs-off"] as const;
export type Variant = (typeof variants)[number];

export async function createPolicyRuntime(thread: JsonObject, variant: Variant) {
  const localRequire = createRequire(resolve(process.cwd(), "packages/session-runtime/package.json"));
  const Fastify = localRequire("fastify") as typeof import("../../../packages/session-runtime/node_modules/fastify");
  const [{ registerCodexRoutes }, { CodexService }, { EventHub }] = await Promise.all([
    import("../../../packages/session-runtime/src/codex/routes"),
    import("../../../packages/session-runtime/src/codex/client"),
    import("../../../packages/session-runtime/src/core/events"),
  ]);
  if (thread.id !== "ux-0" || typeof thread.cwd !== "string") throw Error("Expected exact synthetic ux-0 metadata");
  const rawCalls: Array<{ method: string; params: Json; phase: number }> = [];
  const forbidden: Array<{ method: string; params: Json }> = [];
  const injections: Array<{ path: string; body: Json; status: number; response: unknown; wireStatus: number; wireBody: string }> = [];
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const state = { projectEnabled: variant !== "project-deny", globalEnabled: true, requirementsEnabled: variant !== "requirements-deny", holdSeen: false, released: !variant.startsWith("deferred-"), phase: 0, armedUpload: null as Json, uploads: [] as Json[] };
  const deny = (method: string, params: Json): never => { forbidden.push({ method, params }); throw Error("R21 policy rejects non-contract RPC: " + method); };
  const raw = async (method: string, params: Json): Promise<Json> => {
    rawCalls.push({ method, params: structuredClone(params), phase: state.phase });
    if (method === "account/read") {
      if (!isDeepStrictEqual(params, { refreshToken: false })) return deny(method, params);
      return structuredClone(ACCOUNT);
    }
    if (method === "thread/read") {
      if (!isDeepStrictEqual(params, { threadId: "ux-0", includeTurns: false })) return deny(method, params);
      const { turns: _turns, ...metadata } = thread;
      return { thread: structuredClone(metadata) };
    }
    if (method === "config/read") {
      const project = isDeepStrictEqual(params, { cwd: thread.cwd, includeLayers: false });
      const global = isDeepStrictEqual(params, { cwd: null, includeLayers: false });
      if (!project && !global) return deny(method, params);
      const enabled = project ? state.projectEnabled : state.globalEnabled;
      if (!state.released) { state.holdSeen = true; await gate; }
      return { config: { feedback: { enabled } } };
    }
    if (method === "configRequirements/read") {
      if (params !== null) return deny(method, params);
      return { requirements: { feedback: { enabled: state.requirementsEnabled } } };
    }
    if (method === "feedback/upload") {
      if (!state.armedUpload || !isDeepStrictEqual(params, state.armedUpload) || state.uploads.length) return deny(method, params);
      state.uploads.push(structuredClone(params));
      if (variant === "submit-unknown-logs-off") throw Error("R21 fixture delivery outcome is unknown");
      return { threadId: "r21-policy-feedback-receipt" };
    }
    return deny(method, params);
  };
  const app = Fastify({ logger: false });
  const service = new CodexService({ hub: new EventHub(), instance: INSTANCE, env: {}, sweepIntervalMs: 0,
    feedbackPreflight: { timeoutMs: 6000, fetch: async () => deny("forbidden-workspace-http", null) } });
  Object.assign(service, { raw, call: async (method: string, params: Json) => method === "feedback/upload" ? raw(method, params) : deny("writer-call:" + method, params) });
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "POST" || !["/api/codex/feedback/preflight", "/api/codex/feedback/upload"].includes(request.url))
      return reply.code(409).send({ error: "Only explicit fixture preflight/upload may use inject" });
  });
  registerCodexRoutes(app, service);
  let closed = false;
  return {
    state, rawCalls, forbidden, injections,
    release: () => { state.released = true; release(); },
    armUpload: (payload: Json) => { state.armedUpload = structuredClone(payload); },
    async inject(path: string, body: Json) {
      if (closed) throw Error("Policy runtime is closed");
      const response = await app.inject({ method: "POST", url: path, payload: body });
      let data: unknown; try { data = response.json(); } catch { data = { unparsed: response.body }; }
      const preflight = path.endsWith("/preflight");
      // Explicit gateway faults preserve the real handler result in evidence; no reason is fabricated.
      const status = preflight && variant === "endpoint-503" ? 503 : response.statusCode;
      const wireBody = preflight && variant === "malformed" ? response.body.slice(0, 1) : response.body;
      injections.push({ path, body: structuredClone(body), status: response.statusCode, response: data, wireStatus: status, wireBody });
      return { status, contentType: String(response.headers["content-type"] ?? "application/json"), body: wireBody };
    },
    snapshot() { return { instance: INSTANCE, closed, listening: app.server.listening, ownershipIds: service.ownership.ids(), state: structuredClone(state), rawCalls: structuredClone(rawCalls), forbidden: structuredClone(forbidden), injections: structuredClone(injections) }; },
    async close() {
      state.released = true; release();
      const errors: string[] = [];
      try { await app.close(); } catch (error) { errors.push(String(error)); }
      try { await service.close(); } catch (error) { errors.push(String(error)); }
      closed = !errors.length;
      return { ...this.snapshot(), errors };
    },
  };
}
