import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  bodyObject,
  HttpError,
  object,
  stringField,
  type JsonObject,
} from "../core/json.js";
import { getTomlStore } from "../config/toml-store.js";
import { ClaudeConfig, absolutePath, validateMcpConfig } from "./config.js";
export function registerUnifiedMcpRoutes(
  app: FastifyInstance,
  config: ClaudeConfig,
) {
  const codex = getTomlStore(
    join(
      absolutePath(config.env.CODEX_HOME ?? join(config.home, ".codex")),
      "config.toml",
    ),
  );
  for (const action of ["read", "add", "remove", "enable", "disable"])
    app.post(`/api/codex/mcp/${action}`, async (req, reply) => {
      const p = bodyObject(req.body);
      const client = p.client_name ?? p.clientName;
      const name =
        action === "read"
          ? ""
          : stringField({ name: p.server_name ?? p.serverName }, "name");
      if (client === "codex") {
        if (action === "read") {
          const raw = object((await codex.read()).mcp_servers);
          const servers: JsonObject = {};
          for (const [key, value] of Object.entries(raw)) {
            const input = object(value);
            const server = validateMcpConfig(input);
            if (server.type === "stdio" && !server.args) server.args = [];
            Object.defineProperty(servers, key, {
              value: server,
              enumerable: true,
            });
          }
          return { mcpServers: servers };
        }
        await codex.update((root) => {
          const servers = object(root.mcp_servers);
          root.mcp_servers = servers;
          if (action === "add") {
            const value = validateMcpConfig(p.server_config ?? p.serverConfig);
            if (value.type === "stdio" && !value.args) value.args = [];
            Object.defineProperty(servers, name, {
              value,
              enumerable: true,
              writable: true,
              configurable: true,
            });
          } else {
            if (!Object.hasOwn(servers, name))
              throw new HttpError(404, `MCP server '${name}' not found`);
            if (action === "remove") delete servers[name];
            else {
              const server = bodyObject(servers[name]);
              if (action === "enable") delete server.enabled;
              else server.enabled = false;
            }
          }
          return root;
        });
      } else if (client === "cc") {
        const scope = typeof p.scope === "string" ? p.scope : "local";
        const cwd =
          typeof p.path === "string"
            ? p.path
            : action === "add" && scope === "global"
              ? ""
              : stringField(p, "path");
        if (action === "read") {
          const entries = await config.list(cwd);
          return {
            mcpServers: Object.fromEntries(
              entries.map(({ name, ...entry }) => [String(name), entry]),
            ),
          };
        }
        if (action === "add")
          await config.add(
            { ...bodyObject(p.server_config ?? p.serverConfig), name, scope },
            cwd,
          );
        else if (action === "remove")
          await config.remove(name, cwd, stringField(p, "scope"));
        else await config.toggle(name, cwd, action === "enable");
      } else throw new HttpError(400, `Unknown client: ${String(client)}`);
      return reply.code(200).send();
    });
}
