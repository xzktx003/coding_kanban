import { MessageSquare } from "lucide-react";

export function SessionWelcome() {
  return (
    <div className="session-welcome">
      <span className="session-welcome-mark">
        <MessageSquare size={19} />
      </span>
      <h1>开始一个会话</h1>
      <p>先选择项目与 Agent，再输入任务。已有会话可从左侧搜索打开。</p>
      <div className="session-welcome-hints">
        <span>理解代码</span>
        <span>实现功能</span>
        <span>审查变更</span>
      </div>
    </div>
  );
}
