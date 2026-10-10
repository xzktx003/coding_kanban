import { useEffect, useState } from "react";
import { useAgentInteractionVisible } from "@session/session-dom";
import { codexService } from "@session/services/codexService";
import {
  isCodexTranscriptDormant,
  needsCodexTranscriptRestore,
  onCodexTranscriptReleased,
  retainCodexTranscript,
} from "@session/services/codexTranscriptActivity";

/** Visible body ownership is separate from followed task/status ownership. */
export function useTranscriptVisibility(threadId: string) {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [intersecting, setIntersecting] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  const interactionVisible = useAgentInteractionVisible();
  const [sleeping, setSleeping] = useState(() =>
    isCodexTranscriptDormant(threadId),
  );
  useEffect(() => {
    const changed = () =>
      setDocumentVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setIntersecting(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  useEffect(
    () =>
      onCodexTranscriptReleased((id) => {
        if (id === threadId) setSleeping(true);
      }),
    [threadId],
  );
  const visible =
    !!element && intersecting && documentVisible && interactionVisible;
  useEffect(() => {
    if (!threadId || !visible) return;
    const release = retainCodexTranscript(threadId);
    setSleeping(false);
    if (needsCodexTranscriptRestore(threadId)) {
      void codexService
        .loadThreadHistory(threadId, undefined, {
          background: true,
          recent: true,
        })
        .catch(() => {
          /* The transcript's existing error and retry UI owns recovery. */
        });
    }
    return release;
  }, [threadId, visible]);
  return { ref, renderTranscript: !sleeping };
}
