import { test } from "node:test";
import assert from "node:assert/strict";
import { HistoryBudget } from "./history-budget.js";
import type { Json } from "./json.js";

test("history bytes account for Unicode, escaping and lone surrogates without serialization copies", () => {
  const samples: Json[] = [
    "plain",
    "汉字",
    "😀",
    "\ud800",
    "\udfff",
    '"\\\n\b\u0000',
    { key: ["😀", "\ud800", "\r\t\f", true, false, null, -0, 1.2e30] },
  ];
  for (const value of samples) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    assert.doesNotThrow(() =>
      new HistoryBudget({ maxBytes: bytes }).add(value),
    );
    assert.throws(
      () => new HistoryBudget({ maxBytes: bytes - 1 }).add(value),
      /HISTORY_LIMIT_EXCEEDED/,
    );
  }
});
test("history limits reject excessive structure and depth even when encoded data is tiny", () => {
  assert.throws(
    () => new HistoryBudget({ maxEntries: 3 }).add([null, null, null]),
    /entry limit/,
  );
  let value: Json = "leaf";
  for (let i = 0; i < 20; i++) value = [value];
  assert.throws(
    () => new HistoryBudget({ maxDepth: 5 }).add(value),
    /nesting limit/,
  );
  const budget = new HistoryBudget({ maxPages: 1 });
  budget.beginPage();
  assert.throws(() => budget.beginPage(), /page limit/);
  for (const maxBytes of [0, -1, NaN, Infinity, 1.5])
    assert.throws(
      () => new HistoryBudget({ maxBytes }),
      /Invalid history budget/,
    );
});
