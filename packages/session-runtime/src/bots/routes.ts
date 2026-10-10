import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { object, type JsonObject } from "../core/json.js";
import {
  SessionDatabase,
  parseList,
  validId,
  type BotPatch,
} from "../storage/database.js";
export class DelegationTokens {
  private issued = new Map<string, string>();
  issue(botId: string) {
    validId(botId);
    const token = randomBytes(32).toString("hex");
    this.issued.set(token, botId);
    return token;
  }
  verify(token: string, botId: string) {
    return this.issued.get(token) === botId;
  }
  revoke(token: string) {
    this.issued.delete(token);
  }
  clear() {
    this.issued.clear();
  }
}
export interface BotRoutesOptions {
  db: SessionDatabase;
  tokens: DelegationTokens;
  track?: (event: "bot_created" | "bot_ask") => void | Promise<void>;
  deleteAutomationsForBot?: (botId: string) => Promise<void>;
  runBotUnattended: (
    botId: string,
    prompt: string,
    cwd?: string,
    allowCollaboration?: boolean,
  ) => Promise<{ sessionId: string; reply: string; blocked: boolean }>;
}
const textResult = (text: string, isError = false) => ({
  content: [{ type: "text", text }],
  isError,
});
export function registerBotRoutes(
  app: FastifyInstance,
  options: BotRoutesOptions,
) {
  const { db, tokens } = options;
  const track = (event: "bot_created" | "bot_ask") => {
    void Promise.resolve()
      .then(() => options.track?.(event))
      .catch(() => {});
  };
  app.post("/api/bots/list", (req) =>
    db.listBots(
      (req.body as { include_archived?: boolean }).include_archived ?? false,
    ),
  );
  app.post("/api/bots/create", (req) => {
    const bot = db.createBot(
      req.body as Parameters<SessionDatabase["createBot"]>[0],
    );
    track("bot_created");
    return bot;
  });
  app.post("/api/bots/update", (req) => {
    const b = req.body as BotPatch & { id: string };
    return db.updateBot(b.id, b);
  });
  app.post("/api/bots/delete", async (req) => {
    const id = (req.body as { id: string }).id;
    await options.deleteAutomationsForBot?.(id);
    db.deleteBot(id);
    return null;
  });
  app.post("/api/bots/sessions", (req) => {
    const b = req.body as { botId: string; limit?: number };
    return db.listBotSessions(b.botId, b.limit);
  });
  app.post("/mcp/bots", async (req, reply) => {
    const from = (req.query as { from?: string }).from ?? "";
    const token = req.headers["x-codexia-delegation"];
    if (typeof token !== "string" || !tokens.verify(token, from))
      return reply.code(401).send();
    const message = object(req.body);
    if (typeof message.method !== "string" || !Object.hasOwn(message, "id"))
      return reply.code(202).send();
    const params = object(message.params);
    let result: unknown;
    switch (message.method) {
      case "initialize":
        result = {
          protocolVersion:
            typeof params.protocolVersion === "string"
              ? params.protocolVersion
              : "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "codexia-bots", version: "0.1.0" },
          instructions:
            "Call list_bots to see colleagues, then ask_bot with a self-contained request.",
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = {
          tools: [
            {
              name: "list_bots",
              description: "List other bots authorized for collaboration.",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "ask_bot",
              description:
                "Hand a job to another bot with its own permissions.",
              inputSchema: {
                type: "object",
                properties: {
                  bot: { type: "string" },
                  message: { type: "string" },
                },
                required: ["bot", "message"],
              },
            },
          ],
        };
        break;
      case "tools/call":
        try {
          const caller = db.getBot(from);
          if (!caller || caller.archived)
            throw new Error("collaboration requires an active caller bot");
          const allowed = parseList(caller.allowedBotIds);
          const bots = db
            .listBots()
            .filter((b) => b.id !== from && allowed.includes(b.id));
          if (params.name === "list_bots") {
            result = textResult(
              JSON.stringify(
                bots.map(({ id, name, title }) => ({ id, name, title })),
              ),
            );
            break;
          }
          if (params.name !== "ask_bot")
            throw new Error(`unknown tool: ${String(params.name)}`);
          const args = object(params.arguments);
          const wanted = typeof args.bot === "string" ? args.bot.trim() : "";
          const prompt =
            typeof args.message === "string" ? args.message.trim() : "";
          if (!prompt) throw new Error("message is required");
          const target = bots.find(
            (b) =>
              b.id === wanted || b.name.toLowerCase() === wanted.toLowerCase(),
          );
          if (!target)
            throw new Error("target bot is unavailable or not authorized");
          track("bot_ask");
          const report = await options.runBotUnattended(
            target.id,
            `${caller.name} asks:\n\n${prompt}`,
            undefined,
            false,
          );
          result = textResult(
            report.reply +
              (report.blocked
                ? "\n\n(Note: part of this job was refused because it needed an approval this bot does not have.)"
                : ""),
          );
        } catch (e) {
          result = textResult(e instanceof Error ? e.message : String(e), true);
        }
        break;
      default:
        return {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32601,
            message: `method not found: ${message.method}`,
          },
        };
    }
    return { jsonrpc: "2.0", id: message.id, result };
  });
}
