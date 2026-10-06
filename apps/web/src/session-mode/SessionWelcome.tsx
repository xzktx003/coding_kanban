import { Sparkles } from "lucide-react";

export function SessionWelcome() {
  return (
    <div className="session-welcome">
      <span className="session-welcome-mark">
        <Sparkles size={19} />
      </span>
      <h1>从一个想法，推进到结果</h1>
      <p>选择项目和 Agent，开始对话。工具、文件与变更会跟随当前会话。</p>
      <div className="session-welcome-hints">
        <span>理解代码</span>
        <span>实现功能</span>
        <span>审查变更</span>
      </div>
    </div>
  );
}
