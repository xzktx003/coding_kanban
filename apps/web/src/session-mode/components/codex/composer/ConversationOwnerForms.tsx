import { toast } from "sonner";
import { archiveThread, deleteThread } from "@session/services/apiAdapt/codex";
import { gitCommit, gitPush } from "@session/services/apiAdapt/git";
import { codexService } from "@session/services/codexService";
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
  const report = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : String(error));
  const lifecycle = (remove: boolean) =>
    void owner
      .run(
        () =>
          remove
            ? deleteThread(target.threadId)
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
          toast.message(remove ? "任务已删除" : "已归档聊天");
          close();
        },
      )
      .catch(report);
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
            ? "将归档此聊天，并从关注列表移出。Agent 不会被停止。"
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
