import type {
  ContainerSharedSource, ContainerSharedSourceContext, OwnedSharedDesktopSourceFactory,
} from './container-service.mjs';

export interface OwnedSharedDaemonRegistration {
  readonly pid: number;
  readonly startTicks: string;
  readonly socketPath: string;
  readonly daemonGeneration: string;
  readonly exeSha256: string;
}
export interface SharedNativeMcpConfiguration {
  readonly enabled: true;
  readonly enabled_tools: readonly [];
  readonly omit_tools_from: readonly ['deferred'];
  readonly default_tools_approval_mode: 'prompt';
  readonly startup_timeout_sec: 10;
  readonly tool_timeout_sec: 3600;
  readonly url: string;
  readonly http_headers: Readonly<{Authorization: string}>;
}
export interface OwnedSharedSourceRegistration {
  readonly daemon: OwnedSharedDaemonRegistration;
  readonly codexHome: string;
  readonly daemonVersion: string;
  readonly projects: readonly Readonly<{projectId: string; cwd: string}>[];
  /** Built-in native daemon authority proof; requires nativeAppTools:false and no callback. */
  readonly executionDomainPolicy?: 'preserve-native-cli';
  /** Required for full Desktop App Tools; cannot replace the built-in preservation proof. */
  verifyExecutionDomainSync?(scope: Readonly<{
    runtimeGeneration: string; daemonGeneration: string; accountRevision: number;
  }>, mcpConfig?: SharedNativeMcpConfiguration): boolean;
  authorizeServerReplySync?(request: unknown, response: unknown): boolean;
  onFailure?(cause: Error): void;
  readonly timeoutMs?: number;
}
export interface OwnedSharedSourceOptions extends OwnedSharedSourceRegistration, ContainerSharedSourceContext {
  readonly nativeAppTools?: boolean;
  readonly useNativeDirectory?: boolean;
  readonly privateSource: {
    readonly generation: string;
    verifySync(): boolean;
    list?(params: unknown): Promise<unknown>;
    read?(threadId: string): Promise<unknown>;
  };
}
/** Server code only; neither registration nor executable fixtures come from HTTP. */
export function createOwnedSharedDesktopSourceFactory(
  registration: OwnedSharedSourceRegistration,
  options?: {
    nativeAppTools?: boolean;
    sourceConstructor?: (options: OwnedSharedSourceOptions) => ContainerSharedSource | Promise<ContainerSharedSource>;
  },
): OwnedSharedDesktopSourceFactory;
export function isOwnedSharedDesktopSourceFactory(value: unknown): value is OwnedSharedDesktopSourceFactory;
export function startOwnedSharedDesktopSource(options: OwnedSharedSourceOptions): Promise<ContainerSharedSource>;
