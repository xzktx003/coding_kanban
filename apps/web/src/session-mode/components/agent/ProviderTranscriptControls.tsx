import { Button } from "../ui/button";
import { useProviderTranscriptStore } from "../../services/sessionProviderTranscriptState";

export function ProviderTranscriptControls({
  owner,
  onEarlier,
  onRetry,
}: {
  owner: string | null;
  onEarlier(): Promise<void>;
  onRetry(): Promise<void>;
}) {
  const state = useProviderTranscriptStore((value) =>
    owner ? value.entries[owner] : undefined,
  );
  if (!state) return null;
  return (
    <div
      className="shrink-0 px-3 py-2 space-y-1 text-xs text-muted-foreground"
      data-provider-history-controls
    >
      {state.error && (
        <div role="alert" className="flex items-center justify-between gap-3">
          <span>{state.error}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={state.loading}
            onClick={() => void onRetry().catch(() => {})}
          >
            重试读取
          </Button>
        </div>
      )}
      {state.loading && <div role="status">正在加载近期消息…</div>}
      {state.truncated && <div>当前为有界历史窗口，完整内容可按需查看。</div>}
      <div className="flex items-center justify-center gap-2">
        {state.nextCursor && (
          <Button
            size="sm"
            variant="ghost"
            disabled={state.loading}
            onClick={() => void onEarlier().catch(() => {})}
          >
            加载更早消息
          </Button>
        )}
        {state.truncated && !state.loading && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void onRetry().catch(() => {})}
          >
            读取最新消息
          </Button>
        )}
      </div>
    </div>
  );
}
