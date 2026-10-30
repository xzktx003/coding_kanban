// Handles opening a session: agent card setup, view switch, and message loading.
import { useCallback } from 'react';
import type { SdkSessionInfo } from '@session/lib/sessions';
import { refreshClaudeHistory } from '@session/services/followedSessionAuxSync';
import { useAgentCenterStore, useLayoutStore } from '@session/stores';
import { useCCStore } from '@session/stores/cc';
import { useAgentSettingsStore } from '@session/stores/useAgentSettingsStore';
import { useWorkspaceStore } from '@session/stores/useWorkspaceStore';

interface UseSessionSelectionArgs {
  directory: string;
  onSelectSession?: (sessionId: string, project?: string) => void | Promise<void>;
}

export function useSessionSelection({ directory, onSelectSession }: UseSessionSelectionArgs) {
  const { setCwd } = useWorkspaceStore();
  const { setSelectedAgent } = useAgentSettingsStore();
  const { setView } = useLayoutStore();
  const { addAgentCard, setCurrentAgentCardId } = useAgentCenterStore();
  const {
    activeSessionIds,
    activeSessionId,
    isLoading,
    sessionMessagesMap,
  } = useCCStore();

  const handleSessionClick = useCallback(
    (session: SdkSessionInfo) => {
      const sessionProject = session.cwd ?? '';
      if (sessionProject && sessionProject !== directory) {
        setCwd(sessionProject);
      }
      setSelectedAgent('cc');
      addAgentCard({
        kind: 'cc',
        id: session.session_id,
        preview: session.summary,
        cwd: sessionProject || directory,
      });
      setCurrentAgentCardId(session.session_id);
      setView('agent');
      if (onSelectSession) {
        void Promise.resolve(onSelectSession(session.session_id, sessionProject)).catch((error) => {
          console.error('Failed to select Claude session:', error);
        });
      }
      // Public selection uses the same bounded readonly reader as restoration.
      // Its owner-scoped metadata keeps failures visible and retryable; history
      // completion must not clear an independently running Agent's loading state.
      const sid = session.session_id;
      if (!sessionMessagesMap[sid]?.length) {
        void refreshClaudeHistory(sid).catch((error) => {
          console.error('Failed to read Claude session history:', error);
        });
      }
    },
    [
      directory,
      setCwd,
      setSelectedAgent,
      addAgentCard,
      setCurrentAgentCardId,
      setView,
      onSelectSession,
      sessionMessagesMap,
    ]
  );

  return {
    activeSessionIds,
    activeSessionId,
    isLoading,
    handleSessionClick,
  };
}
