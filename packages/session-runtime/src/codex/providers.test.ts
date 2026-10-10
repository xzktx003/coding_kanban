import { test } from "node:test";
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
import Fastify from "fastify";
import { registerCodexConfigRoutes, resolveCodexEnv } from "./providers.js";
import { KeyedSerial } from "../core/serial.js";
import type { CodexService } from "./client.js";

test("provider config layers, explicit mutations and isolated literal env persistence preserve native contracts", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-providers-"));
  const dataDir = join(home, "data");
  const env = { HOME: home, PATH: process.env.PATH, INHERITED: "value" };
  await mkdir(join(home, ".codex"));
  const config = join(home, ".codex/config.toml");
  await writeFile(
    config,
    'model="keep"\n[model_providers.custom]\nbase_url="http://example.test"\nenv_key="CUSTOM_API_KEY"\n',
  );
  const calls: unknown[] = [];
  const codex = {
    accountOperations: new KeyedSerial(),
    raw: async (method: string, params: unknown) => {
      calls.push([method, params]);
      if (method === "config/read")
        return {
          layers: [
            {
              config: {
                model_providers: {
                  alpha: { env_key: "A", base_url: "https://low.test" },
                },
              },
            },
            {
              config: {
                model_providers: {
                  alpha: { env_key: "B", base_url: "https://high.test" },
                },
              },
            },
          ],
        };
      return {};
    },
  } as unknown as CodexService;
  const app = Fastify();
  registerCodexConfigRoutes(app, { codex, dataDir, env });
  try {
    let r = await app.inject({
      method: "GET",
      url: "/api/codex/provider/list",
    });
    assert.equal(
      r.json().find((p: any) => p.name === "alpha").base_url,
      "https://high.test",
    );
    assert.ok(r.json().some((p: any) => p.name === "ollama"));
    r = await app.inject({
      method: "POST",
      url: "/api/codex/provider/add",
      payload: {
        provider: "custom2",
        base_url: "https://example.test/v1",
        env_key: "CUSTOM_API_KEY",
      },
    });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(calls.at(-1), [
      "config/value/write",
      {
        keyPath: "model_providers.custom2",
        value: {
          name: "custom2",
          base_url: "https://example.test/v1",
          env_key: "CUSTOM_API_KEY",
        },
        mergeStrategy: "upsert",
      },
    ]);
    const value = "literal ' $(touch /tmp/no-execution)\nline2";
    r = await app.inject({
      method: "POST",
      url: "/api/codex/set_env",
      payload: { key: "CUSTOM_API_KEY", value },
    });
    assert.equal(r.statusCode, 200);
    assert.equal((await resolveCodexEnv(dataDir, env)).CUSTOM_API_KEY, value);
    assert.equal(
      (await stat(join(dataDir, "provider-env.json"))).mode & 0o777,
      0o600,
    );
    r = await app.inject({ method: "GET", url: "/api/codex/load_env_keys" });
    assert.equal(
      r.json().find((p: any) => p.env_key === "CUSTOM_API_KEY").is_env_set,
      true,
    );
    assert.ok(!r.body.includes(value));
    for (const key of ["NODE_OPTIONS", "LD_PRELOAD", "PATH", "X;echo bad"]) {
      r = await app.inject({
        method: "POST",
        url: "/api/codex/set_env",
        payload: { key, value: "bad" },
      });
      assert.equal(r.statusCode, 400);
    }
    r = await app.inject({
      method: "POST",
      url: "/api/codex/provider/remove",
      payload: { provider: "custom" },
    });
    assert.equal(r.statusCode, 200);
    const text = await readFile(config, "utf8");
    assert.ok(text.includes('model = "keep"'));
    assert.ok(!text.includes("model_providers"));
  } finally {
    await app.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("model discovery only contacts auto-discover providers, enforces bounds and ignores offline services", async () => {
  const { discoverModels } = await import("./providers.js");
  const visited: string[] = [];
  const result = await discoverModels(
    (async (input) => {
      const url = String(input);
      visited.push(url);
      if (url.includes("1234")) throw new Error("offline");
      return new Response(
        JSON.stringify({ data: [{ id: "fixture-model" }, { id: 12 }] }),
      );
    }) as typeof fetch,
    { SESSION_OLLAMA_BASE_URL: "http://fixture.test/v1" },
  );
  assert.equal(visited.length, 3);
  assert.ok(visited.includes("http://fixture.test/v1/models"));
  assert.deepEqual(result.find((p) => p.provider === "ollama")?.models, [
    { id: "fixture-model", context_length: null },
  ]);
  assert.deepEqual(result.find((p) => p.provider === "lmstudio")?.models, []);
  assert.deepEqual(result.find((p) => p.provider === "openrouter")?.models, []);
});

test("corrupt provider secret store fails closed without reflecting content into HTTP errors", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-env-redaction-"));
  await mkdir(join(home, ".codex"));
  const dataDir = join(home, "data");
  await mkdir(dataDir);
  await writeFile(
    join(dataDir, "provider-env.json"),
    "fixture-secret-broken-json",
  );
  const codex = {
    accountOperations: new KeyedSerial(),
    raw: async () => ({}),
  } as unknown as CodexService;
  const app = Fastify();
  registerCodexConfigRoutes(app, { codex, dataDir, env: { HOME: home } });
  try {
    await assert.rejects(
      resolveCodexEnv(dataDir, { HOME: home }),
      (error) => !String(error).includes("fixture-secret"),
    );
    const r = await app.inject({
      method: "POST",
      url: "/api/codex/set_env",
      payload: { key: "OPENROUTER_API_KEY", value: "replace" },
    });
    assert.equal(r.statusCode, 500);
    assert.ok(!r.body.includes("fixture-secret"));
    assert.equal(
      await readFile(join(dataDir, "provider-env.json"), "utf8"),
      "fixture-secret-broken-json",
    );
  } finally {
    await app.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("native provider add and direct remove serialize, including reentrant launch environment read", async () => {
  const TOML = (await import("@iarna/toml")).default;
  const home = await mkdtemp(join(tmpdir(), "codex-provider-race-"));
  const dataDir = join(home, "data");
  const env = { HOME: home };
  await mkdir(join(home, ".codex"));
  const file = join(home, ".codex/config.toml");
  await writeFile(
    file,
    'model="preserve"\n[model_providers.old]\nbase_url="https://old.test"\n',
  );
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const codex = {
    accountOperations: new KeyedSerial(),
    raw: async (method: string, params: any) => {
      assert.equal(method, "config/value/write");
      await resolveCodexEnv(dataDir, env);
      const config = TOML.parse(await readFile(file, "utf8"));
      entered();
      await gate;
      (config.model_providers as Record<string, unknown>).new = params.value;
      await writeFile(file, TOML.stringify(config));
      return {};
    },
  } as unknown as CodexService;
  const app = Fastify();
  registerCodexConfigRoutes(app, { codex, dataDir, env });
  try {
    const add = app.inject({
      method: "POST",
      url: "/api/codex/provider/add",
      payload: {
        provider: "new",
        base_url: "https://new.test",
        env_key: "OPENROUTER_API_KEY",
      },
    });
    await started;
    const remove = app.inject({
      method: "POST",
      url: "/api/codex/provider/remove",
      payload: { provider: "old" },
    });
    await new Promise((r) => setImmediate(r));
    release();
    assert.equal((await add).statusCode, 200);
    assert.equal((await remove).statusCode, 200);
    const config = TOML.parse(await readFile(file, "utf8"));
    assert.equal(config.model, "preserve");
    assert.ok((config.model_providers as any).new);
    assert.equal((config.model_providers as any).old, undefined);
  } finally {
    release();
    await app.close();
    await rm(home, { recursive: true, force: true });
  }
});
