import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerSessionSavedPatchRoutes } from "./session-saved-patch.js";
const body = {
  requestId: "op-1",
  threadId: "t-1",
  turnId: "turn-1",
  action: "undo",
  expectedChanges: [
    {
      id: "patch-1",
      changes: [
        {
          path: "/project/file.txt",
          kind: { type: "update", move_path: null },
          diff: "@@ -1 +1 @@\n-a\n+b\n",
        },
      ],
    },
  ],
};
test("saved patch routes validate identities and never accept client cwd or Git options", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const calls: unknown[] = [];
  registerSessionSavedPatchRoutes(app, {
    origin: () => null,
    service: {
      apply: async (input) => {
        calls.push(input);
        return {
          requestId: input.requestId,
          action: input.action,
          status: "success",
          changedFiles: 1,
        };
      },
      status: async (threadId, id) => {
        calls.push([threadId, id]);
        return null;
      },
    },
  });
  for (const invalid of [
    { ...body, cwd: "/foreign" },
    { ...body, action: "reset" },
    { ...body, threadId: "../secret" },
    {
      ...body,
      expectedChanges: [
        {
          id: "x",
          changes: [{ path: "file", kind: { type: "symlink" }, diff: "" }],
        },
      ],
    },
    { ...body, filePath: "\0" },
  ]) {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/saved-patches/apply",
          payload: invalid,
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(calls.length, 0);
  const response = await app.inject({
    method: "POST",
    url: "/api/session/saved-patches/apply",
    payload: body,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [body]);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/api/session/saved-patches/status?threadId=t-1&requestId=op-1",
      })
    ).statusCode,
    200,
  );
});
test("native history lookup is read-only and requires matching thread identity", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const calls: { url: string; body: unknown }[] = [];
  registerSessionSavedPatchRoutes(app, {
    origin: () => "http://127.0.0.1:1234",
    fetch: (async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(String(options?.body)) });
      return Response.json({
        thread: {
          id: "foreign",
          cwd: "/foreign",
          status: { type: "idle" },
          turns: [],
        },
      });
    }) as typeof fetch,
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/session/saved-patches/apply",
    payload: body,
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(calls, [
    {
      url: "http://127.0.0.1:1234/api/codex/thread/read",
      body: { threadId: "t-1" },
    },
  ]);
});
