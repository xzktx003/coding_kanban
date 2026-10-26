import { ReviewDialog } from "./ReviewDialog";
import { useCodexStore } from "../stores";
import { HooksDialog } from "./dialogs/HooksDialog";
import { ImportDialog } from "./dialogs/ImportDialog";
import { MemoriesDialog } from "./dialogs/MemoriesDialog";
import type { SlashDialog } from "./slashCommands";
import { FeedbackPreflightWorkflow } from "@session/features/native-feedback/preflightWorkflow";

interface SlashCommandDialogsProps {
  open: SlashDialog | null;
  onClose: () => void;
  threadId?: string | null;
  cwd?: string | null;
  draftOwner?: string;
}

/**
 * Host for the dialogs opened by slash commands (`/hooks`, `/memories`,
 * `/import`). Each dialog owns its own data loading and is mounted only while
 * selected.
 */
export function SlashCommandDialogs({
  open,
  onClose,
  threadId,
  cwd,
  draftOwner,
}: SlashCommandDialogsProps) {
  const currentThreadId = useCodexStore((s) => s.currentThreadId);
  return (
    <>
      <FeedbackPreflightWorkflow
        requested={open === "feedback"}
        target={
          threadId !== undefined &&
          draftOwner &&
          (open === null || open === "feedback")
            ? { threadId, cwd: cwd ?? null, draftOwner }
            : null
        }
        onClose={onClose}
      />
      {open === "review" && (
        <ReviewDialog
          threadId={threadId === undefined ? currentThreadId : threadId}
          onClose={onClose}
        />
      )}
      {open === "hooks" && <HooksDialog open onClose={onClose} />}
      {open === "memories" && <MemoriesDialog open onClose={onClose} />}
      {open === "import" && <ImportDialog open onClose={onClose} />}
    </>
  );
}
