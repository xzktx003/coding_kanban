import { join } from "node:path";
import type { AcpAgentDef, ResolveBot } from "../acp/types.js";
import type { EventHub } from "../core/events.js";
import { type Json, object } from "../core/json.js";
import {
  SessionDatabase,
  validDirectory,
  validId,
  parseList,
} from "../storage/database.js";
import { KekeMcpService, acpEntry } from "../keke/mcp.js";
import { DelegationTokens } from "./routes.js";
export interface BotPolicyOptions {
  db: SessionDatabase;
  dataDir: string;
  keke: KekeMcpService;
  tokens: DelegationTokens;
  hub: EventHub;
  findAgent: (id: string) => Promise<AcpAgentDef | undefined>;
  apiBaseUrl: () => string;
}
/** Every interactive and unattended bot uses the same strict MCP and trust composition. */
export function createBotResolver(options: BotPolicyOptions): ResolveBot {
  return async (botId, mode) => {
    validId(botId);
    const bot = options.db.getBot(botId);
    if (!bot || bot.archived) throw new Error("Bot is unavailable");
    validDirectory(bot.cwd);
    const preset = await options.findAgent(bot.agentId);
    if (!preset) throw new Error(`unknown ACP agent: ${bot.agentId}`);
    const agent: AcpAgentDef = {
      ...preset,
      id: `keke-bot-${bot.id}`,
      name: bot.name,
      args: [...(preset.args ?? []), "-C", bot.cwd],
      env: {
        ...preset.env,
        ...(bot.systemPrompt?.trim()
          ? { KEKE_INSTRUCTIONS: bot.systemPrompt }
          : {}),
        KEKE_MEMORY_DIR: join(options.dataDir, "bots", bot.id, "memory"),
      },
    };
    const selected: Json[] = [];
    const configured = await options.keke.read();
    for (const selectedName of parseList(bot.mcpServers)) {
      if (!selectedName.startsWith("keke:")) continue;
      const name = selectedName.slice(5);
      if (name === "codexia-bots") continue;
      const config = configured[name];
      if (!config || config.disabled === true) continue;
      try {
        selected.push(acpEntry(name, config));
      } catch (e) {
        options.hub.publish("bot:configuration-warning", {
          botId: bot.id,
          error: String(e),
        });
      }
    }
    const tokens: string[] = [];
    const policy = {
      strictMcp: true,
      mcpServers: selected,
      readOnly: bot.trustLevel === "read_only",
      ...(mode.unattended
        ? {
            unattended: {
              allowAll: bot.trustLevel === "autonomous",
              approvedTools: parseList(bot.approvedTools),
              blocked: false,
            },
          }
        : {}),
      sessionMcpServers: () => {
        const servers = structuredClone(selected);
        if (mode.allowCollaboration) {
          const base = new URL(options.apiBaseUrl());
          if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
            throw new Error("Bot delegation endpoint must be loopback");
          const token = options.tokens.issue(bot.id);
          tokens.push(token);
          const url = new URL("/mcp/bots", base);
          url.searchParams.set("from", bot.id);
          servers.unshift({
            type: "http",
            name: "codexia-bots",
            url: url.href,
            headers: [{ name: "X-Codexia-Delegation", value: token }],
          });
        }
        return servers;
      },
      onClose: () => {
        for (const token of tokens) options.tokens.revoke(token);
        tokens.length = 0;
      },
    };
    return {
      agent,
      cwd: bot.cwd,
      policy,
      selectProvider: async (client) => {
        if (bot.provider?.trim()) await client.authenticate(bot.provider);
      },
      applySettings: async (client, sessionId) => {
        const values: Record<string, string> = {
          approval_policy:
            bot.trustLevel === "autonomous" ? "never" : "on-request",
          sandbox_mode:
            bot.trustLevel === "read_only" ? "read_only" : "workspace_write",
        };
        if (bot.model) values.model = bot.model;
        if (bot.reasoningEffort) values.reasoning_effort = bot.reasoningEffort;
        for (const [key, value] of Object.entries(values)) {
          try {
            await client.setConfigOption(sessionId, key, value);
          } catch (e) {
            if (key === "sandbox_mode" && bot.trustLevel === "read_only")
              throw e;
            options.hub.publish("bot:configuration-warning", {
              botId: bot.id,
              option: key,
              error: String(e),
            });
          }
        }
      },
    };
  };
}
