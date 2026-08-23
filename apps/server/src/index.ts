import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

import {
  resolveServerRuntimeConfig,
  resolveServerStorageRuntimeConfig,
  resolveGitAutoPullIntervalMinutes,
} from "./config/server-runtime-config.js";
import { AppVersionService } from "./services/app-version-service.js";
import { GitAutoUpdateService } from "./services/git-auto-update-service.js";
import { installGracefulShutdown } from "./services/server-lifecycle.js";
import { FileSessionStateStore } from "./services/session-state-store.js";
import { ensureSharedPackageBuilt } from "./services/shared-package-builder.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, "../../..");
loadDotenv({ path: resolve(repositoryRoot, ".env") });

async function main(): Promise<void> {
  // Pulls can change shared source and server imports in the same update.
  // Rebuild before importing the app so tsx never loads a stale workspace dist.
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
  const { app } = buildServer({
    appVersionService: new AppVersionService({
      sourceRoot: appSourceRoot,
    }),
    gitAutoUpdateService: new GitAutoUpdateService({
      sourceRoot: appSourceRoot,
      intervalMinutes: gitAutoPullIntervalMinutes,
    }),
    sessionStateStore: new FileSessionStateStore(sessionStatePath),
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
