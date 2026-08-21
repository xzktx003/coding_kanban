import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type {
  AgentTranscriptEntry,
  AgentTranscriptResponse,
} from "@agent-orchestrator/shared";

const SESSION_HEADER_BYTES = 64 * 1024;
const TRANSCRIPT_READ_BLOCK_BYTES = 64 * 1024;
const DEFAULT_TRANSCRIPT_PAGE_LIMIT = 30;
const MAX_TRANSCRIPT_PAGE_LIMIT = 100;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

interface CodexTranscriptServiceOptions {
  sessionsRoot?: string;
}

export interface ReadTranscriptInput {
  sessionId?: string;
  workingDirectory?: string;
  cursor?: string;
  limit?: number;
}

export interface AgentMessageSummaries {
  lastUserMessageSummary?: string;
  lastAgentMessageSummary?: string;
}

const MESSAGE_SUMMARY_MAX_CHARS = 180;

interface SessionMetadata {
  id: string;
  cwd: string;
}

interface JsonRecord {
  timestamp?: unknown;
  type?: unknown;
  payload?: Record<string, unknown>;
}

interface TranscriptPage {
  entries: AgentTranscriptEntry[];
  hasMore: boolean;
  nextCursor: string | null;
}

interface PendingToolOutput {
  entry: AgentTranscriptEntry;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function collectText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(collectText).filter(Boolean).join("");
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  if (record.content !== undefined) {
    return collectText(record.content);
  }
  if (record.output !== undefined) {
    return collectText(record.output);
  }
  return "";
}

function parseRecord(line: string): JsonRecord | null {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === "object" ? (value as JsonRecord) : null;
  } catch {
    // Codex may be appending the final JSONL record while this endpoint reads.
    return null;
  }
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

function scanJsonlLinesBackward(
  path: string,
  endOffset: number,
  visit: (line: string, lineStartOffset: number) => boolean,
): void {
  const descriptor = openSync(path, "r");
  let position = endOffset;
  let suffix = Buffer.alloc(0);

  try {
    while (position > 0) {
      const blockStart = Math.max(0, position - TRANSCRIPT_READ_BLOCK_BYTES);
      const block = Buffer.allocUnsafe(position - blockStart);
      const bytesRead = readSync(
        descriptor,
        block,
        0,
        block.length,
        blockStart,
      );
      const combined = suffix.length
        ? Buffer.concat([block.subarray(0, bytesRead), suffix])
        : block.subarray(0, bytesRead);
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
  } finally {
    closeSync(descriptor);
  }
}

function readTranscriptGroupsBackward(
  path: string,
  endOffset: number,
  limit: number,
): { entries: AgentTranscriptEntry[]; nextOffset: number } {
  const groups: AgentTranscriptEntry[][] = [];
  const pendingOutputs = new Map<string, PendingToolOutput>();
  let entryCount = 0;
  let nextOffset = 0;

  scanJsonlLinesBackward(path, endOffset, (line, lineStartOffset) => {
    nextOffset = lineStartOffset;
    const record = parseRecord(line);
    if (record?.type !== "response_item" || !record.payload) {
      return false;
    }

    const payload = record.payload;
    const payloadType = stringValue(payload.type);
    const timestamp = stringValue(record.timestamp);

    if (payloadType === "custom_tool_call_output") {
      const callId = stringValue(payload.call_id);
      if (callId) {
        pendingOutputs.set(callId, {
          entry: {
            id: `${callId}-output`,
            timestamp,
            kind: "tool",
            title: "工具输出",
            text: collectText(payload.output),
            collapsedByDefault: true,
          },
        });
      }
      return false;
    }

    let group: AgentTranscriptEntry[] | null = null;
    if (payloadType === "custom_tool_call") {
      const callId = stringValue(payload.call_id) || `call-${lineStartOffset}`;
      const name = stringValue(payload.name) || "工具";
      const pendingOutput = pendingOutputs.get(callId);
      pendingOutputs.delete(callId);
      if (name !== "exec") {
        group = [
          {
            id: `${callId}-request`,
            timestamp,
            kind: "tool",
            title: `${name} 调用`,
            text: collectText(payload.input),
            collapsedByDefault: true,
          },
          ...(pendingOutput
            ? [
                {
                  ...pendingOutput.entry,
                  title: `${name} 输出`,
                },
              ]
            : []),
        ];
      }
    } else if (payloadType === "message") {
      const role = stringValue(payload.role);
      const text = collectText(payload.content);
      if ((role === "user" || role === "assistant") && text) {
        group = [
          {
            id: stringValue(payload.id) || `message-${lineStartOffset}`,
            timestamp,
            kind: role,
            title: role === "user" ? "你" : "Codex",
            text,
            collapsedByDefault: false,
          },
        ];
      }
    }

    if (group) {
      groups.push(group);
      entryCount += group.length;
    }
    return entryCount >= limit && pendingOutputs.size === 0;
  });

  return {
    entries: groups.reverse().flat(),
    nextOffset,
  };
}

function readTranscriptPage(
  path: string,
  cursor: string | undefined,
  requestedLimit: number | undefined,
): TranscriptPage {
  const fileSize = statSync(path).size;
  const endOffset = resolveCursorOffset(cursor, fileSize);
  const page = readTranscriptGroupsBackward(
    path,
    endOffset,
    normalizePageLimit(requestedLimit),
  );
  if (page.entries.length === 0) {
    return { entries: [], hasMore: false, nextCursor: null };
  }

  const lookBehind = readTranscriptGroupsBackward(path, page.nextOffset, 1);
  const hasMore = lookBehind.entries.length > 0;
  return {
    entries: page.entries,
    hasMore,
    nextCursor: hasMore ? String(page.nextOffset) : null,
  };
}

function summarizeMessageText(text: string): string {
  const normalized = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= MESSAGE_SUMMARY_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MESSAGE_SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
}

export function summarizeCodexTranscript(
  entries: AgentTranscriptEntry[],
): AgentMessageSummaries {
  const lastUser = [...entries]
    .reverse()
    .find((entry) => entry.kind === "user");
  const lastAssistant = [...entries]
    .reverse()
    .find((entry) => entry.kind === "assistant");
  const summary: AgentMessageSummaries = {};
  if (lastUser) {
    summary.lastUserMessageSummary = summarizeMessageText(lastUser.text);
  }
  if (lastAssistant) {
    summary.lastAgentMessageSummary = summarizeMessageText(lastAssistant.text);
  }
  return summary;
}

function listJsonlFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

function readSessionMetadata(path: string): SessionMetadata | null {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(SESSION_HEADER_BYTES);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    const firstLine = buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .split("\n", 1)[0];
    const record = parseRecord(firstLine ?? "");
    if (record?.type !== "session_meta" || !record.payload) {
      return null;
    }
    const id = stringValue(record.payload.id);
    const cwd = stringValue(record.payload.cwd);
    return id && cwd ? { id, cwd } : null;
  } finally {
    closeSync(descriptor);
  }
}

export class CodexTranscriptService {
  private readonly sessionsRoot: string;

  constructor(options: CodexTranscriptServiceOptions = {}) {
    this.sessionsRoot =
      options.sessionsRoot ?? join(homedir(), ".codex", "sessions");
  }

  read(input: ReadTranscriptInput): AgentTranscriptResponse {
    const match = this.findSession(input);
    if (!match) {
      return {
        available: false,
        agentKind: "codex",
        sessionId: null,
        matchedBy: null,
        updatedAt: null,
        entries: [],
        hasMore: false,
        nextCursor: null,
        message: "没有找到与当前工作目录匹配的本机 Codex 记录。",
      };
    }

    const page = readTranscriptPage(match.path, input.cursor, input.limit);
    return {
      available: true,
      agentKind: "codex",
      sessionId: match.metadata.id,
      matchedBy: match.matchedBy,
      updatedAt: statSync(match.path).mtime.toISOString(),
      ...page,
    };
  }

  private findSession(input: ReadTranscriptInput): {
    path: string;
    metadata: SessionMetadata;
    matchedBy: "session-id" | "working-directory";
  } | null {
    const files = listJsonlFiles(this.sessionsRoot).sort(
      (left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs,
    );
    const requestedSessionId = input.sessionId?.trim();

    if (requestedSessionId && SESSION_ID_PATTERN.test(requestedSessionId)) {
      for (const path of files) {
        if (!path.includes(requestedSessionId)) {
          continue;
        }
        const metadata = readSessionMetadata(path);
        if (metadata?.id === requestedSessionId) {
          return { path, metadata, matchedBy: "session-id" };
        }
      }
    }

    const requestedDirectory = input.workingDirectory?.trim();
    if (!requestedDirectory) {
      return null;
    }
    const normalizedDirectory = resolve(requestedDirectory);
    for (const path of files) {
      const metadata = readSessionMetadata(path);
      if (metadata && resolve(metadata.cwd) === normalizedDirectory) {
        return { path, metadata, matchedBy: "working-directory" };
      }
    }
    return null;
  }
}
