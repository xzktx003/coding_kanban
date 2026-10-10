import { useTranscriptInspection } from "../thread/inspection";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { NativeMessageEdit } from "@session/features/thread-workflows/NativeMessageIcons";
import { NativeMessageCopy } from "@session/features/thread-workflows/NativeMessageCopy";
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NativeHookStats } from "./NativeHookStats";
import type { HookRunSummary } from "@session/bindings/v2/HookRunSummary";
import type { UserInput } from "@session/bindings/v2";
import { useCodexStore } from "@session/components/codex/stores";
import { AddToTodo } from "@session/components/common";
import { CodexMarkdown as Markdown } from "../presentation/CodexMarkdown";
import { CodexImage } from "../presentation/CodexImage";
import { Button } from "@session/components/ui/button";
import { toast } from "@session/components/ui/use-toast";
import { fileSrc } from "@session/hooks/runtime";
import { useWindowFocus } from "@session/hooks/useWindowFocus";
import { codexService } from "@session/services/codexService";
import {
  sessionDraftKey,
  useSessionDraftStore,
} from "@session/stores/useSessionDraftStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { getErrorMessage } from "@session/utils/errorUtils";
import { EditRollbackConfirmDialog } from "./EditRollbackConfirmDialog";
import { NativeInlineUserEditor } from "@session/features/thread-workflows/NativeInlineUserEditor";
import { readDraft } from "@session/stores/useSessionDraftStore";
import {
  mutationKey,
  runTurnMutation,
  useThreadWorkflowStore,
} from "@session/features/thread-workflows/delivery";
import type { TurnSource } from "@session/features/thread-workflows/model";
import "@session/features/thread-workflows/native-message.css";

type UserMessageItemProps = {
  content: Array<UserInput>;
  onEdit?: (text: string) => void | Promise<void>;
  editDisabled?: boolean;
  inlineEditor?: ReactNode;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  hookRuns?: readonly HookRunSummary[];
};

export const UserMessageItem = ({
  content,
  onEdit,
  editDisabled = false,
  inlineEditor,
  threadId,
  turnId,
  itemId,
  hookRuns,
}: UserMessageItemProps) => {
  const { t } = useTranslation("thread");
  const isWindowFocused = useWindowFocus();
  const images = content.filter((m) => m.type === "image").map((m) => m.url);
  const localImages = content
    .filter((m) => m.type === "localImage")
    .map((m) => fileSrc(m.path));
  const text = content
    .filter((m) => m.type === "text")
    .map((m) => m.text)
    .join("");
  const inspection = useTranscriptInspection();
  const canEdit = !inspection && !!onEdit && text.length > 0 && !editDisabled;

  const handleEdit = async () => {
    if (!canEdit || !onEdit) return;
    await onEdit(text);
  };

  return (
    <div
      className="codex-native-user flex justify-end min-w-0"
      data-owner-thread={threadId}
      data-owner-turn={turnId}
      data-thread-user-message-navigation-item-id={itemId}
    >
      <div className="group flex w-full min-w-0 max-w-full flex-col items-end gap-1">
        {inlineEditor ? (
          <div className="codex-native-inline-edit-wrap">{inlineEditor}</div>
        ) : (
          <div className="codex-user-bubble box-border flex w-fit min-w-0 self-end flex-col gap-2 break-words">
            {(images.length > 0 || localImages.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {images.map((src, index) => (
                  <CodexImage
                    // biome-ignore lint/suspicious/noArrayIndexKey: the same image may be attached twice, so src is not unique
                    key={`remote-${index}`}
                    src={src}
                    alt={`Uploaded ${index + 1}`}
                  />
                ))}
                {localImages.map((src, index) => (
                  <CodexImage
                    // biome-ignore lint/suspicious/noArrayIndexKey: the same image may be attached twice, so src is not unique
                    key={`local-${index}`}
                    src={src}
                    alt={`Uploaded ${index + 1}`}
                  />
                ))}
              </div>
            )}
            {text.length > 0 && (
              <Markdown className="min-w-0 max-w-full" value={text} />
            )}
          </div>
        )}
        {!inlineEditor && (
          <div
            className={`session-message-actions codex-message-native-actions flex min-w-0 items-center gap-1 px-1 ${
              isWindowFocused
                ? "invisible group-hover:visible group-focus-within:visible"
                : "invisible"
            }`}
          >
            {onEdit && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleEdit}
                disabled={!canEdit}
                aria-label={t("userMessage.edit")}
                className="h-6 w-6 text-muted-foreground"
              >
                <NativeMessageEdit width={16} height={16} />
              </Button>
            )}
            <NativeMessageCopy text={text} />
            <AddToTodo text={text} />
            {hookRuns?.length ? <NativeHookStats runs={hookRuns} /> : null}
          </div>
        )}
      </div>
    </div>
  );
};

type EditableUserMessageItemProps = {
  content: Array<UserInput>;
  threadId: string;
  turnId: string;
  rollbackTurns: number;
  itemId?: string;
  hookRuns?: readonly HookRunSummary[];
  nativeEdit?: boolean;
};

export const EditableUserMessageItem = ({
  content,
  threadId,
  turnId,
  rollbackTurns,
  itemId,
  nativeEdit = false,
  hookRuns,
}: EditableUserMessageItemProps) => {
  const { t } = useTranslation("thread");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const chosenRef = useRef<{
    source: TurnSource;
    rollbackTurns: number;
    text: string;
    owner: string;
    snapshot: ReturnType<typeof readDraft>;
  } | null>(null);
  const uncertain = useThreadWorkflowStore((state) => {
    const chosen = chosenRef.current;
    return (
      !!chosen &&
      ["pending", "uncertain"].includes(
        state.mutations[mutationKey("restore", chosen.source)]?.status ?? "",
      )
    );
  });
  const running = useCodexStore((s) => codexRuntimeState(s, threadId).running);

  const applyEdit = async () => {
    const chosen = chosenRef.current;
    if (!chosen) return;
    const { source, owner, text, snapshot } = chosen;
    if (chosen.rollbackTurns > 0) {
      await runTurnMutation("restore", source, async () => {
        await codexService.threadRollback(
          source.threadId,
          chosen.rollbackTurns,
          source.turnId,
        );
        return { threadId: source.threadId };
      });
    }
    const current = readDraft(owner);
    useSessionDraftStore
      .getState()
      .setText(
        owner,
        current.revision === snapshot.revision && current.text === snapshot.text
          ? text
          : [current.text, text].filter(Boolean).join("\n\n"),
      );
    if (
      useCodexStore.getState().currentThreadId === source.threadId &&
      useAgentSettingsStore.getState().selectedAgent === "codex"
    ) {
      useCodexStore.getState().triggerInputFocus();
    }
  };

  const handleEdit = async (text: string) => {
    if (submittingRef.current || running) return;
    try {
      setEditError(null);
      const owner = sessionDraftKey("codex", threadId);
      chosenRef.current = {
        source: Object.freeze({
          threadId,
          turnId,
          itemId: itemId ?? `${turnId}:user`,
          rowId: `item:${itemId ?? turnId}`,
        }),
        rollbackTurns,
        text,
        owner,
        snapshot: readDraft(owner),
      };
      setPendingText(text);
    } catch (error) {
      console.error("Failed to edit from user message:", error);
      toast.error(t("userMessage.editFailed"), {
        description: getErrorMessage(error),
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleConfirmEdit = async () => {
    if (!pendingText || submittingRef.current || running || uncertain) return;
    submittingRef.current = true;
    try {
      setSubmitting(true);
      setEditError(null);
      await applyEdit();
      setPendingText(null);
    } catch (error) {
      console.error("Failed to edit from user message:", error);
      setEditError(getErrorMessage(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (nativeEdit)
    return (
      <NativeInlineUserEditor
        content={content}
        threadId={threadId}
        turnId={turnId}
        itemId={itemId ?? `${turnId}:user`}
        hookRuns={hookRuns}
      />
    );

  return (
    <>
      <UserMessageItem
        content={content}
        threadId={threadId}
        turnId={turnId}
        itemId={itemId}
        hookRuns={hookRuns}
        editDisabled={submitting || running}
        onEdit={handleEdit}
      />
      <EditRollbackConfirmDialog
        open={pendingText !== null}
        error={editError}
        submitting={submitting || running}
        confirmDisabled={uncertain}
        onOpenChange={(open) => {
          if (!open && !submitting) {
            setPendingText(null);
          }
        }}
        onConfirm={() => {
          void handleConfirmEdit();
        }}
      />
    </>
  );
};
