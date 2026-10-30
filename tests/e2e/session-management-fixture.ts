import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { registerSessionManagementRoutes } from "../../apps/server/src/routes/session-management";
import { registerSessionClientControlRoutes } from "../../apps/server/src/routes/session-client-control";

const Fastify = createRequire(
  new URL("../../apps/server/package.json", pathToFileURL(__filename)),
)("fastify");

type FixtureThread = {
  id: string;
  turns?: any[];
  [key: string]: unknown;
};
type FixtureRequest = { method: string; url: string; body?: unknown };

/** An isolated protocol fixture, not evidence of real native authorization. */
export async function createSessionManagementFixture(options: {
  threads: () => FixtureThread[];
  context: { scopeToken: string; namespace: string };
}) {
  // Use the same Playwright module format as the queue fixtures. Mixing dynamic
  // ESM and transformed CommonJS imports can split their shared server modules.
  const app = Fastify();
  const nativeOrigin = "http://session-management-fixture.invalid";
  const readEpochs = new Map<string, number>();

  const reject = (statusCode: number, message: string): never => {
    throw Object.assign(new Error(message), { statusCode });
  };
  const object = (value: unknown, keys: string[]) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return reject(400, "Fixture native request must be an object");
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some((key) => !keys.includes(key)))
      return reject(400, "Unexpected fixture native request field");
    return body;
  };
  const findThread = (value: unknown) => {
    if (typeof value !== "string" || !value || value.length > 512)
      return reject(400, "Invalid fixture native thread identity");
    const thread = options.threads().find((thread) => thread.id === value);
    if (!thread) return reject(404, "Fixture native thread does not exist");
    return thread;
  };
  const epochKey = (thread: FixtureThread) =>
    JSON.stringify([options.context.namespace, thread.id]);
  const revision = (thread: FixtureThread) => {
    const turn = thread.turns?.at(-1);
    return createHash("sha256")
      .update(JSON.stringify([
        options.context.namespace,
        thread.id,
        turn?.id ?? null,
        turn?.status ?? null,
        readEpochs.get(epochKey(thread)) ?? 0,
      ]))
      .digest("hex");
  };

  const nativeCall = (method: string, path: string, value?: unknown) => {
    if (method === "GET" && path === "/api/internal/codex/operation-context") {
      if (value !== undefined)
        return reject(400, "Fixture operation context does not accept a body");
      return {
        scope: options.context.scopeToken,
        namespace: options.context.namespace,
      };
    }
    if (method === "POST" && path === "/api/codex/thread/metadata") {
      const body = object(value, ["threadId"]);
      const thread = findThread(body.threadId);
      return {
        thread: { id: thread.id, status: thread.status ?? { type: "idle" } },
        readState: { revision: revision(thread) },
      };
    }
    if (method === "POST" && path === "/api/codex/thread/turns/list") {
      const body = object(value, ["threadId", "limit", "sortDirection", "itemsView"]);
      const thread = findThread(body.threadId);
      if (body.limit !== 1 || body.sortDirection !== "desc" || body.itemsView !== "notLoaded")
        return reject(400, "Fixture native history permits only latest-turn metadata");
      const last = thread.turns?.at(-1);
      if (!last) return { data: [], nextCursor: null };
      const { items: _items, ...metadata } = last;
      return { data: [metadata], nextCursor: null };
    }
    if (method === "POST" && path === "/api/internal/codex/guarded-read-state") {
      const body = object(value, ["threadId", "expectedScope", "expectedRevision", "operation"]);
      const thread = findThread(body.threadId);
      if (body.operation !== "read" && body.operation !== "unread")
        return reject(400, "Invalid fixture native read operation");
      if (body.expectedScope !== options.context.scopeToken || body.expectedRevision !== revision(thread))
        return reject(409, "Fixture native scope or read revision changed");
      const key = epochKey(thread);
      readEpochs.set(key, (readEpochs.get(key) ?? 0) + 1);
      return { readState: { revision: revision(thread) } };
    }
    return reject(404, "Unknown fixture native endpoint");
  };

  const nativeFetch: typeof fetch = async (input, init) => {
    try {
      if (init?.signal?.aborted)
        throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.origin !== nativeOrigin || url.search || url.hash)
        return new Response(JSON.stringify({ error: "Unknown fixture native origin or query" }), { status: 404 });
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (init?.body !== undefined && typeof init.body !== "string")
        return new Response(JSON.stringify({ error: "Fixture native body must be JSON" }), { status: 400 });
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      return new Response(JSON.stringify(nativeCall(method, url.pathname, body)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Fixture native request failed" }), {
        status: error instanceof SyntaxError ? 400 : (error as { statusCode?: number }).statusCode ?? 500,
        headers: { "content-type": "application/json" },
      });
    }
  };

  const management = registerSessionManagementRoutes(app, {
    accountScope: async () => options.context.namespace,
    verifyTarget: async (target) => {
      if (target.kind === "codex") findThread(target.id);
    },
    nativeRead: async (target, expectedRevision, operation, expectedScope) => {
      nativeCall("POST", "/api/internal/codex/guarded-read-state", {
        threadId: target.id,
        expectedRevision,
        operation,
        expectedScope,
      });
    },
  });
  registerSessionClientControlRoutes(app, {
    origin: () => nativeOrigin,
    fetch: nativeFetch,
    management,
    write: async () => reject(404, "Fixture does not permit native execution writes"),
  });

  return {
    async handle(request: FixtureRequest): Promise<{ status: number; body: string }> {
      const url = new URL(request.url, nativeOrigin);
      const method = request.method.toUpperCase();
      const allowed = url.pathname === "/api/session/management"
        ? method === "GET" || method === "POST"
        : url.pathname === "/api/session/management/read-context" && method === "GET";
      if (!allowed)
        return { status: 404, body: JSON.stringify({ error: "Unknown fixture management endpoint" }) };
      const response = await app.inject({
        method,
        url: url.pathname + url.search,
        ...(request.body !== undefined ? { payload: request.body } : {}),
      });
      return { status: response.statusCode, body: response.body };
    },
    async close() {
      await app.close();
      readEpochs.clear();
    },
  };
}
