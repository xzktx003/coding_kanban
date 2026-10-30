import { createRequire } from "node:module";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Json, JsonObject } from "../../../packages/session-runtime/src/core/json";

export const RUNTIME_INSTANCE = "feedback-r21-fixture";
export const ACCOUNT_RESPONSE = {
  account: { type: "apiKey" },
  requiresOpenaiAuth: false,
} as const;

// Factory only: discovery imports this declaration without constructing any runtime.
export async function createRuntimePreflightFixture(thread: JsonObject) {
  const localRequire = createRequire(resolve(process.cwd(), "packages/session-runtime/package.json"));
  const Fastify = localRequire("fastify") as typeof import("../../../packages/session-runtime/node_modules/fastify");
  const [{ registerCodexRoutes }, { CodexService }, { EventHub }] = await Promise.all([
    import("../../../packages/session-runtime/src/codex/routes"),
    import("../../../packages/session-runtime/src/codex/client"),
    import("../../../packages/session-runtime/src/core/events"),
  ]);
  if (thread.id !== "ux-0" || typeof thread.cwd !== "string")
    throw new Error("R21 runtime fixture requires the exact synthetic ux-0 metadata");
  const app = Fastify({ logger: false });
  const service = new CodexService({ hub: new EventHub(), instance: RUNTIME_INSTANCE, env: {}, sweepIntervalMs: 0 });
  const rawCalls: Array<{ method: string; params: Json }> = [];
  const forbidden: Array<{ channel: string; method: string; params: Json }> = [];
  const injections: Array<{ path: string; body: Json; status: number; response: unknown }> = [];
  let closed = false;
  const refuse = (channel: string, method: string, params: Json): never => {
    forbidden.push({ channel, method, params });
    throw new Error("R21 fixture rejects non-contract RPC: " + channel + ":" + method);
  };
  const raw = async (method: string, params: Json): Promise<Json> => {
    rawCalls.push({ method, params: structuredClone(params) });
    let expected: Json;
    let response: Json;
    if (method === "account/read") {
      expected = { refreshToken: false };
      response = structuredClone(ACCOUNT_RESPONSE);
    } else if (method === "thread/read") {
      expected = { threadId: "ux-0", includeTurns: false };
      const { turns: _turns, ...metadata } = thread;
      response = { thread: metadata };
    } else if (method === "config/read") {
      expected = { cwd: thread.cwd, includeLayers: false };
      // A complete, successful native effective config snapshot with no explicit feedback override.
      response = { config: {} };
    } else if (method === "configRequirements/read") {
      expected = null;
      response = { requirements: null };
    } else return refuse("raw", method, params);
    if (!isDeepStrictEqual(params, expected)) return refuse("raw-params", method, params);
    return structuredClone(response);
  };
  Object.assign(service, {
    raw,
    // Ownership captured the original raw at construction: no call/ownership path may run.
    call: async (method: string, params: Json) => refuse("writer-call", method, params),
  });
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "POST" || request.url !== "/api/codex/feedback/preflight")
      return reply.code(409).send({ error: "R21 inject accepts only its read-only preflight route" });
  });
  registerCodexRoutes(app, service);
  return {
    accountResponse: ACCOUNT_RESPONSE,
    rawCalls, forbidden, injections,
    async inject(body: Json) {
      if (closed) throw new Error("R21 preflight fixture is closed");
      const response = await app.inject({ method: "POST", url: "/api/codex/feedback/preflight", payload: body });
      let json: unknown;
      try { json = response.json(); } catch { json = { unparsedBody: response.body }; }
      injections.push({ path: "/api/codex/feedback/preflight", body: structuredClone(body), status: response.statusCode, response: json });
      // Return the unmodified actual runtime handler bytes, including a baseline 404.
      return { status: response.statusCode, contentType: String(response.headers["content-type"] ?? "application/json"), body: response.body };
    },
    snapshot() {
      return { instance: RUNTIME_INSTANCE, closed, listening: app.server.listening,
        ownershipIds: service.ownership.ids(), rawCalls: structuredClone(rawCalls),
        forbidden: structuredClone(forbidden), injections: structuredClone(injections) };
    },
    async close() {
      const errors: string[] = [];
      try { await app.close(); } catch (error) { errors.push("app.close: " + String(error)); }
      try { await service.close(); } catch (error) { errors.push("service.close: " + String(error)); }
      closed = errors.length === 0;
      return { ...this.snapshot(), errors };
    },
  };
}
