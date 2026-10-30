import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from "react";
import { useFollowups } from "@session/hooks/useFollowups";

const Contents = lazy(() => import("./FollowupQueue").then(module => ({ default: module.FollowupQueueContent })));
type Props = ComponentProps<typeof import("./FollowupQueue")["FollowupQueueContent"]>;
class QueueBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <><p role="alert">完整队列暂时无法加载；待发内容仍保留，重新加载页面后可重试面板。</p>{this.props.fallback}</> : this.props.children; }
}
/** State remains live while optional rich previews and reorder controls load. */
export function DeferredFollowupQueueContent(props: Props) {
  const snapshot = useFollowups(props.threadId);
  const pending = snapshot.state.items.filter(message => message.status !== "sent" && message.status !== "cancelled");
  const fallback = <div className="session-followup-queue p-2 text-xs" role="status"><strong>{snapshot.error ? "队列同步失败，正在保留原状态" : `待发消息 ${pending.length} 条${snapshot.state.paused ? " · 已暂停" : ""}`}</strong><p>正在加载队列操作…</p>{pending.slice(0, 2).map(message => <p key={message.id}>{message.text.slice(0, 160) || "含附件的消息"}</p>)}</div>;
  return <QueueBoundary fallback={fallback}><Suspense fallback={fallback}><Contents {...props} /></Suspense></QueueBoundary>;
}
