import type { ReactNode } from "react";
/** Codex composer settings stay on Codex models. Claude is a separate session. */
export function NativeAgentSettings({ children }: { children: ReactNode }) {
  return (
    <div className="session-native-agent-settings">
      <div className="session-native-provider-settings">
        <p>高级提供商配置</p>
        {children}
      </div>
    </div>
  );
}
