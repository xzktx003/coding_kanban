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
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SESSION_HEADER_BYTES = 64 * 1024;
const MAX_PROCESS_TREE_SIZE = 512;
const TMUX_TIMEOUT_MS = 2_000;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

interface CodexSessionLocatorOptions {
  procRoot?: string;
  sessionsRoot?: string;
  resolveTmuxPanePid?: (target: string) => Promise<number | null>;
}

interface ResolveCodexSessionInput {
  tmuxTarget: string;
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
      source !== null &&
      typeof source === "object" &&
      "subagent" in source;
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
    if (!Number.isSafeInteger(processId) || processId <= 0 || visited.has(processId)) {
      continue;
    }
    visited.add(processId);
    try {
      const children = readFileSync(
        join(procRoot, String(processId), "task", String(processId), "children"),
        "utf8",
      );
      for (const value of children.trim().split(/\s+/)) {
        if (!value) continue;
        const childPid = Number(value);
        if (Number.isSafeInteger(childPid) && childPid > 0) pending.push(childPid);
      }
    } catch {
      // The process may exit while its tree is being inspected.
    }
  }

  return [...visited];
}

async function defaultResolveTmuxPanePid(target: string): Promise<number | null> {
  if (!target.trim() || target.includes("\0") || target.length > 256) return null;
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

export class CodexSessionLocator {
  private readonly procRoot: string;
  private readonly sessionsRoot: string;
  private readonly resolveTmuxPanePid: (target: string) => Promise<number | null>;

  constructor(options: CodexSessionLocatorOptions = {}) {
    this.procRoot = options.procRoot ?? "/proc";
    this.sessionsRoot =
      options.sessionsRoot ?? join(homedir(), ".codex", "sessions");
    this.resolveTmuxPanePid =
      options.resolveTmuxPanePid ?? defaultResolveTmuxPanePid;
  }

  async resolve(input: ResolveCodexSessionInput): Promise<string | undefined> {
    const panePid = await this.resolveTmuxPanePid(input.tmuxTarget);
    if (!panePid) return undefined;

    const normalizedDirectory = input.workingDirectory
      ? resolve(input.workingDirectory)
      : undefined;
    const candidates = new Map<string, OpenSessionCandidate>();

    for (const processId of collectProcessTree(this.procRoot, panePid)) {
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
          (normalizedDirectory && resolve(candidate.cwd) !== normalizedDirectory)
        ) {
          continue;
        }
        candidates.set(target, candidate);
      }
    }

    return [...candidates.values()]
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .at(0)?.id;
  }
}
