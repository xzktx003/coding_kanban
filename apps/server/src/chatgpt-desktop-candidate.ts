import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createChatGptDesktopProfileService } from "./services/chatgpt-desktop-profile.js";
import { registerChatGptDesktopRoutes } from "./routes/chatgpt-desktop.js";
import { registerChatGptDesktopBridgeRoutes } from "./routes/chatgpt-desktop-bridge.js";
import { createChatGptDesktopSurfaceOptions } from "./routes/chatgpt-desktop-surface-config.js";

/** These server-only options are fixed at construction and never come from HTTP. */
export async function createChatGptDesktopCandidate(options: { profileFile: string; splitPane?: boolean; sharedThread?: boolean }) {
  const { profileFile } = options;
  const splitPane = Object.hasOwn(options, "splitPane") ? options.splitPane : false;
  const sharedThread = Object.hasOwn(options, "sharedThread") ? options.sharedThread : false;
  if (typeof splitPane !== "boolean" || typeof sharedThread !== "boolean") {
    throw new Error("Invalid ChatGPT candidate surface configuration");
  }
  if (typeof profileFile !== "string" || !isAbsolute(profileFile) || resolve(profileFile) !== profileFile || /[\0-\x1f\x7f]/.test(profileFile)) {
    throw new Error("Invalid ChatGPT candidate profile");
  }
  const app = Fastify({ logger: false });
  const profileService = createChatGptDesktopProfileService({ profileFile });
  await app.register(websocket);
  await app.register(registerChatGptDesktopRoutes, { ...createChatGptDesktopSurfaceOptions({ splitPane, sharedThread }), profileService });
  await app.register(registerChatGptDesktopBridgeRoutes, { profileService });
  return app;
}

async function main() {
  const raw = process.env.CHATGPT_DESKTOP_CANDIDATE_PORT;
  const profileFile = process.env.CHATGPT_DESKTOP_PROFILE_FILE;
  if (!raw || !/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535 || !profileFile) {
    throw new Error("Invalid ChatGPT candidate configuration");
  }
  const app = await createChatGptDesktopCandidate({ profileFile });
  // No general backend or LAN listener is created by the candidate gateway.
  await app.listen({ host: "127.0.0.1", port: Number(raw) });
  process.stdout.write("ChatGPT candidate gateway ready\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("ChatGPT candidate gateway unavailable\n");
    process.exitCode = 1;
  });
}
