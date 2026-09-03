import type {
  AgentSessionRecord,
  ScanResult,
} from "@agent-orchestrator/shared";
import { shellQuote, formatWorkingDirectory } from "@agent-orchestrator/shared";

import {
  buildResilientCopilotInvocation,
  buildRemoteInteractiveShellCommand,
  buildRemoteTmuxCommand,
} from "./platform-compat";

export { shellQuote, formatWorkingDirectory };

export type LaunchMode = "direct" | "tmux";

export const DEFAULT_TMUX_HISTORY_LIMIT_LINES = 20_000;

export function sortScanResults(results: ScanResult[]): ScanResult[] {
  return [...results].sort((a, b) => {
    // Only sort by displayName (宫格名)
    return a.displayName.localeCompare(b.displayName);
  });
}

function buildAgentInvocation(
  agentKind: string,
  displayName: string,
  sessionId?: string,
): string | undefined {
  if (agentKind === "shell") {
    return undefined;
  }

  if (sessionId) {
    return `${agentKind} --resume=${sessionId}`;
  }

  if (agentKind === "claude") {
    return `claude -n ${shellQuote(displayName)}`;
  }

  return agentKind;
}

function buildRemoteAgentInvocation(
  agentKind: string,
  displayName: string,
  sessionId?: string,
): string | undefined {
  if (agentKind === "shell") {
    return undefined;
  }

  if (agentKind === "copilot") {
    return buildResilientCopilotInvocation(
      sessionId ? [`--resume=${sessionId}`] : [],
    );
  }

  return buildAgentInvocation(agentKind, displayName, sessionId);
}

export function buildDirectLaunchCommand(
  agentKind: string,
  workingDirectory: string,
  displayName: string,
  sessionId?: string,
): string {
  const invocation = buildAgentInvocation(agentKind, displayName, sessionId);

  if (!invocation) {
    return "";
  }

  return `cd ${formatWorkingDirectory(workingDirectory)} && ${invocation}`;
}

export function buildTmuxLaunchCommand(
  agentKind: string,
  workingDirectory: string,
  displayName: string,
  tmuxSessionName: string,
  sessionId?: string,
): string {
  const tmuxPrefix = `tmux set-option -g history-limit ${DEFAULT_TMUX_HISTORY_LIMIT_LINES} \\; new-session`;

  if (agentKind === "shell") {
    return `${tmuxPrefix} -s ${shellQuote(tmuxSessionName)} -c ${formatWorkingDirectory(workingDirectory)}`;
  }

  if (agentKind === "copilot") {
    return `${tmuxPrefix} -s ${shellQuote(tmuxSessionName)} ${buildRemoteTmuxCommand(`cd ${formatWorkingDirectory(workingDirectory)} && ${buildRemoteAgentInvocation(agentKind, displayName, sessionId)}`, true)}`;
  }

  return `${tmuxPrefix} -s ${shellQuote(tmuxSessionName)} ${buildRemoteTmuxCommand(buildDirectLaunchCommand(agentKind, workingDirectory, displayName, sessionId), true)}`;
}

export function buildRemoteDirectLaunchCommand(
  agentKind: string,
  workingDirectory: string,
  displayName: string,
  sessionId?: string,
): string {
  if (agentKind === "shell") {
    return `cd ${formatWorkingDirectory(workingDirectory)} && exec "\${SHELL:-\$(command -v bash || command -v zsh || command -v sh || printf /bin/sh)}" -i`;
  }

  return `cd ${formatWorkingDirectory(workingDirectory)} && ${buildRemoteAgentInvocation(agentKind, displayName, sessionId)}`;
}

export function buildTmuxAttachCommand(
  tmuxSessionName: string,
  tmuxPaneId?: string,
): string {
  const tmuxPrefix = `tmux set-option -t ${shellQuote(tmuxSessionName)} history-limit ${DEFAULT_TMUX_HISTORY_LIMIT_LINES}`;

  if (tmuxPaneId) {
    return `${tmuxPrefix} \\; select-pane -t ${shellQuote(tmuxPaneId)} \\; attach -t ${shellQuote(tmuxSessionName)}`;
  }

  return `${tmuxPrefix} \\; attach -t ${shellQuote(tmuxSessionName)}`;
}

export function wrapRemoteInteractiveCommand(command: string): string {
  return buildRemoteInteractiveShellCommand(command);
}

export function findExistingSession(
  result: ScanResult,
  sessions: AgentSessionRecord[],
): AgentSessionRecord | undefined {
  if (result.sessionId) {
    return sessions.find((s) => s.agentSessionId === result.sessionId);
  }
  if (result.tmuxSession) {
    const hostId = result.sshTarget?.host ?? "local";
    return sessions.find(
      (s) =>
        (s.hostId ?? "local") === hostId &&
        s.transportRef?.tmuxSession === result.tmuxSession,
    );
  }
  const hostId = result.sshTarget?.host ?? "local";
  return sessions.find(
    (s) =>
      (s.hostId ?? "local") === hostId &&
      s.workingDirectory === result.workingDirectory &&
      s.agentKind === result.agentKind,
  );
}
