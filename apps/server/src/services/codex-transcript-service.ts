import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
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
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

interface CodexTranscriptServiceOptions {
  sessionsRoot?: string;
}

interface ReadTranscriptInput {
  sessionId?: string;
  workingDirectory?: string;
}

interface SessionMetadata {
  id: string;
  cwd: string;
}

interface JsonRecord {
  timestamp?: unknown;
  type?: unknown;
  payload?: Record<string, unknown>;
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

export function parseCodexTranscript(content: string): AgentTranscriptEntry[] {
  const entries: AgentTranscriptEntry[] = [];
  const toolNames = new Map<string, string>();

  for (const [lineIndex, line] of content.split("\n").entries()) {
    if (!line.trim()) {
      continue;
    }
    const record = parseRecord(line);
    if (record?.type !== "response_item" || !record.payload) {
      continue;
    }

    const payload = record.payload;
    const payloadType = stringValue(payload.type);
    const timestamp = stringValue(record.timestamp);

    if (payloadType === "message") {
      const role = stringValue(payload.role);
      if (role !== "user" && role !== "assistant") {
        continue;
      }
      const text = collectText(payload.content);
      if (!text) {
        continue;
      }
      entries.push({
        id: stringValue(payload.id) || `message-${lineIndex}`,
        timestamp,
        kind: role,
        title: role === "user" ? "你" : "Codex",
        text,
        collapsedByDefault: false,
      });
      continue;
    }

    if (payloadType === "custom_tool_call") {
      const callId = stringValue(payload.call_id) || `call-${lineIndex}`;
      const name = stringValue(payload.name) || "工具";
      toolNames.set(callId, name);
      if (name === "exec") {
        continue;
      }
      entries.push({
        id: `${callId}-request`,
        timestamp,
        kind: "tool",
        title: `${name} 调用`,
        text: collectText(payload.input),
        collapsedByDefault: true,
      });
      continue;
    }

    if (payloadType === "custom_tool_call_output") {
      const callId = stringValue(payload.call_id) || `output-${lineIndex}`;
      const name = toolNames.get(callId) ?? "工具";
      if (name === "exec") {
        continue;
      }
      entries.push({
        id: `${callId}-output`,
        timestamp,
        kind: "tool",
        title: `${name} 输出`,
        text: collectText(payload.output),
        collapsedByDefault: true,
      });
    }
  }

  return entries;
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
        message: "没有找到与当前工作目录匹配的本机 Codex 记录。",
      };
    }

    const content = readFileSync(match.path, "utf8");
    return {
      available: true,
      agentKind: "codex",
      sessionId: match.metadata.id,
      matchedBy: match.matchedBy,
      updatedAt: statSync(match.path).mtime.toISOString(),
      entries: parseCodexTranscript(content),
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
