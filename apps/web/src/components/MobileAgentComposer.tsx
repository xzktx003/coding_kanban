import { useState } from "react";

import {
  buildMobileComposerInputFrames,
  sendMobileComposerFrames,
  type MobileComposerSendMode,
} from "../lib/mobile-terminal-controls";

interface MobileAgentComposerProps {
  disabled?: boolean;
  onSendInput: (input: string) => Promise<void> | void;
}

interface FailedComposerAttempt {
  draft: string;
  frames: string[];
  nextFrameIndex: number;
}

function errorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : "";
  return detail ? `发送失败，内容已保留：${detail}` : "发送失败，内容已保留。";
}

export function MobileAgentComposer({
  disabled = false,
  onSendInput,
}: MobileAgentComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [failedAttempt, setFailedAttempt] =
    useState<FailedComposerAttempt | null>(null);

  const deliver = async (
    frames: string[],
    startFrameIndex: number,
    draft: string,
  ) => {
    setSending(true);
    setSendError(null);
    try {
      const result = await sendMobileComposerFrames(
        frames,
        onSendInput,
        startFrameIndex,
      );
      if (!result.ok) {
        setFailedAttempt({
          draft,
          frames,
          nextFrameIndex: result.nextFrameIndex,
        });
        setSendError(errorMessage(result.error));
        return;
      }
      setFailedAttempt(null);
      setText((current) => (current === draft ? "" : current));
    } finally {
      setSending(false);
    }
  };

  const send = async (mode: MobileComposerSendMode) => {
    if (!text || disabled || sending) return;
    const draft = text;
    await deliver(buildMobileComposerInputFrames(draft, mode), 0, draft);
  };

  const retry = async () => {
    if (!failedAttempt || disabled || sending) return;
    await deliver(
      failedAttempt.frames,
      failedAttempt.nextFrameIndex,
      failedAttempt.draft,
    );
  };

  return (
    <form
      className="mobile-agent-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send("send");
      }}
    >
      <textarea
        className="mobile-agent-composer-input"
        disabled={disabled || sending}
        onChange={(event) => setText(event.target.value)}
        placeholder="输入给 Codex / Agent 的内容"
        rows={3}
        value={text}
      />
      {sendError && (
        <div className="mobile-agent-composer-error" role="alert">
          <span>{sendError}</span>
          <button
            disabled={disabled || sending}
            onClick={() => void retry()}
            type="button"
          >
            重试
          </button>
        </div>
      )}
      <div className="mobile-agent-composer-actions">
        <button
          className="mobile-agent-composer-btn mobile-agent-composer-btn--primary"
          disabled={!text || disabled || sending}
          type="submit"
        >
          发送
        </button>
        <button
          className="mobile-agent-composer-btn"
          disabled={!text || disabled || sending}
          onClick={() => void send("paste")}
          type="button"
        >
          粘贴
        </button>
      </div>
    </form>
  );
}
