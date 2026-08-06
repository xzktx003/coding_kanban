import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

import { buildServer } from "./app.js";
import {
  resolveServerRuntimeConfig,
  resolveServerStorageRuntimeConfig,
  resolveGitAutoPullIntervalMinutes,
} from "./config/server-runtime-config.js";
import { AppVersionService } from "./services/app-version-service.js";
import { GitAutoUpdateService } from "./services/git-auto-update-service.js";
import { installGracefulShutdown } from "./services/server-lifecycle.js";
import { FileSessionStateStore } from "./services/session-state-store.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, "../../..");
loadDotenv({ path: resolve(repositoryRoot, ".env") });

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

app.listen({ port, host }).catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
