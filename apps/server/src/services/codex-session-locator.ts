import { execFile } from "node:child_process";
import {
  closeSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SESSION_HEADER_BYTES = 64 * 1024;
const MAX_PROCESS_TREE_SIZE = 512;
const TMUX_TIMEOUT_MS = 2_000;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const SHELL_SNAPSHOT_MATCH_WINDOW_MS = 2 * 60 * 1_000;

interface CodexSessionLocatorOptions {
  procRoot?: string;
  sessionsRoot?: string;
  shellSnapshotsRoot?: string;
  resolveTmuxPanePid?: (target: string) => Promise<number | null>;
  resolveTmuxActivePanePid?: (
    sessionName: string,
    clientProcessId?: number,
  ) => Promise<number | null>;
}

interface ResolveCodexSessionInput {
  tmuxTarget: string;
  tmuxSession?: string;
  tmuxClientProcessId?: number;
  workingDirectory?: string;
}

interface OpenSessionCandidate {
  id: string;
  cwd: string;
  mtimeMs: number;
  path: string;
  subagent: boolean;
}

function isPathInside(root: string, path: string): boolean {
  const child = relative(resolve(root), resolve(path));
  return Boolean(child) && !child.startsWith("..") && !isAbsolute(child);
}

function readOpenSession(path: string): OpenSessionCandidate | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, "r");
    const buffer = Buffer.alloc(SESSION_HEADER_BYTES);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    const firstLine = buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .split("\n", 1)[0];
    const record = JSON.parse(firstLine ?? "") as {
      type?: unknown;
      payload?: Record<string, unknown>;
    };
    if (record.type !== "session_meta" || !record.payload) return null;

    const id = record.payload.id;
    const cwd = record.payload.cwd;
    if (
      typeof id !== "string" ||
      !SESSION_ID_PATTERN.test(id) ||
      typeof cwd !== "string" ||
      !cwd
    ) {
      return null;
    }
    const source = record.payload.source;
    const subagent =
      source !== null && typeof source === "object" && "subagent" in source;
    return { id, cwd, mtimeMs: statSync(path).mtimeMs, path, subagent };
  } catch {
    return null;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function collectProcessTree(procRoot: string, rootPid: number): number[] {
  const pending = [rootPid];
  const visited = new Set<number>();

  while (pending.length > 0 && visited.size < MAX_PROCESS_TREE_SIZE) {
    const processId = pending.shift()!;
    if (
      !Number.isSafeInteger(processId) ||
      processId <= 0 ||
      visited.has(processId)
    ) {
      continue;
    }
    visited.add(processId);
    try {
      const children = readFileSync(
        join(
          procRoot,
          String(processId),
          "task",
          String(processId),
          "children",
        ),
        "utf8",
      );
      for (const value of children.trim().split(/\s+/)) {
        if (!value) continue;
        const childPid = Number(value);
        if (Number.isSafeInteger(childPid) && childPid > 0)
          pending.push(childPid);
      }
    } catch {
      // The process may exit while its tree is being inspected.
    }
  }

  return [...visited];
}

function isCodexProcess(procRoot: string, processId: number): boolean {
  try {
    const commandLine = readFileSync(
      join(procRoot, String(processId), "cmdline"),
      "utf8",
    );
    return commandLine.split("\0").some((argument) => {
      const executable = argument.split("/").at(-1) ?? "";
      return executable === "codex" || executable.startsWith("codex-");
    });
  } catch {
    return false;
  }
}

function readProcessWorkingDirectory(
  procRoot: string,
  processId: number,
): string | undefined {
  try {
    const workingDirectory = readlinkSync(
      join(procRoot, String(processId), "cwd"),
    );
    return isAbsolute(workingDirectory) ? workingDirectory : undefined;
  } catch {
    return undefined;
  }
}

function listSessionFiles(root: string): string[] {
  const pending = [root];
  const files: string[] = [];

  while (pending.length > 0) {
    const directory = pending.pop()!;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(directory, {
        encoding: "utf8",
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(path);
      }
    }
  }

  return files;
}

function readProcessStartTime(
  procRoot: string,
  processId: number,
): number | null {
  try {
    const modifiedAt = statSync(join(procRoot, String(processId))).mtimeMs;
    return Number.isFinite(modifiedAt) ? modifiedAt : null;
  } catch {
    return null;
  }
}

function resolveShellSnapshotSessionId(
  shellSnapshotsRoot: string,
  procRoot: string,
  processId: number,
  allowedSessionIds?: ReadonlySet<string>,
): string | null {
  const processStartTime = readProcessStartTime(procRoot, processId);
  if (processStartTime === null) {
    return null;
  }

  let entries: Dirent<string>[];
  try {
    entries = readdirSync(shellSnapshotsRoot, {
      encoding: "utf8",
      withFileTypes: true,
    });
  } catch {
    return null;
  }

  let closest: { distance: number; sessionId: string } | null = null;
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const match =
      /^(?<sessionId>[a-zA-Z0-9_-]{8,128})\.(?<timestamp>\d+)\.sh$/.exec(
        entry.name,
      );
    if (!match?.groups) {
      continue;
    }

    if (allowedSessionIds && !allowedSessionIds.has(match.groups.sessionId)) {
      continue;
    }

    const snapshotTime = Number(match.groups.timestamp) / 1_000_000;
    if (!Number.isFinite(snapshotTime)) {
      continue;
    }

    const distance = Math.abs(snapshotTime - processStartTime);
    if (
      distance > SHELL_SNAPSHOT_MATCH_WINDOW_MS ||
      (closest && closest.distance <= distance)
    ) {
      continue;
    }

    closest = {
      distance,
      sessionId: match.groups.sessionId,
    };
  }

  return closest?.sessionId ?? null;
}

function isValidTmuxTarget(target: string): boolean {
  return (
    Boolean(target.trim()) && !target.includes("\0") && target.length <= 256
  );
}

async function defaultResolveTmuxPanePid(
  target: string,
): Promise<number | null> {
  if (!isValidTmuxTarget(target)) return null;
  try {
    const result = await execFileAsync(
      "tmux",
      ["display-message", "-p", "-t", target, "#{pane_pid}"],
      {
        encoding: "utf8",
        timeout: TMUX_TIMEOUT_MS,
        maxBuffer: 16 * 1024,
      },
    );
    const processId = Number(result.stdout.trim());
    return Number.isSafeInteger(processId) && processId > 0 ? processId : null;
  } catch {
    return null;
  }
}

async function defaultResolveTmuxActivePanePid(
  sessionName: string,
  clientProcessId?: number,
): Promise<number | null> {
  if (!isValidTmuxTarget(sessionName)) {
    return null;
  }

  try {
    if (clientProcessId !== undefined) {
      if (!Number.isSafeInteger(clientProcessId) || clientProcessId <= 0) {
        return null;
      }

      const clientResult = await execFileAsync(
        "tmux",
        ["list-clients", "-t", `=${sessionName}`, "-F", "#{client_pid}"],
        {
          encoding: "utf8",
          timeout: TMUX_TIMEOUT_MS,
          maxBuffer: 16 * 1024,
        },
      );
      const isAttached = String(clientResult.stdout)
        .split("\n")
        .some((value) => Number(value.trim()) === clientProcessId);
      if (!isAttached) return null;
    }

    const paneResult = await execFileAsync(
      "tmux",
      [
        "list-panes",
        "-t",
        `=${sessionName}`,
        "-F",
        "#{pane_active}\t#{pane_pid}",
      ],
      {
        encoding: "utf8",
        timeout: TMUX_TIMEOUT_MS,
        maxBuffer: 16 * 1024,
      },
    );
    for (const line of String(paneResult.stdout).split("\n")) {
      const [active, rawPanePid] = line.split("\t");
      if (active !== "1") continue;
      const panePid = Number(rawPanePid);
      if (Number.isSafeInteger(panePid) && panePid > 0) return panePid;
    }
  } catch {
    // tmux may exit while the managed client is being detached.
  }

  return null;
}

export class CodexSessionLocator {
  private readonly procRoot: string;
  private readonly sessionsRoot: string;
  private readonly shellSnapshotsRoot: string;
  private readonly resolveTmuxPanePid: (
    target: string,
  ) => Promise<number | null>;
  private readonly resolveTmuxActivePanePid: (
    sessionName: string,
    clientProcessId?: number,
  ) => Promise<number | null>;

  constructor(options: CodexSessionLocatorOptions = {}) {
    this.procRoot = options.procRoot ?? "/proc";
    this.sessionsRoot =
      options.sessionsRoot ?? join(homedir(), ".codex", "sessions");
    this.shellSnapshotsRoot =
      options.shellSnapshotsRoot ??
      join(homedir(), ".codex", "shell_snapshots");
    this.resolveTmuxPanePid =
      options.resolveTmuxPanePid ?? defaultResolveTmuxPanePid;
    this.resolveTmuxActivePanePid =
      options.resolveTmuxActivePanePid ?? defaultResolveTmuxActivePanePid;
  }

  async resolve(input: ResolveCodexSessionInput): Promise<string | undefined> {
    const activePanePid = input.tmuxSession
      ? await this.resolveTmuxActivePanePid(
          input.tmuxSession,
          input.tmuxClientProcessId,
        )
      : null;
    const panePid =
      activePanePid ?? (await this.resolveTmuxPanePid(input.tmuxTarget));
    if (!panePid) return undefined;

    // A managed card keeps the directory from the pane it was first
    // discovered in. Once the user switches windows in the same tmux session,
    // that value is stale, so the attached client's active pane must win.
    const activePaneDirectory = activePanePid
      ? readProcessWorkingDirectory(this.procRoot, activePanePid)
      : undefined;
    const normalizedDirectory =
      (activePaneDirectory ?? input.workingDirectory)
        ? resolve(activePaneDirectory ?? input.workingDirectory!)
        : undefined;
    const candidates = new Map<string, OpenSessionCandidate>();
    const processIds = collectProcessTree(this.procRoot, panePid);

    for (const processId of processIds) {
      let descriptors: string[];
      try {
        descriptors = readdirSync(join(this.procRoot, String(processId), "fd"));
      } catch {
        continue;
      }
      for (const descriptor of descriptors) {
        let target: string;
        try {
          target = readlinkSync(
            join(this.procRoot, String(processId), "fd", descriptor),
          );
        } catch {
          continue;
        }
        if (
          !target.endsWith(".jsonl") ||
          !isPathInside(this.sessionsRoot, target) ||
          candidates.has(target)
        ) {
          continue;
        }
        const candidate = readOpenSession(target);
        if (
          !candidate ||
          candidate.subagent ||
          (normalizedDirectory &&
            resolve(candidate.cwd) !== normalizedDirectory)
        ) {
          continue;
        }
        candidates.set(target, candidate);
      }
    }

    const openCandidates = [...candidates.values()];
    if (openCandidates.length > 0) {
      return openCandidates.sort(
        (left, right) => right.mtimeMs - left.mtimeMs,
      )[0]?.id;
    }

    const codexProcessIds = processIds.filter((processId) =>
      isCodexProcess(this.procRoot, processId),
    );
    const sessionFiles = listSessionFiles(this.sessionsRoot);
    const sessionCandidates = sessionFiles
      .map((path) => readOpenSession(path))
      .filter((candidate): candidate is OpenSessionCandidate =>
        Boolean(
          candidate &&
          !candidate.subagent &&
          (!normalizedDirectory ||
            resolve(candidate.cwd) === normalizedDirectory),
        ),
      );
    const sessionCandidateIds = new Set(
      sessionCandidates.map((candidate) => candidate.id),
    );

    // `codex resume` can close the rollout file between writes. In that case
    // directory recency is unsafe when several Codex processes share a cwd.
    // Codex's shell snapshot is created next to the process startup and keeps
    // the selected conversation ID unambiguous for the matching tmux pane.
    for (const processId of codexProcessIds) {
      const snapshotSessionId = resolveShellSnapshotSessionId(
        this.shellSnapshotsRoot,
        this.procRoot,
        processId,
        sessionCandidateIds,
      );
      if (!snapshotSessionId) {
        continue;
      }

      const matchingSession = sessionCandidates.find(
        (candidate) => candidate.id === snapshotSessionId,
      );
      if (matchingSession) {
        return matchingSession.id;
      }
    }

    // Recent Codex builds append rollout JSONL through short-lived handles
    // instead of keeping the session file open. Only use the directory
    // fallback when the active pane is demonstrably running Codex; a shell
    // pane must not inherit the previous pane's transcript.
    if (
      normalizedDirectory &&
      codexProcessIds.length > 0 &&
      sessionCandidates.length === 1
    ) {
      return sessionCandidates[0]?.id;
    }

    return undefined;
  }
}
