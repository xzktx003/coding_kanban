import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerSessionModeRoutes } from "../../apps/server/src/routes/session-mode";
import { registerCodexRoutes } from "../../packages/session-runtime/src/codex/routes";
import { CodexService } from "../../packages/session-runtime/src/codex/client";
import { EventHub } from "../../packages/session-runtime/src/core/events";
import type { Rpc } from "../../packages/session-runtime/src/codex/ownership";
import type { Json } from "../../packages/session-runtime/src/core/json";

const Fastify = createRequire(new URL("../../apps/server/package.json", import.meta.url))("fastify");

// Actual gateway -> private HTTP runtime -> native RPC fixture. No browser,
// native process, account HTTP request, feedback upload or writer is started.
const cwd = "/fixture/feedback-project-A";
const sourcePaths = [
  "apps/server/src/routes/session-mode.ts",
  "packages/session-runtime/src/codex/routes.ts",
  "packages/session-runtime/src/codex/client.ts",
  "packages/session-runtime/src/codex/protocol.ts",
  "tests/e2e/session-feedback-preflight-bridge.spec.mts",
];
const hashes = () => sourcePaths.map((path) => ({
  path,
  sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
}));

for (const scenario of ["global-default", "project-disabled", "metadata-mismatch", "config-default-after-error"] as const) {
  test(`feedback preflight HTTP bridge: ${scenario}`, async ({}, info) => {
    const sourceBefore = hashes();
    const runtime = Fastify();
    const gateway = Fastify();
    const service = new CodexService({
      hub: new EventHub(), instance: "feedback-bridge-fixture", env: {}, sweepIntervalMs: 0,
    });
    const calls: Array<{ method: string; params: unknown }> = [];
    const writerCalls: string[] = [];
    const raw: Rpc = async (method, params, options): Promise<Json> => {
      options?.beforeSend?.();
      calls.push({ method, params });
      if (method === "account/read") {
        expect(params).toEqual({ refreshToken: false });
        return { account: { type: "apiKey" }, requiresOpenaiAuth: false };
      }
      if (method === "thread/read") {
        expect(params).toEqual({ threadId: "feedback-A", includeTurns: false });
        return { thread: { id: scenario === "metadata-mismatch" ? "other-thread" : "feedback-A", cwd } };
      }
      if (method === "config/read") {
        if (scenario === "config-default-after-error") throw new Error("fixture config unavailable");
        return {
          config: {
            ...(scenario === "global-default" ? {} : {
              feedback: { enabled: scenario !== "project-disabled" || (params as { cwd?: unknown }).cwd !== cwd },
            }),
            secret: "PRIVATE_CONFIG_VALUE",
          },
          origins: { private: "/private/config.toml" }, layers: [{ private: "PRIVATE_LAYER" }],
        };
      }
      if (method === "configRequirements/read") {
        expect(params).toBeNull();
        return { requirements: null };
      }
      throw new Error(`Unexpected native method: ${method}`);
    };
    Object.assign(service, {
      raw,
      call: async (method: string) => {
        writerCalls.push(method);
        throw new Error("Preflight must not acquire, resume or send through a writer");
      },
    });
    let response: { statusCode: number; headers: unknown; body: string } | undefined;
    let failure: string | null = null;
    const upstream: Array<{ method: string; url: string }> = [];
    try {
      registerCodexRoutes(runtime, service);
      runtime.addHook("onRequest", async (request: { method: string; url: string }) => { upstream.push({ method: request.method, url: request.url }); });
      await runtime.listen({ host: "127.0.0.1", port: 0 });
      const address = runtime.server.address();
      if (!address || typeof address === "string") throw new Error("Private runtime listener missing");
      registerSessionModeRoutes(gateway, { origin: `http://127.0.0.1:${address.port}` });
      const result = await gateway.inject({
        method: "POST",
        url: "/api/session/api/codex/feedback/preflight",
        payload: scenario === "global-default"
          ? { threadId: null, cwd: null }
          : { threadId: "feedback-A", cwd: "/fixture/caller-must-not-change-project" },
      });
      response = { statusCode: result.statusCode, headers: result.headers, body: result.body };
    } catch (error) {
      failure = String(error);
    } finally {
      await gateway.close();
      await runtime.close();
      await service.close();
      await writeFile(info.outputPath("feedback-preflight-bridge.json"), JSON.stringify({
        scenario, boundary: "Actual gateway and private HTTP runtime; native RPC fixture only; no browser or live account",
        sourceBefore, sourceAfter: hashes(), response, calls, writerCalls, upstream, failure,
      }, null, 2) + "\n");
    }
    // Preserve failure evidence before judging the baseline missing endpoint.
    expect(failure).toBeNull();
    expect(hashes()).toEqual(sourceBefore);
    expect(writerCalls).toEqual([]);
    expect(upstream).toEqual([{ method: "POST", url: "/api/codex/feedback/preflight" }]);
    expect(response?.statusCode).toBe(200);
    const result = JSON.parse(response!.body);
    expect(result.runtimeInstance).toBe("feedback-bridge-fixture");
    expect(result.reason).toBe(scenario === "project-disabled" ? "configuration" : scenario === "metadata-mismatch" ? "unavailable" : null);
    expect(response!.body).not.toMatch(/PRIVATE_|private\/config|origins|layers|authToken|Bearer/);
    expect(calls.every((call) => ["account/read", "thread/read", "config/read", "configRequirements/read"].includes(call.method))).toBe(true);
    if (scenario === "global-default") {
      expect(calls.some((call) => call.method === "thread/read")).toBe(false);
      expect(calls.filter((call) => call.method === "config/read").map((call) => call.params)).toEqual([{ cwd: null, includeLayers: false }]);
    } else if (scenario !== "metadata-mismatch") {
      expect(calls.filter((call) => call.method === "config/read").map((call) => call.params)).toEqual([{ cwd, includeLayers: false }]);
    }
    if (scenario === "config-default-after-error") expect(result.provenance.config).toBe("default");
  });
}
