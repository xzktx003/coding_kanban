import type {
  ContainerDesktopRuntimeOptions,
  ContainerDesktopUpstream,
  ContainerRecoveryContext,
  ContainerRecoveryIdentity,
} from "./container-service.mjs";

/** Inherits finite memory/process budgets and the opaque server-only shared source. */
export interface ContainerDesktopServiceOptions extends ContainerDesktopRuntimeOptions {
  macAsarPath: string;
  macAsarSha256: string;
  profileFile: string;
  controlSocketPath: string;
}

export interface ContainerDesktopService {
  readonly profileId: string;
  readonly generation: string;
  /** Non-enumerable; close() preserves this container's native process. */
  readonly containerId: string;
  readonly nativeExited: ContainerDesktopUpstream["nativeExited"];
  captureRecoveryIdentity(options: { configSha256: string }): Promise<ContainerRecoveryIdentity>;
  /** Revoke the held profile, close owned views and detach. Does not stop native. */
  close(): Promise<void>;
}

export function startContainerDesktopService(
  options: ContainerDesktopServiceOptions,
): Promise<ContainerDesktopService>;
/** Explicit prototype; does not create or stop a native container. */
export function reattachContainerDesktopService(
  options: ContainerDesktopServiceOptions,
  context: ContainerRecoveryContext,
): Promise<ContainerDesktopService>;
