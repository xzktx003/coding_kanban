import {
  execFileSync,
  execSync,
  type ExecFileSyncOptions,
  type ExecSyncOptions,
} from "child_process";
import * as fs from "fs";
import * as path from "path";

import type {
  ScanDirectoryInput,
  ScanDirectoryResponse,
  ScanResult,
  SshTarget,
} from "@agent-orchestrator/shared";

import {
  buildInteractiveShellCommand,
  quoteForPosixShell,
  resolveTmuxBinary,
} from "./runtime-compat.js";
import { buildSshArgs } from "./ssh-command.js";
import { canonicalTmuxDisplayName } from "./tmux-display-name.js";

const AGENT_INDICATORS: Record<string, { dirs: string[]; files: string[] }> = {
  claude: {
    dirs: [".claude"],
    files: [".claude_history"],
  },
  copilot: {
    dirs: [".copilot"],
    files: [],
  },
  codex: {
    dirs: [".codex"],
    files: [],
  },
  aider: {
    dirs: [".aider.chat.history.md"],
    files: [".aider.chat.history.md"],
  },
  cursor: {
    dirs: [".cursor"],
    files: [],
  },
};

const AGENT_PROCESS_NAMES = ["claude", "copilot", "codex", "aider", "cursor"];
const SCAN_PRUNE_DIRS = [
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
];
const INDICATOR_DIR_NAMES = [
  ...new Set(Object.values(AGENT_INDICATORS).flatMap((v) => v.dirs)),
];
const INDICATOR_FILE_NAMES = [
  ...new Set(Object.values(AGENT_INDICATORS).flatMap((v) => v.files)),
];
const INDICATOR_TO_AGENT_KIND = new Map(
  Object.entries(AGENT_INDICATORS).flatMap(([agentKind, indicators]) =>
    [...indicators.dirs, ...indicators.files].map((indicator) => [
      indicator,
      agentKind,
    ]),
  ),
);

interface IndicatorHit {
  agentKind: string;
  workingDirectory: string;
  indicatorPath: string;
}

function trimTrailingSeparator(
  value: string,
  separator: string,
  root: string,
): string {
  let result = value;
  while (result.length > root.length && result.endsWith(separator)) {
    result = result.slice(0, -separator.length);
  }
  return result;
}

function normalizeExistingLocalPath(value: string): string {
  const normalized = trimTrailingSeparator(
    path.normalize(value),
    path.sep,
    path.parse(value).root || path.parse(path.normalize(value)).root,
  );

  try {
    const realPath = fs.realpathSync.native(normalized);
    return trimTrailingSeparator(
      path.normalize(realPath),
      path.sep,
      path.parse(realPath).root,
    );
  } catch {
    return normalized;
  }
}

function normalizeLocalPath(value?: string): string {
  if (!value) return "";
  return normalizeExistingLocalPath(value);
}

function normalizeRemotePath(value?: string): string {
  if (!value) return "";
  const normalized = path.posix.normalize(value);
  return trimTrailingSeparator(
    normalized,
    path.posix.sep,
    path.posix.parse(normalized).root,
  );
}

function isLocalPathWithinScope(candidate?: string, scope?: string): boolean {
  const normalizedCandidate = normalizeLocalPath(candidate);
  const normalizedScope = normalizeLocalPath(scope);
  if (!normalizedCandidate || !normalizedScope) {
    return false;
  }
  if (normalizedCandidate === normalizedScope) {
    return true;
  }
  return normalizedCandidate.startsWith(`${normalizedScope}${path.sep}`);
}

function isRemotePathWithinScope(candidate?: string, scope?: string): boolean {
  const normalizedCandidate = normalizeRemotePath(candidate);
  const normalizedScope = normalizeRemotePath(scope);
  if (!normalizedCandidate || !normalizedScope) {
    return false;
  }
  if (normalizedCandidate === normalizedScope) {
    return true;
  }
  return normalizedCandidate.startsWith(`${normalizedScope}${path.posix.sep}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function commandLineMatchesScope(
  cmdline: string,
  scope: string,
  remote: boolean,
): boolean {
  const normalizedScope = remote
    ? normalizeRemotePath(scope)
    : normalizeLocalPath(scope).replace(/\\/g, "/");
  if (!normalizedScope) {
    return false;
  }

  const escapedScope = escapeRegExp(normalizedScope);
  const pattern = new RegExp(
    `(?:^|[\\s'\"=])${escapedScope}(?:/[^\\s'\"=]*)?(?=$|[\\s'\"=])`,
  );

  return pattern.test(cmdline.replace(/\\/g, "/"));
}

function buildFindIndicatorCommand(rootPath: string): string {
  const pruneExpression = SCAN_PRUNE_DIRS.map(
    (name) => `-name ${quoteForPosixShell(name)}`,
  ).join(" -o ");
  const dirExpression = INDICATOR_DIR_NAMES.map(
    (name) => `-name ${quoteForPosixShell(name)}`,
  ).join(" -o ");
  const fileExpression = INDICATOR_FILE_NAMES.map(
    (name) => `-name ${quoteForPosixShell(name)}`,
  ).join(" -o ");

  return [
    "find",
    quoteForPosixShell(rootPath),
    "\\(",
    "-type d",
    "\\(",
    pruneExpression,
    "\\)",
    "-prune",
    "\\)",
    "-o",
    "\\(",
    "-type d",
    "\\(",
    dirExpression,
    "\\)",
    "-o",
    "-type f",
    "\\(",
    fileExpression,
    "\\)",
    "\\)",
    "-print",
    "2>/dev/null || true",
  ].join(" ");
}

function parseIndicatorHits(output: string, remote: boolean): IndicatorHit[] {
  const pathApi = remote ? path.posix : path;
  const hits: IndicatorHit[] = [];
  const seen = new Set<string>();

  for (const rawLine of output.split("\n")) {
    const indicatorPath = rawLine.trim();
    if (!indicatorPath) continue;

    const agentKind = INDICATOR_TO_AGENT_KIND.get(
      pathApi.basename(indicatorPath),
    );
    if (!agentKind) continue;

    const workingDirectory = pathApi.dirname(indicatorPath);
    const key = `${agentKind}:${workingDirectory}`;
    if (seen.has(key)) continue;
    seen.add(key);

    hits.push({
      agentKind,
      workingDirectory,
      indicatorPath,
    });
  }

  return hits;
}

function execLocal(command: string, options?: ExecSyncOptions): string {
  try {
    const output = execSync(command, {
      encoding: "utf8",
      timeout: 10000,
      ...options,
    });
    return typeof output === "string" ? output.trim() : "";
  } catch {
    return "";
  }
}

function execRemote(sshTarget: SshTarget, command: string): string {
  try {
    const output = execFileSync(
      "ssh",
      buildSshArgs(sshTarget, {
        batchMode: true,
        connectTimeoutSeconds: 5,
        remoteCommand: command,
      }),
      {
        encoding: "utf8",
        timeout: 10000,
      } satisfies ExecFileSyncOptions,
    );
    return typeof output === "string" ? output.trim() : "";
  } catch {
    return "";
  }
}

function scanLocalHistory(dirPath: string): ScanResult[] {
  const output = execLocal(buildFindIndicatorCommand(dirPath));
  const hits = parseIndicatorHits(output, false);

  return hits.map(({ agentKind, workingDirectory, indicatorPath }) => {
    let lastActivity: string | undefined;
    try {
      lastActivity = fs.statSync(indicatorPath).mtime.toISOString();
    } catch {
      /* ignore */
    }

    return {
      agentKind,
      status: "stopped",
      displayName: `${agentKind} (${path.basename(workingDirectory)})`,
      workingDirectory,
      lastActivity,
      historyPath: indicatorPath,
    } satisfies ScanResult;
  });
}

function scanLocalProcesses(dirPath: string): ScanResult[] {
  const results: ScanResult[] = [];

  for (const procName of AGENT_PROCESS_NAMES) {
    const output = execLocal(`pgrep -af "${procName}" 2>/dev/null || true`);
    if (!output) continue;

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;

      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[0], 10);
      if (isNaN(pid)) continue;

      const cmdline = parts.slice(1).join(" ");
      if (commandLineMatchesScope(cmdline, dirPath, false)) {
        results.push({
          agentKind: procName,
          status: "running",
          displayName: `${procName} (PID ${pid})`,
          workingDirectory: dirPath,
          pid,
        });
      }
    }
  }

  return results;
}

function scanLocalTmux(dirPath: string): ScanResult[] {
  const results: ScanResult[] = [];

  const tmuxBin = resolveTmuxBinary();

  const panes = execLocal(
    `${tmuxBin} list-panes -a -F '#{session_name}:#{pane_id}:#{pane_current_path}:#{pane_current_command}' 2>/dev/null || true`,
  );
  if (!panes) return results;

  for (const line of panes.split("\n")) {
    if (!line.trim()) continue;

    const parts = line.split(":");
    if (parts.length < 4) continue;

    const [session, paneId, panePath, command] = parts;
    if (!isLocalPathWithinScope(panePath, dirPath)) continue;

    const isAgent = AGENT_PROCESS_NAMES.some(
      (name) =>
        command?.toLowerCase().includes(name) ||
        session?.toLowerCase().includes(name),
    );

    results.push({
      agentKind: isAgent ? (command ?? "shell") : "shell",
      status: "running",
      displayName: canonicalTmuxDisplayName(session),
      workingDirectory: panePath ?? dirPath,
      tmuxSession: session,
      tmuxPane: paneId,
    });
  }

  return results;
}

function resolveRemotePath(sshTarget: SshTarget, remotePath: string): string {
  if (!remotePath.startsWith("~")) return remotePath;

  const home = execRemote(sshTarget, 'printf %s "$HOME"');
  if (!home) {
    return remotePath;
  }

  if (remotePath === "~" || remotePath === "~/") {
    return home;
  }

  return path.posix.join(home, remotePath.slice(2));
}

function parseSimpleYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (match) {
      result[match[1]] = match[2].trim();
    }
  }
  return result;
}

/**
 * Scan copilot session-state directories to find sessions
 * with proper names and session IDs for --resume.
 */
function scanCopilotSessionsRemote(
  sshTarget: SshTarget,
  remotePath: string,
): ScanResult[] {
  const results: ScanResult[] = [];

  // Detect copilot binary path (nvm loads in interactive shells)
  const copilotBin = execRemote(
    sshTarget,
    buildInteractiveShellCommand("command -v copilot 2>/dev/null"),
  );

  // Batch read all workspace.yaml files and lock info in one SSH call
  const output = execRemote(
    sshTarget,
    `for d in ~/.copilot/session-state/*/; do ` +
      `echo "SESSION_START"; ` +
      `cat "$d/workspace.yaml" 2>/dev/null || echo "NO_YAML"; ` +
      `echo "LOCK_INFO:$(ls "$d"/inuse.*.lock 2>/dev/null | head -1)"; ` +
      `echo "SESSION_END"; ` +
      `done`,
  );

  if (!output || output === "NO_YAML") return results;

  const blocks = output.split("SESSION_START").filter((b) => b.trim());

  for (const block of blocks) {
    if (block.includes("NO_YAML") && !block.includes("id:")) continue;

    // Extract lock info
    const lockMatch = block.match(/LOCK_INFO:(.*)$/m);
    const lockFile = lockMatch?.[1]?.trim() ?? "";

    // Parse workspace.yaml content (everything before LOCK_INFO)
    const yamlText = block.split("LOCK_INFO:")[0] ?? "";
    const meta = parseSimpleYaml(yamlText);

    if (!meta.id || !meta.cwd) continue;

    // Only include sessions whose cwd matches the scanned path
    if (!isRemotePathWithinScope(meta.cwd, remotePath)) continue;

    // Determine running state from lock file
    let isRunning = false;
    if (lockFile) {
      const pidMatch = lockFile.match(/inuse\.(\d+)\.lock/);
      if (pidMatch) {
        const lockPid = pidMatch[1];
        // Check if the process is still alive
        const alive = execRemote(
          sshTarget,
          `kill -0 ${lockPid} 2>/dev/null && echo alive || echo dead`,
        );
        isRunning = alive === "alive";
      }
    }

    const sessionName = meta.name || meta.summary || undefined;
    const displayLabel = sessionName
      ? `${sessionName}`
      : `copilot (${path.basename(meta.cwd)})`;

    results.push({
      agentKind: "copilot",
      status: isRunning ? "running" : "stopped",
      displayName: displayLabel,
      workingDirectory: meta.cwd,
      sessionId: meta.id,
      sessionName,
      lastActivity: meta.updated_at,
      binaryPath: copilotBin || undefined,
      sshTarget,
    });
  }

  return results;
}

function scanCopilotSessionsLocal(dirPath: string): ScanResult[] {
  const results: ScanResult[] = [];
  const home = process.env.HOME ?? "/root";
  const sessionDir = path.join(home, ".copilot", "session-state");

  if (!fs.existsSync(sessionDir)) return results;

  for (const entry of fs.readdirSync(sessionDir)) {
    const entryPath = path.join(sessionDir, entry);
    const yamlPath = path.join(entryPath, "workspace.yaml");
    if (!fs.existsSync(yamlPath)) continue;

    try {
      const yamlText = fs.readFileSync(yamlPath, "utf8");
      const meta = parseSimpleYaml(yamlText);

      if (!meta.id || !meta.cwd) continue;
      if (!isLocalPathWithinScope(meta.cwd, dirPath)) continue;

      // Check lock files
      let isRunning = false;
      const lockFiles = fs
        .readdirSync(entryPath)
        .filter((f) => f.startsWith("inuse.") && f.endsWith(".lock"));
      for (const lf of lockFiles) {
        const pidMatch = lf.match(/inuse\.(\d+)\.lock/);
        if (pidMatch) {
          try {
            process.kill(parseInt(pidMatch[1], 10), 0);
            isRunning = true;
          } catch {
            // Process not alive
          }
        }
      }

      const sessionName = meta.name || meta.summary || undefined;
      const displayLabel = sessionName
        ? `${sessionName}`
        : `copilot (${path.basename(meta.cwd)})`;

      results.push({
        agentKind: "copilot",
        status: isRunning ? "running" : "stopped",
        displayName: displayLabel,
        workingDirectory: meta.cwd,
        sessionId: meta.id,
        sessionName,
        lastActivity: meta.updated_at,
      });
    } catch {
      /* skip unreadable sessions */
    }
  }

  return results;
}

function scanRemoteHistory(
  sshTarget: SshTarget,
  remotePath: string,
): ScanResult[] {
  const output = execRemote(sshTarget, buildFindIndicatorCommand(remotePath));
  const hits = parseIndicatorHits(output, true);

  return hits.map(({ agentKind, workingDirectory, indicatorPath }) => {
    const timestampOutput = execRemote(
      sshTarget,
      `stat -c %Y ${quoteForPosixShell(indicatorPath)} 2>/dev/null || stat -f %m ${quoteForPosixShell(indicatorPath)} 2>/dev/null || echo ''`,
    );
    const timestamp = parseInt(timestampOutput.trim(), 10);
    const lastActivity = isNaN(timestamp)
      ? undefined
      : new Date(timestamp * 1000).toISOString();

    return {
      agentKind,
      status: "stopped",
      displayName: `${agentKind} (远程: ${path.posix.basename(workingDirectory)})`,
      workingDirectory,
      lastActivity,
      historyPath: indicatorPath,
      sshTarget,
    } satisfies ScanResult;
  });
}

function scanRemoteProcesses(
  sshTarget: SshTarget,
  remotePath: string,
): ScanResult[] {
  const results: ScanResult[] = [];

  for (const procName of AGENT_PROCESS_NAMES) {
    const output = execRemote(
      sshTarget,
      `pgrep -af "${procName}" 2>/dev/null || true`,
    );
    if (!output) continue;

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;

      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[0], 10);
      if (isNaN(pid)) continue;

      const cmdline = parts.slice(1).join(" ");
      if (commandLineMatchesScope(cmdline, remotePath, true)) {
        results.push({
          agentKind: procName,
          status: "running",
          displayName: `${procName} (远程 PID ${pid})`,
          workingDirectory: remotePath,
          pid,
          sshTarget,
        });
      }
    }
  }

  return results;
}

function scanRemoteTmux(
  sshTarget: SshTarget,
  remotePath: string,
): ScanResult[] {
  const results: ScanResult[] = [];

  const panes = execRemote(
    sshTarget,
    `tmux list-panes -a -F '#{session_name}:#{pane_id}:#{pane_current_path}:#{pane_current_command}' 2>/dev/null || true`,
  );
  if (!panes) return results;

  for (const line of panes.split("\n")) {
    if (!line.trim()) continue;

    const parts = line.split(":");
    if (parts.length < 4) continue;

    const [session, paneId, panePath, command] = parts;

    if (!isRemotePathWithinScope(panePath, remotePath)) {
      continue;
    }

    // Also check if this pane runs a known agent process
    const isAgent = AGENT_PROCESS_NAMES.some(
      (name) =>
        command?.toLowerCase() === name ||
        session?.toLowerCase().includes(name),
    );

    results.push({
      agentKind: isAgent ? (command ?? "shell") : "shell",
      status: "running",
      displayName: canonicalTmuxDisplayName(session),
      workingDirectory: panePath ?? remotePath,
      tmuxSession: session,
      tmuxPane: paneId,
      sshTarget,
    });
  }

  return results;
}

function isSameSshTarget(left?: SshTarget, right?: SshTarget): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;

  return (
    left.host === right.host &&
    (left.port ?? 22) === (right.port ?? 22) &&
    (left.username ?? "") === (right.username ?? "")
  );
}

function matchesTmuxResult(
  result: ScanResult,
  tmuxResult: ScanResult,
): boolean {
  if (!tmuxResult.tmuxSession || result.status !== "running") {
    return false;
  }

  if (!isSameSshTarget(result.sshTarget, tmuxResult.sshTarget)) {
    return false;
  }

  const sessionName = result.sessionName?.trim().toLowerCase();
  if (sessionName) {
    return (
      tmuxResult.tmuxSession?.trim().toLowerCase() === sessionName ||
      tmuxResult.displayName.toLowerCase().includes(sessionName)
    );
  }

  const pathMatches = tmuxResult.sshTarget
    ? isRemotePathWithinScope(
        tmuxResult.workingDirectory,
        result.workingDirectory,
      )
    : isLocalPathWithinScope(
        tmuxResult.workingDirectory,
        result.workingDirectory,
      );

  const agentMatches =
    result.agentKind === tmuxResult.agentKind ||
    tmuxResult.agentKind === "shell" ||
    tmuxResult.displayName
      .toLowerCase()
      .includes(result.agentKind.toLowerCase());

  return pathMatches && agentMatches;
}

function mergeTmuxResults(
  results: ScanResult[],
  tmuxResults: ScanResult[],
): ScanResult[] {
  const remainingTmux = [...tmuxResults];
  const merged = results.map((result) => {
    const matchedIndex = remainingTmux.findIndex((tmuxResult) =>
      matchesTmuxResult(result, tmuxResult),
    );

    if (matchedIndex === -1) {
      return result;
    }

    const matched = remainingTmux.splice(matchedIndex, 1)[0];
    return {
      ...result,
      tmuxSession: matched.tmuxSession,
      tmuxPane: matched.tmuxPane,
      displayName: result.displayName,
    };
  });

  return [...merged, ...remainingTmux];
}

export function scanAgentDirectory(
  input: ScanDirectoryInput,
): ScanDirectoryResponse {
  const { path: dirPath, hostId, sshTarget } = input;

  let results: ScanResult[];

  if (sshTarget) {
    const resolvedPath = resolveRemotePath(sshTarget, dirPath);
    const historyResults = scanRemoteHistory(sshTarget, resolvedPath);
    const processResults = scanRemoteProcesses(sshTarget, resolvedPath);
    const tmuxResults = scanRemoteTmux(sshTarget, resolvedPath);
    const copilotSessions = scanCopilotSessionsRemote(sshTarget, resolvedPath);
    // Copilot sessions with sessionId take priority over generic results
    const copilotIds = new Set(
      copilotSessions.map((s) => s.agentKind + ":" + s.workingDirectory),
    );
    const filtered = [...processResults, ...historyResults].filter(
      (r) => !copilotIds.has(r.agentKind + ":" + r.workingDirectory),
    );
    results = mergeTmuxResults([...copilotSessions, ...filtered], tmuxResults);
  } else {
    const resolvedPath = dirPath.startsWith("~")
      ? dirPath.replace("~", process.env.HOME ?? "/root")
      : dirPath;

    const historyResults = scanLocalHistory(resolvedPath);
    const processResults = scanLocalProcesses(resolvedPath);
    const tmuxResults = scanLocalTmux(resolvedPath);
    const copilotSessions = scanCopilotSessionsLocal(resolvedPath);
    const copilotIds = new Set(
      copilotSessions.map((s) => s.agentKind + ":" + s.workingDirectory),
    );
    const filtered = [...processResults, ...historyResults].filter(
      (r) => !copilotIds.has(r.agentKind + ":" + r.workingDirectory),
    );
    results = mergeTmuxResults([...copilotSessions, ...filtered], tmuxResults);
  }

  // Deduplicate: sessions with sessionId are unique; others dedup by kind+cwd+status
  const seen = new Set<string>();
  const deduped = results.filter((r) => {
    const key = r.sessionId
      ? `session:${r.sessionId}`
      : `${r.agentKind}:${r.workingDirectory}:${r.status}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    results: deduped,
    scannedPath: dirPath,
    hostId: hostId ?? "local",
  };
}
