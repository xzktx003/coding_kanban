import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../core/json.js";
import { readModelConfig } from "./model-config.js";
test("reads project effective model config without exposing endpoints or credentials", async () => {
  const result = await readModelConfig(
    { cwd: "/project" },
    async (method, params) => {
      assert.equal(method, "config/read");
      assert.deepEqual(params, { cwd: "/project", includeLayers: false });
      return {
        config: {
          model: "houmo/h200",
          model_provider: "magpie",
          model_reasoning_effort: "high",
          openai_base_url: "http://private",
          model_providers: { magpie: { api_key: "SECRET" } },
        },
      };
    },
  );
  assert.deepEqual(result, {
    status: "ready",
    model: "houmo/h200",
    modelProvider: "magpie",
    reasoningEffort: "high",
  });
  assert.doesNotMatch(JSON.stringify(result), /SECRET|private|api_key/);
});
test("preserves null defaults and rejects unbounded or arbitrary config requests", async () => {
  assert.deepEqual(await readModelConfig({}, async () => ({ config: {} })), {
    status: "ready",
    model: null,
    modelProvider: null,
    reasoningEffort: null,
  });
  for (const input of [
    { cwd: "relative" },
    { cwd: "/x\0" },
    { includeLayers: true },
  ] as Json[])
    await assert.rejects(
      readModelConfig(input, async () => {
        throw Error("must not read");
      }),
    );
  await assert.rejects(
    readModelConfig({}, async () => ({ config: { model: "x".repeat(1025) } })),
  );
});

test("HTTP model config uses only config/read on the existing connection", async (t) => {
  const { default: Fastify } = await import("fastify");
  const { registerCodexRoutes } = await import("./routes.js");
  const { CodexService } = await import("./client.js");
  const { EventHub } = await import("../core/events.js");
  const app = Fastify();
  const service = new CodexService({
    hub: new EventHub(),
    instance: "model-config-test",
    sweepIntervalMs: 0,
  });
  const methods: string[] = [];
  Object.assign(service, {
    raw: async (method: string) => {
      methods.push(method);
      return { config: { model: "custom", model_provider: "magpie" } };
    },
  });
  registerCodexRoutes(app, service);
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/codex/model/config/read",
    payload: { cwd: "/project" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().model, "custom");
  assert.deepEqual(methods, ["config/read"]);
});
