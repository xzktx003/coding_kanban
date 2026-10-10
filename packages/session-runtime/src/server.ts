import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { EventHub } from "./core/events.js";
import { JsonStore } from "./core/json-store.js";
import { bodyObject } from "./core/json.js";
import { registerRuntimeCors } from "./transport/cors.js";
import { registerEventRoutes } from "./transport/events.js";
import { FileWatches } from "./services/file-watches.js";
import { registerFilesystemRoutes } from "./services/filesystem.js";
import { Terminals, registerTerminalRoutes } from "./services/terminal.js";

import { CodexService } from "./codex/client.js";
import { registerCodexRoutes } from "./codex/routes.js";
import {
  registerCodexConfigRoutes,
  resolveCodexEnv,
} from "./codex/providers.js";
import { codexRunner } from "./codex/automation.js";
import { createClaudeService } from "./claude/service.js";
import { registerClaudeRoutes } from "./claude/routes.js";
import { registerUnifiedMcpRoutes } from "./claude/mcp.js";
import { createAcpService, registerAcpRoutes } from "./acp/index.js";
import { SessionDatabase } from "./storage/database.js";
import { GitService, registerGitRoutes } from "./git/index.js";
import { registerSkillsRoutes } from "./skills/index.js";
import {
  AutomationService,
  registerAutomationRoutes,
} from "./automation/service.js";
import { automationWorktree } from "./automation/worktree.js";
import { botAutomationRunner } from "./automation/bot-runner.js";
import { DelegationTokens, registerBotRoutes } from "./bots/routes.js";
import { createBotResolver } from "./bots/policy.js";
import { KekeMcpService, registerKekeRoutes } from "./keke/mcp.js";
import { ImportService, registerImportRoutes } from "./import/service.js";
import {
  createPlatformServices,
  registerPlatformRoutes,
} from "./platform/index.js";

export interface RuntimeOptions {
  dataHome: string;
  instance: string;
  allowedOrigins?: string[];
  env?: NodeJS.ProcessEnv;
}

export async function createRuntime(options: RuntimeOptions) {
  if (!isAbsolute(options.dataHome) || /[\x00-\x1f]/.test(options.dataHome))
    throw new Error("SESSION_DATA_HOME must be an absolute path");
  if (
    !options.instance.trim() ||
    options.instance.length > 512 ||
    /[\x00-\x1f]/.test(options.instance)
  )
    throw new Error("Invalid runtime instance");
  const app = Fastify({
    logger: false,
    bodyLimit: 16 * 1024 * 1024,
    forceCloseConnections: true,
  });
  const cleanup: Array<() => unknown | Promise<unknown>> = [];
  let disposing: Promise<void> | undefined;
  const dispose = () =>
    (disposing ??= (async () => {
      const failures: unknown[] = [];
      // Reverse acquisition order keeps database/event infrastructure alive until
      // every native adapter has drained its callbacks. One failure cannot skip peers.
      for (const release of cleanup.reverse()) {
        try {
          await release();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length)
        throw new AggregateError(failures, "Runtime cleanup failed");
    })());
  app.addHook("preClose", dispose);
  try {
    const hub = new EventHub();
    cleanup.push(() => hub.close());
    const env = options.env ?? process.env;
    const watchLimit = Number(env.SESSION_FS_WATCH_MAX_DIRS);
    const watches = new FileWatches(hub, {
      maxDirectories:
        Number.isInteger(watchLimit) && watchLimit > 0 && watchLimit <= 65536
          ? watchLimit
          : 1024,
    });
    cleanup.push(() => watches.close());
    const terminals = new Terminals(hub, { env });
    cleanup.push(() => terminals.close());
    const settings = new JsonStore(
      join(options.dataHome, ".codexia", "settings.json"),
      () => ({ version: 1, workspace: { projects: [], historyProjects: [] } }),
    );
    const dataDir = join(options.dataHome, ".codexia");
    const db = new SessionDatabase(dataDir);
    cleanup.push(() => db.close());
    const codex = new CodexService({
      hub,
      instance: options.instance,
      env,
      resolveEnv: () => resolveCodexEnv(dataDir, env),
    });
    cleanup.push(() => codex.close());
    const claude = createClaudeService({
      hub,
      dataHome: options.dataHome,
      env,
    });
    cleanup.push(() => claude.close());
    const acp = createAcpService({
      hub,
      dataHome: options.dataHome,
      env,
      history: db,
    });
    cleanup.push(() => acp.close());
    const git = new GitService({ dataHome: options.dataHome, env });
    const tokens = new DelegationTokens();
    cleanup.push(() => tokens.clear());
    const keke = new KekeMcpService({
      home: join(env.HOME ?? homedir(), ".keke"),
      env,
      findAgent: async () =>
        (await acp.listAgents()).find((agent) => agent.id === "keke"),
    });
    const platform = await createPlatformServices({
      dataHome: options.dataHome,
      hub,
      env,
      hasBots: () => db.listBots(false).length > 0,
    });
    cleanup.push(() => platform.close());
    acp.setBotResolver(
      createBotResolver({
        db,
        dataDir,
        keke,
        tokens,
        hub,
        findAgent: async (id) =>
          (await acp.listAgents()).find((agent) => agent.id === id),
        apiBaseUrl: () => {
          const address = app.server.address();
          if (!address || typeof address === "string")
            throw new Error("Runtime is not listening");
          return `http://127.0.0.1:${address.port}`;
        },
      }),
    );
    const automation = new AutomationService({
      dataDir,
      db,
      hub,
      runners: {
        codex: codexRunner(codex, hub),
        cc: (spec) => claude.runAutomation(spec),
        bot: botAutomationRunner(acp),
      },
      prepareWorktree: automationWorktree(git),
      track: (event) => platform.telemetry.track(event),
    });
    cleanup.push(() => automation.close());
    app.addHook("onListen", async () => {
      automation.startScheduler();
    });
    app.setErrorHandler((error, _request, reply) => {
      const failure = error as { statusCode?: number; message?: string };
      reply
        .code(
          failure.statusCode ??
            (/SESSION_|SUBAGENT_DIRECT_INPUT_DISABLED/.test(
              failure.message ?? "",
            )
              ? 409
              : /DELIVERY_UNKNOWN/.test(failure.message ?? "")
                ? 502
                : 500),
        )
        .send({ error: failure.message ?? "Runtime request failed" });
    });
    registerRuntimeCors(app, { allowedOrigins: options.allowedOrigins });
    app.addHook("onRequest", async (request, reply) => {
      if (
        request.method === "GET" &&
        request.url.split("?", 1)[0] === "/health"
      )
        return;
      if (!platform.deviceToken.permits(request))
        return reply.code(401).send({ error: "Unauthorized" });
    });
    await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
    app.get("/health", async () => ({
      status: "ok",
      instance: options.instance,
      runtime: "typescript",
      capabilities: {
        codexOwnership: true,
        codexAccountMutationsV1: true,
        acpImages: true,
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));
    app.get("/api/settings", () => settings.read());
    app.post("/api/settings", async (request, reply) => {
      await settings.write(bodyObject(request.body));
      return reply.code(200).send();
    });
    registerEventRoutes(app, hub);
    registerFilesystemRoutes(app, watches, env);
    registerTerminalRoutes(app, terminals);
    registerCodexRoutes(app, codex);
    registerCodexConfigRoutes(app, { codex, dataDir, env });
    registerClaudeRoutes(app, claude);
    registerUnifiedMcpRoutes(app, claude.config);
    registerAcpRoutes(app, acp);
    registerGitRoutes(app, git);
    registerSkillsRoutes(app, { home: env.HOME, codexHome: env.CODEX_HOME });
    registerAutomationRoutes(app, automation);
    registerBotRoutes(app, {
      db,
      tokens,
      runBotUnattended: (...args) => acp.runBotUnattended(...args),
      deleteAutomationsForBot: (id) => automation.deleteForBot(id),
      track: (event) => platform.telemetry.track(event),
    });
    registerKekeRoutes(app, keke);
    const importer = new ImportService({
      db, dataDir, settings,
      importTasks: (tasks) => automation.importPaused(tasks),
    });
    cleanup.push(() => importer.close());
    registerImportRoutes(app, importer);
    registerPlatformRoutes(app, platform);
    await automation.initialize(false);
    // Complete registration now so construction failures take the same cleanup
    // path and callers can close an unused runtime without first issuing a request.
    await app.ready();
    return {
      app,
      hub,
      settings,
      watches,
      terminals,
      codex,
      claude,
      acp,
      git,
      db,
      automation,
      platform,
    };
  } catch (error) {
    // Fastify may not execute hooks if registration itself failed or never booted.
    await dispose().catch(() => {});
    await app.close().catch(() => {});
    throw error;
  }
}
