import { useEffect, useRef, useState } from "react";
import { openMcpDetail } from "@session/components/codex/items/commandDetail";
import { sourcePreview } from "./sourcePreview";
import type { SourceCall } from "./sourceCatalogue";

export function SourceMcpPreview({ call }: { call: SourceCall }) {
  const preview = useRef<{ input: string; output: string } | null>(null);
  const [phase, setPhase] = useState("loading");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    preview.current = null;
    setPhase("loading");
    let release = () => {};
    // StrictMode replays effects before an explicit preview is committed. Wait
    // until that replay has settled instead of aborting a native reader and
    // immediately trying to acquire its still-draining slot again.
    queueMicrotask(() => {
      if (!active) return;
      release = openMcpDetail(
        {
          threadId: call.threadId,
          turnId: call.turnId,
          itemId: call.itemId,
          expectedType: "mcpToolCall",
        },
        {
          success: (item) => {
            if (!active) return;
            // Do not keep the full native item in React state or a completed cache.
            preview.current = {
              input: sourcePreview(item.arguments),
              output: sourcePreview(item.error ?? item.result),
            };
            setPhase("ready");
          },
          failure: () => {
            if (active) setPhase("failed");
          },
          invalidate: () => {
            preview.current = null;
            if (active) setPhase("invalidated");
          },
        },
      );
    });
    return () => {
      active = false;
      preview.current = null;
      release();
    };
  }, [call.threadId, call.turnId, call.itemId, attempt]);
  if (phase === "loading") return <p role="status">正在加载调用详情…</p>;
  if (phase !== "ready" || !preview.current)
    return (
      <div role="status">
        <p>
          {phase === "invalidated"
            ? "连接或账号已变化，请关闭后从当前会话重新打开来源。"
            : "暂时无法读取调用详情。"}
        </p>
        {phase !== "invalidated" && (
          <button type="button" onClick={() => retry((n) => n + 1)}>
            重试
          </button>
        )}
      </div>
    );
  return (
    <div className="codex-source-preview">
      <p>输入</p>
      <pre>{preview.current.input}</pre>
      <p>结果</p>
      <pre>{preview.current.output}</pre>
      <small>长内容仅显示有界预览。</small>
    </div>
  );
}
