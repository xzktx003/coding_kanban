import type { SshTarget } from "@agent-orchestrator/shared";

export interface BuildSshArgsOptions {
  batchMode?: boolean;
  clearAllForwardings?: boolean;
  connectTimeoutSeconds?: number;
  exitOnForwardFailure?: boolean;
  localForwardings?: Array<{
    bindAddress?: string;
    localPort: number;
    remoteHost: string;
    remotePort: number;
  }>;
  noCommand?: boolean;
  remoteCommand?: string;
  requestTty?: boolean;
}

export class InvalidSshTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSshTargetError";
  }
}

function assertSafeSshField(name: string, value: string | undefined): void {
  if (!value) {
    return;
  }

  if (/\r|\n|\0/.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
}

export function assertValidSshTarget(
  sshTarget: SshTarget | null | undefined,
): asserts sshTarget is SshTarget {
  if (!sshTarget || typeof sshTarget.host !== "string") {
    throw new InvalidSshTargetError("Invalid host");
  }

  const host = sshTarget.host;
  if (
    !host ||
    host.length > 255 ||
    host !== host.trim() ||
    host.startsWith("-") ||
    host.includes("@") ||
    /[\s\0]/.test(host)
  ) {
    throw new InvalidSshTargetError("Invalid host");
  }

  if (
    sshTarget.port !== undefined &&
    (!Number.isInteger(sshTarget.port) ||
      sshTarget.port < 1 ||
      sshTarget.port > 65_535)
  ) {
    throw new InvalidSshTargetError("Invalid port");
  }

  if (
    sshTarget.username !== undefined &&
    (!sshTarget.username ||
      sshTarget.username.length > 128 ||
      !/^[A-Za-z0-9._-]+$/.test(sshTarget.username))
  ) {
    throw new InvalidSshTargetError("Invalid username");
  }

  if (
    sshTarget.identityFile !== undefined &&
    (!sshTarget.identityFile ||
      sshTarget.identityFile.length > 4096 ||
      /[\r\n\0]/.test(sshTarget.identityFile))
  ) {
    throw new InvalidSshTargetError("Invalid identity file");
  }
}

export function formatSshDestination(sshTarget: SshTarget): string {
  assertValidSshTarget(sshTarget);

  return sshTarget.username
    ? `${sshTarget.username}@${sshTarget.host}`
    : sshTarget.host;
}

export function buildSshArgs(
  sshTarget: SshTarget,
  options: BuildSshArgsOptions = {},
): string[] {
  assertValidSshTarget(sshTarget);
  assertSafeSshField("identity file", sshTarget.identityFile);
  assertSafeSshField("remote command", options.remoteCommand);
  for (const forward of options.localForwardings ?? []) {
    assertSafeSshField("local forward bind address", forward.bindAddress);
    assertSafeSshField("local forward host", forward.remoteHost);
  }

  const args: string[] = [];

  if (options.requestTty) {
    args.push("-t");
  }

  if (options.batchMode) {
    args.push("-o", "BatchMode=yes");
  }

  if (options.clearAllForwardings) {
    args.push("-o", "ClearAllForwardings=yes");
  }

  if (options.connectTimeoutSeconds) {
    args.push("-o", `ConnectTimeout=${options.connectTimeoutSeconds}`);
  }

  if (options.exitOnForwardFailure) {
    args.push("-o", "ExitOnForwardFailure=yes");
  }

  for (const forward of options.localForwardings ?? []) {
    const bindPrefix = forward.bindAddress ? `${forward.bindAddress}:` : "";
    args.push(
      "-L",
      `${bindPrefix}${forward.localPort}:${forward.remoteHost}:${forward.remotePort}`,
    );
  }

  if (options.noCommand) {
    args.push("-N");
  }

  if (sshTarget.port) {
    args.push("-p", String(sshTarget.port));
  }

  if (sshTarget.identityFile) {
    args.push("-i", sshTarget.identityFile);
  }

  args.push(formatSshDestination(sshTarget));

  if (options.remoteCommand) {
    args.push(options.remoteCommand);
  }

  return args;
}
