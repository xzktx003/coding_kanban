import type { FastifyInstance } from "fastify";

import type {
  AppVersionResponse,
  GitAutoUpdateStatus,
  RestoreManagedSessionsResponse,
} from "@agent-orchestrator/shared";

export interface AppVersionServiceLike {
  getVersion(): Promise<AppVersionResponse>;
}

export interface ManagedSessionRestorerLike {
  restore(): Promise<RestoreManagedSessionsResponse>;
}

export interface GitAutoUpdateServiceLike {
  getStatus(): GitAutoUpdateStatus;
  checkNow(): Promise<GitAutoUpdateStatus>;
  applyUpdate(): Promise<GitAutoUpdateStatus>;
  start(): void;
  stop(): void;
}

export interface AppUpdateRoutesOptions {
  appVersionService: AppVersionServiceLike;
  gitAutoUpdateService: GitAutoUpdateServiceLike;
  managedSessionRestorer: ManagedSessionRestorerLike;
}

export async function registerAppUpdateRoutes(
  fastify: FastifyInstance,
  options: AppUpdateRoutesOptions,
): Promise<void> {
  fastify.get("/api/app-version", async () => ({
    ...(await options.appVersionService.getVersion()),
    autoUpdate: options.gitAutoUpdateService.getStatus(),
  }));

  fastify.post("/api/app-update/check", async () =>
    options.gitAutoUpdateService.checkNow(),
  );

  fastify.post("/api/app-update/apply", async () =>
    options.gitAutoUpdateService.applyUpdate(),
  );

  fastify.post("/api/agent-sessions/restore-managed", async () =>
    options.managedSessionRestorer.restore(),
  );
}
