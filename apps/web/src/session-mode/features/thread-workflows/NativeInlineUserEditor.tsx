import { useRef, useState } from "react";
import type { HookRunSummary } from "@session/bindings/v2/HookRunSummary";
import type { UserInput } from "@session/bindings/v2";
import { useTranslation } from "react-i18next";
import { UserMessageItem } from "@session/components/codex/items/UserMessageItem";
import { EditRollbackConfirmDialog } from "@session/components/codex/items/EditRollbackConfirmDialog";
import { useCodexStore } from "@session/components/codex/stores";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { useTranscriptInspection } from "@session/components/codex/thread/inspection";
import { InlineEditInput } from "./InlineEditInput";
import { editLastUserMessage } from "./edit";
import {
  inlineEditKey,
  mutationKey,
  useThreadWorkflowStore,
  MutationUncertainError,
} from "./delivery";
import type { TurnSource } from "./model";

export function NativeInlineUserEditor({
  content,
  threadId,
  turnId,
  itemId,
  hookRuns,
}: {
  content: UserInput[];
  threadId: string;
  turnId: string;
  itemId: string;
  hookRuns?: readonly HookRunSummary[];
}) {
  const source: TurnSource = Object.freeze({
    threadId,
    turnId,
    itemId,
    rowId: `item:${itemId}`,
  });
  const inspection = useTranscriptInspection();
  const { i18n } = useTranslation();
  const zh = i18n?.language?.startsWith("zh") ?? true;
  const label = (cn: string, en: string) => (zh ? cn : en);
  const stored = useThreadWorkflowStore(
    (state) => state.inlineEdits[inlineEditKey(source)],
  );
  const uncertain = useThreadWorkflowStore((state) =>
    ["editRollback", "editSend"].some((kind) =>
      ["pending", "uncertain"].includes(
        state.mutations[
          mutationKey(kind as "editRollback" | "editSend", source)
        ]?.status ?? "",
      ),
    ),
  );
  const running = useCodexStore(
    (state) => codexRuntimeState(state, threadId).running,
  );
  const [editing, setEditing] = useState(!!stored),
    [confirm, setConfirm] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const request = useRef<{
    source: TurnSource;
    text: string;
    inputs: UserInput[];
  } | null>(null);
  const original = content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
  const text = stored?.text ?? original;
  const confirmSend = async () => {
    if (busy.current || running || uncertain || !request.current) return;
    const chosen = request.current;
    busy.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await editLastUserMessage(chosen.source, chosen.text, chosen.inputs);
      const current =
        useThreadWorkflowStore.getState().inlineEdits[
          inlineEditKey(chosen.source)
        ];
      setConfirm(false);
      // The service clears only its captured submit revision. A newer buffer remains editable.
      setEditing(!!current);
    } catch (e) {
      setError(
        e instanceof MutationUncertainError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };
  const beginConfirm = () => {
    if (!text.trim() || running || uncertain || inspection || submitting)
      return;
    request.current = {
      source: Object.freeze({ ...source }),
      text,
      inputs: structuredClone(content),
    };
    setError(null);
    setConfirm(true);
  };
  const cancel = () => {
    if (submitting) return;
    useThreadWorkflowStore.getState().clearInlineEdit(source);
    setEditing(false);
    setError(null);
  };
  return (
    <>
      <UserMessageItem
        content={content}
        threadId={threadId}
        turnId={turnId}
        itemId={itemId}
        hookRuns={hookRuns}
        editDisabled={running || submitting || inspection}
        onEdit={() => {
          if (running || submitting || inspection) return;
          if (!stored)
            useThreadWorkflowStore.getState().setInlineEdit(source, original);
          setEditing(true);
        }}
        inlineEditor={
          editing ? (
            <div className="codex-native-inline-editor">
              <InlineEditInput
                label={label(
                  "编辑上一条用户消息",
                  "Edit previous user message",
                )}
                value={text}
                disabled={submitting}
                onChange={(value) =>
                  useThreadWorkflowStore.getState().setInlineEdit(source, value)
                }
                onCollapse={() => {
                  if (!submitting) setEditing(false);
                }}
                onSubmit={beginConfirm}
              />
              {error && (
                <p role="alert" className="codex-native-inline-edit-error">
                  {error}
                </p>
              )}
              <div className="codex-native-inline-edit-actions">
                <button
                  type="button"
                  disabled={submitting}
                  aria-label={label("取消编辑", "Cancel edit")}
                  onClick={cancel}
                >
                  {label("取消", "Cancel")}
                </button>
                <button
                  type="button"
                  disabled={!text.trim() || running || submitting || uncertain}
                  aria-label={label("发送编辑消息", "Send edited message")}
                  onClick={beginConfirm}
                >
                  {label("发送", "Send")}
                </button>
              </div>
            </div>
          ) : undefined
        }
      />
      <EditRollbackConfirmDialog
        open={confirm}
        submitting={submitting}
        confirmDisabled={uncertain}
        error={error}
        onOpenChange={(open) => {
          if (!submitting) setConfirm(open);
        }}
        onConfirm={() => void confirmSend()}
      />
    </>
  );
}
