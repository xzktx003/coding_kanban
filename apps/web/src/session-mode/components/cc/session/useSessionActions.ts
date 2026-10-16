// Handles session/worktree deletion and copy-id actions.
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useToast } from '@session/components/ui/use-toast';
import type { SdkSessionInfo } from '@session/lib/sessions';
import { ccDeleteSession } from '@session/services/apiAdapt/cc';
import { gitRemoveWorktree } from '@session/services/apiAdapt/git';
import { useWorkspaceStore } from '@session/stores/useWorkspaceStore';
import { writeNativeMarkdownClipboard } from '@session/components/codex/presentation/nativeMarkdownClipboard';

type SessionCopyScope = {
  current: { owner: object; toast: ReturnType<typeof useToast>['toast'] } | null;
};
function observeSessionIdCopy(write: Promise<void>, scope: SessionCopyScope, owner: object) {
  const feedback = (copied: boolean) => {
    if (scope.current?.owner !== owner) return;
    scope.current.toast(copied
      ? { description: 'Session ID copied to clipboard' }
      : { description: 'Failed to copy session ID', variant: 'destructive' });
  };
  void write.then(() => feedback(true), () => feedback(false));
}
function copyCapturedSessionId(id: string, scope: SessionCopyScope) {
  if (scope.current) observeSessionIdCopy(writeNativeMarkdownClipboard(id), scope, scope.current.owner);
}

interface UseSessionActionsArgs {
  onSessionDeleted: (sessionId: string) => void;
}

export function useSessionActions({ onSessionDeleted }: UseSessionActionsArgs) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { toast } = useToast();
  const cwd = useWorkspaceStore(state => state.cwd);
  const copyScope = useRef<SessionCopyScope['current']>(null);
  useLayoutEffect(() => {
    copyScope.current = { owner: {}, toast };
    return () => { copyScope.current = null; };
  }, [cwd, toast]);

  const doDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await ccDeleteSession(sessionId);
        onSessionDeleted(sessionId);
      } catch {
        toast({ description: 'Failed to delete session', variant: 'destructive' });
      }
    },
    [onSessionDeleted, toast]
  );

  const doDeleteWorktree = useCallback(
    async (session: SdkSessionInfo) => {
      const sessionProject = session.cwd ?? '';
      if (!sessionProject.includes('/.codexia/worktrees/')) return;
      const worktreeKey = sessionProject.split('/').pop() ?? '';
      const mainCwd = useWorkspaceStore.getState().cwd;
      if (!mainCwd) return;
      try {
        await gitRemoveWorktree(mainCwd, worktreeKey);
        toast({ description: 'Worktree deleted' });
      } catch {
        toast({ description: 'Failed to delete worktree', variant: 'destructive' });
      }
    },
    [toast]
  );

  const copySessionId = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      copyCapturedSessionId(id, copyScope);
    },
    []
  );

  return {
    pendingDeleteId,
    setPendingDeleteId,
    doDeleteSession,
    doDeleteWorktree,
    copySessionId,
  };
}
