import { createRuntimePreflightFixture } from "./session-feedback-preflight-runtime-core.mts";
import type { Json, JsonObject } from "../../../packages/session-runtime/src/core/json";

let fixture: Awaited<ReturnType<typeof createRuntimePreflightFixture>> | undefined;
let chain = Promise.resolve();
process.on("message", (message: { id: number; operation: string; body?: Json }) => {
  chain = chain.then(async () => {
    if (!Number.isSafeInteger(message?.id)) return;
    try {
      let value: unknown;
      if (message.operation === "initialize" && !fixture) {
        fixture = await createRuntimePreflightFixture(message.body as JsonObject);
        value = null;
      } else if (message.operation === "inject" && fixture) value = await fixture.inject(message.body ?? null);
      else if (message.operation === "close" && fixture) value = await fixture.close();
      else throw new Error("Owned preflight worker operation refused");
      process.send?.({ id: message.id, value, snapshot: fixture?.snapshot() });
    } catch (error) { process.send?.({ id: message.id, error: String(error) }); }
  });
});
process.once("disconnect", async () => { await fixture?.close(); process.exit(0); });
