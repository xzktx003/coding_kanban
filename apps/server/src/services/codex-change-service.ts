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
import { isAbsolute, join, relative, resolve } from "node:path";

import type {
  AgentTaskDiffResponse,
  DiffFileChange,
  DiffFileStatus,
} from "@agent-orchestrator/shared";

const SESSION_HEADER_BYTES = 64 * 1024;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

interface CodexChangeServiceOptions {
  sessionsRoot?: string;
}
interface ReadChangesInput {
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
function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function collectText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(collectText).join("");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return (
    stringValue(record.text) ||
    collectText(record.content) ||
    collectText(record.input)
  );
}
function parseRecord(line: string): JsonRecord | null {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === "object" ? (value as JsonRecord) : null;
  } catch {
    return null;
  }
}
function listJsonlFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl"))
        files.push(path);
    }
  }
  return files;
}
function readSessionMetadata(path: string): SessionMetadata | null {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(SESSION_HEADER_BYTES);
    const bytes = readSync(descriptor, buffer, 0, buffer.length, 0);
    const record = parseRecord(
      buffer.subarray(0, bytes).toString("utf8").split("\n", 1)[0] ?? "",
    );
    if (record?.type !== "session_meta" || !record.payload) return null;
    const id = stringValue(record.payload.id);
    const cwd = stringValue(record.payload.cwd);
    return id && cwd ? { id, cwd } : null;
  } finally {
    closeSync(descriptor);
  }
}
function normalizePatchPath(path: string, cwd: string): string | null {
  const stripped = path.replace(/^['"]|['"]$/g, "");
  if (stripped === "/dev/null") return null;
  const relativePath = relative(
    resolve(cwd),
    isAbsolute(stripped) ? resolve(stripped) : resolve(cwd, stripped),
  );
  return !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
    ? null
    : relativePath;
}
function countPatchLines(patch: string): {
  addedLines: number;
  deletedLines: number;
} {
  const lines = patch.split("\n");
  return {
    addedLines: lines.filter(
      (line) => line.startsWith("+") && !line.startsWith("+++"),
    ).length,
    deletedLines: lines.filter(
      (line) => line.startsWith("-") && !line.startsWith("---"),
    ).length,
  };
}
function contentLines(content: string): string[] {
  const normalized = content.replaceAll("\r\n", "\n");
  if (!normalized) return [];
  return (
    normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized
  ).split("\n");
}
function contentPatch(
  path: string,
  status: "added" | "deleted",
  content: string,
): string {
  const lines = contentLines(content);
  const header =
    status === "added" ? `*** Add File: ${path}` : `*** Delete File: ${path}`;
  const hunk =
    status === "added"
      ? `@@ -0,0 +1,${lines.length} @@`
      : `@@ -1,${lines.length} +0,0 @@`;
  const prefix = status === "added" ? "+" : "-";
  return [header, hunk, ...lines.map((line) => `${prefix}${line}`)].join("\n");
}
function parseNativeFileChanges(value: unknown, cwd: string): DiffFileChange[] {
  const changes = objectValue(value);
  if (!changes) return [];

  const files: DiffFileChange[] = [];
  for (const [rawPath, rawDescriptor] of Object.entries(changes)) {
    const descriptor = objectValue(rawDescriptor);
    const sourcePath = normalizePatchPath(rawPath, cwd);
    if (!descriptor || !sourcePath) continue;

    const type = stringValue(descriptor.type);
    if (type === "update") {
      const movePath = stringValue(descriptor.move_path);
      const destinationPath = movePath
        ? normalizePatchPath(movePath, cwd)
        : null;
      const patch = stringValue(descriptor.unified_diff);
      const counts = countPatchLines(patch);
      files.push({
        path: destinationPath ?? sourcePath,
        previousPath: destinationPath ? sourcePath : undefined,
        status: destinationPath ? "renamed" : "modified",
        patch,
        ...counts,
      });
      continue;
    }

    if (type !== "add" && type !== "delete") continue;
    const status = type === "add" ? "added" : "deleted";
    const patch = contentPatch(
      sourcePath,
      status,
      stringValue(descriptor.content),
    );
    files.push({
      path: sourcePath,
      status,
      patch,
      ...countPatchLines(patch),
    });
  }
  return files;
}
function parseApplyPatch(input: string, cwd: string): DiffFileChange[] {
  const files: DiffFileChange[] = [];
  let current: {
    path: string;
    status: DiffFileStatus;
    lines: string[];
  } | null = null;
  const flush = () => {
    if (!current) return;
    const patch = current.lines.join("\n");
    files.push({
      path: current.path,
      status: current.status,
      patch,
      ...countPatchLines(patch),
    });
    current = null;
  };
  for (const line of input.split("\n")) {
    const header = line.match(/^\*\*\* (Update|Add|Delete) File: (.+)$/);
    if (header) {
      flush();
      const path = normalizePatchPath(header[2]!, cwd);
      if (!path) continue;
      current = {
        path,
        status:
          header[1] === "Add"
            ? "added"
            : header[1] === "Delete"
              ? "deleted"
              : "modified",
        lines: [line],
      };
    } else if (current) current.lines.push(line);
  }
  flush();
  return files;
}
function mergeFiles(files: DiffFileChange[]): DiffFileChange[] {
  const merged = new Map<string, DiffFileChange>();
  for (const file of files) {
    const previous = merged.get(file.path);
    merged.set(
      file.path,
      previous
        ? {
            ...file,
            status: previous.status === "added" ? "added" : file.status,
            patch: `${previous.patch}\n\n${file.patch}`,
            addedLines: previous.addedLines + file.addedLines,
            deletedLines: previous.deletedLines + file.deletedLines,
          }
        : file,
    );
  }
  return [...merged.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

export class CodexChangeService {
  private readonly sessionsRoot: string;
  constructor(options: CodexChangeServiceOptions = {}) {
    this.sessionsRoot =
      options.sessionsRoot ?? join(homedir(), ".codex", "sessions");
  }
  read(input: ReadChangesInput): AgentTaskDiffResponse {
    const generatedAt = new Date().toISOString();
    const match = this.findSession(input);
    if (!match)
      return this.unavailable(generatedAt, "没有找到匹配的本机 Codex 记录");
    const records = readFileSync(match.path, "utf8")
      .split("\n")
      .map(parseRecord)
      .filter(Boolean) as JsonRecord[];
    let latestTurnIndex = -1;
    let latestTurnId = "";
    records.forEach((record, index) => {
      if (
        record.type !== "event_msg" ||
        record.payload?.type !== "task_started"
      )
        return;
      const turnId = stringValue(record.payload.turn_id);
      if (!turnId) return;
      latestTurnIndex = index;
      latestTurnId = turnId;
    });

    if (latestTurnIndex >= 0) {
      const nativeChanges: DiffFileChange[] = [];
      let nativeTaskTitle = "";
      let completedAt: string | undefined;
      for (const record of records.slice(latestTurnIndex + 1)) {
        const payload = record.payload;
        if (!payload) continue;
        if (record.type === "event_msg" && payload.type === "task_started")
          break;
        if (
          record.type === "response_item" &&
          payload.type === "message" &&
          payload.role === "user"
        ) {
          const candidate = collectText(payload.content)
            .replace(/\s+/g, " ")
            .trim();
          if (
            candidate &&
            !candidate.startsWith("# AGENTS.md instructions") &&
            !candidate.startsWith("<hook_prompt") &&
            !candidate.startsWith("<environment_context")
          ) {
            nativeTaskTitle = candidate;
          }
          continue;
        }
        if (
          record.type !== "event_msg" ||
          stringValue(payload.turn_id) !== latestTurnId
        )
          continue;
        if (payload.type === "task_complete") {
          completedAt = stringValue(record.timestamp) || undefined;
          continue;
        }
        if (payload.type !== "item_completed") continue;
        const item = objectValue(payload.item);
        if (item?.type !== "FileChange") continue;
        nativeChanges.push(
          ...parseNativeFileChanges(item.changes, match.metadata.cwd),
        );
      }

      const files = mergeFiles(nativeChanges);
      if (files.length) {
        return {
          available: true,
          scope: "task",
          agentKind: "codex",
          sessionId: match.metadata.id,
          matchedBy: match.matchedBy,
          confidence: "medium",
          taskTitle: nativeTaskTitle.slice(0, 180),
          startedAt:
            stringValue(records[latestTurnIndex]?.timestamp) || undefined,
          completedAt:
            completedAt ??
            (stringValue(records.at(-1)?.timestamp) || undefined),
          changedFiles: files.length,
          addedLines: files.reduce((sum, file) => sum + file.addedLines, 0),
          deletedLines: files.reduce((sum, file) => sum + file.deletedLines, 0),
          files,
          generatedAt,
          warning:
            "基于 Codex 本轮 FileChange 原生记录生成；未由 Codex 记录的 Shell 或外部编辑修改不会包含。",
        };
      }
    }

    let latestUserIndex = -1;
    let taskTitle = "";
    records.forEach((record, index) => {
      const payload = record.payload;
      if (
        record.type === "response_item" &&
        payload?.type === "message" &&
        payload.role === "user"
      ) {
        latestUserIndex = index;
        taskTitle = collectText(payload.content).replace(/\s+/g, " ").trim();
      }
    });
    if (latestUserIndex < 0)
      return this.unavailable(
        generatedAt,
        "Codex 记录中没有可识别的任务边界",
        match,
      );
    const changed: DiffFileChange[] = [];
    for (const record of records.slice(latestUserIndex + 1)) {
      const payload = record.payload;
      if (
        record.type === "response_item" &&
        payload?.type === "custom_tool_call" &&
        payload.name === "apply_patch"
      ) {
        changed.push(
          ...parseApplyPatch(collectText(payload.input), match.metadata.cwd),
        );
      }
    }
    const files = mergeFiles(changed);
    if (!files.length)
      return this.unavailable(
        generatedAt,
        "本次任务没有可识别的 Codex 文件修改记录",
        match,
      );
    return {
      available: true,
      scope: "task",
      agentKind: "codex",
      sessionId: match.metadata.id,
      matchedBy: match.matchedBy,
      confidence: "medium",
      taskTitle: taskTitle.slice(0, 180),
      startedAt: stringValue(records[latestUserIndex]?.timestamp) || undefined,
      completedAt: stringValue(records.at(-1)?.timestamp) || undefined,
      changedFiles: files.length,
      addedLines: files.reduce((sum, file) => sum + file.addedLines, 0),
      deletedLines: files.reduce((sum, file) => sum + file.deletedLines, 0),
      files,
      generatedAt,
      warning:
        "基于 Codex apply_patch 记录生成；Shell、格式化器或外部编辑产生的间接修改可能未包含。",
    };
  }
  private unavailable(
    generatedAt: string,
    unavailableReason: string,
    match?: ReturnType<CodexChangeService["findSession"]>,
  ): AgentTaskDiffResponse {
    return {
      available: false,
      scope: "task",
      agentKind: "codex",
      sessionId: match?.metadata.id ?? null,
      matchedBy: match?.matchedBy ?? null,
      confidence: "unavailable",
      changedFiles: 0,
      addedLines: 0,
      deletedLines: 0,
      files: [],
      generatedAt,
      unavailableReason,
    };
  }
  private findSession(input: ReadChangesInput): {
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
        if (!path.includes(requestedSessionId)) continue;
        const metadata = readSessionMetadata(path);
        if (metadata?.id === requestedSessionId)
          return { path, metadata, matchedBy: "session-id" };
      }
    }
    const requestedDirectory = input.workingDirectory?.trim();
    if (!requestedDirectory) return null;
    for (const path of files) {
      const metadata = readSessionMetadata(path);
      if (metadata && resolve(metadata.cwd) === resolve(requestedDirectory))
        return { path, metadata, matchedBy: "working-directory" };
    }
    return null;
  }
}
