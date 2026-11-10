import { Component, type ErrorInfo, type ReactNode } from "react";

export class TranscriptRowBoundary extends Component<
  { threadId: string; rowKey: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[CodexTranscript] Message row failed.", {
      threadId: this.props.threadId,
      rowKey: this.props.rowKey,
      error,
      componentStack: info.componentStack,
    });
  }

  render() {
    return this.state.failed ? (
      <div
        role="status"
        data-transcript-row-error={this.props.rowKey}
        className="rounded-md px-3 py-2 text-xs text-muted-foreground"
      >
        <span>此消息暂时无法显示，其余消息仍可继续查看。</span>
        <button
          type="button"
          className="ml-2 text-primary underline underline-offset-2"
          onClick={() => this.setState({ failed: false })}
        >
          重试此消息
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
