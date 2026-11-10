import { useEffect } from "react";
import { emptyFollowupThread } from "@agent-orchestrator/shared/session-followups";
import { followupService, useFollowupStore } from "../services/followupService";
import {
  isAgentInteractionVisible,
  useAgentInteractionVisible,
} from "../session-dom";
const EMPTY = emptyFollowupThread();

type Observer = {
  users: number;
  stop: () => void;
  retryNow: () => Promise<void>;
};
const observers = new Map<string, Observer>();
const POLL_INTERVAL_MS = 1500;
const MAX_ERROR_POLL_INTERVAL_MS = 15_000;

/** Mounted composers/dialogs share one visible observer of a thread's queue. */
function observe(threadId: string): () => void {
  let observer = observers.get(threadId);
  if (observer) observer.users++;
  else {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> | null = null;
    let consecutiveFailures = 0;
    const visible = () =>
      !document.hidden &&
      navigator.onLine !== false &&
      isAgentInteractionVisible();
    const load = (explicit = false): Promise<void> => {
      if (stopped || (!explicit && !visible())) return Promise.resolve();
      if (inFlight) return inFlight;
      clearTimeout(timer);
      const request = (async () => {
        try {
          // The service coalesces this read with background synchronization and
          // send-receipt verification. Do not abort a shared read when this UI
          // leaves: those other consumers may still need its result.
          await followupService.load(threadId);
          consecutiveFailures = 0;
        } catch {
          consecutiveFailures += 1;
        } finally {
          inFlight = null;
          if (!stopped && visible()) {
            const delay = consecutiveFailures
              ? Math.min(
                  POLL_INTERVAL_MS * 2 ** (consecutiveFailures - 1),
                  MAX_ERROR_POLL_INTERVAL_MS,
                )
              : POLL_INTERVAL_MS;
            timer = setTimeout(() => void load(), delay);
          }
        }
      })();
      inFlight = request;
      return request;
    };
    const wake = () => {
      clearTimeout(timer);
      if (visible()) void load();
    };
    observer = {
      users: 1,
      retryNow: () => {
        consecutiveFailures = 0;
        clearTimeout(timer);
        return load(true);
      },
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

/** An explicit user retry shares the visible observer and resets its backoff. */
export function retryFollowupsNow(threadId: string): Promise<void> {
  const observer = observers.get(threadId);
  if (observer) return observer.retryNow();
  return followupService.load(threadId).then(
    () => undefined,
    () => undefined,
  );
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
