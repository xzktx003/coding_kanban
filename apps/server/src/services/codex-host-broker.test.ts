import assert from "node:assert/strict";
import { test } from "node:test";
import { CodexHostBroker } from "./codex-host-broker.js";
const owner = { cwd: "/project", threadId: "thread-a", draftOwner: "draft-a" };
const capabilities = {
  context: true,
  openLocation: true,
  showDiff: true,
  todoCodeLens: true,
  lsp: false,
};
test("an absent real companion remains unavailable", () => {
  const broker = new CodexHostBroker();
  broker.bind("nonce-a", owner);
  assert.equal(broker.status("nonce-a", owner).available, false);
  assert.throws(
    () => broker.command("nonce-a", owner, { type: "context" }),
    /扩展/,
  );
});
test("owner and companion instance isolate replies and CodeLens events", async () => {
  const broker = new CodexHostBroker();
  broker.bind("nonce-a", owner);
  broker.connect("instance-a", "/project", capabilities);
  assert.throws(
    () => broker.status("nonce-a", { ...owner, threadId: "thread-b" }),
    /绑定/,
  );
  const result = broker.command("nonce-a", owner, { type: "context" });
  const command = broker.poll("instance-a", "/project").commands[0]!;
  assert.throws(
    () =>
      broker.complete("instance-b", "/project", command.id, {
        path: "/project/a",
        text: "a",
      }),
    /实例/,
  );
  broker.complete("instance-a", "/project", command.id, {
    path: "/project/a",
    text: "a",
  });
  assert.deepEqual(await result, { path: "/project/a", text: "a" });
  broker.activate("nonce-a", owner, true);
  broker.publish("instance-a", "/project", {
    path: "/project/a",
    text: "TODO",
    range: { start: 2, end: 2 },
  });
  assert.equal(broker.events("nonce-a", owner).length, 1);
  broker.activate("nonce-a", owner, false);
  assert.throws(
    () =>
      broker.publish("instance-a", "/project", {
        path: "/project/a",
        text: "TODO",
      }),
    /会话/,
  );
});
test("replacing a connection rejects its pending commands instead of accepting a stale response", async () => {
  const broker = new CodexHostBroker();
  broker.bind("nonce-a", owner);
  broker.connect("instance-a", "/project", capabilities);
  const pending = broker.command("nonce-a", owner, { type: "context" });
  broker.connect("instance-b", "/project", capabilities);
  await assert.rejects(pending, /实例/);
});
test("two browser windows in one real directory never exchange editor selections", async () => {
  const broker = new CodexHostBroker();
  broker.bind("nonce-a", owner, "/private/window-a.code-workspace");
  const other = { ...owner, draftOwner: "draft-b" };
  broker.bind("nonce-b", other, "/private/window-b.code-workspace");
  broker.connect(
    "instance-a",
    owner.cwd,
    capabilities,
    "/private/window-a.code-workspace",
  );
  broker.connect(
    "instance-b",
    owner.cwd,
    capabilities,
    "/private/window-b.code-workspace",
  );
  const pending = broker.command("nonce-a", owner, { type: "context" });
  assert.equal(
    broker.poll("instance-b", owner.cwd, "/private/window-b.code-workspace")
      .commands.length,
    0,
  );
  const command = broker.poll(
    "instance-a",
    owner.cwd,
    "/private/window-a.code-workspace",
  ).commands[0]!;
  assert.throws(
    () =>
      broker.complete(
        "instance-b",
        owner.cwd,
        command.id,
        "b",
        undefined,
        "/private/window-b.code-workspace",
      ),
    /实例/,
  );
  broker.complete(
    "instance-a",
    owner.cwd,
    command.id,
    "a",
    undefined,
    "/private/window-a.code-workspace",
  );
  assert.equal(await pending, "a");
  broker.activate("nonce-a", owner, true);
  broker.activate("nonce-b", other, true);
  broker.publish(
    "instance-a",
    owner.cwd,
    { path: "/project/a", text: "a" },
    "/private/window-a.code-workspace",
  );
  assert.equal(broker.events("nonce-b", other).length, 0);
  assert.equal(broker.events("nonce-a", owner)[0]?.text, "a");
});
