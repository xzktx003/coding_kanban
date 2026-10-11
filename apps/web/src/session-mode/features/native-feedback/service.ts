import { useCodexStore } from "@session/components/codex/stores";
import { openEventStream } from "@session/lib/eventStream";
import { authHeaders, buildUrl } from "@session/hooks/runtime";
import { usePairingStore } from "@session/stores/usePairingStore";
import type { FeedbackUploadParams } from "@session/bindings/v2/FeedbackUploadParams";
import { FeedbackUploads } from "./controller";
export const feedbackUploads = new FeedbackUploads();
const path = "/api/codex/feedback/upload";
/** Captured endpoint and headers also bind explicit retries to the original host. */
export function startFeedbackUpload(
  threadId: string | null,
  text: string,
  selection: { classification: string; includeLogs: boolean },
  owner: string,
) {
  const reason = text.trim();
  if (!reason) throw new Error("Feedback details are required");
  const endpoint = buildUrl(path),
    headers = { "Content-Type": "application/json", ...authHeaders() };
  const params: FeedbackUploadParams = {
    threadId,
    reason,
    classification: selection.classification,
    includeLogs: selection.includeLogs,
  };
  return feedbackUploads.start(threadId, owner, async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.message === "string"
          ? data.message
          : typeof data.error === "string"
            ? data.error
            : `Request failed: ${response.status}`,
      );
    if (typeof data.threadId !== "string" || !data.threadId)
      throw new Error("Feedback receipt is unknown");
    return data.threadId;
  });
}
// One metadata-only observer while reports exist; reuse the shared view=chat stream.
let stopEvents: (() => void) | undefined;
let stopAccount: (() => void) | undefined;
const accountIdentity = (state: ReturnType<typeof useCodexStore.getState>) =>
  JSON.stringify(
    state.account?.type === "chatgpt"
      ? [state.account.type, state.accountNamespace ?? state.account.email]
      : state.account,
  );
const restart = () => feedbackUploads.clear();
const stopReports = feedbackUploads.subscribe(() => {
  if (!feedbackUploads.getSnapshot().length) {
    const stop = stopEvents;
    stopEvents = undefined;
    stop?.();
    stopAccount?.();
    stopAccount = undefined;
    window.removeEventListener("session-runtime-restarted", restart);
  } else if (!stopEvents) {
    stopAccount = useCodexStore.subscribe((state, previous) => {
      if (
        state.account === previous.account &&
        state.accountNamespace === previous.accountNamespace
      )
        return;
      if (accountIdentity(state) !== accountIdentity(previous))
        feedbackUploads.clear();
    });
    stopEvents = openEventStream({
      agents: ["codex"],
      label: "feedback-upload",
      onEvent: (event) => {
        const payload = event.payload;
        const method =
          payload && typeof payload === "object" && "method" in payload
            ? payload.method
            : undefined;
        if (
          event.event === "codex:disconnected" ||
          method === "account/updated" ||
          method === "account/login/completed"
        )
          feedbackUploads.clear();
      },
    });
    window.addEventListener("session-runtime-restarted", restart);
  }
});
const stopIdentity = usePairingStore.subscribe((state, previous) => {
  const a = state.desktops.find((d) => d.host === state.selectedHost),
    b = previous.desktops.find((d) => d.host === previous.selectedHost);
  if (
    state.selectedHost !== previous.selectedHost ||
    a?.port !== b?.port ||
    a?.token !== b?.token
  )
    feedbackUploads.clear();
});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    stopIdentity();
    feedbackUploads.clear();
    stopReports();
  });
