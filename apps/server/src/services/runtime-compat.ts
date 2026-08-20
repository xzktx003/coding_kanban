import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import os from "node:os";
import { basename, delimiter, join } from "node:path";

function isExecutablePath(
  commandPath: string | undefined,
): commandPath is string {
  if (!commandPath || !commandPath.includes("/")) {
    return false;
  }

  try {
    accessSync(commandPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isExecutableOnPath(
  command: string,
  envPath: string | undefined,
): boolean {
  return (envPath ?? "")
    .split(delimiter)
    .filter(Boolean)
    .some((directory) => isExecutablePath(join(directory, command)));
}

function isResolvableCommand(
  command: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): command is string {
  if (!command) {
    return false;
  }

  if (!command.includes("/")) {
    return isExecutableOnPath(command, env.PATH);
  }

  return isExecutablePath(command);
}

function readUserShell(): string | undefined {
  try {
    return os.userInfo().shell ?? undefined;
  } catch {
    return undefined;
  }
}

export function quoteForPosixShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

type ExecFileLike = (
  file: string,
  args: string[],
  options: {
    cwd: string;
    encoding: "utf8";
    env: NodeJS.ProcessEnv;
    maxBuffer: number;
  },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void;

interface ResolveShellStartupEnvOptions {
  cwd?: string;
  execFileImpl?: ExecFileLike;
  marker?: string;
  nodePath?: string;
  shellPath?: string;
}

function buildShellStartupEnvArgs(
  shellPath: string,
  command: string,
): string[] {
  const shellName = basename(shellPath).toLowerCase();
  if (shellName === "sh" || shellName === "dash") {
    return ["-i", "-c", command];
  }

  return ["-l", "-i", "-c", command];
}

function buildShellStartupEnvCommand(marker: string, nodePath: string): string {
  return [
    `printf '%s\\n' ${quoteForPosixShell(marker)}`,
    `${quoteForPosixShell(nodePath)} -e ${quoteForPosixShell(
      "process.stdout.write(JSON.stringify(process.env))",
    )}`,
    `printf '\\n%s\\n' ${quoteForPosixShell(marker)}`,
  ].join("; ");
}

function parseShellStartupEnv(
  output: string,
  marker: string,
): Record<string, string> {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = output.match(
    new RegExp(`${escapedMarker}\\r?\\n([\\s\\S]*?)\\r?\\n${escapedMarker}`),
  );
  if (!match?.[1]) {
    throw new Error("Could not parse shell startup environment output");
  }

  const parsed = JSON.parse(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Shell startup environment did not return an object");
  }

  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function buildInteractiveShellBootstrap(finalCommand: string): string {
  return [
    'if [ -n "${SHELL:-}" ] && [ -x "$SHELL" ]; then',
    '  SHELL_NAME="${SHELL##*/}";',
    "else",
    '  SHELL_NAME="";',
    "fi;",
    'if [ -n "${SHELL:-}" ] && [ -x "$SHELL" ] && [ "$SHELL_NAME" != "sh" ] && [ "$SHELL_NAME" != "dash" ]; then',
    '  SHELL_BIN="$SHELL";',
    "elif command -v bash >/dev/null 2>&1; then",
    '  SHELL_BIN="$(command -v bash)";',
    "elif command -v zsh >/dev/null 2>&1; then",
    '  SHELL_BIN="$(command -v zsh)";',
    'elif [ -n "${SHELL:-}" ] && [ -x "$SHELL" ]; then',
    '  SHELL_BIN="$SHELL";',
    "elif command -v sh >/dev/null 2>&1; then",
    '  SHELL_BIN="$(command -v sh)";',
    "else",
    '  SHELL_BIN="/bin/sh";',
    "fi;",
    "export SHELL_BIN;",
    finalCommand,
  ].join(" ");
}

export function resolvePreferredShell(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const candidates = [
    env.SHELL,
    readUserShell(),
    "/bin/bash",
    "/usr/bin/bash",
    "/bin/zsh",
    "/usr/bin/zsh",
    "/bin/sh",
    "/usr/bin/sh",
  ];

  return (
    candidates.find((candidate) => isResolvableCommand(candidate, env)) ??
    "/bin/sh"
  );
}

export async function resolveShellStartupEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveShellStartupEnvOptions = {},
): Promise<Record<string, string>> {
  const shellPath = options.shellPath ?? resolvePreferredShell(env);
  const shellEnv: NodeJS.ProcessEnv = {
    ...env,
    SHELL: env.SHELL ?? shellPath,
  };
  const marker =
    options.marker ??
    `__CODING_KANBAN_SHELL_ENV_${process.pid}_${Date.now()}__`;

  return new Promise((resolve, reject) => {
    const cwd = options.cwd ?? shellEnv.HOME?.trim() ?? os.homedir();

    (options.execFileImpl ?? execFile)(
      shellPath,
      buildShellStartupEnvArgs(
        shellPath,
        buildShellStartupEnvCommand(
          marker,
          options.nodePath ?? process.execPath,
        ),
      ),
      {
        cwd,
        encoding: "utf8",
        env: shellEnv,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        try {
          resolve(parseShellStartupEnv(stdout, marker));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

export function buildInteractiveShellCommand(command: string): string {
  return buildInteractiveShellBootstrap(
    `exec "$SHELL_BIN" -i -c ${quoteForPosixShell(command)}`,
  );
}

export function buildTmuxCommand(
  command: string,
  keepPaneOpen = false,
): string {
  const paneCommand = keepPaneOpen
    ? `${command}; exec "$SHELL_BIN" -i`
    : command;

  return quoteForPosixShell(buildInteractiveShellCommand(paneCommand));
}

export function resolveTmuxBinary(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.TMUX_BINARY?.trim();

  if (isResolvableCommand(configured, env)) {
    return configured;
  }

  if (isExecutableOnPath("tmux", env.PATH)) {
    return "tmux";
  }

  const candidates = [
    "/opt/homebrew/bin/tmux",
    "/usr/local/bin/tmux",
    "/usr/bin/tmux",
    "/bin/tmux",
  ];

  return candidates.find(isExecutablePath) ?? "tmux";
}
