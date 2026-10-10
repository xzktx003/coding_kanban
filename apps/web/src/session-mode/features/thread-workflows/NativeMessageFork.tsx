import { useEffect, useRef, useState, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useTranscriptInspection } from "@session/components/codex/thread/inspection";
import { isAgentInteractionVisible } from "@session/session-dom";
import { NativeMessageForkIcon } from "./NativeMessageIcons";
import { forkAtTurn } from "./service";
import { mutationKey, useThreadWorkflowStore } from "./delivery";
import type { TurnSource } from "./model";

function sourceSelection(root: HTMLDivElement | null): string {
  const selection = root?.ownerDocument.getSelection();
  return root &&
    selection?.anchorNode &&
    selection.focusNode &&
    root.contains(selection.anchorNode) &&
    root.contains(selection.focusNode)
    ? selection.toString()
    : "";
}

export function NativeMessageFork({
  threadId,
  turnId,
  itemId,
  contentRef,
  disabled = false,
}: {
  threadId?: string;
  turnId?: string;
  itemId?: string;
  contentRef: RefObject<HTMLDivElement | null>;
  disabled?: boolean;
}) {
  const { i18n } = useTranslation();
  const zh = i18n?.language?.startsWith("zh") ?? true;
  const inspection = useTranscriptInspection();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const source: TurnSource = {
    threadId: threadId ?? "",
    turnId: turnId ?? "",
    itemId: itemId ?? "",
    rowId: `item:${itemId ?? ""}`,
  };
  const record = useThreadWorkflowStore(
    (state) => state.mutations[mutationKey("fork", source)],
  );
  useEffect(() => {
    const update = () => {
      setSelected(
        isAgentInteractionVisible() ? sourceSelection(contentRef.current) : "",
      );
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [contentRef]);
  if (inspection || !threadId || !turnId || !itemId) return null;
  const uncertain =
    record?.status === "uncertain" || record?.status === "pending";
  const label = uncertain
    ? zh
      ? "分支结果待确认，请检查会话列表"
      : "Fork outcome unconfirmed; check conversations"
    : selected
      ? zh
        ? "从此轮分支并引用选区"
        : "Fork from this turn with selected text"
      : zh
        ? "从此轮创建分支"
        : "Fork from this turn";
  return (
    <button
      type="button"
      className="codex-native-fork"
      aria-label={label}
      title={label}
      disabled={disabled || busy || uncertain}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (
          pending.current ||
          disabled ||
          uncertain ||
          !isAgentInteractionVisible()
        )
          return;
        const chosen = Object.freeze({ ...source }),
          quote = sourceSelection(contentRef.current);
        pending.current = true;
        setBusy(true);
        void forkAtTurn(chosen, quote)
          .then(
            () =>
              toast.success(
                zh ? "已创建会话分支" : "Conversation fork created",
              ),
            (error) =>
              toast.error(
                error instanceof Error ? error.message : String(error),
              ),
          )
          .finally(() => {
            pending.current = false;
            setBusy(false);
          });
      }}
    >
      {busy ? (
        <Loader2 size={15} className="animate-spin" aria-hidden />
      ) : (
        <NativeMessageForkIcon width={16} height={16} />
      )}
    </button>
  );
}
