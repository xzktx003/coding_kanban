import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerSessionGitHunkRoutes } from "./session-git-hunks.js";
test("hunk routes accept only exact scopes and authoritative digests, never client patches or Git args", async t => {
  const app = Fastify(), calls: unknown[] = [];
  t.after(() => app.close());
  registerSessionGitHunkRoutes(app, { service: { read: async input => { calls.push(input); return { digest: "a".repeat(64), unifiedDiff: "", binary: false, hunks: [] }; }, action: async input => { calls.push(input); return { status: "success", action: input.action, hunkIndex: input.hunkIndex }; } } });
  const body = { cwd: "/project", filePath: "a.ts", staged: false, hunkIndex: 0, expectedDigest: "a".repeat(64), action: "stage" };
  for (const invalid of [{ ...body, patch: "fake" }, { ...body, args: ["--unsafe-paths"] }, { ...body, action: "reset" }, { ...body, staged: "false" }, { ...body, hunkIndex: -1 }, { ...body, expectedDigest: "" }, { ...body, confirmRevert: "true" }]) {
    assert.equal((await app.inject({ method: "POST", url: "/api/session/git/hunks/action", payload: invalid })).statusCode, 400);
  }
  assert.deepEqual(calls, []);
  assert.equal((await app.inject({ method: "POST", url: "/api/session/git/hunks/action", payload: body })).statusCode, 200);
  assert.deepEqual(calls, [body]);
});
