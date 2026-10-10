import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { JsonStore } from "../core/json-store.js";
import {
  HttpError,
  bodyObject,
  object,
  stringField,
  type JsonObject,
} from "../core/json.js";

export function absolutePath(value: string): string {
  if (!isAbsolute(value) || /[\x00-\x1f]/.test(value))
    throw new HttpError(400, "Expected an absolute path");
  return value;
}
export class ClaudeConfig {
  readonly home: string;
  readonly claudeHome: string;
  private stores = new Map<string, JsonStore>();
  constructor(readonly env: NodeJS.ProcessEnv = process.env) {
    this.home = absolutePath(env.HOME ?? env.USERPROFILE ?? homedir());
    this.claudeHome = absolutePath(
      env.CLAUDE_CONFIG_DIR ?? join(this.home, ".claude"),
    );
  }
  store(path: string, defaults: () => JsonObject = () => ({})): JsonStore {
    let store = this.stores.get(path);
    if (!store) {
      store = new JsonStore(path, defaults);
      this.stores.set(path, store);
    }
    return store;
  }
  get userConfig() {
    return this.store(join(this.home, ".claude.json"));
  }
  get settings() {
    return this.store(join(this.claudeHome, "settings.json"), () => ({
      env: {},
      permissions: { allow: [], deny: [] },
      enabledPlugins: {},
      enabledSkills: {},
    }));
  }
  async list(cwd: string): Promise<JsonObject[]> {
    absolutePath(cwd);
    const config = await this.userConfig.read();
    const project = object(object(config.projects)[cwd]);
    const disabled = new Set(
      Array.isArray(project.disabledMcpServers)
        ? project.disabledMcpServers
        : [],
    );
    const shared = await this.store(join(cwd, ".mcp.json")).read();
    const servers = new Map<string, JsonObject>();
    for (const [scope, source] of [
      ["global", config],
      ["project", shared],
      ["local", project],
    ] as const) {
      for (const [name, value] of Object.entries(object(source.mcpServers))) {
        const server = object(value);
        servers.set(name, {
          name,
          type: server.type ?? "stdio",
          url: server.url ?? null,
          command: server.command ?? null,
          args: server.args ?? null,
          env: server.env ?? null,
          ...(server.headers ? { headers: server.headers } : {}),
          scope,
          enabled: !disabled.has(name),
        });
      }
    }
    return [...servers.values()];
  }
  async get(name: string, cwd: string) {
    const server = (await this.list(cwd)).find((s) => s.name === name);
    if (!server) throw new HttpError(404, `Server '${name}' not found`);
    return server;
  }
  private target(cwd: string, scope: string) {
    if (!["global", "project", "local", ""].includes(scope))
      throw new HttpError(400, "Invalid scope");
    if (scope !== "global") absolutePath(cwd);
    return scope === "project"
      ? this.store(join(cwd, ".mcp.json"))
      : this.userConfig;
  }
  private section(config: JsonObject, cwd: string, scope: string): JsonObject {
    if (scope === "global" || scope === "project") return config;
    const projects = object(config.projects);
    config.projects = projects;
    const project = object(projects[cwd]);
    projects[cwd] = project;
    return project;
  }
  async add(request: JsonObject, cwd: string) {
    const name = stringField(request, "name");
    const scope = typeof request.scope === "string" ? request.scope : "local";
    const server = validateMcpConfig(request);
    await this.target(cwd, scope).update((config) => {
      const section = this.section(config, cwd, scope);
      const servers = object(section.mcpServers);
      section.mcpServers = servers;
      Object.defineProperty(servers, name, {
        value: server,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return config;
    });
    return {
      success: true,
      message: `Server '${name}' added successfully to ${scope} scope`,
    };
  }
  async remove(name: string, cwd: string, scope: string) {
    await this.target(cwd, scope).update((config) => {
      const section = this.section(config, cwd, scope);
      const servers = object(section.mcpServers);
      if (!Object.hasOwn(servers, name))
        throw new HttpError(
          404,
          `Server '${name}' not found in ${scope} scope`,
        );
      delete servers[name];
      return config;
    });
    return {
      success: true,
      message: `Server '${name}' removed successfully from ${scope} scope`,
    };
  }
  async toggle(name: string, cwd: string, enabled: boolean) {
    absolutePath(cwd);
    await this.userConfig.update((config) => {
      const project = object(object(config.projects)[cwd]);
      if (!Object.hasOwn(object(config.projects), cwd))
        throw new HttpError(404, "Project not found");
      const list = project.disabledMcpServers ?? [];
      if (!Array.isArray(list)) throw new Error("Invalid disabledMcpServers");
      project.disabledMcpServers = enabled
        ? list.filter((v) => v !== name)
        : [...new Set([...list, name])];
      return config;
    });
    return {
      success: true,
      message: `Server '${name}' ${enabled ? "enabled" : "disabled"} successfully`,
    };
  }
  async projects() {
    return Object.keys(object((await this.userConfig.read()).projects)).sort();
  }
  async allowProject(cwd: string, toolName: string) {
    await this.store(
      join(absolutePath(cwd), ".claude", "settings.json"),
    ).update((config) => {
      const permissions = object(config.permissions);
      config.permissions = permissions;
      const allow = permissions.allow ?? [];
      if (!Array.isArray(allow)) throw new Error("Invalid permissions.allow");
      permissions.allow = [...new Set([...allow, toolName])];
      return config;
    });
  }
  async skills() {
    const root = join(this.claudeHome, "skills");
    const names: string[] = [];
    for (const entry of await entries(root))
      if (
        (await stat(join(root, entry, "SKILL.md")).catch(() => null))?.isFile()
      )
        names.push(entry);
    return names.sort();
  }
  async slashCommands(cwd?: string) {
    const names = new Set([
      "clear",
      "compact",
      "context",
      "cost",
      "help",
      "init",
      "login",
      "logout",
      "model",
      "pr-comments",
      "release-notes",
      "review",
      "todos",
    ]);
    for (const root of [
      join(this.claudeHome, "commands"),
      ...(cwd ? [join(absolutePath(cwd), ".claude", "commands")] : []),
    ])
      for (const entry of await entries(root))
        if (entry.endsWith(".md")) names.add(entry.slice(0, -3));
    return [...names].sort();
  }
}
async function entries(path: string) {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
export function validateMcpConfig(value: unknown): JsonObject {
  const input = bodyObject(value);
  const type = input.type ?? (input.url ? "http" : "stdio");
  if (!["stdio", "http", "sse"].includes(String(type)))
    throw new HttpError(400, "Invalid MCP transport");
  const result: JsonObject = { type };
  if (type === "stdio") {
    result.command = stringField(input, "command");
    if (input.args !== undefined && input.args !== null) {
      if (
        !Array.isArray(input.args) ||
        input.args.some((v) => typeof v !== "string" || v.includes("\0"))
      )
        throw new HttpError(400, "Invalid MCP args");
      result.args = input.args;
    }
  } else {
    const url = stringField(input, "url");
    if (!["https:", "http:"].includes(new URL(url).protocol))
      throw new HttpError(400, "Invalid MCP URL");
    result.url = url;
  }
  for (const field of ["env", "headers"])
    if (input[field] !== undefined && input[field] !== null) {
      const values = bodyObject(input[field]);
      if (Object.values(values).some((v) => typeof v !== "string"))
        throw new HttpError(400, `Invalid ${field}`);
      result[field] = values;
    }
  if (input.enabled === false) result.enabled = false;
  return result;
}
