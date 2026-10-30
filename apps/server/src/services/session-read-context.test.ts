import assert from "node:assert/strict";
import test from "node:test";
import { visibleSessionReadContext } from "./session-read-context.js";

function fixture({ latest = "seen", changed = false } = {}) {
  const calls: Array<[string, unknown]> = [];
  let contexts = 0;
  return {
    calls,
    options: {
      context: async () => ({
        scope: changed && contexts++ ? "other" : "same",
        namespace: "account",
      }),
      call: async (method: string, params: Record<string, unknown>) => {
        calls.push([method, params]);
        return method === "thread/metadata"
          ? {
              thread: { id: "a" },
              readState: { revision: "observed-revision" },
            }
          : { data: [{ id: latest, status: "completed" }] };
      },
    },
  };
}

test("read proof binds the actually visible terminal turn and uses only bounded metadata reads", async () => {
  const f = fixture();
  assert.deepEqual(await visibleSessionReadContext(f.options, "a", "seen"), {
    scope: "same",
    revision: "observed-revision",
    replyId: "seen",
  });
  assert.deepEqual(f.calls, [
    ["thread/metadata", { threadId: "a" }],
    [
      "thread/turns/list",
      {
        threadId: "a",
        limit: 1,
        sortDirection: "desc",
        itemsView: "notLoaded",
      },
    ],
  ]);
});

test("a new reply or changed account cannot supply a proof for an older visible reply", async () => {
  await assert.rejects(
    visibleSessionReadContext(
      fixture({ latest: "unseen" }).options,
      "a",
      "seen",
    ),
    /回复已变化/,
  );
  await assert.rejects(
    visibleSessionReadContext(fixture({ changed: true }).options, "a", "seen"),
    /范围已变化/,
  );
});

test("unavailable durable native receipts remain unsupported instead of inventing a revision", async () => {
  const f = fixture();
  f.options.call = async () =>
    ({ thread: { id: "a" }, readState: null }) as any;
  await assert.rejects(
    visibleSessionReadContext(f.options, "a", "seen"),
    /原生已读/,
  );
});
