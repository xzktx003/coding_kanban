import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createTerminalOutputBackpressureState,
  measureTerminalOutputChunks,
  releaseTerminalOutputCapacity,
  reserveTerminalOutputCapacity,
  resetTerminalOutputCapacity,
} from "./terminal-output-backpressure.js";

describe("terminal output backpressure", () => {
  it("measures chunks without changing their bytes", () => {
    assert.deepEqual(measureTerminalOutputChunks(["abc", "de"]), {
      chars: 5,
      chunks: 2,
    });
  });

  it("reserves pending output until xterm write callbacks release it", () => {
    const state = createTerminalOutputBackpressureState();

    assert.equal(
      reserveTerminalOutputCapacity(state, ["abcd"], {
        maxPendingChars: 8,
        maxPendingChunks: 2,
      }),
      true,
    );
    assert.deepEqual(state, { pendingChars: 4, pendingChunks: 1 });

    assert.equal(
      reserveTerminalOutputCapacity(state, ["efgh"], {
        maxPendingChars: 8,
        maxPendingChunks: 2,
      }),
      true,
    );
    assert.deepEqual(state, { pendingChars: 8, pendingChunks: 2 });

    releaseTerminalOutputCapacity(state, "abcd");
    assert.deepEqual(state, { pendingChars: 4, pendingChunks: 1 });
  });

  it("rejects reservations that would exceed char or chunk budgets", () => {
    const state = createTerminalOutputBackpressureState();

    assert.equal(
      reserveTerminalOutputCapacity(state, ["12345"], {
        maxPendingChars: 6,
        maxPendingChunks: 10,
      }),
      true,
    );
    assert.equal(
      reserveTerminalOutputCapacity(state, ["67"], {
        maxPendingChars: 6,
        maxPendingChunks: 10,
      }),
      false,
    );
    assert.deepEqual(state, { pendingChars: 5, pendingChunks: 1 });

    releaseTerminalOutputCapacity(state, "12345");
    assert.equal(
      reserveTerminalOutputCapacity(state, ["a", "b"], {
        maxPendingChars: 6,
        maxPendingChunks: 1,
      }),
      false,
    );
    assert.deepEqual(state, { pendingChars: 0, pendingChunks: 0 });
  });

  it("resets pending counters during terminal teardown", () => {
    const state = createTerminalOutputBackpressureState();
    assert.equal(
      reserveTerminalOutputCapacity(state, ["queued"], {
        maxPendingChars: 10,
        maxPendingChunks: 10,
      }),
      true,
    );

    resetTerminalOutputCapacity(state);
    assert.deepEqual(state, { pendingChars: 0, pendingChunks: 0 });
  });
});
