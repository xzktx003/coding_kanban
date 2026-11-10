import {
  Component,
  lazy,
  Suspense,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useFollowups } from "@session/hooks/useFollowups";

const Contents = lazy(() =>
  import("./FollowupQueue").then((module) => ({
    default: module.FollowupQueueContent,
  })),
);
type Props = ComponentProps<typeof import("./FollowupQueue")["FollowupQueueContent"]>;

class QueueBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
    failedFallback: ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="session-followup-queue-recovery flex min-w-0 flex-col items-start gap-2">
        <p role="alert">完整队列面板暂时无法加载，待发内容仍已保留。</p>
        <button
          type="button"
          className="session-followup-queue-retry"
          onClick={() => window.location.reload()}
        >
          刷新页面并重试队列
        </button>
        {this.props.failedFallback}
      </div>
    );
  }
}

/** State remains live while optional rich previews and reorder controls load. */
export function DeferredFollowupQueueContent(props: Props) {
  const snapshot = useFollowups(props.threadId);
  const pending = snapshot.state.items.filter(
    (message) => message.status !== "sent" && message.status !== "cancelled",
  );
  const status = snapshot.error
    ? "队列同步失败，正在保留原状态"
    : `待发消息 ${pending.length} 条${snapshot.state.paused ? " · 已暂停" : ""}`;
  const pendingPreview = pending
    .slice(0, 2)
    .map((message) => (
      <p key={message.id}>{message.text.slice(0, 160) || "含附件的消息"}</p>
    ));
  const renderSnapshot = (message: string) => (
    <div className="session-followup-queue p-2 text-xs" role="status">
      <strong>{status}</strong>
      <p>{message}</p>
      {pendingPreview}
    </div>
  );
  const fallback = renderSnapshot("正在加载队列操作…");
  const failedFallback = renderSnapshot("队列操作面板暂不可用；队列内容未更改。");
  return (
    <QueueBoundary fallback={fallback} failedFallback={failedFallback}>
      <Suspense fallback={fallback}>
        <Contents {...props} />
      </Suspense>
    </QueueBoundary>
  );
}
