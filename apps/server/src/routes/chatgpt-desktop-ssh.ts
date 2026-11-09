import type { FastifyInstance } from "fastify";
import type { ChatGptDesktopProfileResult } from "../services/chatgpt-desktop-profile.js";
import type { ChatGptSshAliasDiscovery } from "../services/chatgpt-desktop-ssh-aliases.js";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAC = "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95";
const LINUX = "1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e";
const REASONS = new Set(["SSH_DISCOVERY_VERSION_UNAVAILABLE", "SSH_CONFIG_UNSAFE", "SSH_CONFIG_LIMIT", "SSH_CONFIG_CHANGED", "SSH_DISCOVERY_FAILED"]);
interface Options {
  profileService: { readValidated(): Promise<ChatGptDesktopProfileResult> };
  /** Server construction only. There is no HTTP config, host, path or command argument. */
  discovery?: ChatGptSshAliasDiscovery;
}

export async function registerChatGptDesktopSshRoutes(app: FastifyInstance, options: Options) {
  app.route<{ Params: { id: string; generation: string } }>({
    method: "GET", url: "/api/chatgpt-desktop/:id/:generation/ssh/discover", exposeHeadRoute: false,
    async handler(request, reply) {
      reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Content-Type-Options", "nosniff");
      if (request.raw.url?.includes("?") || !UUID.test(request.params.id) || !UUID.test(request.params.generation))
        return reply.code(400).send({ reasonCode: "SSH_REQUEST_INVALID" });
      let first: ChatGptDesktopProfileResult;
      try { first = await options.profileService.readValidated(); }
      catch { return reply.code(503).send({ reasonCode: "SSH_PROFILE_UNAVAILABLE" }); }
      if (first.status.state !== "ready" || !first.profile)
        return reply.code(503).send({ reasonCode: "SSH_PROFILE_UNAVAILABLE" });
      const identity = Object.freeze({ ...first.profile });
      if (identity.id !== request.params.id || identity.generation !== request.params.generation)
        return reply.code(409).send({ reasonCode: "SSH_PROFILE_CHANGED" });
      if (identity.macAsarSha256 !== MAC || identity.linuxAsarSha256 !== LINUX)
        return reply.code(503).send({ reasonCode: "SSH_DISCOVERY_VERSION_UNAVAILABLE" });
      if (!options.discovery) return reply.code(503).send({ reasonCode: "SSH_DISCOVERY_UNCONFIGURED" });
      try {
        const value = await options.discovery.discover();
        const next = await options.profileService.readValidated();
        if (next.status.state !== "ready" || !next.profile || Object.entries(identity).some(([key, value]) => next.profile![key as keyof typeof identity] !== value))
          return reply.code(409).send({ reasonCode: "SSH_PROFILE_CHANGED" });
        if (!value || !Array.isArray(value.sshAliases) || value.sshAliases.length > 512 || value.sshAliases.some(alias => typeof alias !== "string" || !alias.length) ||
            !["ready", "missing"].includes(value.configState) || Buffer.byteLength(JSON.stringify({ sshAliases: value.sshAliases })) > 64 * 1024)
          return reply.code(503).send({ reasonCode: "SSH_DISCOVERY_FAILED" });
        reply.header("X-ChatGPT-SSH-Config-State", value.configState);
        // Exact original sshConnections.discover() shape. Do not invent resolved
        // host, username, port, key metadata, saved catalog entries or connection state.
        return { sshAliases: value.sshAliases };
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        return reply.code(503).send({ reasonCode: REASONS.has(code) ? code : "SSH_DISCOVERY_FAILED" });
      }
    },
  });
}
