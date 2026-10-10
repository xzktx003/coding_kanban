import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventHub } from "../core/events.js";
import { createPlatformServices, registerPlatformRoutes } from "./index.js";
import Fastify from "fastify";
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "platform-"));
  const hub = new EventHub();
  const services = await createPlatformServices({
    dataHome: home,
    env: { HOME: home, CODEX_HOME: join(home, ".codex") },
    hub,
    hasBots: () => true,
  });
  const app = Fastify();
  app.setErrorHandler((e, _, r) =>
    r.code((e as any).statusCode ?? 500).send({ error: (e as Error).message }),
  );
  registerPlatformRoutes(app, services);
  return {
    home,
    services,
    app,
    async close() {
      await app.close();
      await services.close();
      hub.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}
test("pairing persists owner-only tokens; dictation validates without downloading", async () => {
  const f = await fixture();
  try {
    const a = (await f.app.inject("/api/pairing")).json();
    assert.match(a.token, /^[a-f0-9]{64}$/);
    assert.equal(
      (await stat(join(f.home, ".codexia/device-token"))).mode & 0o777,
      0o600,
    );
    assert.equal(
      (await f.app.inject("/api/dictation/models/status?modelId=base")).json()
        .state,
      "missing",
    );
    assert.equal(
      (await f.app.inject("/api/dictation/models/status?modelId=../x"))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/dictation/transcribe",
          payload: { modelId: "base", data: "bad" },
        })
      ).statusCode,
      400,
    );
  } finally {
    await f.close();
  }
});
test("telemetry consent persists but unavailable telemetry makes no network requests", async () => {
  const f = await fixture();
  try {
    assert.deepEqual((await f.app.inject("/api/telemetry/status")).json(), {
      available: false,
      consent: "unset",
      eligible: false,
    });
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/telemetry/consent",
          payload: { consent: "granted" },
        })
      ).json().consent,
      "granted",
    );
    await f.app.inject({ method: "POST", url: "/api/telemetry/active" });
    assert.deepEqual(
      JSON.parse(
        await readFile(join(f.home, ".codexia/telemetry.json"), "utf8"),
      ).sent,
      {},
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/telemetry/consent",
          payload: { consent: "anything" },
        })
      ).statusCode,
      400,
    );
  } finally {
    await f.close();
  }
});
test("insights uses latest cumulative Codex usage and native Claude/Gemini totals", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.home, ".codex/sessions"), { recursive: true });
    await writeFile(
      join(f.home, ".codex/sessions/a.jsonl"),
      [
        { type: "session_meta", payload: { id: "a", cwd: "/test" } },
        { type: "turn_context", payload: { model: "model" } },
        {
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 10,
                output_tokens: 2,
                total_tokens: 12,
              },
            },
          },
        },
        {
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 20,
                output_tokens: 4,
                total_tokens: 24,
              },
            },
          },
        },
        {
          type: "response_item",
          payload: { type: "custom_tool_call", name: "exec" },
        },
      ]
        .map((v) => JSON.stringify(v))
        .join("\n"),
    );
    const heat = (
      await f.app.inject({
        method: "POST",
        url: "/api/insights/heatmaps",
        payload: {},
      })
    ).json();
    assert.equal(heat.codex.token_stats.total_tokens, 24);
    assert.equal(heat.codex.total_files, 1);
    assert.deepEqual(heat.codex.tool_calls, [{ tool_name: "exec", count: 1 }]);
    assert.deepEqual(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/insights/filter-options",
          payload: {},
        })
      ).json(),
      { cwds: ["/test"], session_ids: ["a"] },
    );
  } finally {
    await f.close();
  }
});
