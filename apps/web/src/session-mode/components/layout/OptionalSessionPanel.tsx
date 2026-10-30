import { Component, type ReactNode } from "react";

/** A failed optional module must leave the conversation and composer mounted. */
export class OptionalSessionPanel extends Component<
  {
    children: ReactNode;
    label: string;
    visible?: boolean;
    overlay?: boolean;
    onClose: () => void;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.visible === false) return null;
    return (
      <div
        role="alert"
        className={`session-optional-panel-error${this.props.overlay ? " session-optional-panel-overlay" : ""}`}
      >
        <strong>{this.props.label}暂时无法加载</strong>
        <p>会话与草稿已保留，可继续使用；重新加载页面后可重试此面板。</p>
        <button type="button" onClick={this.props.onClose}>
          关闭此面板
        </button>
      </div>
    );
  }
}
