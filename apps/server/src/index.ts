import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

import {
  resolveServerRuntimeConfig,
  resolveServerStorageRuntimeConfig,
  resolveGitAutoPullIntervalMinutes,
} from "./config/server-runtime-config.js";
import { AppVersionService } from "./services/app-version-service.js";
import { ScriptFeishuCompletionSender } from "./services/agent-completion-feishu-notifier.js";
import { GitAutoUpdateService } from "./services/git-auto-update-service.js";
import { FeishuNotificationSettingsService } from "./services/feishu-notification-settings-service.js";
import { FeishuReplyBindingStore } from "./services/feishu-reply-binding-store.js";
import { installGracefulShutdown } from "./services/server-lifecycle.js";
import { FileSessionStateStore } from "./services/session-state-store.js";
import { ensureSharedPackageBuilt } from "./services/shared-package-builder.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, "../../..");
loadDotenv({ path: resolve(repositoryRoot, ".env") });

async function main(): Promise<void> {
  // Pulls can change shared source and server imports in the same update.
  // Ensure the output is current before importing the app, without rewriting
  // an already-current dist and retriggering legacy tsx watchers.
  await ensureSharedPackageBuilt(repositoryRoot);

  const { buildServer } = await import("./app.js");
  const { host, port } = resolveServerRuntimeConfig(process.env);
  const { appSourceRoot, sessionStatePath } = resolveServerStorageRuntimeConfig(
    process.env,
    repositoryRoot,
  );
  const gitAutoPullIntervalMinutes = resolveGitAutoPullIntervalMinutes(
    process.env,
  );
  const feishuNotificationSettingsService =
    new FeishuNotificationSettingsService({
      env: process.env,
      statePath: resolve(
        repositoryRoot,
        ".dev-runtime/feishu-notification-settings.json",
      ),
    });
  feishuNotificationSettingsService.activateKanbanDelivery();
  const feishuReplyBindingStore = new FeishuReplyBindingStore({
    statePath: resolve(
      repositoryRoot,
      ".dev-runtime/feishu-reply-bindings.json",
    ),
  });
  const { app } = buildServer({
    appVersionService: new AppVersionService({
      sourceRoot: appSourceRoot,
    }),
    gitAutoUpdateService: new GitAutoUpdateService({
      sourceRoot: appSourceRoot,
      intervalMinutes: gitAutoPullIntervalMinutes,
    }),
    sessionStateStore: new FileSessionStateStore(sessionStatePath),
    feishuNotificationSettingsService,
    feishuReplyBindingStore,
    ...(process.env.FEISHU_NOTIFY_USER_ID?.trim()
      ? { feishuReplyAllowedUserId: process.env.FEISHU_NOTIFY_USER_ID.trim() }
      : {}),
    feishuCompletionSender: new ScriptFeishuCompletionSender({
      scriptPath: resolve(repositoryRoot, "scripts/codex-feishu-notify.mjs"),
      fallbackWorkingDirectory: repositoryRoot,
    }),
  });

  installGracefulShutdown({
    app,
    logError(error) {
      app.log.error(error);
    },
  });

  await app.listen({ port, host });
}

void main().catch((error: unknown) => {
  console.error("[server] startup failed", error);
  process.exit(1);
});
