import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  bodyObject,
  HttpError,
  object,
  stringField,
  type JsonObject,
} from "../core/json.js";
import { JsonStore } from "../core/json-store.js";
import { getTomlStore } from "../config/toml-store.js";
import { AccountSnapshots, codexHome } from "./accounts.js";
import type { CodexService } from "./client.js";
import { providerPresets } from "./assets/provider-presets.js";
const envStores = new Map<string, JsonStore>();
function envStore(dataDir: string) {
  const path = join(dataDir, "provider-env.json");
  let store = envStores.get(path);
  if (!store) {
    store = new JsonStore(path, () => ({}));
    envStores.set(path, store);
  }
  return store;
}
const unsafeKeys = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "SHELL",
  "BASH_ENV",
  "ENV",
  "IFS",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "OPENSSL_CONF",
]);
function validEnvKey(key: string) {
  return (
    /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) &&
    !unsafeKeys.has(key.toUpperCase()) &&
    !/^(LD_|DYLD_|SESSION_|VSCODE_|ELECTRON_)/i.test(key)
  );
}
async function configuredKeys(env: NodeJS.ProcessEnv) {
  const presets = providerPresets
    .filter((p) => p.env_key)
    .map((p) => p.env_key);
  const config = await getTomlStore(join(codexHome(env), "config.toml")).read();
  for (const provider of Object.values(object(config.model_providers))) {
    const key = object(provider).env_key;
    if (typeof key === "string") presets.push(key);
  }
  return new Set(presets.filter(validEnvKey));
}
export async function resolveCodexEnv(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const keys = await configuredKeys(env);
  let saved: JsonObject;
  try {
    saved = await envStore(dataDir).read();
  } catch {
    throw new Error(
      "Codex provider environment store is invalid or unreadable",
    );
  }
  const result = { ...env };
  for (const [key, value] of Object.entries(saved)) {
    if (!keys.has(key) || !validEnvKey(key)) continue;
    if (typeof value !== "string" || value.includes("\0"))
      throw new Error(
        "Codex provider environment store contains an invalid value",
      );
    result[key] = value;
  }
  return result;
}
export interface CodexConfigOptions {
  codex: CodexService;
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
}
export function registerCodexConfigRoutes(
  app: FastifyInstance,
  options: CodexConfigOptions,
) {
  const env = options.env ?? process.env;
  const { codex, dataDir } = options;
  const snapshots = new AccountSnapshots(codex, env);
  const config = getTomlStore(join(codexHome(env), "config.toml"));
  const optional = (p: JsonObject, key: string) => {
    const value = p[key];
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") throw new HttpError(400, `Invalid ${key}`);
    return value;
  };
  app.get("/api/codex/account/snapshot/list", () => snapshots.list());
  app.post("/api/codex/account/snapshot/save", async (req, reply) => {
    const p = bodyObject(req.body);
    await snapshots.save(
      stringField(p, "label"),
      optional(p, "email"),
      optional({ ...p, planType: p.planType ?? p.plan_type }, "planType"),
    );
    return reply.code(200).send();
  });
  app.post("/api/codex/account/snapshot/remove", async (req, reply) => {
    await snapshots.remove(stringField(bodyObject(req.body), "label"));
    return reply.code(200).send();
  });
  app.post("/api/codex/account/snapshot/switch", (req) =>
    snapshots.switch(stringField(bodyObject(req.body), "label")),
  );
  app.get("/api/codex/provider/presets", () => providerPresets);
  app.get("/api/codex/provider/list", async () => {
    const response = object(
      await codex.raw("config/read", { includeLayers: true }),
    );
    const providers = new Map<string, JsonObject>();
    for (const layer of Array.isArray(response.layers) ? response.layers : [])
      for (const [name, value] of Object.entries(
        object(object(object(layer).config).model_providers),
      )) {
        const p = object(value);
        providers.set(name, {
          name,
          base_url: typeof p.base_url === "string" ? p.base_url : null,
          env_key: typeof p.env_key === "string" ? p.env_key : null,
        });
      }
    for (const name of ["ollama", "lmstudio"])
      if (!providers.has(name)) {
        const preset = providerPresets.find((p) => p.model_provider === name)!;
        providers.set(name, { name, base_url: preset.base_url, env_key: null });
      }
    return [...providers.values()].sort((a, b) =>
      String(a.name).localeCompare(String(b.name)),
    );
  });
  app.post("/api/codex/provider/add", async (req, reply) => {
    const p = bodyObject(req.body);
    const name = providerName(p);
    const base_url = stringField(p, "base_url");
    let url: URL;
    try {
      url = new URL(base_url);
    } catch {
      throw new HttpError(400, "Invalid base_url");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new HttpError(400, "Invalid base_url");
    if (typeof p.env_key !== "string" || (p.env_key && !validEnvKey(p.env_key)))
      throw new HttpError(400, "Invalid env_key");
    if (!["ollama", "lmstudio"].includes(name))
      await config.exclusive(() =>
        codex.raw("config/value/write", {
          keyPath: `model_providers.${name}`,
          value: { name, base_url, env_key: p.env_key },
          mergeStrategy: "upsert",
        }),
      );
    return reply.code(200).send();
  });
  app.post("/api/codex/provider/remove", async (req, reply) => {
    const name = providerName(bodyObject(req.body));
    await config.update((root) => {
      const table = object(root.model_providers);
      delete table[name];
      if (Object.keys(table).length) root.model_providers = table;
      else delete root.model_providers;
      return root;
    });
    return reply.code(200).send();
  });
  app.get("/api/codex/load_env_keys", async () => {
    const resolved = await resolveCodexEnv(dataDir, env);
    const entries: JsonObject[] = providerPresets.map((p) => ({
      provider: p.model_provider,
      env_key: p.env_key,
      is_env_set: Boolean(p.env_key && resolved[p.env_key]),
      api_key_url: p.api_key_url ?? null,
      signup_url: p.signup_url ?? null,
    }));
    for (const [provider, value] of Object.entries(
      object((await config.read()).model_providers),
    )) {
      const key = object(value).env_key;
      if (
        typeof key === "string" &&
        !entries.some((p) => p.provider === provider)
      )
        entries.push({
          provider,
          env_key: key,
          is_env_set: Boolean(resolved[key]),
          api_key_url: null,
          signup_url: null,
        });
    }
    return entries;
  });
  app.post("/api/codex/set_env", async (req, reply) => {
    const p = bodyObject(req.body);
    const key = stringField(p, "key");
    if (!validEnvKey(key) || !(await configuredKeys(env)).has(key))
      throw new HttpError(
        400,
        "Environment key must belong to a configured model provider",
      );
    if (
      typeof p.value !== "string" ||
      p.value.includes("\0") ||
      Buffer.byteLength(p.value) > 64 * 1024
    )
      throw new HttpError(400, "Invalid environment value");
    try {
      await envStore(dataDir).update((saved) => {
        Object.defineProperty(saved, key, {
          value: p.value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        return saved;
      });
    } catch {
      throw new Error("Could not persist Codex provider environment");
    }
    return reply.code(200).send();
  });
  app.get("/api/codex/model/list-other", () =>
    discoverModels(options.fetcher ?? fetch, env),
  );
}
function providerName(p: JsonObject) {
  const name = stringField(p, "provider");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(name))
    throw new HttpError(400, "Invalid provider name");
  return name;
}
export async function discoverModels(
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
) {
  return Promise.all(
    providerPresets.map(async (provider) => {
      const models: JsonObject[] = [];
      if (provider.auto_discover) {
        const key = `SESSION_${provider.model_provider.toUpperCase()}_BASE_URL`;
        const base = env[key] ?? provider.base_url;
        try {
          const url = new URL(`${base.replace(/\/$/, "")}/models`);
          if (!["http:", "https:"].includes(url.protocol))
            throw new Error("Invalid model endpoint");
          const response = await fetcher(url, {
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          });
          if (response.ok) {
            const text = await limitedBody(response, 2 * 1024 * 1024);
            const data = object(JSON.parse(text)).data;
            if (Array.isArray(data))
              for (const value of data) {
                const id = object(value).id;
                if (typeof id === "string" && id.length <= 1024)
                  models.push({ id, context_length: null });
              }
          }
        } catch {
          /* Optional local model servers may be offline, as in the original contract. */
        }
      }
      return { provider: provider.model_provider, models };
    }),
  );
}
async function limitedBody(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > limit) throw new Error("Model list too large");
      chunks.push(next.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
