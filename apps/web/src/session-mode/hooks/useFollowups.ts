import { useEffect } from "react";
import { emptyFollowupThread } from "@agent-orchestrator/shared";
import { followupService, useFollowupStore } from "../services/followupService";
const EMPTY = emptyFollowupThread();
export function useFollowups(threadId: string | null) {
  const state = useFollowupStore((s) =>
    threadId ? (s.threads[threadId] ?? EMPTY) : EMPTY,
  );
  const error = useFollowupStore((s) =>
    threadId ? s.errors[threadId] : undefined,
  );
  useEffect(() => {
    if (!threadId) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    let busy = false;
    const load = async () => {
      if (stopped || busy) return;
      busy = true;
      clearTimeout(timer);
      try {
        await followupService.load(threadId);
      } catch {
      } finally {
        busy = false;
        if (!stopped) timer = setTimeout(() => void load(), 1500);
      }
    };
    const wake = () => {
      if (!document.hidden) void load();
    };
    void load();
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [threadId]);
  return { state, error };
}
