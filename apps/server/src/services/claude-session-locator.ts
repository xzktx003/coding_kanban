import { execFile } from "node:child_process";
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import type { SshTarget } from "@agent-orchestrator/shared";

import {
  buildInteractiveShellCommand,
  quoteForPosixShell,
} from "./runtime-compat.js";
import { buildSshArgs } from "./ssh-command.js";
import { ensureInheritedTmuxControlSocket } from "./tmux-control-socket.js";

const execFileAsync = promisify(execFile);

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSCRIPT_HEADER_BYTES = 256 * 1024;
const MAX_PROCESS_TREE_SIZE = 512;
const MAX_PROJECT_DIRECTORIES = 512;
const MAX_TRANSCRIPTS_PER_DIRECTORY = 64;
const REMOTE_LOOKUP_TIMEOUT_MS = 10_000;
const TMUX_TIMEOUT_MS = 2_000;

export interface ResolveClaudeSessionInput {
  tmuxTarget?: string;
  workingDirectory?: string;
  sshTarget?: SshTarget;
}

interface ClaudeSessionLocatorOptions {
  procRoot?: string;
  projectsRoot?: string;
  resolveTmuxPanePid?: (target: string) => Promise<number | null>;
  runRemoteCommand?: (command: string, sshTarget: SshTarget) => Promise<string>;
}

interface TranscriptCandidate {
  sessionId: string;
  cwd: string;
  mtimeMs: number;
}

function isClaudeProcess(procRoot: string, processId: number): boolean {
  try {
    const commandLine = readFileSync(
      join(procRoot, String(processId), "cmdline"),
      "utf8",
    );
    return commandLine.split("\0").some((argument) => {
      const executable = argument.split("/").at(-1) ?? "";
      return executable === "claude" || executable.startsWith("claude-");
    });
  } catch {
    return false;
  }
}

function readResumeSessionId(
  procRoot: string,
  processId: number,
): string | null {
  try {
    const args = readFileSync(join(procRoot, String(processId), "cmdline"), "utf8")
      .split("\0")
      .filter(Boolean);
    for (let index = 0; index < args.length - 1; index += 1) {
      const flag = args[index];
      const value = args[index + 1];
      if (
        (flag === "--resume" || flag === "--session-id") &&
        value &&
        SESSION_ID_PATTERN.test(value)
      ) {
        return value;
      }
    }
  } catch {
    // The process may exit while its command line is being inspected.
  }
  return null;
}

function collectProcessTree(procRoot: string, rootPid: number): number[] {
  const pending = [rootPid];
  const visited = new Set<number>();

  while (pending.length > 0 && visited.size < MAX_PROCESS_TREE_SIZE) {
    const processId = pending.shift();
    if (
      processId === undefined ||
      !Number.isSafeInteger(processId) ||
      processId <= 0 ||
      visited.has(processId)
    ) {
      continue;
    }
    visited.add(processId);
    try {
      const children = readFileSync(
        join(procRoot, String(processId), "task", String(processId), "children"),
        "utf8",
      );
      for (const value of children.trim().split(/\s+/)) {
        const childPid = Number(value);
        if (Number.isSafeInteger(childPid) && childPid > 0) {
          pending.push(childPid);
        }
      }
    } catch {
      // The process may exit while its tree is being inspected.
    }
  }

  return [...visited];
}

function readTranscriptCandidate(path: string): TranscriptCandidate | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, "r");
    const buffer = Buffer.alloc(TRANSCRIPT_HEADER_BYTES);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    let cwd = "";
    let sessionId = "";
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let record: { cwd?: unknown; sessionId?: unknown };
      try {
        record = JSON.parse(line) as { cwd?: unknown; sessionId?: unknown };
      } catch {
        continue;
      }
      if (!cwd && typeof record.cwd === "string" && isAbsolute(record.cwd)) {
        cwd = record.cwd;
      }
      if (
        !sessionId &&
        typeof record.sessionId === "string" &&
        SESSION_ID_PATTERN.test(record.sessionId)
      ) {
        sessionId = record.sessionId;
      }
      if (cwd && sessionId) break;
    }
    if (!cwd || !sessionId) return null;
    return { sessionId, cwd, mtimeMs: statSync(path).mtimeMs };
  } catch {
    return null;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function listTranscripts(projectsRoot: string): TranscriptCandidate[] {
  let directories: Dirent<string>[];
  try {
    directories = readdirSync(projectsRoot, {
      encoding: "utf8",
      withFileTypes: true,
    });
  } catch {
    return [];
  }

  const candidates: TranscriptCandidate[] = [];
  for (const directory of directories.slice(0, MAX_PROJECT_DIRECTORIES)) {
    if (!directory.isDirectory()) continue;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(join(projectsRoot, directory.name), {
        encoding: "utf8",
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    for (const entry of entries.slice(0, MAX_TRANSCRIPTS_PER_DIRECTORY)) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const candidate = readTranscriptCandidate(
        join(projectsRoot, directory.name, entry.name),
      );
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function uniqueMatch(
  candidates: TranscriptCandidate[],
  workingDirectory: string,
): string | undefined {
  const sessionIds = new Set(
    candidates
      .filter((candidate) => candidate.cwd === workingDirectory)
      .map((candidate) => candidate.sessionId),
  );
  return sessionIds.size === 1 ? [...sessionIds][0] : undefined;
}

function normalizeWorkingDirectory(workingDirectory: string): string {
  if (workingDirectory === "~") return homedir();
  if (workingDirectory.startsWith("~/")) {
    return join(homedir(), workingDirectory.slice(2));
  }
  return workingDirectory;
}

function isSafeRemotePath(workingDirectory: string): boolean {
  return (
    isAbsolute(workingDirectory) &&
    !workingDirectory.includes("..") &&
    /^\/[A-Za-z0-9._~/-]+$/.test(workingDirectory)
  );
}
function isValidTmuxTarget(target: string): boolean {
  return /^[%]?[A-Za-z0-9_.:@-]{1,128}$/.test(target);
}

async function defaultResolveTmuxPanePid(
  target: string,
): Promise<number | null> {
  if (!isValidTmuxTarget(target)) return null;
  try {
    await ensureInheritedTmuxControlSocket();
    const result = await execFileAsync(
      "tmux",
      ["display-message", "-p", "-t", target, "#{pane_pid}"],
      { encoding: "utf8", timeout: TMUX_TIMEOUT_MS, maxBuffer: 16 * 1024 },
    );
    const processId = Number(result.stdout.trim());
    return Number.isSafeInteger(processId) && processId > 0 ? processId : null;
  } catch {
    return null;
  }
}

function buildRemoteLookupCommand(workingDirectory: string): string {
  const projectDirectory = quoteForPosixShell(
    workingDirectory.replace(/[^A-Za-z0-9]/g, "-"),
  );
  const cwdMarker = quoteForPosixShell(`"cwd":"${workingDirectory}"`);
  const script = [
    'root="$HOME/.claude/projects"',
    `dir="$root"/${projectDirectory}`,
    'newest=""',
    'count=0',
    'for file in "$dir"/*.jsonl; do',
    '  [ -f "$file" ] || continue',
    `  head -c 262144 "$file" | grep -q -F -m 1 -- ${cwdMarker} || continue`,
    '  count=$((count + 1))',
    '  [ "$count" -gt 1 ] && exit 0',
    '  newest=$(basename "$file" .jsonl)',
    "done",
    '[ "$count" -eq 1 ] && printf %s "$newest"',
    ":",
  ].join("\n");
  return buildInteractiveShellCommand(script);
}

async function defaultRunRemoteCommand(
  command: string,
  sshTarget: SshTarget,
): Promise<string> {
  const result = await execFileAsync(
    "ssh",
    buildSshArgs(sshTarget, {
      batchMode: true,
      connectTimeoutSeconds: 10,
      remoteCommand: command,
    }),
    { encoding: "utf8", timeout: REMOTE_LOOKUP_TIMEOUT_MS, maxBuffer: 64 * 1024 },
  );
  return result.stdout.trim();
}

export class ClaudeSessionLocator {
  private readonly procRoot: string;
  private readonly projectsRoot: string;
  private readonly resolveTmuxPanePid: (target: string) => Promise<number | null>;
  private readonly runRemoteCommand: (
    command: string,
    sshTarget: SshTarget,
  ) => Promise<string>;

  constructor(options: ClaudeSessionLocatorOptions = {}) {
    this.procRoot = options.procRoot ?? "/proc";
    this.projectsRoot =
      options.projectsRoot ?? join(homedir(), ".claude", "projects");
    this.resolveTmuxPanePid =
      options.resolveTmuxPanePid ?? defaultResolveTmuxPanePid;
    this.runRemoteCommand = options.runRemoteCommand ?? defaultRunRemoteCommand;
  }

  async resolve(input: ResolveClaudeSessionInput): Promise<string | undefined> {
    if (input.sshTarget) {
      return this.resolveRemote(input);
    }

    if (input.tmuxTarget) {
      const panePid = await this.resolveTmuxPanePid(input.tmuxTarget);
      if (panePid) {
        for (const processId of collectProcessTree(this.procRoot, panePid)) {
          if (!isClaudeProcess(this.procRoot, processId)) continue;
          const sessionId = readResumeSessionId(this.procRoot, processId);
          if (sessionId) return sessionId;
        }
      }
    }

    if (!input.workingDirectory) return undefined;
    const workingDirectory = normalizeWorkingDirectory(input.workingDirectory);
    return uniqueMatch(listTranscripts(this.projectsRoot), workingDirectory);
  }

  private async resolveRemote(
    input: ResolveClaudeSessionInput,
  ): Promise<string | undefined> {
    if (!input.sshTarget || !isSafeRemotePath(input.workingDirectory ?? "")) {
      return undefined;
    }
    try {
      const output = await this.runRemoteCommand(
        buildRemoteLookupCommand(input.workingDirectory ?? ""),
        input.sshTarget,
      );
      const trimmed = output.trim();
      return SESSION_ID_PATTERN.test(trimmed) ? trimmed : undefined;
    } catch {
      return undefined;
    }
  }
}
