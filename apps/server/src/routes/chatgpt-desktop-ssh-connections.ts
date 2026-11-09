import type { FastifyInstance } from "fastify";
import type { ChatGptSshConnections } from "../services/chatgpt-desktop-ssh-connections.js";
import type { ChatGptDesktopProfileResult } from "../services/chatgpt-desktop-profile.js";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAC = "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
  LINUX = "1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e";
const CODES = new Set([
  "SSH_PROFILE_CHANGED",
  "SSH_ALIAS_UNAVAILABLE",
  "SSH_ALIAS_NOT_SAVED",
  "SSH_REQUEST_INVALID",
  "SSH_CONNECTION_EXISTS",
  "SSH_CONNECTION_UNAVAILABLE",
  "SSH_CONNECTION_LIMIT",
  "SSH_CONFIG_UNSAFE",
]);
const shape = (
  value: unknown,
  fields: string[],
): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === fields.length &&
  Object.keys(value).every((k) => fields.includes(k));
interface Options {
  profileService: { readValidated(): Promise<ChatGptDesktopProfileResult> };
  connections?: ChatGptSshConnections;
}
/** All authority/configuration is server construction. HTTP carries selected aliases only. */
export async function registerChatGptDesktopSshConnectionRoutes(
  app: FastifyInstance,
  options: Options,
) {
  const prefix = "/api/chatgpt-desktop/:id/:generation/ssh";
  for (const [method, suffix, fields] of [
    ["GET", "connections", []],
    ["POST", "aliases", ["aliases"]],
  ] as const) {
    app.route<{ Params: { id: string; generation: string } }>({
      method,
      url: prefix + "/" + suffix,
      bodyLimit: 16 * 1024,
      exposeHeadRoute: false,
      async handler(request, reply) {
        reply
          .header("Cache-Control", "no-store")
          .header("Referrer-Policy", "no-referrer")
          .header("X-Content-Type-Options", "nosniff");
        if (
          request.raw.url?.includes("?") ||
          !UUID.test(request.params.id) ||
          !UUID.test(request.params.generation) ||
          (method === "POST" && !shape(request.body, [...fields]))
        )
          return reply.code(400).send({ reasonCode: "SSH_REQUEST_INVALID" });
        let first: ChatGptDesktopProfileResult;
        try {
          first = await options.profileService.readValidated();
        } catch {
          return reply
            .code(503)
            .send({ reasonCode: "SSH_PROFILE_UNAVAILABLE" });
        }
        if (first.status.state !== "ready" || !first.profile)
          return reply
            .code(503)
            .send({ reasonCode: "SSH_PROFILE_UNAVAILABLE" });
        const original = first.profile;
        if (
          original.id !== request.params.id ||
          original.generation !== request.params.generation
        )
          return reply.code(409).send({ reasonCode: "SSH_PROFILE_CHANGED" });
        if (
          original.macAsarSha256 !== MAC ||
          original.linuxAsarSha256 !== LINUX
        )
          return reply
            .code(503)
            .send({ reasonCode: "SSH_DISCOVERY_VERSION_UNAVAILABLE" });
        if (!options.connections)
          return reply
            .code(503)
            .send({ reasonCode: "SSH_CONNECTIONS_UNCONFIGURED" });
        const scope = { id: original.id, generation: original.generation },
          body = request.body as Record<string, unknown>;
        try {
          let result: unknown;
          if (suffix === "connections")
            result = await options.connections.refresh(scope);
          else if (suffix === "aliases") {
            if (
              !Array.isArray(body.aliases) ||
              body.aliases.some((x) => typeof x !== "string")
            )
              return reply
                .code(400)
                .send({ reasonCode: "SSH_REQUEST_INVALID" });
            result = await options.connections.save(body.aliases, scope);
          }
          const after = await options.profileService.readValidated();
          if (
            after.status.state !== "ready" ||
            !after.profile ||
            Object.entries(original).some(
              ([key, value]) =>
                after.profile![key as keyof typeof original] !== value,
            )
          )
            return reply.code(409).send({ reasonCode: "SSH_PROFILE_CHANGED" });
          // The service projection contains no socket/config paths, initialize data
          // or RPC bodies. Native bytes use the owned UDS, never this HTTP API.
          return result;
        } catch (error) {
          const code = (error as { code?: unknown })?.code;
          const reasonCode =
            typeof code === "string" && CODES.has(code)
              ? code
              : "SSH_CONNECTION_FAILED";
          return reply
            .code(
              reasonCode === "SSH_PROFILE_CHANGED" ||
                reasonCode === "SSH_CONNECTION_EXISTS"
                ? 409
                : reasonCode === "SSH_REQUEST_INVALID"
                  ? 400
                  : 503,
            )
            .send({ reasonCode });
        }
      },
    });
  }
}
