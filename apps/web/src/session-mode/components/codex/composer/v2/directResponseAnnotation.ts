import { composeContextText } from "@agent-orchestrator/shared";
import { useCodexStore } from "@session/components/codex/stores";
import {
  followupParameters,
  followupService,
} from "@session/services/followupService";
import { useFollowupSettingsStore } from "@session/stores/useFollowupSettingsStore";
import { readDraft } from "@session/stores/useSessionDraftStore";
import { captureThreadModelSelection } from "@session/stores/useThreadModelStore";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { composerDrafts } from "./drafts";
import { acquireComposerSubmission } from "./composerSubmissionLock";
import {
  contextForDelivery,
  type AnnotatedContext,
} from "./selectionAnnotations";

/** Direct send captures only this annotation, leaving every other composer draft intact. */
export async function sendResponseAnnotation(
  owner: string,
  threadId: string,
  id: string,
): Promise<{ removed: boolean }> {
  const captured = composerDrafts.capture(owner);
  const found = captured.contexts.find((item) => item.id === id) as
    | AnnotatedContext
    | undefined;
  const version = captured.versions[id];
  if (
    !found ||
    found.kind !== "quote" ||
    !found.responseSelection ||
    found.sourceThreadId !== threadId ||
    !found.sourceItemId ||
    !version
  )
    throw new Error("批注不属于当前会话或尚未恢复，请重新选择");
  const annotation = structuredClone(found);
  const delivery = contextForDelivery(annotation);
  if (composeContextText("", [delivery]).length > 200_000)
    throw new Error("批注内容过长，请缩短后再发送");
  const snapshot = readDraft(owner);
  const settings = captureThreadModelSelection(threadId);
  const parameters = followupParameters(threadId, settings.settings);
  const { running, turnId } = codexRuntimeState(
    useCodexStore.getState(),
    threadId,
  );
  const mode = running ? useFollowupSettingsStore.getState().mode : "queue";
  if (running && mode === "steer" && !turnId)
    throw new Error("正在同步当前任务，请稍后再发送批注");
  const release = acquireComposerSubmission(owner);
  if (!release) throw new Error("当前会话正在发送，请稍后再试");
  try {
    await composerDrafts.flush(owner);
    if (composerDrafts.capture(owner).versions[id] !== version)
      throw new Error("批注已变化，请核对后重新发送");
    await followupService.submit(
      owner,
      {
        revision: snapshot.revision,
        writeId: snapshot.writeId,
        attachmentIds: [],
        contextIds: [id],
      },
      threadId,
      "",
      [],
      mode,
      turnId ?? undefined,
      parameters,
      [delivery],
      undefined,
      settings,
    );
    const latest = composerDrafts.capture(owner);
    const removed =
      latest.versions[id] === version &&
      latest.contexts.some((item) => item.id === id);
    if (removed)
      composerDrafts.clearSubmitted(owner, [annotation], captured.versions);
    return { removed };
  } finally {
    release();
  }
}
