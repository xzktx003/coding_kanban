import { useState } from "react";
import {
  sessionDraftKey,
  readDraft,
  useSessionDraftStore,
  useSessionTextDraft,
} from "@session/stores/useSessionDraftStore";
import { useImageAttachments } from "@session/components/common/useImageAttachments";
import { followupService } from "@session/services/followupService";
import { subagentService } from "./service";
import { AgentMentionPicker } from "./AgentMentionPicker";
import { mentionDrafts } from "./mentions";
// Shared across editor views: a second instance cannot submit the same draft concurrently.
import { sessionDraftSubmissions as submissions } from "./submissions";
export function SubagentInput({
  root,
  id,
  name,
}: {
  root: string;
  id: string;
  name: string;
}) {
  const owner = sessionDraftKey("codex", id),
    draft = useSessionTextDraft(owner),
    attachments = useImageAttachments(owner);
  const [sending, setSending] = useState(false),
    [notice, setNotice] = useState("");
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      submissions.has(owner) ||
      attachments.blocked ||
      (!draft.inputValue.trim() && !attachments.paths.length)
    )
      return;
    const snapshot = readDraft(owner),
      mentions = mentionDrafts.read(owner),
      images = [...attachments.paths],
      ids = attachments.attachments.map((a) => a.id);
    submissions.add(owner);
    setSending(true);
    setNotice("");
    try {
      const metadata = await subagentService.verify(root, id);
      if (metadata.canAcceptDirectInput !== true)
        throw new Error("当前子线程不允许直接输入，请通过主 Agent 跟进");
      const parameters = {
        cwd: metadata.cwd ?? null,
        ...(metadata.model ? { model: metadata.model } : {}),
        ...(metadata.reasoningEffort
          ? { effort: metadata.reasoningEffort }
          : {}),
      };
      // Omitted settings inherit the child's native policy/model, never the
      // currently open parent's global composer controls.
      // The service checks the exact submitted ID; unrelated failed queue items
      // are not evidence that this new submission failed.
      await followupService.submit(
        owner,
        snapshot.revision,
        id,
        snapshot.text,
        images,
        "queue",
        undefined,
        parameters,
        undefined,
        mentions,
      );
      useSessionDraftStore.getState().clearSubmitted(owner, snapshot);
      mentionDrafts.clear(owner, mentions);
      attachments.clear(ids);
      setNotice("消息已接收，等待子线程确认");
      // Merely inspecting never changes currentThreadId, including after this send.
    } catch (e) {
      setNotice(String(e));
    } finally {
      submissions.delete(owner);
      setSending(false);
    }
  };
  return (
    <form
      className="session-subagent-input"
      onSubmit={send}
      onPasteCapture={attachments.onPaste}
    >
      <small>发送至子 Agent · {name}</small>
      <textarea
        aria-label={`发送给 ${name}`}
        value={draft.inputValue}
        onChange={(e) => draft.setInputValue(e.target.value)}
        placeholder="子线程的独立草稿…"
      />
      <AgentMentionPicker root={root} owner={owner} />
      {attachments.storageError && (
        <p role="alert">
          附件尚未保存：{attachments.storageError}
          <button type="button" onClick={() => void attachments.retryStorage()}>
            重试保存
          </button>
        </p>
      )}
      {attachments.attachments.map((a) => (
        <div key={a.id}>
          {a.name} · {a.status}
          <button
            type="button"
            onClick={() => attachments.remove(a.id)}
            aria-label={`移除附件 ${a.name}`}
          >
            ×
          </button>
          {a.status === "error" && (
            <button type="button" onClick={() => void attachments.retry(a.id)}>
              重试上传
            </button>
          )}
        </div>
      ))}
      <label className="session-subagent-upload">
        添加附件
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => {
            if (e.target.files)
              void attachments.addFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
      </label>
      <button type="submit" disabled={sending || attachments.blocked}>
        {sending ? "正在发送…" : `发送给 ${name}`}
      </button>
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
