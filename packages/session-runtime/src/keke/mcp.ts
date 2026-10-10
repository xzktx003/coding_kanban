import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import type { FastifyInstance } from "fastify";
import { JsonStore } from "../core/json-store.js";
import { isObject, object, type Json, type JsonObject } from "../core/json.js";
import type { AcpAgentDef } from "../acp/types.js";
const execFileAsync = promisify(execFile);
export function acpEntry(name: string, config: Json): JsonObject {
  if (!isObject(config)) throw new Error("Server must be an object");
  if (config.disabled !== undefined && typeof config.disabled !== "boolean")
    throw new Error("disabled must be boolean");
  const pairs = (key: string) => {
    if (config[key] === undefined) return [];
    if (!isObject(config[key])) throw new Error(`${key} must be an object`);
    return Object.entries(config[key]).map(([name, value]) => {
      if (typeof value !== "string")
        throw new Error(`${key} values must be strings`);
      return { name, value };
    });
  };
  const kind = config.type ?? "stdio";
  if (kind === "stdio") {
    if (
      typeof config.command !== "string" ||
      !config.command.trim() ||
      config.command.includes("\0")
    )
      throw new Error("Missing command");
    const args = config.args ?? [];
    if (
      !Array.isArray(args) ||
      !args.every((v) => typeof v === "string" && !v.includes("\0"))
    )
      throw new Error("args must be strings");
    return { name, command: config.command, args, env: pairs("env") };
  }
  if (kind === "http" || kind === "sse") {
    if (typeof config.url !== "string" || !/^https?:\/\//.test(config.url))
      throw new Error("Missing HTTP(S) URL");
    new URL(config.url);
    const entry: JsonObject = {
      type: kind,
      name,
      url: config.url,
      headers: pairs("headers"),
    };
    if (config._meta !== undefined) {
      if (!isObject(config._meta))
        throw new Error("MCP metadata must be object");
      entry._meta = { ...config._meta };
    }
    if (config.oauth !== undefined) {
      if (!isObject(config.oauth))
        throw new Error("MCP OAuth configuration must be object");
      entry._meta = { ...object(entry._meta), "keke.dev/oauth": config.oauth };
    }
    return entry;
  }
  throw new Error("Unsupported MCP transport");
}
function remoteUrl(config: Json) {
  const c = object(config);
  if (c.disabled === true)
    throw new Error("Enable connector before authorizing");
  if (c.type !== "http" && c.type !== "sse")
    throw new Error("Local connectors do not use browser authorization");
  if (typeof c.url !== "string") throw new Error("Missing server URL");
  return c.url;
}
export function githubUrl(config: Json) {
  const raw = remoteUrl(config);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.githubcopilot.com" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error(
      "GitHub tokens can only be sent to the official GitHub MCP server",
    );
  return raw;
}
function hasAuth(config: Json) {
  return Object.entries(object(object(config).headers)).some(
    ([key, value]) =>
      key.toLowerCase() === "authorization" &&
      typeof value === "string" &&
      value.trim() &&
      !value.includes("${"),
  );
}
export interface KekeOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  findAgent?: () => AcpAgentDef | undefined | Promise<AcpAgentDef | undefined>;
  fetch?: typeof fetch;
}
export class KekeMcpService {
  readonly home: string;
  readonly store: JsonStore;
  private loginRunning = false;
  constructor(private options: KekeOptions = {}) {
    this.home = options.home ?? join(homedir(), ".keke");
    this.store = new JsonStore(join(this.home, ".mcp.json"), () => ({
      mcpServers: {},
    }));
  }
  private document(root: JsonObject) {
    if (root.mcpServers !== undefined && !isObject(root.mcpServers))
      throw new Error("Invalid keke MCP document");
    return root;
  }
  private configure(raw: Json): JsonObject {
    if (!isObject(raw)) throw new Error("Invalid MCP server");
    const c = structuredClone(raw);
    if (c.oauth !== undefined) return c;
    if (isObject(c._meta) && c._meta["keke.dev/oauth"] !== undefined) {
      c.oauth = c._meta["keke.dev/oauth"];
      return c;
    }
    try {
      githubUrl(c);
    } catch {
      return c;
    }
    const env = this.options.env ?? process.env;
    const client = env.MCP_GITHUB_CLIENT_ID?.trim();
    if (client) {
      c.oauth = {
        client_id: client,
        redirect_uri:
          env.MCP_GITHUB_REDIRECT_URI ?? "http://127.0.0.1:8765/callback",
        ...(env.MCP_GITHUB_CLIENT_SECRET?.trim()
          ? { client_secret: "${MCP_GITHUB_CLIENT_SECRET}" }
          : {}),
      };
    }
    return c;
  }
  async read(): Promise<Record<string, JsonObject>> {
    const root = this.document(await this.store.read());
    return Object.fromEntries(
      Object.entries(object(root.mcpServers)).map(([name, c]) => [
        name,
        this.configure(c),
      ]),
    );
  }
  private name(name: string) {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name === "codexia-bots" ||
      name.includes("\0")
    )
      throw new Error("Empty or reserved server name");
  }
  async add(name: string, raw: Json) {
    this.name(name);
    const config = this.configure(raw);
    acpEntry(name, config);
    await this.store.update((root) => {
      this.document(root);
      const servers = object(root.mcpServers);
      if (Object.hasOwn(servers, name))
        throw new Error("Server exists; remove explicitly before replacing");
      return { ...root, mcpServers: { ...servers, [name]: config } };
    });
  }
  async remove(name: string) {
    this.name(name);
    await this.store.update((root) => {
      this.document(root);
      const servers = { ...object(root.mcpServers) };
      delete servers[name];
      return { ...root, mcpServers: servers };
    });
  }
  private async cli(action: string, name: string, timeout: number) {
    const agent = await this.options.findAgent?.();
    if (!agent?.local)
      throw new Error("Install Keke before authorizing connectors");
    const args = agent.args ?? [];
    if (args.at(-2) !== "agent" || args.at(-1) !== "stdio")
      throw new Error("Keke launcher does not support MCP commands");
    const output = await execFileAsync(
      agent.command,
      [...args.slice(0, -2), "mcp", action, "--", name],
      {
        env: {
          ...(this.options.env ?? process.env),
          ...agent.env,
          KEKE_HOME: this.home,
        },
        cwd: this.home,
        timeout,
        maxBuffer: 1024 * 1024,
      },
    );
    return output.stdout;
  }
  private signedIn(output: string) {
    const line = output
      .split(/\r?\n/)
      .find((v) => v.startsWith("signed in: "))
      ?.slice(11);
    if (line === "yes") return true;
    if (line === "no" || line?.startsWith("no ")) return false;
    throw new Error("Keke did not report authorization status; update Keke");
  }
  async authStatuses() {
    const entries = Object.entries(await this.read());
    const statuses: Record<
      string,
      { signedIn: boolean | null; error: string | null }
    > = {};
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, entries.length) }, async () => {
        for (;;) {
          const entry = entries[index++];
          if (!entry) return;
          const [name, c] = entry;
          try {
            remoteUrl(c);
          } catch {
            continue;
          }
          if (hasAuth(c)) {
            statuses[name] = { signedIn: true, error: null };
            continue;
          }
          try {
            statuses[name] = {
              signedIn: this.signedIn(await this.cli("get", name, 15000)),
              error: null,
            };
          } catch (e) {
            statuses[name] = { signedIn: null, error: String(e) };
          }
        }
      }),
    );
    return statuses;
  }
  async login(name: string) {
    this.name(name);
    if (this.loginRunning)
      throw new Error("Another connector is being authorized");
    this.loginRunning = true;
    try {
      const original = (await this.read())[name];
      if (!original) throw new Error("Connector no longer configured");
      const url = remoteUrl(original);
      let github = false;
      try {
        githubUrl(original);
        github = true;
      } catch {}
      if (github && !original.oauth)
        throw new Error(
          "Configure MCP_GITHUB_CLIENT_ID before authorizing GitHub in the browser",
        );
      if (original.oauth)
        await this.store.update((root) => {
          this.document(root);
          const servers = object(root.mcpServers);
          const stored = servers[name];
          if (!stored || remoteUrl(stored) !== url)
            throw new Error("Connector changed before authorization");
          return {
            ...root,
            mcpServers: {
              ...servers,
              [name]: { ...object(stored), oauth: original.oauth! },
            },
          };
        });
      await this.cli("login", name, 360000);
      const current = (await this.read())[name];
      if (!current || remoteUrl(current) !== url)
        throw new Error("Connector changed during authorization");
      if (!this.signedIn(await this.cli("get", name, 15000)))
        throw new Error("Keke did not save an authorization credential");
    } finally {
      this.loginRunning = false;
    }
  }
  async authorizeGithub(name: string, rawToken: string) {
    this.name(name);
    if (
      typeof rawToken !== "string" ||
      !rawToken.trim() ||
      /\s/.test(rawToken.trim())
    )
      throw new Error("Enter a GitHub personal access token");
    const token = rawToken.trim();
    const original = (await this.read())[name];
    if (!original) throw new Error("Connector no longer configured");
    const url = githubUrl(original);
    let status: number;
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "codexia", version: "0.1.0" },
          },
        }),
      });
      status = response.status;
      await response.body?.cancel();
    } catch {
      throw new Error("Could not reach GitHub. Try again.");
    }
    if (status < 200 || status >= 300)
      throw new Error(
        `GitHub could not authorize this connector (HTTP ${status})`,
      );
    await this.store.update((root) => {
      this.document(root);
      const servers = object(root.mcpServers);
      const c = servers[name];
      if (!c || githubUrl(c) !== url)
        throw new Error("Connector changed during authorization");
      const headers = Object.fromEntries(
        Object.entries(object(object(c).headers)).filter(
          ([key]) => key.toLowerCase() !== "authorization",
        ),
      );
      return {
        ...root,
        mcpServers: {
          ...servers,
          [name]: {
            ...object(c),
            headers: { ...headers, Authorization: `Bearer ${token}` },
          },
        },
      };
    });
  }
}
export function registerKekeRoutes(
  app: FastifyInstance,
  service: KekeMcpService,
) {
  app.post("/api/keke/mcp/read", () => service.read());
  app.post("/api/keke/mcp/auth-statuses", () => service.authStatuses());
  app.post("/api/keke/mcp/add", async (req) => {
    const b = req.body as { name: string; config: Json };
    await service.add(b.name, b.config);
    return null;
  });
  app.post("/api/keke/mcp/remove", async (req) => {
    await service.remove((req.body as { name: string }).name);
    return null;
  });
  app.post("/api/keke/mcp/login", async (req) => {
    await service.login((req.body as { name: string }).name);
    return null;
  });
  app.post("/api/keke/mcp/authorize-github", async (req) => {
    const b = req.body as { name: string; token: string };
    await service.authorizeGithub(b.name, b.token);
    return null;
  });
}
