import test from "node:test";
import assert from "node:assert/strict";
import { chatHistoryRequest } from "./chat-history.js";
import { HttpError } from "../core/json.js";

test("the shell-only itemsView is accepted so huge transcripts can page without item bodies", () => {
  assert.equal(
    chatHistoryRequest({ threadId: "t", itemsView: "notLoaded" }).itemsView,
    "notLoaded",
  );
  for (const itemsView of ["full", "summary"] as const) {
    assert.equal(
      chatHistoryRequest({ threadId: "t", itemsView }).itemsView,
      itemsView,
    );
  }
  // The default stays "full": existing readers keep their current contract.
  assert.equal(chatHistoryRequest({ threadId: "t" }).itemsView, "full");
  for (const itemsView of ["", "FULL", "notloaded", "evicted", 1, null]) {
    assert.throws(
      () => chatHistoryRequest({ threadId: "t", itemsView }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 400 &&
        error.message === "CHAT_HISTORY_INVALID_REQUEST",
      JSON.stringify(itemsView),
    );
  }
});
