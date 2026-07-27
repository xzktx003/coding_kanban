import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type {
  AgentSessionRecord,
  AgentSourceType,
  ListAgentSessionsResponse,
  SshTarget,
} from "@agent-orchestrator/shared";

const SESSION_STATE_VERSION = 1;

interface PersistedSessionState {
  version: typeof SESSION_STATE_VERSION;
  snapshot: ListAgentSessionsResponse;
}

export interface SessionStateStore {
  load(): ListAgentSessionsResponse | null;
  save(snapshot: ListAgentSessionsResponse): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return items.length > 0 ? items : undefined;
}

function parseSourceType(value: unknown): AgentSourceType | null {
  return value === "local" ||
    value === "remote-connect" ||
    value === "remote-tmux-discovered"
    ? value
    : null;
}

function parseSshTarget(value: unknown): SshTarget | undefined {
  if (
    !isRecord(value) ||
    typeof value.host !== "string" ||
    !value.host.trim()
  ) {
    return undefined;
  }

  return {
    host: value.host,
    ...(typeof value.port === "number" ? { port: value.port } : {}),
    ...(optionalString(value.username)
      ? { username: optionalString(value.username) }
      : {}),
    ...(optionalString(value.identityFile)
      ? { identityFile: optionalString(value.identityFile) }
      : {}),
  };
}

function parseSession(value: unknown): AgentSessionRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const sourceType = parseSourceType(value.sourceType);
  if (
    !sourceType ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.workspaceId !== "string" ||
    typeof value.agentKind !== "string" ||
    typeof value.displayName !== "string"
  ) {
    return null;
  }

  const transport = isRecord(value.transportRef)
    ? {
        ...(optionalString(value.transportRef.tmuxSession)
          ? { tmuxSession: optionalString(value.transportRef.tmuxSession) }
          : {}),
        ...(optionalString(value.transportRef.tmuxPane)
          ? { tmuxPane: optionalString(value.transportRef.tmuxPane) }
          : {}),
        ...(optionalString(value.transportRef.sshHost)
          ? { sshHost: optionalString(value.transportRef.sshHost) }
          : {}),
        ...(typeof value.transportRef.sshPort === "number"
          ? { sshPort: value.transportRef.sshPort }
          : {}),
        ...(optionalString(value.transportRef.sshUsername)
          ? { sshUsername: optionalString(value.transportRef.sshUsername) }
          : {}),
      }
    : undefined;
  const hostId = optionalString(value.hostId);
  const workingDirectory = optionalString(value.workingDirectory);
  const controlMode = optionalString(value.controlMode);
  const agentSessionId = optionalString(value.agentSessionId);
  const sshTarget = parseSshTarget(value.sshTarget);
  const remoteCommand = optionalString(value.remoteCommand);
  const tags = optionalStringArray(value.tags);

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    sourceType,
    agentKind: value.agentKind,
    displayName: value.displayName,
    connectionState: "offline",
    interactionState: transport?.tmuxSession ? "detached" : "exited",
    ...(hostId ? { hostId } : {}),
    ...(workingDirectory ? { workingDirectory } : {}),
    ...(controlMode === "observe" || controlMode === "control"
      ? { controlMode }
      : {}),
    ...(transport && Object.keys(transport).length > 0
      ? { transportRef: transport }
      : {}),
    ...(agentSessionId ? { agentSessionId } : {}),
    ...(sshTarget ? { sshTarget } : {}),
    ...(remoteCommand ? { remoteCommand } : {}),
    ...(typeof value.hidden === "boolean" ? { hidden: value.hidden } : {}),
    ...(tags ? { tags } : {}),
  };
}

function parseSnapshot(value: unknown): ListAgentSessionsResponse | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }

  const items = value.items
    .map(parseSession)
    .filter(Boolean) as AgentSessionRecord[];
  if (items.length !== value.items.length) {
    return null;
  }
  if (new Set(items.map((session) => session.id)).size !== items.length) {
    return null;
  }

  const activeAgentSessionId =
    typeof value.activeAgentSessionId === "string" &&
    items.some((session) => session.id === value.activeAgentSessionId)
      ? value.activeAgentSessionId
      : null;

  return {
    items,
    activeAgentSessionId,
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : new Date().toISOString(),
  };
}

function projectSession(session: AgentSessionRecord): AgentSessionRecord {
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    sourceType: session.sourceType,
    agentKind: session.agentKind,
    displayName: session.displayName,
    connectionState: "offline",
    interactionState: session.transportRef?.tmuxSession ? "detached" : "exited",
    ...(session.hostId ? { hostId: session.hostId } : {}),
    ...(session.workingDirectory
      ? { workingDirectory: session.workingDirectory }
      : {}),
    ...(session.controlMode ? { controlMode: session.controlMode } : {}),
    ...(session.transportRef
      ? {
          transportRef: {
            ...(session.transportRef.tmuxSession
              ? { tmuxSession: session.transportRef.tmuxSession }
              : {}),
            ...(session.transportRef.tmuxPane
              ? { tmuxPane: session.transportRef.tmuxPane }
              : {}),
            ...(session.transportRef.sshHost
              ? { sshHost: session.transportRef.sshHost }
              : {}),
            ...(session.transportRef.sshPort
              ? { sshPort: session.transportRef.sshPort }
              : {}),
            ...(session.transportRef.sshUsername
              ? { sshUsername: session.transportRef.sshUsername }
              : {}),
          },
        }
      : {}),
    ...(session.agentSessionId
      ? { agentSessionId: session.agentSessionId }
      : {}),
    ...(session.sshTarget ? { sshTarget: session.sshTarget } : {}),
    ...(session.remoteCommand ? { remoteCommand: session.remoteCommand } : {}),
    ...(session.hidden !== undefined ? { hidden: session.hidden } : {}),
    ...(session.tags ? { tags: session.tags } : {}),
  };
}

export class FileSessionStateStore implements SessionStateStore {
  private lastMetadataFingerprint: string | null = null;

  constructor(private readonly filePath: string) {}

  load(): ListAgentSessionsResponse | null {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      if (
        isRecord(parsed) &&
        parsed.version === SESSION_STATE_VERSION &&
        "snapshot" in parsed
      ) {
        return parseSnapshot(parsed.snapshot);
      }

      // The restart migration helper writes the legacy raw API snapshot.
      return parseSnapshot(parsed);
    } catch {
      return null;
    }
  }

  save(snapshot: ListAgentSessionsResponse): void {
    const items = snapshot.items.map(projectSession);
    const metadataFingerprint = JSON.stringify({
      items,
      activeAgentSessionId: snapshot.activeAgentSessionId,
    });
    if (metadataFingerprint === this.lastMetadataFingerprint) {
      return;
    }

    const projected: PersistedSessionState = {
      version: SESSION_STATE_VERSION,
      snapshot: {
        items,
        activeAgentSessionId: snapshot.activeAgentSessionId,
        updatedAt: snapshot.updatedAt,
      },
    };
    const serialized = `${JSON.stringify(projected, null, 2)}\n`;

    const parentDirectory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;

    mkdirSync(parentDirectory, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(temporaryPath, serialized, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporaryPath, this.filePath);
      this.lastMetadataFingerprint = metadataFingerprint;
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
}
