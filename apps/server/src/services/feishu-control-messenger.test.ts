import assert from "node:assert/strict";
import test from "node:test";

import { FeishuControlMessenger } from "./feishu-control-messenger.js";

test("sends an interactive control card to the configured private user", async () => {
  const calls: Array<{ binary: string; args: string[] }> = [];
  const messenger = new FeishuControlMessenger({
    allowedUserId: "ou_owner",
    runCommand: async (binary, args) => {
      calls.push({ binary, args });
      return {
        stdout: JSON.stringify({
          ok: true,
          data: { message_id: "om_control", chat_id: "oc_private" },
        }),
      };
    },
  });
  const card = { schema: "2.0", body: { elements: [] } };

  const delivery = await messenger.sendCard("ou_owner", card, "panel-1");

  assert.deepEqual(delivery, {
    messageId: "om_control",
    chatId: "oc_private",
  });
  assert.equal(calls[0]?.binary, "lark-cli");
  assert.deepEqual(calls[0]?.args, [
    "im",
    "+messages-send",
    "--as",
    "bot",
    "--format",
    "json",
    "--user-id",
    "ou_owner",
    "--msg-type",
    "interactive",
    "--content",
    JSON.stringify(card),
    "--idempotency-key",
    "panel-1",
  ]);
});

test("sends text as explicit text JSON content", async () => {
  const calls: Array<{ args: string[] }> = [];
  const messenger = new FeishuControlMessenger({
    allowedUserId: "ou_owner",
    runCommand: async (_binary, args) => {
      calls.push({ args });
      return {
        stdout: JSON.stringify({
          ok: true,
          data: { messageId: "om_text", chatId: "oc_private" },
        }),
      };
    },
  });

  await messenger.sendText("ou_owner", "面板已刷新", "notice-1");

  assert.deepEqual(calls[0]?.args.slice(0, 12), [
    "im",
    "+messages-send",
    "--as",
    "bot",
    "--format",
    "json",
    "--user-id",
    "ou_owner",
    "--msg-type",
    "text",
    "--content",
    JSON.stringify({ text: "面板已刷新" }),
  ]);
  assert.deepEqual(calls[0]?.args.slice(12), ["--idempotency-key", "notice-1"]);
});

test("rejects unconfigured or mismatched private recipients before invoking lark-cli", async () => {
  const calls: string[][] = [];
  const messenger = new FeishuControlMessenger({
    allowedUserId: "ou_owner",
    runCommand: async (_binary, args) => {
      calls.push(args);
      return { stdout: "{}" };
    },
  });

  await assert.rejects(
    messenger.sendCard("ou_other", { schema: "2.0" }, "panel-1"),
    /Feishu control message delivery failed/,
  );
  await assert.rejects(
    new FeishuControlMessenger().sendCard(
      "ou_owner",
      { schema: "2.0" },
      "panel-1",
    ),
    /Feishu control message delivery failed/,
  );
  assert.equal(calls.length, 0);
});

test("normalizes lark-cli failures without leaking prompt or argv content", async () => {
  const messenger = new FeishuControlMessenger({
    allowedUserId: "ou_owner",
    runCommand: async () => {
      throw new Error("bad argv secret prompt");
    },
  });

  await assert.rejects(
    messenger.sendText("ou_owner", "secret prompt", "notice-1"),
    (error) =>
      error instanceof Error &&
      error.message === "Feishu control message delivery failed",
  );
});

test("requires ok true and message identifiers in lark-cli JSON output", async () => {
  for (const stdout of [
    "{",
    JSON.stringify({
      ok: false,
      data: { message_id: "om_1", chat_id: "oc_1" },
    }),
    JSON.stringify({ ok: true, data: { message_id: "bad", chat_id: "oc_1" } }),
    JSON.stringify({ ok: true, data: { message_id: "om_1" } }),
  ]) {
    const messenger = new FeishuControlMessenger({
      allowedUserId: "ou_owner",
      runCommand: async () => ({ stdout }),
    });
    await assert.rejects(
      messenger.sendCard("ou_owner", { schema: "2.0" }, "panel-1"),
      /Feishu control message delivery failed/,
    );
  }
});
