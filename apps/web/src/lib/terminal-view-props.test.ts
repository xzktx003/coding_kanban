import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { terminalViewPropsAreEqual } from "./terminal-view-props.js";

describe("terminal view props", () => {
  it("publishes callback changes so terminal events use the current handlers", () => {
    const shared = {
      agentSessionId: "grok",
      fontSize: 14,
      inputEnabled: true,
      interactive: true,
      visible: true,
    };

    assert.equal(
      terminalViewPropsAreEqual(
        { ...shared, onReady: () => undefined } as typeof shared,
        { ...shared, onReady: () => undefined } as typeof shared,
      ),
      false,
    );
    assert.equal(
      terminalViewPropsAreEqual(shared, { ...shared, fontSize: 16 }),
      false,
    );
    assert.equal(
      terminalViewPropsAreEqual(shared, {
        ...shared,
        agentSessionId: "other",
      }),
      false,
    );
  });
});
