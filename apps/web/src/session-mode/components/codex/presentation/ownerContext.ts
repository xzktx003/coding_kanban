import { createContext, useContext } from "react";
import { useCodexStore } from "../stores/useCodexStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";

export const CodexContentOwner = createContext<string | null>(null);
export const CapturedCodexContentOwner = createContext<{
  threadId?: string;
  cwd?: string | null;
} | null>(null);
export function useCodexContentOwner(explicit?: string) {
  const inherited = useContext(CodexContentOwner);
  const captured = useContext(CapturedCodexContentOwner);
  const threadId = explicit ?? inherited;
  const cwd = useCodexStore((state) =>
    threadId
      ? state.threads.find((thread) => thread.id === threadId)?.cwd
      : undefined,
  );
  const activeCwd = useWorkspaceStore((state) => state.cwd);
  return {
    threadId,
    cwd:
      captured && captured.threadId === threadId
        ? captured.cwd
        : threadId
          ? cwd
          : activeCwd,
  };
}
