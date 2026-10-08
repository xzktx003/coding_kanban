import { useEffect, useState, type RefObject } from "react";
import { Quote, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import {
  composeContextText,
  type ComposerContext,
} from "@agent-orchestrator/shared";
import { sessionDraftKey } from "@session/stores/useSessionDraftStore";
import { createSideChat } from "@session/services/conversationActions";
import { useCodexStore } from "../../stores";
import { composerDrafts } from "./drafts";
import { isAgentInteractionVisible } from "@session/session-dom";

export function MessageReferenceActions({
  text,
  threadId,
  itemId,
  contentRef,
}: {
  text: string;
  threadId?: string;
  itemId?: string;
  contentRef: RefObject<HTMLDivElement | null>;
}) {
  const [selection, setSelection] = useState("");
  useEffect(() => {
    const update = () => {
      if (!isAgentInteractionVisible()) return;
      const selected = window.getSelection(),
        root = contentRef.current;
      if (!root || !selected?.anchorNode || !selected.focusNode) return;
      if (
        root.contains(selected.anchorNode) &&
        root.contains(selected.focusNode)
      )
        setSelection(selected.toString());
      else setSelection("");
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [contentRef]);
  const reference = (): ComposerContext => ({
    id: crypto.randomUUID(),
    kind: "quote",
    name: selection ? "引用的选区" : "引用的回答",
    text: selection || text,
    sourceThreadId: threadId,
    ...(itemId ? { sourceItemId: itemId } : {}),
  });
  return (
    <span className="session-reference-actions" data-selection={!!selection}>
      <button
        type="button"
        disabled={!threadId}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!threadId) return;
          composerDrafts.add(sessionDraftKey("codex", threadId), reference());
          if (useCodexStore.getState().currentThreadId === threadId)
            useCodexStore.getState().triggerInputFocus();
          toast.success("引用已加入该会话的草稿");
        }}
      >
        <Quote size={15} />
        {selection ? "引用选区" : "引用"}
      </button>
      <button
        type="button"
        disabled={!threadId}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (threadId)
            void createSideChat(
              threadId,
              composeContextText("", [reference()]),
            ).catch((e) => toast.error(String(e)));
        }}
      >
        <MessageSquarePlus size={15} />
        侧边追问
      </button>
    </span>
  );
}
