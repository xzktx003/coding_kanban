import type { FastifyInstance } from "fastify";

import type {
  AppVersionResponse,
  RestoreManagedSessionsResponse,
} from "@agent-orchestrator/shared";

export interface AppVersionServiceLike {
  getVersion(): Promise<AppVersionResponse>;
}

export interface ManagedSessionRestorerLike {
  restore(): Promise<RestoreManagedSessionsResponse>;
}

export interface AppUpdateRoutesOptions {
  appVersionService: AppVersionServiceLike;
  managedSessionRestorer: ManagedSessionRestorerLike;
}

export async function registerAppUpdateRoutes(
  fastify: FastifyInstance,
  options: AppUpdateRoutesOptions,
): Promise<void> {
  fastify.get("/api/app-version", async () =>
    options.appVersionService.getVersion(),
  );

  fastify.post("/api/agent-sessions/restore-managed", async () =>
    options.managedSessionRestorer.restore(),
  );
}
