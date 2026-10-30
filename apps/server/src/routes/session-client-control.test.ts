import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerSessionClientControlRoutes } from "./session-client-control.js";
import type { SessionManagement } from "../services/session-management.js";

function fixture(change: "none" | "namespace" | "scope") {
  let snapshots = 0,
    contexts = 0;
  const paths: string[] = [];
  return {
    paths,
    options: {
      origin: () => "http://127.0.0.1:1",
      management: {
        snapshot: async () => ({
          namespaces: {
            codex: change === "namespace" && snapshots++ ? "other" : "expected",
          },
        }),
      } as unknown as SessionManagement,
      write: async <T>(_id: string, work: () => Promise<T>) => work(),
      fetch: (async (url, init) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);
        if (path === "/api/internal/codex/operation-context") {
          const late = ++contexts > 2 && change === "scope";
          return new Response(
            JSON.stringify({
              scope: late ? "changed" : "scope",
              namespace: "native-account",
            }),
          );
        }
        const body = JSON.parse(String(init?.body));
        assert.equal(body.threadId, "a");
        return new Response(
          JSON.stringify(
            path.endsWith("metadata")
              ? {
                  thread: { id: "a" },
                  readState: { revision: "opaque-revision" },
                }
              : {
                  data: [{ id: "seen", status: "completed" }],
                  nextCursor: null,
                },
          ),
        );
      }) as typeof fetch,
    },
  };
}

for (const change of ["none", "namespace", "scope"] as const) {
  test(`read-context checks the caller namespace again after bounded native verification (${change})`, async (t) => {
    const app = Fastify(),
      f = fixture(change);
    registerSessionClientControlRoutes(app, f.options);
    t.after(() => app.close());
    const response = await app.inject({
      url: "/api/session/management/read-context?threadId=a&replyId=seen&namespace=expected",
    });
    assert.equal(response.statusCode, change === "none" ? 200 : 409);
    assert.ok(f.paths.every((path) => !/resume|turn\/start/.test(path)));
    if (change === "none")
      assert.deepEqual(response.json(), {
        scope: "scope",
        revision: "opaque-revision",
        replyId: "seen",
      });
  });
}
