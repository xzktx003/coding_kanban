import { AgentSessionRegistry } from "./agent-session-registry.js";
import { PtyRuntimeManager } from "./pty-runtime-manager.js";
import { sanitizeReplayForTerminal } from "./terminal-control-filter.js";
import { takeUtf8Tail } from "./terminal-replay-window.js";

export type TerminalOutputSender = (frame: string) => void;

export interface TerminalOutputSubscriptionDependencies {
  registry: AgentSessionRegistry;
  ptyRuntimeManager: PtyRuntimeManager;
}

export function buildTerminalControlFrame(
  event: "replay" | "replay-complete",
  data?: string,
): string {
  return JSON.stringify({
    __agentOrchestrator: "terminal-control",
    event,
    data,
  });
}

export function subscribeTerminalOutput(
  agentSessionId: string,
  replayByteLimit: number,
  dependencies: TerminalOutputSubscriptionDependencies,
  send: TerminalOutputSender,
): (() => void) | null {
  const { registry, ptyRuntimeManager } = dependencies;
  let replaying = true;
  const bufferedLiveFrames: string[] = [];
  let unsubscribe = () => {};

  if (ptyRuntimeManager.has(agentSessionId)) {
    unsubscribe = ptyRuntimeManager.subscribe(
      agentSessionId,
      (data) => {
        if (replaying) {
          bufferedLiveFrames.push(data);
          return;
        }

        send(data);
      },
      { replay: false },
    );

    const replay = takeUtf8Tail(
      sanitizeReplayForTerminal(
        ptyRuntimeManager.getScrollback(agentSessionId),
      ),
      replayByteLimit,
    );
    if (replay) {
      send(buildTerminalControlFrame("replay", replay));
    }
  } else if (registry.has(agentSessionId)) {
    const replay = takeUtf8Tail(
      sanitizeReplayForTerminal(
        registry
          .getDetail(agentSessionId)
          .outputEntries.map((entry) => entry.text)
          .join(""),
      ),
      replayByteLimit,
    );
    if (replay) {
      send(buildTerminalControlFrame("replay", replay));
    }
  } else {
    return null;
  }

  send(buildTerminalControlFrame("replay-complete"));
  replaying = false;
  for (const frame of bufferedLiveFrames) {
    send(frame);
  }
  bufferedLiveFrames.length = 0;

  return unsubscribe;
}
