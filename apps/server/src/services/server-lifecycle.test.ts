import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { installGracefulShutdown } from "./server-lifecycle.js";

class FakeProcess extends EventEmitter {
  readonly exitCodes: number[] = [];

  exit(code: number): void {
    this.exitCodes.push(code);
  }
}

test("graceful shutdown closes the app before exiting on SIGTERM", async () => {
  const processTarget = new FakeProcess();
  const events: string[] = [];

  installGracefulShutdown({
    app: {
      async close() {
        events.push("close");
      },
    },
    processTarget,
  });

  processTarget.emit("SIGTERM");
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(events, ["close"]);
  assert.deepEqual(processTarget.exitCodes, [0]);
});

test("graceful shutdown coalesces repeated signals and reports close failures", async () => {
  const processTarget = new FakeProcess();
  const errors: unknown[] = [];
  let closeCalls = 0;

  installGracefulShutdown({
    app: {
      async close() {
        closeCalls += 1;
        throw new Error("close failed");
      },
    },
    processTarget,
    logError(error) {
      errors.push(error);
    },
  });

  processTarget.emit("SIGINT");
  processTarget.emit("SIGTERM");
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(closeCalls, 1);
  assert.equal(errors.length, 1);
  assert.deepEqual(processTarget.exitCodes, [1]);
});
