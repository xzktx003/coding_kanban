import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  createDynamicToolsRouter,
} = require("../src/dynamic-tools-routing.cjs");
test("an explicit shared resume wrapper runs in the originating dynamic-tool view scope", async () => {
  const sender = { id: 2, isDestroyed: () => false },
    window = { webContents: sender, isDestroyed: () => false },
    record = { senderId: 2, window, failed: false };
  const observed = [];
  let router;
  router = createDynamicToolsRouter({
    getRecord: (id) => (id === 2 ? record : null),
    getOwnedRecord: (value) => (value === sender ? record : null),
    withResume: async (actual, host, params, invoke) => {
      observed.push({ actual, host, params });
      await Promise.resolve();
      return invoke({ conversationId: params.conversationId });
    },
  });
  const service = {
    open: () => ({
      status: "ready",
      manager: {
        async resumeConversation(params) {
          await Promise.resolve();
          return { params, window: router.selectWindow() };
        },
      },
    }),
  };
  const manager = router.bindManagers(service, sender).open("local").manager;
  const result = await manager.resumeConversation({
    conversationId: "thread",
    __kanbanSharedConnectAttempt: "receipt",
  });
  assert.deepEqual(result, { params: { conversationId: "thread" }, window });
  assert.equal(observed.length, 1);
  assert.equal(observed[0].actual, sender);
  assert.equal(observed[0].host, "local");
});
test("an invalid or rejected shared resume wrapper never invokes the original manager", async () => {
  const sender = { id: 2, isDestroyed: () => false },
    window = { webContents: sender, isDestroyed: () => false },
    record = { senderId: 2, window, failed: false };
  let calls = 0;
  const base = { getRecord: () => record, getOwnedRecord: () => record };
  assert.throws(() => createDynamicToolsRouter({ ...base, withResume: 42 }), {
    code: "DYNAMIC_TOOLS_INVALID_CONFIG",
  });
  const router = createDynamicToolsRouter({
    ...base,
    withResume: () => {
      throw Error("denied");
    },
  });
  const manager = router
    .bindManagers(
      {
        open: () => ({
          status: "ready",
          manager: {
            resumeConversation() {
              calls++;
            },
          },
        }),
      },
      sender,
    )
    .open("local").manager;
  assert.throws(
    () => manager.resumeConversation({ conversationId: "thread", __kanbanSharedConnectAttempt: "rejected-receipt" }),
    /denied/,
  );
  assert.equal(calls, 0);
});
