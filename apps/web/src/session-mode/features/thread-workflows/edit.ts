import type { TurnStartParams, UserInput } from "@session/bindings/v2";
import { threadRead } from "@session/services/apiAdapt/codex";
import { codexService } from "@session/services/codexService";
import { useCodexStore } from "@session/components/codex/stores";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import {
  inlineEditKey,
  mutationKey,
  runTurnMutation,
  useThreadWorkflowStore,
  MutationUncertainError,
} from "./delivery";
import { followupParameters } from "@session/services/followupService";
import type { TurnSource } from "./model";

function assertIdle(
  thread: { status?: { type: string }; turns: Array<{ status: string }> },
  threadId: string,
) {
  if (
    thread.status?.type === "active" ||
    thread.turns.at(-1)?.status === "inProgress" ||
    codexRuntimeState(useCodexStore.getState(), threadId).running
  )
    throw new Error("任务正在运行，请先使用可见停止操作，再编辑最后消息。");
}
function rejectUnknown(source: TurnSource, kind: "editRollback" | "editSend") {
  const record =
    useThreadWorkflowStore.getState().mutations[mutationKey(kind, source)];
  if (record?.status === "uncertain" || record?.status === "pending")
    throw new MutationUncertainError(source, kind);
  return record;
}
/** Called only after visible destructive-history confirmation. The detached composer is never modified. */
type EditConfig = Pick<
  TurnStartParams,
  | "cwd"
  | "model"
  | "effort"
  | "serviceTier"
  | "approvalPolicy"
  | "approvalsReviewer"
  | "sandboxPolicy"
  | "collaborationMode"
>;
export async function editLastUserMessage(
  chosen: TurnSource,
  text: string,
  originalInputs: readonly UserInput[],
): Promise<string> {
  const source = Object.freeze({ ...chosen });
  const message = text.trim();
  if (!message) throw new Error("编辑的消息不能为空。");
  const sendRecord = rejectUnknown(source, "editSend");
  if (sendRecord?.status === "completed")
    return (sendRecord.result as { turnId: string }).turnId;
  const rollbackRecord = rejectUnknown(source, "editRollback");
  const submitRevision =
    useThreadWorkflowStore.getState().inlineEdits[inlineEditKey(source)]
      ?.revision;
  const input: UserInput[] = [
    { type: "text", text, text_elements: [] },
    ...structuredClone(originalInputs).filter((item) => item.type !== "text"),
  ];
  let afterLastTurnId: string | null;
  let config = structuredClone(
    followupParameters(source.threadId),
  ) as EditConfig;
  if (rollbackRecord?.status === "completed") {
    const saved = rollbackRecord.result as {
      afterLastTurnId: string | null;
      config: EditConfig;
    };
    afterLastTurnId = saved.afterLastTurnId;
    config = saved.config;
  } else {
    const read = await threadRead(
      { threadId: source.threadId },
      { suppressToast: true },
    );
    if (read.thread.id !== source.threadId)
      throw new Error("历史未返回所选会话，已保留编辑内容。");
    assertIdle(read.thread, source.threadId);
    const latest = read.thread.turns.at(-1);
    if (
      !latest ||
      latest.id !== source.turnId ||
      !latest.items.some(
        (item) => item.id === source.itemId && item.type === "userMessage",
      )
    )
      throw new Error(
        "所选消息已不是最后一条用户消息，请刷新历史；编辑内容已保留。",
      );
    const rollback = await runTurnMutation("editRollback", source, async () => {
      const result = await codexService.threadRollback(
        source.threadId,
        1,
        source.turnId,
      );
      return {
        threadId: result.id,
        afterLastTurnId: result.turns.at(-1)?.id ?? null,
        config,
      };
    });
    afterLastTurnId = rollback.afterLastTurnId;
  }
  // Another device could append a turn after rollback. Re-read before sending, never resume or acquire ownership here.
  const current = await threadRead(
    { threadId: source.threadId },
    { suppressToast: true },
  );
  assertIdle(current.thread, source.threadId);
  if (
    current.thread.id !== source.threadId ||
    (current.thread.turns.at(-1)?.id ?? null) !== afterLastTurnId
  )
    throw new Error("会话历史在编辑期间改变，未发送替换消息；编辑内容已保留。");
  const result = await runTurnMutation("editSend", source, async () => {
    const turn = await codexService.turnStart(
      source.threadId,
      text,
      [],
      crypto.randomUUID(),
      input,
      config,
    );
    return { turnId: turn.id };
  });
  const store = useThreadWorkflowStore.getState();
  const currentBuffer = store.inlineEdits[inlineEditKey(source)];
  if (
    currentBuffer?.revision === submitRevision &&
    currentBuffer?.text === text
  )
    store.clearInlineEdit(source);
  return result.turnId;
}
