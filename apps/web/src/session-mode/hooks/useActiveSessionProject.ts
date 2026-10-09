import { useCodexStore } from "../components/codex/stores";
import { useCCStore } from "../stores/cc";
import {
  selectedAgentCard,
  useAgentCenterStore,
} from "../stores/useAgentCenterStore";
import { useAgentSettingsStore } from "../stores/useAgentSettingsStore";
import { useAcpStore } from "../stores/useAcpStore";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { sessionProject } from "../utils/sessionProject";
/** An existing session with missing metadata must not inherit an unrelated workspace. */
export function useActiveSessionProject() {
  const state = useAgentCenterStore();
  const card = selectedAgentCard(state);
  const cwd = useWorkspaceStore((s) => s.cwd);
  const acp = useAcpStore((s) => s.active);
  const acpSessionId = useAcpStore((s) => s.sessionId);
  const acpCwd = useAcpStore((s) => s.sessionCwd);
  const kind = useAgentSettingsStore((s) => s.selectedAgent);
  const ccId = useCCStore((s) => s.activeSessionId);
  const threadId = useCodexStore((s) => s.currentThreadId);
  const thread = useCodexStore((s) =>
    s.threads.find((t) => t.id === s.currentThreadId),
  );
  // Native ACP session cwd is independent of the workspace currently browsed.
  const metadata = acp
    ? { cwd: acpSessionId ? (acpCwd ?? undefined) : cwd }
    : card ||
      (kind === "codex" && threadId
        ? { cwd: thread?.cwd }
        : kind === "cc" && ccId
          ? {}
          : { cwd });
  return sessionProject(
    metadata,
    state.detachedCard ? [...state.cards, state.detachedCard] : state.cards,
  );
}
