import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultFocusViewState,
  parseFocusViewState,
} from "./focus-view-state.js";

test("missing storage falls back to the grid with nothing focused", () => {
  assert.deepEqual(parseFocusViewState(null), defaultFocusViewState());
});

test("a saved grid keeps the session it can return to", () => {
  assert.deepEqual(
    parseFocusViewState(
      JSON.stringify({ viewMode: "grid", focusedId: "session-a" }),
    ),
    { viewMode: "grid", focusedId: "session-a" },
  );
});

test("focus mode without a session id falls back to the grid", () => {
  assert.deepEqual(parseFocusViewState(JSON.stringify({ viewMode: "focus" })), {
    viewMode: "grid",
    focusedId: null,
  });
});

test("blank or non-string session ids are dropped", () => {
  assert.deepEqual(
    parseFocusViewState(
      JSON.stringify({ viewMode: "grid", focusedId: "   " }),
    ),
    { viewMode: "grid", focusedId: null },
  );
});
