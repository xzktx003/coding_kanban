import { toast } from "sonner";
import { useMemo } from "react";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import { archiveThread, deleteThread } from "@session/services/apiAdapt/codex";
import { gitCommit, gitPush } from "@session/services/apiAdapt/git";
import { codexService } from "@session/services/codexService";
import { renameSession } from "@session/services/sessionNames";
import {
  SESSION_NAME_LIMIT,
  useSessionNameStore,
} from "@session/stores/useSessionNameStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useSessionDraftStore } from "@session/stores/useSessionDraftStore";
import { useCodexStore } from "../stores/useCodexStore";
import { GitCommitDialog } from "@session/features/git/GitCommitDialog";
import { ComposerSheet } from "./v2/ComposerSheet";
import { CreateBranchSheet } from "./CreateBranchSheet";
import { FileSearchSheet } from "./FileSearchSheet";
import {
  MergePullRequestSheet,
  OpenPullRequestSheet,
  PullRequestSheet,
} from "./PullRequestSheet";
import {
  ConversationOwnerFormProvider,
  OwnerFormSummary,
  useConversationFormField,
  useConversationOwnerForm,
  type ConversationOwnerForm,
} from "./conversationOwnerFormContext";
import { useConversationFormDrafts } from "./conversationFormDrafts";
import { archiveUndoNotice, captureArchivedThread } from "./archiveThreadUndo";
export function ConversationOwnerForms({
  form,
  onClose,
  onChange,
}: {
  form: ConversationOwnerForm;
  onClose: () => void;
  onChange: (form: ConversationOwnerForm) => void;
}) {
  const close = () => {
    if (!useConversationFormDrafts.getState().drafts[form.target.key]?.pending)
      onClose();
  };
  return (
    <ConversationOwnerFormProvider target={form.target}>
      <OwnerFormContent form={form} close={close} change={onChange} />
    </ConversationOwnerFormProvider>
  );
}
function OwnerFormContent({
  form,
  close,
  change,
}: {
  form: ConversationOwnerForm;
  close: () => void;
  change: (form: ConversationOwnerForm) => void;
}) {
  const owner = useConversationOwnerForm()!,
    { target, kind } = form,
    [notes, setNotes] = useConversationFormField("notes");
  const initialName = useMemo(
    () =>
      useSessionNameStore.getState().names[`codex:${target.threadId}`] ??
      useCodexStore
        .getState()
        .threads.find((thread) => thread.id === target.threadId)?.name ??
      target.title,
    [target.id, target.threadId, target.title],
  );
  const [rename, setRename] = useConversationFormField("rename", initialName);
  const report = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : String(error));
  const capturedTurn = useMemo(
    () => codexRuntimeState(useCodexStore.getState(), target.threadId).turnId,
    [target.id, target.threadId],
  );
  const lifecycle = (remove: boolean, stop = false) => {
    const snapshot = remove ? null : captureArchivedThread(target.threadId);
    return void owner
      .run(
        () =>
          remove
            ? deleteThread(target.threadId)
            : stop
              ? archiveThread(target.threadId, {
                  mode: "stop",
                  ...(capturedTurn ? { expectedTurnId: capturedTurn } : {}),
                })
              : archiveThread(target.threadId),
        () => {
          useAgentCenterStore
            .getState()
            .removeCard({ kind: "codex", id: target.threadId });
          useCodexStore.setState((s) => ({
            threads: s.threads.filter((t) => t.id !== target.threadId),
          }));
          if (
            remove &&
            useCodexStore.getState().currentThreadId === target.threadId
          )
            void codexService.setCurrentThread(null);
          // Deleting is permanent on the official side too, so only the archive
          // notice carries an undo entry.
          if (remove) toast.message("任务已删除");
          else
            toast.message(
              "已归档聊天",
              archiveUndoNotice(target.threadId, snapshot!),
            );
          close();
        },
      )
      .catch(report);
  };
  if (kind === "rename")
    return (
      <ComposerSheet
        title="重命名"
        description="重命名当前聊天"
        onClose={close}
      >
        <OwnerFormSummary />
        <label className="space-y-2 block">
          会话名称
          <input
            className="session-command-search"
            aria-label="会话名称"
            autoFocus
            maxLength={SESSION_NAME_LIMIT}
            value={rename}
            disabled={owner.pending}
            onChange={(event) => setRename(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={owner.pending || !rename.trim()}
          onClick={() =>
            void owner
              .run(() => renameSession("codex", target.threadId, rename), close)
              .catch(report)
          }
        >
          保存名称
        </button>
      </ComposerSheet>
    );
  if (kind === "archive" || kind === "delete")
    return (
      <ComposerSheet
        title={kind === "archive" ? "归档聊天" : "要删除任务？"}
        description={
          kind === "archive" ? "归档所选聊天" : "确认是否要删除所选聊天"
        }
        onClose={close}
      >
        <OwnerFormSummary />
        <p>
          {kind === "archive"
            ? "普通归档仅适用于空闲且没有待发内容的聊天。停止并归档会暂停本会话的自动推进，保留队列、Goal 和草稿；结果未确认时不会继续归档。"
            : "这将永久删除该任务及其子智能体任务。此操作无法撤销。"}
        </p>
        <button type="button" disabled={owner.pending} onClick={close}>
          {kind === "archive" ? "返回" : "取消"}
        </button>
        <button
          type="button"
          disabled={owner.pending}
          onClick={() => lifecycle(kind === "delete")}
        >
          {kind === "archive" ? "确认归档" : "删除"}
        </button>
        {kind === "archive" && (
          <button
            type="button"
            disabled={owner.pending}
            onClick={() => lifecycle(false, true)}
          >
            停止并归档
          </button>
        )}
      </ComposerSheet>
    );
  if (kind === "notes")
    return (
      <ComposerSheet
        title="会议：记笔记"
        description="在此设备上使用 Meetings 开始记笔记"
        onClose={close}
      >
        <OwnerFormSummary />
        <p>
          本机没有 Codex
          Meetings。笔记会追加到上述会话的输入，不会自动开始会议。
        </p>
        <textarea
          aria-label="会议笔记"
          value={notes}
          disabled={owner.pending}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button type="button" disabled={owner.pending} onClick={close}>
          取消
        </button>
        <button
          type="button"
          disabled={owner.pending}
          onClick={() => {
            const text = notes.trim();
            if (!text) {
              toast.message("先写下会议笔记");
              return;
            }
            void owner
              .run(
                async () => {
                  const current =
                    useSessionDraftStore.getState().drafts[target.draftOwner]
                      ?.text ?? "";
                  useSessionDraftStore
                    .getState()
                    .setText(
                      target.draftOwner,
                      current ? `${current}\n${text}` : text,
                    );
                },
                () => {
                  close();
                  toast.message("已记入原会话输入");
                },
              )
              .catch(report);
          }}
        >
          记入当前输入
        </button>
      </ComposerSheet>
    );
  if (!target.cwd) return null;
  if (kind === "commitOptions")
    return (
      <ComposerSheet
        title="提交或推送"
        description="打开提交或推送选项"
        onClose={close}
      >
        <OwnerFormSummary />
        <p>选择提交已暂存的更改，或把所选项目分支推送到远程仓库。</p>
        <button
          type="button"
          disabled={owner.pending}
          onClick={() => change({ ...form, kind: "commit" })}
        >
          提交更改
        </button>
        <button
          type="button"
          disabled={owner.pending}
          onClick={() =>
            void owner
              .run(
                () => gitPush(target.cwd!),
                () => {
                  toast.message("已推送到远程仓库");
                  close();
                },
                false,
              )
              .catch(report)
          }
        >
          推送到远程仓库
        </button>
      </ComposerSheet>
    );
  if (kind === "commit")
    return (
      <GitCommitDialog
        isOpen
        onClose={close}
        onConfirm={(message) =>
          gitCommit(target.cwd!, message).then(() => undefined)
        }
      />
    );
  if (kind === "branch")
    return <CreateBranchSheet cwd={target.cwd} onClose={close} />;
  if (kind === "pullRequest" || kind === "draftPullRequest")
    return (
      <PullRequestSheet
        cwd={target.cwd}
        draft={kind === "draftPullRequest"}
        onClose={close}
      />
    );
  if (kind === "fileSearch")
    return <FileSearchSheet cwd={target.cwd} onClose={close} />;
  if (kind === "merge")
    return <MergePullRequestSheet cwd={target.cwd} onClose={close} />;
  if (kind === "openPullRequest")
    return <OpenPullRequestSheet cwd={target.cwd} onClose={close} />;
  return null;
}
