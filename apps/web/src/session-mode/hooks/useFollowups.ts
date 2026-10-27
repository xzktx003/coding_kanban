import { useEffect } from "react";
import { emptyFollowupThread } from "@agent-orchestrator/shared";
import { followupService, useFollowupStore } from "../services/followupService";
import {
  isAgentInteractionVisible,
  useAgentInteractionVisible,
} from "../session-dom";
const EMPTY = emptyFollowupThread();

type Observer = { users: number; stop: () => void };
const observers = new Map<string, Observer>();

/** Mounted composers/dialogs share one visible observer of a thread's queue. */
function observe(threadId: string): () => void {
  let observer = observers.get(threadId);
  if (observer) observer.users++;
  else {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    const visible = () =>
      !document.hidden &&
      navigator.onLine !== false &&
      isAgentInteractionVisible();
    const load = async () => {
      if (stopped || busy || !visible()) return;
      busy = true;
      clearTimeout(timer);
      try {
        // The service coalesces this read with background synchronization and
        // send-receipt verification. Do not abort a shared read when this UI
        // leaves: those other consumers may still need its result.
        await followupService.load(threadId);
      } catch {
      } finally {
        busy = false;
        if (!stopped && visible()) timer = setTimeout(() => void load(), 1500);
      }
    };
    const wake = () => {
      clearTimeout(timer);
      if (visible()) void load();
    };
    observer = {
      users: 1,
      stop: () => {
        stopped = true;
        clearTimeout(timer);
        window.removeEventListener("online", wake);
        window.removeEventListener("offline", wake);
        document.removeEventListener("visibilitychange", wake);
      },
    };
    observers.set(threadId, observer);
    window.addEventListener("online", wake);
    window.addEventListener("offline", wake);
    document.addEventListener("visibilitychange", wake);
    void load();
  }
  const retained = observer;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--retained.users === 0) {
      retained.stop();
      if (observers.get(threadId) === retained) observers.delete(threadId);
    }
  };
}

export function useFollowups(threadId: string | null) {
  const visible = useAgentInteractionVisible();
  const state = useFollowupStore((s) =>
    threadId ? (s.threads[threadId] ?? EMPTY) : EMPTY,
  );
  const error = useFollowupStore((s) =>
    threadId ? s.errors[threadId] : undefined,
  );
  useEffect(() => {
    if (threadId && visible) return observe(threadId);
  }, [threadId, visible]);
  return { state, error };
}
