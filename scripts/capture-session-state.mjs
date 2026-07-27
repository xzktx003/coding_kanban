#!/usr/bin/env node

import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isAgentSessionSnapshot(value) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    (typeof value.activeAgentSessionId !== "string" &&
      value.activeAgentSessionId !== null) ||
    typeof value.updatedAt !== "string"
  ) {
    return false;
  }

  return value.items.every(
    (session) =>
      isRecord(session) &&
      typeof session.id === "string" &&
      session.id.trim().length > 0 &&
      typeof session.workspaceId === "string" &&
      typeof session.sourceType === "string" &&
      typeof session.agentKind === "string" &&
      typeof session.displayName === "string" &&
      typeof session.connectionState === "string" &&
      typeof session.interactionState === "string",
  );
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function projectTransportRef(value) {
  if (!isRecord(value)) {
    return undefined;
  }

  const projected = {
    ...(optionalString(value.tmuxSession)
      ? { tmuxSession: value.tmuxSession }
      : {}),
    ...(optionalString(value.tmuxPane) ? { tmuxPane: value.tmuxPane } : {}),
    ...(optionalString(value.sshHost) ? { sshHost: value.sshHost } : {}),
    ...(typeof value.sshPort === "number" ? { sshPort: value.sshPort } : {}),
    ...(optionalString(value.sshUsername)
      ? { sshUsername: value.sshUsername }
      : {}),
  };

  return Object.keys(projected).length > 0 ? projected : undefined;
}

function projectSshTarget(value) {
  if (!isRecord(value) || !optionalString(value.host)) {
    return undefined;
  }

  return {
    host: value.host,
    ...(typeof value.port === "number" ? { port: value.port } : {}),
    ...(optionalString(value.username) ? { username: value.username } : {}),
    ...(optionalString(value.identityFile)
      ? { identityFile: value.identityFile }
      : {}),
  };
}

function projectSession(session) {
  const transportRef = projectTransportRef(session.transportRef);
  const sshTarget = projectSshTarget(session.sshTarget);
  const tags = Array.isArray(session.tags)
    ? session.tags.filter((tag) => typeof tag === "string" && tag.length > 0)
    : [];

  return {
    id: session.id,
    workspaceId: session.workspaceId,
    sourceType: session.sourceType,
    agentKind: session.agentKind,
    displayName: session.displayName,
    connectionState: "offline",
    interactionState: transportRef?.tmuxSession ? "detached" : "exited",
    ...(optionalString(session.hostId) ? { hostId: session.hostId } : {}),
    ...(optionalString(session.workingDirectory)
      ? { workingDirectory: session.workingDirectory }
      : {}),
    ...(session.controlMode === "observe" || session.controlMode === "control"
      ? { controlMode: session.controlMode }
      : {}),
    ...(transportRef ? { transportRef } : {}),
    ...(optionalString(session.agentSessionId)
      ? { agentSessionId: session.agentSessionId }
      : {}),
    ...(sshTarget ? { sshTarget } : {}),
    ...(optionalString(session.remoteCommand)
      ? { remoteCommand: session.remoteCommand }
      : {}),
    ...(typeof session.hidden === "boolean" ? { hidden: session.hidden } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

export async function captureSessionState({
  apiUrl,
  filePath,
  fetchImpl = fetch,
}) {
  try {
    const response = await fetchImpl(apiUrl, {
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) {
      return false;
    }

    const snapshot = await response.json();
    if (!isAgentSessionSnapshot(snapshot)) {
      return false;
    }
    const projectedSnapshot = {
      items: snapshot.items.map(projectSession),
      activeAgentSessionId: snapshot.activeAgentSessionId,
      updatedAt: snapshot.updatedAt,
    };

    const parentDirectory = dirname(filePath);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    mkdirSync(parentDirectory, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(
        temporaryPath,
        `${JSON.stringify(projectedSnapshot, null, 2)}\n`,
        {
          encoding: "utf8",
          mode: 0o600,
        },
      );
      renameSync(temporaryPath, filePath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const [, , apiUrl, filePath] = process.argv;
  if (!apiUrl || !filePath) {
    process.stderr.write(
      "Usage: capture-session-state.mjs <agent-sessions-url> <state-file>\n",
    );
    process.exitCode = 2;
    return;
  }

  const captured = await captureSessionState({ apiUrl, filePath });
  process.exitCode = captured ? 0 : 1;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main();
}
