import { useEffect, useState, type RefObject } from "react";
import { useAgentInteractionVisible } from "../session-dom";
import {
  retainProviderTranscript,
  trackProviderTranscript,
  updateProviderTranscript,
  useProviderTranscriptStore,
  type TranscriptProvider,
} from "../services/sessionProviderTranscriptState";

/** Display consumers only. Never changes the native connection or running task. */
export function useProviderTranscriptVisibility(
  owner: string | null,
  kind: TranscriptProvider,
  id: string | null,
  ref: RefObject<HTMLElement | null>,
  hasBody: boolean,
  restore: () => Promise<void>,
) {
  const interactionVisible = useAgentInteractionVisible();
  const [visible, setVisible] = useState(false);
  const entry = useProviderTranscriptStore((state) =>
    owner ? state.entries[owner] : undefined,
  );
  useEffect(() => {
    if (!owner || !id) return;
    const existed = useProviderTranscriptStore.getState().entries[owner];
    trackProviderTranscript(owner, kind, id);
    if (!existed && hasBody)
      updateProviderTranscript(owner, { restoreNeeded: false });
    const node = ref.current;
    let intersecting = true;
    const check = () =>
      setVisible(
        !!node?.getClientRects().length &&
          intersecting &&
          interactionVisible &&
          document.visibilityState !== "hidden",
      );
    const observer =
      node && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([event]) => {
            intersecting = event?.isIntersecting ?? false;
            check();
          })
        : null;
    if (node) observer?.observe(node);
    check();
    document.addEventListener("visibilitychange", check);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", check);
    };
  }, [owner, kind, id, interactionVisible, ref]);
  useEffect(() => {
    if (!owner || !id || !visible) return;
    return retainProviderTranscript(owner, kind, id);
  }, [owner, kind, id, visible]);
  useEffect(() => {
    if (
      owner &&
      visible &&
      entry?.restoreNeeded &&
      !entry.loading &&
      !entry.error
    )
      void restore().catch(() => {});
  }, [
    owner,
    visible,
    entry?.restoreNeeded,
    entry?.loading,
    entry?.error,
    restore,
  ]);
  return visible;
}
