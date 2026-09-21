import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

interface TmuxControlSocketRecoveryDependencies {
  pathExists(path: string): boolean;
  ensureDirectory(path: string, mode: number): void;
  isOwnedTmuxServer(processId: number): boolean;
  signalServer(processId: number, signal: NodeJS.Signals): void;
  wait(delayMs: number): Promise<void>;
}

interface InheritedTmuxServer {
  socketPath: string;
  processId: number;
}

const SOCKET_DIRECTORY_MODE = 0o700;
const SOCKET_RECOVERY_ATTEMPTS = 10;
const SOCKET_RECOVERY_DELAY_MS = 10;

function parseInheritedTmuxServer(
  tmuxEnvironment: string | undefined,
): InheritedTmuxServer | null {
  const match = /^(.*),(\d+),(\d+)$/u.exec(tmuxEnvironment ?? "");
  if (!match || !isAbsolute(match[1])) {
    return null;
  }

  const processId = Number(match[2]);
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    return null;
  }

  return { socketPath: match[1], processId };
}

function isCurrentUserTmuxServer(processId: number): boolean {
  const currentUserId = process.getuid?.();
  if (currentUserId === undefined) {
    return false;
  }

  try {
    const processStats = statSync(`/proc/${processId}`);
    const processName = readFileSync(`/proc/${processId}/comm`, "utf8").trim();
    return processStats.uid === currentUserId && processName.startsWith("tmux");
  } catch {
    return false;
  }
}

const defaultDependencies: TmuxControlSocketRecoveryDependencies = {
  pathExists: existsSync,
  ensureDirectory(path, mode) {
    mkdirSync(path, { recursive: true, mode });
  },
  isOwnedTmuxServer: isCurrentUserTmuxServer,
  signalServer(processId, signal) {
    process.kill(processId, signal);
  },
  wait(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  },
};

export async function recoverTmuxControlSocket(
  tmuxEnvironment: string | undefined,
  dependencies: TmuxControlSocketRecoveryDependencies = defaultDependencies,
): Promise<boolean> {
  const inheritedServer = parseInheritedTmuxServer(tmuxEnvironment);
  if (!inheritedServer) {
    return false;
  }
  if (dependencies.pathExists(inheritedServer.socketPath)) {
    return true;
  }
  if (!dependencies.isOwnedTmuxServer(inheritedServer.processId)) {
    return false;
  }

  try {
    dependencies.ensureDirectory(
      dirname(inheritedServer.socketPath),
      SOCKET_DIRECTORY_MODE,
    );
    dependencies.signalServer(inheritedServer.processId, "SIGUSR1");
    for (let attempt = 0; attempt < SOCKET_RECOVERY_ATTEMPTS; attempt += 1) {
      if (dependencies.pathExists(inheritedServer.socketPath)) {
        return true;
      }
      await dependencies.wait(SOCKET_RECOVERY_DELAY_MS);
    }
  } catch {
    return false;
  }

  return dependencies.pathExists(inheritedServer.socketPath);
}

let recoveryInFlight: Promise<boolean> | null = null;

export async function ensureInheritedTmuxControlSocket(): Promise<boolean> {
  if (!recoveryInFlight) {
    recoveryInFlight = recoverTmuxControlSocket(process.env.TMUX).finally(
      () => {
        recoveryInFlight = null;
      },
    );
  }
  return recoveryInFlight;
}
