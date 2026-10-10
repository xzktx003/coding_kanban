import { join } from "node:path";
import { getTomlStore } from "../config/toml-store.js";
import { codexHome } from "./accounts.js";
import { sanitizeCodexHistory } from "./projection.js";
import type { FastifyInstance } from "fastify";
import {
  bodyObject,
  HttpError,
  isObject,
  object,
  type Json,
} from "../core/json.js";
import type { CodexService } from "./client.js";
import {
  boundedText,
  cancelLogin,
  logout,
  readConfig,
  readRequirements,
  searchOccurrences,
  unsupported,
} from "./protocol.js";
export function registerCodexRoutes(
  app: FastifyInstance,
  service: CodexService,
): void {
  const post = (path: string, handler: (body: Json) => Promise<Json>) =>
    app.post("/api/codex/" + path, async (request, reply) => {
      const result = sanitizeCodexHistory(
        await handler(bodyObject(request.body)),
      );
      return reply.type("application/json").send(JSON.stringify(result));
    });
  const methods: Record<string, string> = {};
  for (const path of [
    "thread/start",
    "thread/resume",
    "thread/fork",
    "thread/list",
    "thread/archive",
    "thread/unarchive",
    "thread/loaded/list",
    "thread/turns/list",
    "thread/items/list",
    "thread/unsubscribe",
    "thread/delete",
    "thread/goal/set",
    "thread/goal/get",
    "thread/goal/clear",
    "thread/compact/start",
    "memory/reset",
    "hooks/list",
    "plugin/list",
    "plugin/read",
    "plugin/install",
    "plugin/uninstall",
    "plugin/installed",
    "turn/start",
    "turn/steer",
    "turn/interrupt",
    "review/start",
    "model/list",
    "skills/list",
    "skills/config/write",
  ])
    methods[path] = path;
  Object.assign(methods, {
    "start-thread": "thread/start",
    "thread/rename": "thread/name/set",
    "thread/memory-mode/set": "thread/memoryMode/set",
    "external-agent-config/detect": "externalAgentConfig/detect",
    "external-agent-config/import": "externalAgentConfig/import",
    "external-agent-config/import/record-history":
      "externalAgentConfig/import/recordHistory",
    "external-agent-config/import/read-histories":
      "externalAgentConfig/import/readHistories",
    "account/get": "account/read",
    "mcp/oauth/login": "mcpServer/oauth/login",
    "mcp/status/list": "mcpServerStatus/list",
  });
  for (const [path, method] of Object.entries(methods))
    post(path, (body) =>
      method === "skills/config/write"
        ? getTomlStore(
            join(codexHome(service.options.env ?? process.env), "config.toml"),
          ).exclusive(() => service.call(method, body))
        : service.call(method, body),
    );
  app.get("/api/codex/model/list", () => service.raw("model/list", {}));
  app.get("/api/codex/account/rate-limits", () =>
    service.raw("account/rateLimits/read", null),
  );
  const thread = (body: Json) =>
    boundedText(object(body).threadId, 512, "threadId", true);
  post("thread/read", (body) => service.readHistory(thread(body)));
  post("thread/metadata", (body) =>
    service.raw("thread/read", { threadId: thread(body), includeTurns: false }),
  );
  post("thread/access", (body) =>
    object(body).release === true
      ? service.ownership.release(thread(body))
      : service.ownership.access(thread(body)),
  );
  post("thread/rollback", (body) => service.rollback(bodyObject(body)));
  post("thread/search-occurrences", (body) =>
    readonly(
      () => searchOccurrences(body, service.raw),
      ["thread/searchOccurrences"],
    ),
  );
  post("config/read", (body) =>
    readonly(() => readConfig(body, service.raw), ["config/read"]),
  );
  post("config/requirements/read", (body) =>
    readonly(
      () => readRequirements(body, service.raw),
      ["configRequirements/read"],
    ),
  );
  post("agents/roles", async (body) => {
    const response = object(
      await service.raw("config/read", {
        cwd: typeof object(body).cwd === "string" ? object(body).cwd : null,
        includeLayers: false,
      }),
    );
    const roles = Object.entries(
      object(object(response.config).agents),
    ).flatMap(([name, config]) =>
      /^[a-zA-Z0-9_:-]{1,160}$/.test(name) && isObject(config)
        ? [
            {
              name,
              description:
                typeof config.description === "string"
                  ? config.description
                  : "",
            },
          ]
        : [],
    );
    return { roles };
  });
  post("account/login", (body) =>
    service.accountOperations.run("account", () =>
      service.raw("account/login/start", body),
    ),
  );
  post("account/login/cancel", (body) =>
    service.accountOperations.run("account", () =>
      cancelLogin(body, service.options.instance, service.raw),
    ),
  );
  post("account/logout", (body) =>
    service.accountOperations.run("account", () =>
      logout(body, service.options.instance, service.raw),
    ),
  );
  for (const [path, kind] of Object.entries({
    "command-execution": "commandExecution",
    "file-change": "fileChange",
    "user-input": "requestUserInput",
    "mcp-elicitation": "mcpServerElicitation",
    permissions: "permissionsApproval",
  }))
    app.post("/api/codex/approval/" + path, async (request, reply) => {
      await service.respond(kind, bodyObject(request.body));
      return reply.code(200).send();
    });
  app.post("/api/internal/codex/queue-holds", async (request) => {
    const body = bodyObject(request.body);
    if (
      typeof body.busy !== "boolean" ||
      !Array.isArray(body.threadIds) ||
      body.threadIds.length > 10000 ||
      body.threadIds.some(
        (id) =>
          typeof id !== "string" ||
          !id ||
          Buffer.byteLength(id) > 512 ||
          /[\x00-\x1f]/.test(id),
      )
    )
      throw new HttpError(400, "Invalid queue ownership snapshot");
    if (
      typeof body.sequence !== "string" ||
      !/^\d{1,39}$/.test(body.sequence) ||
      BigInt(body.sequence) >= 1n << 128n
    )
      throw new HttpError(400, "Invalid queue sequence");
    if (
      !service.ownership.queueUpdate(
        BigInt(body.sequence),
        body.busy,
        body.threadIds as string[],
      )
    )
      throw new HttpError(409, "Stale queue ownership snapshot");
    return { ok: true };
  });
}
async function readonly(
  work: () => Promise<Json>,
  methods: string[],
): Promise<Json> {
  try {
    return await work();
  } catch (error) {
    if (unsupported(error, methods))
      throw new HttpError(
        501,
        "This Codex version does not support " + methods.join(", "),
      );
    throw error;
  }
}
