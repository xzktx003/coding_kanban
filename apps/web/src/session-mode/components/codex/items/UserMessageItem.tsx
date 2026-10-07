import { Pencil } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UserInput } from "@session/bindings/v2";
import { useCodexStore } from "@session/components/codex/stores";
import { AddToTodo, CopyButton } from "@session/components/common";
import { Markdown } from "@session/components/Markdown";
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

type UserMessageItemProps = {
  content: Array<UserInput>;
  onEdit?: (text: string) => void | Promise<void>;
  editDisabled?: boolean;
};

export const UserMessageItem = ({
  content,
  onEdit,
  editDisabled = false,
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
  const canEdit = !!onEdit && text.length > 0 && !editDisabled;

  const handleEdit = async () => {
    if (!canEdit || !onEdit) return;
    await onEdit(text);
  };

  return (
    <div className="flex justify-end min-w-0">
      <div className="group flex w-full min-w-0 max-w-full flex-col items-end gap-1">
        <div className="box-border flex w-fit min-w-0 max-w-full self-end flex-col gap-2 break-words rounded-md border bg-gray-100 p-2 dark:bg-gray-700">
          {(images.length > 0 || localImages.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {images.map((src, index) => (
                <img
                  // biome-ignore lint/suspicious/noArrayIndexKey: the same image may be attached twice, so src is not unique
                  key={`remote-${index}`}
                  src={src}
                  alt={`Uploaded ${index + 1}`}
                  className="max-w-full max-h-48 rounded object-contain"
                />
              ))}
              {localImages.map((src, index) => (
                <img
                  // biome-ignore lint/suspicious/noArrayIndexKey: the same image may be attached twice, so src is not unique
                  key={`local-${index}`}
                  src={src}
                  alt={`Uploaded ${index + 1}`}
                  className="max-w-full max-h-48 rounded object-contain"
                />
              ))}
            </div>
          )}
          {text.length > 0 && (
            <Markdown className="min-w-0 max-w-full" value={text} />
          )}
        </div>
        <div
          className={`flex min-w-0 items-center gap-1 px-1 ${
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
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          <CopyButton text={text} />
          <AddToTodo text={text} />
        </div>
      </div>
    </div>
  );
};

type EditableUserMessageItemProps = {
  content: Array<UserInput>;
  threadId: string;
  turnId: string;
  rollbackTurns: number;
};

export const EditableUserMessageItem = ({
  content,
  threadId,
  turnId,
  rollbackTurns,
}: EditableUserMessageItemProps) => {
  const { t } = useTranslation("thread");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const running = useCodexStore(
    (s) =>
      s.threadStatusMap[threadId]?.type === "active" ||
      s.turnTimingMap[threadId]?.status === "inProgress",
  );

  const applyEdit = async (text: string) => {
    if (rollbackTurns > 0) {
      await codexService.threadRollback(threadId, rollbackTurns, turnId);
    }
    useSessionDraftStore
      .getState()
      .setText(sessionDraftKey("codex", threadId), text);
    if (
      useCodexStore.getState().currentThreadId === threadId &&
      useAgentSettingsStore.getState().selectedAgent === "codex"
    ) {
      useCodexStore.getState().triggerInputFocus();
    }
  };

  const handleEdit = async (text: string) => {
    if (submittingRef.current || running) return;
    try {
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
    if (!pendingText || submittingRef.current || running) return;
    submittingRef.current = true;
    try {
      setSubmitting(true);
      await applyEdit(pendingText);
      setPendingText(null);
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

  return (
    <>
      <UserMessageItem
        content={content}
        editDisabled={submitting || running}
        onEdit={handleEdit}
      />
      <EditRollbackConfirmDialog
        open={pendingText !== null}
        submitting={submitting || running}
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
