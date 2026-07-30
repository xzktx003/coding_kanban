import { resolve } from "node:path";

export type ServerRuntimeConfig = {
  host: string;
  port: number;
  terminalScrollbackBytes: number;
  terminalTmuxCaptureLines: number;
  terminalRegistryOutputEntries: number;
};

export type TerminalHistoryRuntimeConfig = Pick<
  ServerRuntimeConfig,
  | "terminalScrollbackBytes"
  | "terminalTmuxCaptureLines"
  | "terminalRegistryOutputEntries"
>;

export type ServerStorageRuntimeConfig = {
  appSourceRoot: string;
  sessionStatePath: string;
};

export type GitAutoPullIntervalMinutes = 10 | 30 | null;

export const DEFAULT_TERMINAL_SCROLLBACK_BYTES = 4 * 1024 * 1024;
export const DEFAULT_TERMINAL_TMUX_CAPTURE_LINES = 20_000;
export const DEFAULT_TERMINAL_REGISTRY_OUTPUT_ENTRIES = 5_000;

function parsePort(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized) {
    return 4000;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      "SERVER_PORT must be a positive integer between 1 and 65535",
    );
  }

  return parsed;
}

function parsePositiveInteger(
  envName: string,
  value: string | undefined,
  defaultValue: number,
): number {
  const normalized = value?.trim();
  if (!normalized) {
    return defaultValue;
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${envName} must be a positive integer`);
  }

  return parsed;
}

function resolvePortValue(env: NodeJS.ProcessEnv): string | undefined {
  const explicitServerPort = env.SERVER_PORT?.trim();
  if (explicitServerPort) {
    return explicitServerPort;
  }

  return env.PORT?.trim();
}

export function resolveGitAutoPullIntervalMinutes(
  env: NodeJS.ProcessEnv,
): GitAutoPullIntervalMinutes {
  const normalized = env.GIT_AUTO_PULL_INTERVAL_MINUTES?.trim();
  if (!normalized || normalized === "0") {
    return null;
  }
  if (normalized === "10" || normalized === "30") {
    return Number(normalized) as 10 | 30;
  }

  throw new Error("GIT_AUTO_PULL_INTERVAL_MINUTES must be 0, 10, or 30");
}

export function resolveTerminalHistoryRuntimeConfig(
  env: NodeJS.ProcessEnv,
): TerminalHistoryRuntimeConfig {
  return {
    terminalRegistryOutputEntries: parsePositiveInteger(
      "TERMINAL_REGISTRY_OUTPUT_ENTRIES",
      env.TERMINAL_REGISTRY_OUTPUT_ENTRIES,
      DEFAULT_TERMINAL_REGISTRY_OUTPUT_ENTRIES,
    ),
    terminalScrollbackBytes: parsePositiveInteger(
      "TERMINAL_SCROLLBACK_BYTES",
      env.TERMINAL_SCROLLBACK_BYTES,
      DEFAULT_TERMINAL_SCROLLBACK_BYTES,
    ),
    terminalTmuxCaptureLines: parsePositiveInteger(
      "TERMINAL_TMUX_CAPTURE_LINES",
      env.TERMINAL_TMUX_CAPTURE_LINES,
      DEFAULT_TERMINAL_TMUX_CAPTURE_LINES,
    ),
  };
}

const VALID_HOST_PATTERN = /^[\d.]+$|^[a-zA-Z\d]([a-zA-Z\d\-.]*[a-zA-Z\d])?$/;

function parseHost(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "0.0.0.0";
  }

  if (!VALID_HOST_PATTERN.test(normalized) || normalized.includes("_")) {
    throw new Error(
      `HOST value "${normalized}" does not look like a valid IP or hostname. ` +
        "If a conda environment sets HOST to a platform triplet, override it " +
        "with SERVER_BIND_HOST in .env.",
    );
  }

  return normalized;
}

export function resolveServerRuntimeConfig(
  env: NodeJS.ProcessEnv,
): ServerRuntimeConfig {
  return {
    host: parseHost(env.SERVER_BIND_HOST ?? env.HOST),
    port: parsePort(resolvePortValue(env)),
    ...resolveTerminalHistoryRuntimeConfig(env),
  };
}

export function resolveServerStorageRuntimeConfig(
  env: NodeJS.ProcessEnv,
  repositoryRoot: string,
): ServerStorageRuntimeConfig {
  const appSourceRoot = env.APP_SOURCE_ROOT?.trim();
  const sessionStatePath = env.SESSION_STATE_PATH?.trim();

  return {
    appSourceRoot: resolve(repositoryRoot, appSourceRoot || "."),
    sessionStatePath: resolve(
      repositoryRoot,
      sessionStatePath || ".dev-runtime/agent-sessions.json",
    ),
  };
}
