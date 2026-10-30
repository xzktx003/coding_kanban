import { lazy } from "react";
import { DeferredComposerPanel } from "./DeferredComposerPanel";
import { useCodexStore } from "../stores";
import type { SlashDialog } from "./slashCommands";
import { FeedbackPreflightWorkflow } from "@session/features/native-feedback/preflightWorkflow";
import type { CodexOperationScope } from "@session/services/codexOperationScope";
import type { SupplementalCommandKind } from "./SupplementalCommandDialog";

const ReviewDialog = lazy(() => import("./ReviewDialog").then((module) => ({ default: module.ReviewDialog })));
const HooksDialog = lazy(() => import("./dialogs/HooksDialog").then((module) => ({ default: module.HooksDialog })));
const ImportDialog = lazy(() => import("./dialogs/ImportDialog").then((module) => ({ default: module.ImportDialog })));
const MemoriesDialog = lazy(() => import("./dialogs/MemoriesDialog").then((module) => ({ default: module.MemoriesDialog })));
const SupplementalCommandDialog = lazy(() => import("./SupplementalCommandDialog").then((module) => ({ default: module.SupplementalCommandDialog })));
const AutoReviewDenialsSheet = lazy(() => import("./AutoReviewDenialsSheet").then((module) => ({ default: module.AutoReviewDenialsSheet })));

interface SlashCommandDialogsProps {
  open: SlashDialog | null;
  onClose: () => void;
  threadId?: string | null;
  cwd?: string | null;
  draftOwner?: string;
  targetScope?: CodexOperationScope;
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
  targetScope,
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
        <DeferredComposerPanel label="代码审查" onClose={onClose}>
        <ReviewDialog
          threadId={threadId === undefined ? currentThreadId : threadId}
          onClose={onClose}
          targetScope={targetScope}
        />
        </DeferredComposerPanel>
      )}
      {open === "hooks" && <DeferredComposerPanel label="Hooks" onClose={onClose}><HooksDialog open onClose={onClose} /></DeferredComposerPanel>}
      {open === "memories" && <DeferredComposerPanel label="记忆" onClose={onClose}><MemoriesDialog open onClose={onClose} /></DeferredComposerPanel>}
      {open === "import" && <DeferredComposerPanel label="导入会话" onClose={onClose}><ImportDialog open onClose={onClose} /></DeferredComposerPanel>}
      {open && ["status", "rename", "fork", "mcp", "personality"].includes(open) && <DeferredComposerPanel label="会话命令" onClose={onClose}><SupplementalCommandDialog key={`${open}:${threadId}:${draftOwner}`} kind={open as SupplementalCommandKind} threadId={threadId === undefined ? currentThreadId : threadId} targetScope={targetScope} onClose={onClose} /></DeferredComposerPanel>}
      {open === "auto-review-denials" && <DeferredComposerPanel label="自动审查批准" onClose={onClose}><AutoReviewDenialsSheet threadId={threadId === undefined ? currentThreadId : threadId} onClose={onClose} /></DeferredComposerPanel>}
    </>
  );
}
