import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type {
  AgentSessionRecord,
  AgentTranscriptEntry,
  AgentTranscriptResponse,
  SshTarget,
} from "@agent-orchestrator/shared";

import type {
  ReadRemoteTranscriptInput,
  RemoteCodexFileAccess,
} from "./codex-transcript-service.js";

const TRANSCRIPT_READ_BLOCK_BYTES = 64 * 1024;
const DEFAULT_TRANSCRIPT_PAGE_LIMIT = 30;
const MAX_TRANSCRIPT_PAGE_LIMIT = 100;
const HEADER_SCAN_BYTES = 256 * 1024;
const LATEST_COMPLETION_SCAN_BYTES = 1024 * 1024;
const COMPLETION_QUESTION_RECOVERY_SCAN_BYTES = 8 * 1024 * 1024;
const MAX_VISIBLE_TEXT_CHARS = 200_000;
const MAX_TOOL_TEXT_CHARS = 8_000;
const MAX_USER_QUESTION_CHARS = 8_000;
const COMPLETION_STOP_REASONS = new Set([
  "end_turn",
  "max_tokens",
  "stop_sequence",
]);

export const CLAUDE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ClaudeTranscriptServiceOptions {
  projectsRoot?: string;
  sessionsRoot?: string;
  remoteFileAccess?: RemoteCodexFileAccess;
}

export interface ReadClaudeTranscriptInput {
  sessionId?: string;
  workingDirectory?: string;
  tmuxSession?: string;
  tmuxPane?: string;
  cursor?: string;
  limit?: number;
}

export interface ClaudeTurnCompletion {
  completionId: string;
  sessionId: string;
  content: string;
  completedAt: string;
  userQuestion?: string;
}

interface LocatedClaudeTranscript {
  path: string;
  sessionId: string;
  matchedBy: "session-id" | "working-directory";
  size: number;
  modifiedAt: string;
}

interface ClaudeLiveSession {
  sessionId: string;
  cwd: string;
  tmux?: string;
  updatedAt: number;
  spare: boolean;
}

interface ParsedClaudeLine {
  entries: AgentTranscriptEntry[];
  completion: Omit<ClaudeTurnCompletion, "sessionId" | "userQuestion"> | null;
  userPrompt: string | null;
  sessionId: string | null;
}

type RangeReader = (offset: number, length: number) => Promise<Buffer>;

export function encodeClaudeProjectDirectory(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

export function claudeTmuxTargetMatches(
  tmuxField: string | undefined,
  tmuxSession: string | undefined,
  tmuxPane: string | undefined,
): boolean {
  if (!tmuxField || !tmuxSession || !tmuxPane) {
    return false;
  }
  if (/[\u0000-\u001f\u007f]/u.test(tmuxSession + tmuxPane)) {
    return false;
  }
  return (
    tmuxField.startsWith(`${tmuxSession}:`) &&
    tmuxField.endsWith(`.${tmuxPane}`)
  );
}

function normalizePageLimit(limit: number | undefined): number {
  if (!Number.isSafeInteger(limit) || !limit || limit < 1) {
    return DEFAULT_TRANSCRIPT_PAGE_LIMIT;
  }
  return Math.min(limit, MAX_TRANSCRIPT_PAGE_LIMIT);
}

function resolveCursorOffset(
  cursor: string | undefined,
  fileSize: number,
): number {
  if (!cursor || !/^\d+$/.test(cursor)) {
    return fileSize;
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > fileSize) {
    return fileSize;
  }
  return offset;
}

function capText(text: string, maxChars: number): string {
  const characters = Array.from(text);
  if (characters.length <= maxChars) {
    return text;
  }
  return `${characters.slice(0, maxChars).join("")}\n…(已截断)`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readLocalRange(path: string, offset: number, length: number): Buffer {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(descriptor, buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}

function readCwdHint(path: string): string | null {
  const sample = readLocalRange(path, 0, HEADER_SCAN_BYTES).toString("utf8");
  const match = sample.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
  if (!match?.[1]) {
    return null;
  }
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}

async function scanLinesBackward(
  readRange: RangeReader,
  endOffset: number,
  visit: (line: string, lineStartOffset: number) => boolean,
): Promise<void> {
  let position = endOffset;
  let suffix = Buffer.alloc(0);
  while (position > 0) {
    const blockStart = Math.max(0, position - TRANSCRIPT_READ_BLOCK_BYTES);
    const block = await readRange(blockStart, position - blockStart);
    const combined = suffix.length ? Buffer.concat([block, suffix]) : block;
    let lineEnd = combined.length;
    for (let index = combined.length - 1; index >= 0; index -= 1) {
      if (combined[index] !== 0x0a) {
        continue;
      }
      const lineStart = index + 1;
      if (
        lineEnd > lineStart &&
        visit(
          combined.subarray(lineStart, lineEnd).toString("utf8"),
          blockStart + lineStart,
        )
      ) {
        return;
      }
      lineEnd = index;
    }
    suffix = Buffer.from(combined.subarray(0, lineEnd));
    position = blockStart;
  }
  if (suffix.length > 0) {
    visit(suffix.toString("utf8"), 0);
  }
}

function textFromBlock(block: Record<string, unknown>): string {
  if (typeof block.text === "string") {
    return block.text;
  }
  if (typeof block.content === "string") {
    return block.content;
  }
  if (Array.isArray(block.content)) {
    return block.content
      .map((item) => (isRecord(item) ? textFromBlock(item) : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function parseClaudeLine(line: string): ParsedClaudeLine {
  const empty = {
    entries: [],
    completion: null,
    userPrompt: null,
    sessionId: null,
  };
  let record: Record<string, unknown>;
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed)) {
      return empty;
    }
    record = parsed;
  } catch {
    return empty;
  }
  if (record.isSidechain === true || record.isMeta === true) {
    return empty;
  }
  const type = record.type;
  if (type !== "user" && type !== "assistant") {
    return empty;
  }
  const timestamp = stringValue(record.timestamp) ?? "1970-01-01T00:00:00.000Z";
  const uuid = stringValue(record.uuid) ?? `${type}:${timestamp}`;
  const sessionId = stringValue(record.sessionId);
  const message = isRecord(record.message) ? record.message : null;
  const content = message?.content;
  const entries: AgentTranscriptEntry[] = [];
  const textParts: string[] = [];
  let sawToolUse = false;

  const pushText = (kind: "user" | "assistant", text: string) => {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }
    entries.push({
      id: uuid,
      timestamp,
      kind,
      title: kind === "user" ? "你" : "Claude",
      text: capText(normalized, MAX_VISIBLE_TEXT_CHARS),
      collapsedByDefault: false,
    });
  };

  if (typeof content === "string") {
    textParts.push(content);
  } else if (Array.isArray(content)) {
    for (const [index, block] of content.entries()) {
      if (!isRecord(block)) {
        continue;
      }
      if (block.type === "thinking") {
        continue;
      }
      if (
        block.type === "text" ||
        (type === "user" && block.type === undefined)
      ) {
        const text = textFromBlock(block);
        textParts.push(text);
        continue;
      }
      if (block.type === "tool_use") {
        sawToolUse = true;
        const name = stringValue(block.name) ?? "tool";
        const input =
          isRecord(block.input) || Array.isArray(block.input)
            ? JSON.stringify(block.input, null, 2)
            : (stringValue(block.input) ?? "");
        entries.push({
          id: `${uuid}:tool:${index}`,
          timestamp,
          kind: "tool",
          title: `${name} 调用`,
          text: capText(input, MAX_TOOL_TEXT_CHARS),
          collapsedByDefault: true,
        });
        continue;
      }
      if (block.type === "tool_result") {
        const result = textFromBlock(block).trim();
        if (!result) {
          continue;
        }
        entries.push({
          id: `${uuid}:result:${index}`,
          timestamp,
          kind: "tool",
          title: "工具结果",
          text: capText(result, MAX_TOOL_TEXT_CHARS),
          collapsedByDefault: true,
        });
      }
    }
  }

  if (type === "user" && textParts.join("").trim()) {
    pushText("user", textParts.join("\n"));
  }
  if (type === "assistant" && textParts.join("").trim()) {
    pushText("assistant", textParts.join("\n"));
  }

  const assistantText = textParts.join("\n").trim();
  const stopReason = stringValue(message?.stop_reason);
  const messageId = stringValue(message?.id);
  const completion =
    type === "assistant" &&
    assistantText &&
    stopReason &&
    COMPLETION_STOP_REASONS.has(stopReason) &&
    !sawToolUse
      ? {
          completionId: messageId ?? uuid,
          content: capText(assistantText, MAX_VISIBLE_TEXT_CHARS),
          completedAt: timestamp,
        }
      : null;

  return {
    entries,
    completion,
    userPrompt:
      type === "user" && textParts.join("").trim()
        ? capText(textParts.join("\n").trim(), MAX_USER_QUESTION_CHARS)
        : null,
    sessionId,
  };
}

async function readTranscriptPage(
  fileSize: number,
  readRange: RangeReader,
  cursor: string | undefined,
  limit: number | undefined,
): Promise<
  Pick<AgentTranscriptResponse, "entries" | "hasMore" | "nextCursor">
> {
  const pageLimit = normalizePageLimit(limit);
  const endOffset = resolveCursorOffset(cursor, fileSize);
  const collected: AgentTranscriptEntry[] = [];
  let oldestStart = 0;
  let stoppedEarly = false;
  await scanLinesBackward(readRange, endOffset, (line, lineStart) => {
    const parsed = parseClaudeLine(line);
    if (parsed.entries.length === 0) {
      return false;
    }
    collected.unshift(...parsed.entries);
    oldestStart = lineStart;
    if (collected.length >= pageLimit && lineStart > 0) {
      stoppedEarly = true;
      return true;
    }
    return false;
  });
  return {
    entries: collected,
    hasMore: stoppedEarly,
    nextCursor: stoppedEarly ? String(oldestStart) : null,
  };
}

async function readLatestCompletionFromReader(
  fileSize: number,
  readRange: RangeReader,
  fallbackSessionId: string,
): Promise<ClaudeTurnCompletion | null> {
  const scanTail = async (
    scanBytes: number,
  ): Promise<ClaudeTurnCompletion | null> => {
    const result: {
      completion: ParsedClaudeLine["completion"];
      sessionId: string;
      userQuestion?: string;
    } = { completion: null, sessionId: fallbackSessionId };
    const minimumOffset = Math.max(0, fileSize - scanBytes);
    await scanLinesBackward(readRange, fileSize, (line, lineStart) => {
      if (lineStart < minimumOffset) {
        return true;
      }
      const parsed = parseClaudeLine(line);
      if (!result.completion) {
        if (!parsed.completion) {
          return false;
        }
        result.completion = parsed.completion;
        result.sessionId = parsed.sessionId ?? fallbackSessionId;
        return false;
      }
      if (parsed.userPrompt) {
        result.userQuestion = parsed.userPrompt;
        return true;
      }
      return false;
    });
    if (!result.completion) {
      return null;
    }
    return {
      ...result.completion,
      sessionId: result.sessionId,
      ...(result.userQuestion ? { userQuestion: result.userQuestion } : {}),
    };
  };

  const latest = await scanTail(LATEST_COMPLETION_SCAN_BYTES);
  if (
    !latest ||
    latest.userQuestion ||
    fileSize <= LATEST_COMPLETION_SCAN_BYTES
  ) {
    return latest;
  }
  const recovered = await scanTail(COMPLETION_QUESTION_RECOVERY_SCAN_BYTES);
  return recovered?.completionId === latest.completionId &&
    recovered.userQuestion
    ? recovered
    : latest;
}

function listProjectJsonl(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(directory, name));
}

function findJsonlBySessionId(
  projectsRoot: string,
  sessionId: string,
): string | null {
  if (!existsSync(projectsRoot) || !CLAUDE_SESSION_ID_PATTERN.test(sessionId)) {
    return null;
  }
  for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = join(projectsRoot, entry.name, `${sessionId}.jsonl`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readLiveSessions(sessionsRoot: string): ClaudeLiveSession[] {
  if (!existsSync(sessionsRoot)) {
    return [];
  }
  const sessions: ClaudeLiveSession[] = [];
  for (const name of readdirSync(sessionsRoot)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(
        readFileSync(join(sessionsRoot, name), "utf8"),
      ) as unknown;
      if (!isRecord(parsed)) {
        continue;
      }
      const sessionId = stringValue(parsed.sessionId);
      const cwd = stringValue(parsed.cwd);
      if (!sessionId || !CLAUDE_SESSION_ID_PATTERN.test(sessionId) || !cwd) {
        continue;
      }
      sessions.push({
        sessionId,
        cwd,
        ...(stringValue(parsed.tmux)
          ? { tmux: stringValue(parsed.tmux)! }
          : {}),
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
        spare: parsed.spare === true,
      });
    } catch {
      // A torn session index must not hide the JSONL fallback.
    }
  }
  return sessions;
}

function locatedFromPath(
  path: string,
  sessionId: string,
  matchedBy: LocatedClaudeTranscript["matchedBy"],
): LocatedClaudeTranscript | null {
  if (!existsSync(path)) {
    return null;
  }
  const stats = statSync(path);
  return {
    path,
    sessionId,
    matchedBy,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

export class ClaudeTranscriptService {
  private readonly projectsRoot: string;
  private readonly sessionsRoot: string;
  private readonly remoteFileAccess?: RemoteCodexFileAccess;

  constructor(options: ClaudeTranscriptServiceOptions = {}) {
    const claudeRoot = join(homedir(), ".claude");
    this.projectsRoot = options.projectsRoot ?? join(claudeRoot, "projects");
    this.sessionsRoot = options.sessionsRoot ?? join(claudeRoot, "sessions");
    this.remoteFileAccess = options.remoteFileAccess;
  }

  private locate(
    input: ReadClaudeTranscriptInput,
  ): LocatedClaudeTranscript | null {
    const live = readLiveSessions(this.sessionsRoot)
      .filter((session) => !session.spare)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const tmuxMatch = live.find((session) =>
      claudeTmuxTargetMatches(session.tmux, input.tmuxSession, input.tmuxPane),
    );
    if (tmuxMatch) {
      const located = locatedFromPath(
        join(
          this.projectsRoot,
          encodeClaudeProjectDirectory(tmuxMatch.cwd),
          `${tmuxMatch.sessionId}.jsonl`,
        ),
        tmuxMatch.sessionId,
        "session-id",
      );
      if (located) {
        return located;
      }
      // The pane index can outlive its original JSONL after Claude rotates sessions.
      const rotated = this.locateByWorkingDirectory(tmuxMatch.cwd);
      if (rotated) {
        return rotated;
      }
    }

    if (input.sessionId && CLAUDE_SESSION_ID_PATTERN.test(input.sessionId)) {
      const path = findJsonlBySessionId(this.projectsRoot, input.sessionId);
      const located = path
        ? locatedFromPath(path, input.sessionId, "session-id")
        : null;
      if (located) {
        return located;
      }
    }

    if (!input.workingDirectory) {
      return null;
    }
    return this.locateByWorkingDirectory(input.workingDirectory);
  }

  private locateByWorkingDirectory(
    workingDirectory: string,
  ): LocatedClaudeTranscript | null {
    const candidates = listProjectJsonl(
      join(this.projectsRoot, encodeClaudeProjectDirectory(workingDirectory)),
    )
      .flatMap((path) => {
        try {
          return [{ path, mtime: statSync(path).mtimeMs }];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.mtime - left.mtime);
    for (const candidate of candidates) {
      if (readCwdHint(candidate.path) !== workingDirectory) {
        continue;
      }
      const sessionId = basename(candidate.path, ".jsonl");
      if (!CLAUDE_SESSION_ID_PATTERN.test(sessionId)) {
        continue;
      }
      return locatedFromPath(candidate.path, sessionId, "working-directory");
    }
    return null;
  }

  async read(
    input: ReadClaudeTranscriptInput,
  ): Promise<AgentTranscriptResponse> {
    const match = this.locate(input);
    if (!match) {
      return unavailable("没有找到与当前工作目录匹配的本机 Claude 记录。");
    }
    const page = await readTranscriptPage(
      match.size,
      async (offset, length) => readLocalRange(match.path, offset, length),
      input.cursor,
      input.limit,
    );
    return {
      available: true,
      agentKind: "claude",
      sessionId: match.sessionId,
      matchedBy: match.matchedBy,
      updatedAt: match.modifiedAt,
      ...page,
    };
  }

  async readLatestCompletion(
    input: ReadClaudeTranscriptInput,
  ): Promise<ClaudeTurnCompletion | null> {
    const match = this.locate(input);
    if (!match) {
      return null;
    }
    return readLatestCompletionFromReader(
      match.size,
      async (offset, length) => readLocalRange(match.path, offset, length),
      match.sessionId,
    );
  }

  async readRemote(
    input: ReadRemoteTranscriptInput & ReadClaudeTranscriptInput,
  ): Promise<AgentTranscriptResponse> {
    if (!this.remoteFileAccess) {
      return unavailable("远端 Claude 记录读取未配置。");
    }
    try {
      const match = await this.locateRemote(input);
      if (!match) {
        return unavailable("没有找到与当前工作目录匹配的远端 Claude 记录。");
      }
      const page = await readTranscriptPage(
        match.size,
        (offset, length) =>
          this.readRemoteRange(input.sshTarget, match.path, offset, length),
        input.cursor,
        input.limit,
      );
      return {
        available: true,
        agentKind: "claude",
        sessionId: match.sessionId,
        matchedBy: match.matchedBy,
        updatedAt: match.modifiedAt,
        ...page,
      };
    } catch {
      return unavailable("远端 Claude 记录暂时无法读取。");
    }
  }

  async readLatestRemoteCompletion(
    input: ReadRemoteTranscriptInput & ReadClaudeTranscriptInput,
  ): Promise<ClaudeTurnCompletion | null> {
    if (!this.remoteFileAccess) {
      return null;
    }
    const match = await this.locateRemote(input);
    if (!match) {
      return null;
    }
    return readLatestCompletionFromReader(
      match.size,
      (offset, length) =>
        this.readRemoteRange(input.sshTarget, match.path, offset, length),
      match.sessionId,
    );
  }

  async readLatestCompletionForSession(
    session: AgentSessionRecord,
  ): Promise<ClaudeTurnCompletion | null> {
    const input: ReadClaudeTranscriptInput = {
      ...(session.agentSessionId ? { sessionId: session.agentSessionId } : {}),
      ...(session.workingDirectory
        ? { workingDirectory: session.workingDirectory }
        : {}),
      ...(session.transportRef?.tmuxSession
        ? { tmuxSession: session.transportRef.tmuxSession }
        : {}),
      ...(session.transportRef?.tmuxPane
        ? { tmuxPane: session.transportRef.tmuxPane }
        : {}),
    };
    if (session.sshTarget) {
      return this.readLatestRemoteCompletion({
        ...input,
        sshTarget: session.sshTarget,
      });
    }
    if (session.hostId && session.hostId !== "local") {
      return null;
    }
    return this.readLatestCompletion(input);
  }

  async resolveSessionId(
    session: AgentSessionRecord,
  ): Promise<string | undefined> {
    const completionInput: ReadClaudeTranscriptInput = {
      ...(session.agentSessionId ? { sessionId: session.agentSessionId } : {}),
      ...(session.workingDirectory
        ? { workingDirectory: session.workingDirectory }
        : {}),
      ...(session.transportRef?.tmuxSession
        ? { tmuxSession: session.transportRef.tmuxSession }
        : {}),
      ...(session.transportRef?.tmuxPane
        ? { tmuxPane: session.transportRef.tmuxPane }
        : {}),
    };
    if (session.sshTarget) {
      const match = await this.locateRemote({
        ...completionInput,
        sshTarget: session.sshTarget,
      }).catch(() => null);
      return match?.matchedBy === "session-id" ? match.sessionId : undefined;
    }
    const match = this.locate(completionInput);
    return match?.sessionId;
  }

  private async readRemoteRange(
    target: SshTarget,
    path: string,
    offset: number,
    length: number,
  ): Promise<Buffer> {
    const result = await this.remoteFileAccess!.readRange(
      target,
      path,
      offset,
      length,
    );
    return result.buffer;
  }

  private async locateRemote(
    input: ReadRemoteTranscriptInput & ReadClaudeTranscriptInput,
  ): Promise<LocatedClaudeTranscript | null> {
    const access = this.remoteFileAccess;
    if (!access) {
      return null;
    }
    const tmuxMatch = await this.readRemoteLiveMatch(input);
    if (tmuxMatch) {
      const located = await this.remoteFile(
        input.sshTarget,
        joinRemote(
          await access.resolveRemotePath(
            input.sshTarget,
            `~/.claude/projects/${encodeClaudeProjectDirectory(tmuxMatch.cwd)}`,
          ),
          `${tmuxMatch.sessionId}.jsonl`,
        ),
        tmuxMatch.sessionId,
        "session-id",
      );
      if (located) {
        return located;
      }
    }

    const cwdCandidates = [
      ...(tmuxMatch ? [tmuxMatch.cwd] : []),
      ...(input.workingDirectory ? [input.workingDirectory] : []),
    ].filter((cwd, index, all) => all.indexOf(cwd) === index);
    if (cwdCandidates.length === 0 && !input.sessionId) {
      return null;
    }
    for (const workingDirectory of cwdCandidates) {
      const located = await this.locateRemoteByWorkingDirectory(
        input,
        workingDirectory,
      );
      if (located) {
        return located;
      }
    }
    return null;
  }

  private async locateRemoteByWorkingDirectory(
    input: ReadRemoteTranscriptInput & ReadClaudeTranscriptInput,
    workingDirectory: string,
  ): Promise<LocatedClaudeTranscript | null> {
    const access = this.remoteFileAccess;
    if (!access) {
      return null;
    }
    const directory = await access.resolveRemotePath(
      input.sshTarget,
      `~/.claude/projects/${encodeClaudeProjectDirectory(workingDirectory)}`,
    );
    let entries: Awaited<ReturnType<RemoteCodexFileAccess["listRecursive"]>> =
      [];
    try {
      entries = await access.listRecursive(input.sshTarget, directory);
    } catch {
      entries = [];
    }
    const files = entries
      .filter(
        (entry) =>
          entry.path.endsWith(".jsonl") && !entry.path.includes("/memory/"),
      )
      .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
    if (input.sessionId && CLAUDE_SESSION_ID_PATTERN.test(input.sessionId)) {
      const exact = files.find((entry) =>
        entry.path.endsWith(`/${input.sessionId}.jsonl`),
      );
      if (exact) {
        return {
          path: exact.path,
          sessionId: input.sessionId,
          matchedBy: "session-id",
          size: exact.size,
          modifiedAt: exact.modifiedAt,
        };
      }
    }
    for (const file of files) {
      const sample = (
        await this.readRemoteRange(
          input.sshTarget,
          file.path,
          0,
          Math.min(file.size, HEADER_SCAN_BYTES),
        )
      ).toString("utf8");
      const match = sample.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
      let cwd = match?.[1] ?? "";
      try {
        cwd = JSON.parse(`"${cwd}"`) as string;
      } catch {
        // Keep the raw hint when the path has no escape sequences.
      }
      if (cwd !== workingDirectory) {
        continue;
      }
      const sessionId = basename(file.path, ".jsonl");
      return {
        path: file.path,
        sessionId,
        matchedBy:
          input.sessionId === sessionId ? "session-id" : "working-directory",
        size: file.size,
        modifiedAt: file.modifiedAt,
      };
    }
    return null;
  }

  private async remoteFile(
    target: SshTarget,
    path: string,
    sessionId: string,
    matchedBy: LocatedClaudeTranscript["matchedBy"],
  ): Promise<LocatedClaudeTranscript | null> {
    try {
      const entries = await this.remoteFileAccess!.listRecursive(
        target,
        path.slice(0, path.lastIndexOf("/")) || "/",
      );
      const file = entries.find((entry) => entry.path === path);
      if (!file) {
        return null;
      }
      return {
        path: file.path,
        sessionId,
        matchedBy,
        size: file.size,
        modifiedAt: file.modifiedAt,
      };
    } catch {
      return null;
    }
  }

  private async readRemoteLiveMatch(
    input: ReadRemoteTranscriptInput & ReadClaudeTranscriptInput,
  ): Promise<ClaudeLiveSession | null> {
    if (!input.tmuxSession || !input.tmuxPane || !this.remoteFileAccess) {
      return null;
    }
    try {
      const directory = await this.remoteFileAccess.resolveRemotePath(
        input.sshTarget,
        "~/.claude/sessions",
      );
      const entries = (
        await this.remoteFileAccess.listRecursive(input.sshTarget, directory)
      )
        .filter((entry) => entry.path.endsWith(".json") && entry.size <= 65_536)
        .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
        .slice(0, 80);
      for (const entry of entries) {
        const parsed = JSON.parse(
          (
            await this.readRemoteRange(
              input.sshTarget,
              entry.path,
              0,
              entry.size,
            )
          ).toString("utf8"),
        ) as unknown;
        if (!isRecord(parsed) || parsed.spare === true) {
          continue;
        }
        const sessionId = stringValue(parsed.sessionId);
        const cwd = stringValue(parsed.cwd);
        const tmux = stringValue(parsed.tmux) ?? undefined;
        if (
          !sessionId ||
          !cwd ||
          !claudeTmuxTargetMatches(tmux, input.tmuxSession, input.tmuxPane)
        ) {
          continue;
        }
        return {
          sessionId,
          cwd,
          ...(tmux ? { tmux } : {}),
          updatedAt:
            typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
          spare: false,
        };
      }
    } catch {
      return null;
    }
    return null;
  }
}

function joinRemote(directory: string, name: string): string {
  return directory.endsWith("/")
    ? `${directory}${name}`
    : `${directory}/${name}`;
}

function unavailable(message: string): AgentTranscriptResponse {
  return {
    available: false,
    agentKind: "claude",
    sessionId: null,
    matchedBy: null,
    updatedAt: null,
    entries: [],
    hasMore: false,
    nextCursor: null,
    message,
  };
}
