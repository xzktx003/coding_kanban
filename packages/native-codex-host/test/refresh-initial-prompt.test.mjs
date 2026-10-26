import test from "node:test";
import assert from "node:assert/strict";
import { focusInitialOriginalComposer } from "../../../tests/e2e/codex-refresh-initial-prompt.mjs";

function fixture({
  titleCount = 1,
  buttonCount = 1,
  visible = true,
  dismissError,
  stillBlocked = false,
} = {}) {
  let blocked = true;
  const originalError = Error("original native dialog intercepts pointer");
  const calls = [];
  const focus = async () => {
    if (blocked) throw originalError;
    calls.push("focus");
  };
  const editor = { click: focus, tap: focus };
  const button = {
    count: async () => buttonCount,
    isVisible: async () => visible,
    click: async () => {
      calls.push("click-current");
      if (dismissError) throw dismissError;
      blocked = stillBlocked;
    },
    tap: async () => {
      calls.push("tap-current");
      if (dismissError) throw dismissError;
      blocked = stillBlocked;
    },
  };
  const frame = {
    getByRole: (role, options) => {
      assert.equal(role, "button");
      assert.deepEqual(options, {
        name: "Continue with current model",
        exact: true,
      });
      return button;
    },
    getByText: (text, options) => {
      assert.equal(text, "Introducing GPT-6.1 Sol");
      assert.deepEqual(options, { exact: true });
      return { count: async () => titleCount, isVisible: async () => visible };
    },
  };
  return {
    editor,
    frame,
    calls,
    originalError,
    unblock: () => {
      blocked = false;
    },
  };
}

test("cold setup clicks the original keep-current action once and then focuses", async () => {
  const f = fixture();
  assert.equal(await focusInitialOriginalComposer(f), true);
  assert.deepEqual(f.calls, ["click-current", "focus"]);
});
test("cold touch setup uses the original action through a tap", async () => {
  const f = fixture();
  assert.equal(
    await focusInitialOriginalComposer({ ...f, mobile: true }),
    true,
  );
  assert.deepEqual(f.calls, ["tap-current", "focus"]);
});
test("already usable original composer performs no announcement interaction", async () => {
  const f = fixture();
  f.unblock();
  assert.equal(await focusInitialOriginalComposer(f), false);
  assert.deepEqual(f.calls, ["focus"]);
});
for (const [name, options] of Object.entries({
  unrelated: { titleCount: 0 },
  duplicateTitle: { titleCount: 2 },
  missingButton: { buttonCount: 0 },
  hidden: { visible: false },
})) {
  test(`unknown or ${name} UI preserves the original focus failure`, async () => {
    const f = fixture(options);
    await assert.rejects(
      focusInitialOriginalComposer(f),
      (error) => error === f.originalError,
    );
    assert.deepEqual(f.calls, []);
  });
}
test("a failed original dismiss is not retried or replaced by another action", async () => {
  const dismissError = Error("native click failed"),
    f = fixture({ dismissError });
  await assert.rejects(
    focusInitialOriginalComposer(f),
    (error) => error === dismissError,
  );
  assert.deepEqual(f.calls, ["click-current"]);
});
test("remaining obstruction after one original action fails without further clicks", async () => {
  const f = fixture({ stillBlocked: true });
  await assert.rejects(
    focusInitialOriginalComposer(f),
    (error) => error === f.originalError,
  );
  assert.deepEqual(f.calls, ["click-current"]);
});
