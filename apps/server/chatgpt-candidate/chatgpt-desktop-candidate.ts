import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { installChatGptCandidateAuth, installChatGptWorkbenchAccess } from "./chatgpt-candidate-auth.mjs";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createChatGptDesktopProfileService } from "../src/services/chatgpt-desktop-profile.js";
import { registerChatGptDesktopRoutes } from "../src/routes/chatgpt-desktop.js";
import { registerChatGptDesktopBridgeRoutes } from "../src/routes/chatgpt-desktop-bridge.js";
import { createChatGptDesktopSurfaceOptions } from "../src/routes/chatgpt-desktop-surface-config.js";
import { registerChatGptDesktopSshRoutes } from "../src/routes/chatgpt-desktop-ssh.js";
import { registerChatGptDesktopSshConnectionRoutes } from "../src/routes/chatgpt-desktop-ssh-connections.js";
import { createChatGptSshConnections } from "../src/services/chatgpt-desktop-ssh-connections.js";
import { startChatGptSshConnectionIpc } from "../src/services/chatgpt-desktop-ssh-ipc.js";
import { createChatGptSshAliasDiscovery, type ChatGptSshAliasDiscoveryOptions } from "../src/services/chatgpt-desktop-ssh-aliases.js";

export interface ChatGptDesktopCandidateOptions {
  profileFile: string;
  authTokenFile?: string;
  /** Explicitly reuse the existing workbench access boundary without a second password. */
  accessMode?: "token" | "workbench";
  workbenchOrigin?: string;
  /** Fixed by the server owner at construction; HTTP cannot select a surface. */
  splitPane?: boolean;
  /** Enable the matching shared-thread document/assets; constructor-only opt-in. */
  sharedThread?: boolean;
  /** Fixed server SSH config and exact original member; disabled when absent. */
  sshDiscovery?: ChatGptSshAliasDiscoveryOptions;
  /** Single server owner; UDS path comes only from the fixed ready profile. */
  sshConnections?: { runtimeRoot: string; sshBinary?: string };
}

/** Parse only the fixed CLI environment value, without truthy-string coercion. */
export function parseChatGptDesktopCandidateSplitPane(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid ChatGPT candidate surface configuration");
}

type CandidateSignalSource = {
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
};

/** Close Fastify so its owned SSH UDS and child connections are released on restart. */
export function installChatGptDesktopCandidateShutdown(
  app: { close(): Promise<unknown> },
  signals: CandidateSignalSource = process,
) {
  let closing: Promise<unknown> | undefined;
  const close = () => {
    closing ??= app.close().catch(() => {
      process.exitCode = 1;
    });
  };
  signals.once("SIGINT", close);
  signals.once("SIGTERM", close);
}

/** Explicit CLI configuration; no socket target is accepted from environment or HTTP. */
export function parseChatGptDesktopSshConnectionsEnvironment(env: Readonly<Record<string, string | undefined>>): ChatGptDesktopCandidateOptions["sshConnections"] {
  const runtimeRoot = env.CHATGPT_DESKTOP_SSH_RUNTIME_ROOT, sshBinary = env.CHATGPT_DESKTOP_SSH_BINARY;
  if (env.CHATGPT_DESKTOP_SSH_CONTROL_SOCKET !== undefined) throw new Error("Invalid fixed SSH connection configuration");
  if (runtimeRoot === undefined && sshBinary === undefined) return undefined;
  const valid = (value: unknown): value is string => typeof value === "string" && value.length > 1 && value.length <= 4096 && isAbsolute(value) && resolve(value) === value && !/[\0-\x1f\x7f]/.test(value);
  if (!valid(runtimeRoot) || (sshBinary !== undefined && !valid(sshBinary))) throw new Error("Invalid fixed SSH connection configuration");
  return { runtimeRoot, ...(sshBinary === undefined ? {} : { sshBinary }) };
}

/** These server-only options are fixed at startup and never come from HTTP. */
export async function createChatGptDesktopCandidate(options: ChatGptDesktopCandidateOptions) {
  const { profileFile, authTokenFile, accessMode, workbenchOrigin } = options;
  if ((accessMode !== undefined && accessMode !== "token" && accessMode !== "workbench") ||
      (accessMode === "workbench" && (authTokenFile !== undefined || workbenchOrigin === undefined)) ||
      (accessMode !== "workbench" && workbenchOrigin !== undefined) ||
      (accessMode === "token" && authTokenFile === undefined)) {
    throw new Error("Invalid ChatGPT candidate authentication configuration");
  }
  const splitPane = Object.hasOwn(options, "splitPane") ? options.splitPane : false;
  const sharedThread = Object.hasOwn(options, "sharedThread") ? options.sharedThread : false;
  if (typeof splitPane !== "boolean" || typeof sharedThread !== "boolean") {
    throw new Error("Invalid ChatGPT candidate surface configuration");
  }
  if (typeof profileFile !== "string" || !isAbsolute(profileFile) || resolve(profileFile) !== profileFile || /[\0-\x1f\x7f]/.test(profileFile)) {
    throw new Error("Invalid ChatGPT candidate profile");
  }
  const discovery = options.sshDiscovery === undefined ? undefined : createChatGptSshAliasDiscovery(options.sshDiscovery);
  const app = Fastify({ logger: false });
  const profileService = createChatGptDesktopProfileService({ profileFile });
  await app.register(websocket);
  if (accessMode === "workbench") await installChatGptWorkbenchAccess(app, { origin: workbenchOrigin! });
  else if (authTokenFile !== undefined) await installChatGptCandidateAuth(app, { tokenFile: authTokenFile });
  if (options.sshConnections !== undefined) {
    const fixed = options.sshConnections;
    if (!discovery || !options.sshDiscovery || !fixed || typeof fixed !== "object" || Array.isArray(fixed) || Object.keys(fixed).some(key => !["runtimeRoot", "sshBinary"].includes(key)))
      throw new Error("Invalid fixed SSH connection configuration");
    const initial = await profileService.readValidated();
    if (initial.status.state !== "ready" || !initial.profile ||
        initial.profile.macAsarSha256 !== "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95" ||
        initial.profile.linuxAsarSha256 !== "1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e")
      throw new Error("SSH native profile is unavailable");
    const identity = JSON.stringify(Object.entries(initial.profile).sort(([a], [b]) => a.localeCompare(b)));
    const socketPath = initial.profile.serverSshSocketPath;
    if (socketPath === undefined) throw new Error("SSH native endpoint is unconfigured");
    const connections = createChatGptSshConnections({
      configPath: options.sshDiscovery.configPath, discovery, runtimeRoot: fixed.runtimeRoot,
      ...(fixed.sshBinary === undefined ? {} : { sshBinary: fixed.sshBinary }),
      readScope: async () => {
        const value = await profileService.readValidated();
        if (value.status.state !== "ready" || !value.profile ||
            JSON.stringify(Object.entries(value.profile).sort(([a], [b]) => a.localeCompare(b))) !== identity) return null;
        return { id: value.profile.id, generation: value.profile.generation, identity };
      },
    });
    const ipc = await startChatGptSshConnectionIpc({ socketPath, connections });
    app.addHook("onClose", async () => { await ipc.close(); connections.close(); });
    await app.register(registerChatGptDesktopSshConnectionRoutes, { profileService, connections });
  }
  await app.register(registerChatGptDesktopSshRoutes, { profileService, discovery });
  await app.register(registerChatGptDesktopRoutes, { ...createChatGptDesktopSurfaceOptions({ splitPane, sharedThread, sshDiscovery: discovery !== undefined }), profileService });
  await app.register(registerChatGptDesktopBridgeRoutes, { profileService });
  return app;
}

async function main() {
  const raw = process.env.CHATGPT_DESKTOP_CANDIDATE_PORT;
  const profileFile = process.env.CHATGPT_DESKTOP_PROFILE_FILE;
  const authTokenFile = process.env.CHATGPT_DESKTOP_CANDIDATE_AUTH_TOKEN_FILE;
  const accessMode = process.env.CHATGPT_DESKTOP_ACCESS_MODE ?? "token";
  const workbenchOrigin = process.env.CHATGPT_DESKTOP_WORKBENCH_ORIGIN;
  const splitPane = parseChatGptDesktopCandidateSplitPane(process.env.CHATGPT_DESKTOP_SPLIT_PANE);
  const configPath = process.env.CHATGPT_DESKTOP_SSH_CONFIG_FILE;
  const nativeMainChunkFile = process.env.CHATGPT_DESKTOP_SSH_NATIVE_CHUNK_FILE;
  const homeDirectory = process.env.CHATGPT_DESKTOP_SSH_HOME_DIRECTORY;
  const sshConnections = parseChatGptDesktopSshConnectionsEnvironment(process.env);
  const sshSelected = configPath !== undefined || nativeMainChunkFile !== undefined || homeDirectory !== undefined;
  if (!raw || !/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535 || !profileFile ||
      (accessMode !== "token" && accessMode !== "workbench") ||
      (accessMode === "token" && !authTokenFile) ||
      (sshSelected && (configPath === undefined || nativeMainChunkFile === undefined)) || (sshConnections !== undefined && !sshSelected)) {
    throw new Error("Invalid ChatGPT candidate configuration");
  }
  const app = await createChatGptDesktopCandidate({ profileFile, authTokenFile, accessMode, workbenchOrigin, splitPane,
    ...(sshConnections === undefined ? {} : { sshConnections }),
    ...(sshSelected ? { sshDiscovery: { configPath: configPath!, nativeMainChunkFile: nativeMainChunkFile!, ...(homeDirectory === undefined ? {} : { homeDirectory }) } } : {}) });
  // No general backend or LAN listener is created by the candidate gateway.
  await app.listen({ host: "127.0.0.1", port: Number(raw) });
  installChatGptDesktopCandidateShutdown(app);
  process.stdout.write("ChatGPT candidate gateway ready\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("ChatGPT candidate gateway unavailable\n");
    process.exitCode = 1;
  });
}
