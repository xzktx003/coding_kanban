/** Opaque server capability; obtain it only from the owned source factory. */
declare const ownedSharedDesktopSourceBrand: unique symbol;
export interface OwnedSharedDesktopSourceFactory {
  readonly [ownedSharedDesktopSourceBrand]: true;
  readonly requiresAppTools: boolean;
  create(context: ContainerSharedSourceContext): Promise<ContainerSharedSource>;
}
export interface ContainerSharedOwnedView {
  readonly profileId: string; readonly generation: string; readonly viewId: string;
}
export interface ContainerSharedSourceContext {
  readonly profileId: string; readonly generation: string;
  getOwnedView(viewId: string): ContainerSharedOwnedView | null;
  verifyOwnedViewSync(viewId: string): boolean;
  verifyContainerSync(): boolean;
  writeNative(encoded: string, verifyRequestSync?: () => boolean): Promise<void>;
}
export interface ContainerSharedSource {
  receiveNative(frame: unknown): boolean;
  retireView(viewId: string): void;
  accountRevision(): number | null;
  close(): void;
}

/** Trusted server registration; never populated from an HTTP request. */
export interface ContainerDesktopRuntimeOptions {
  imageDigest: string;
  sourceRoot: string;
  runtimeRoot: string;
  bridgeRoot: string;
  cpuId: number;
  /** Server-only finite container memory budget. Default 2048 MiB. */
  memoryLimitMiB?: 2048 | 4096 | 8192;
  /** Server-only finite process/thread budget. Default 256. */
  pidsLimit?: 256 | 512;
  /** Dedicated owned 0700 persistent rollouts; auth, SQLite and queues stay private per instance. */
  historyRoot?: string;
  dockerPath: string;
  dockerSha256: string;
  pythonPath: string;
  pythonSha256: string;
  nodePath: string;
  nodeSha256: string;
  startupTimeoutMs?: number;
  /** Network namespace selection. Default none; bridge allows general outbound traffic. */
  networkMode?: "none" | "bridge";
  /** Explicit authorized snapshot; requires networkMode bridge and an empty private tmpfs home. */
  accountSnapshot?: { sourceFile: string; homeRoot: string };
  /** Set the original desktop's Codex preference once in this new private home. */
  initialMode?: "codex";
  /** Explicit server-only proxy values for this new native; never inherited or copied from config. Requires bridge. */
  connection?: { httpProxy?: string; httpsProxy?: string; noProxy?: string };
  /** Existing owned server-selected roots, same-path writable non-recursive binds. Maximum eight. */
  projectRoots?: readonly string[];
  /** New hosts only; never supplied from JSON/HTTP or rebound during recovery. */
  sharedDesktopSource?: OwnedSharedDesktopSourceFactory;
  /** New-host constructor only: fixed /bridge/server-ssh.sock client, never creates an SSH broker. No recovery rebind. */
  serverSsh?: boolean;
}

export interface ContainerDesktopUpstreamOptions extends ContainerDesktopRuntimeOptions {
  profileId: string;
  generation: string;
}

/** Private startup witness; it contains no tokens or thread content. */
export interface ContainerRecoveryProcessIdentity {
  readonly pid: number; readonly ppid: number; readonly uid: number; readonly ticks: string;
  readonly nspids: readonly number[]; readonly cpus: string; readonly noNewPrivs: string;
  readonly seccomp: string; readonly capEff: string; readonly cgroup: string;
  readonly pidns: string; readonly mntns: string;
}
export interface ContainerRecoveryIdentity {
  readonly version: 1; readonly containerId: string; readonly profileId: string; readonly generation: string;
  readonly bootId: string; readonly configSha256: string; readonly filesSha256: string;
  readonly account: Readonly<{ kind: "anonymous"; binding: null } | { kind: "chatgpt"; binding: string }>;
  readonly projects: readonly Readonly<{ path: string; dev: string; ino: string; uid: string; gid: string; mode: string }>[];
  readonly processes: Readonly<Record<"init" | "bridge" | "node" | "native", ContainerRecoveryProcessIdentity>>;
}
export interface ContainerRecoveryContext {
  readonly identity: ContainerRecoveryIdentity;
  readonly configSha256: string;
}

export interface DesktopWriteControl {
  signal: AbortSignal;
  /** Absolute performance.now() deadline in this process. */
  deadline: number;
  /** Called synchronously immediately before the transport write attempt. */
  onDispatch(): void;
}

/** Trusted fixed-membership server batch; never populated from HTTP options. */
export interface DesktopWriteBatchEntry extends DesktopWriteControl {
  readonly encoded: string;
}

export interface ContainerDesktopUpstream {
  readonly profileId: string;
  readonly generation: string;
  /** Non-enumerable. Identifies the owned container, not permission to stop it. */
  readonly containerId: string;
  readonly upstream: {
    readonly explicitDispatch: true;
    send(encoded: string, control: DesktopWriteControl): Promise<void>;
    /** At most eight same-view ordinary frames. Lifecycle/handshake remain single. */
    sendBatch(entries: readonly DesktopWriteBatchEntry[]): Promise<void>;
    /** Async completions apply native read backpressure in windows of eight. */
    subscribe(handler: (encoded: string) => void | Promise<void>): () => void;
  };
  verifyIdentity(): Promise<boolean>;
  /** Server-only witness, captured while the original manager still owns the live transport. */
  captureRecoveryIdentity(options: { configSha256: string }): Promise<ContainerRecoveryIdentity>;
  /** Requires no owned views or queued bytes. Does not stop native. */
  disconnectTransport(): Promise<void>;
  reconnectTransport(): Promise<void>;
  readonly nativeExited: Promise<Readonly<{ state: "exited" }>>;
  /** Fixed metadata only; no project paths, credentials or raw errors. */
  projectPersistenceStatus(): "disabled" | "waiting" | "active" | "unsupported" | "error";
  onUnavailable(handler: () => void): () => void;
}

/** A failed grant may have started native; never retry or infer an exit. */
export interface RetainedContainerOwner {
  readonly containerId: string;
  readonly grantSent: boolean;
  readonly grantOutcome: "not_attempted" | "unknown" | "written";
  readonly nativeExited: ContainerDesktopUpstream["nativeExited"];
}

export function startContainerDesktopUpstream(
  options: ContainerDesktopUpstreamOptions,
): Promise<ContainerDesktopUpstream>;
/** Explicit prototype: currently only anonymous, no persistent-history recovery is admitted. */
export function reattachContainerDesktopUpstream(
  options: ContainerDesktopUpstreamOptions,
  context: ContainerRecoveryContext,
): Promise<ContainerDesktopUpstream>;

/** Internal server adapter; its context is passed only to the branded factory. */
export function createContainerSharedSourceBridge(options: {
  profileId: string; generation: string;
  verifyCurrentSync(): boolean;
  writeNative(encoded: string, finalVerifySync: () => boolean): Promise<void>;
}): Readonly<{
  context: ContainerSharedSourceContext;
  receiveNative(frame: unknown, encoded?: string): boolean;
  activate(source: ContainerSharedSource): void;
  viewCreated(viewId: string): ContainerSharedOwnedView;
  retireView(viewId: string): void;
  close(): void;
}>;
