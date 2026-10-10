import type { ReactNode } from "react";
import { Button } from "@session/components/ui/button";
import { AgentModelPanel } from "@session/components/agent/AgentModelPanel";
import { selectBuiltinInputTarget } from "@session/services/builtinInputNavigation";
import { NativeComposerIcon } from "./NativeComposerIcon";
/** Project adapter: built-in Agent navigation stays direct beside native models. */
export function NativeAgentSettings({ children }: { children: ReactNode }) {
  return (
    <div className="session-native-agent-settings">
      <div
        className="session-native-agent-choices"
        role="group"
        aria-label="切换 Agent"
      >
        <Button
          type="button"
          variant="ghost"
          aria-label="当前 Agent：Codex"
          aria-pressed
          onClick={() => selectBuiltinInputTarget("codex")}
        >
          Codex
          <NativeComposerIcon name="check" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label="切换到 Claude Code"
          onClick={() => selectBuiltinInputTarget("cc")}
        >
          Claude Code
        </Button>
        <AgentModelPanel
          trigger={
            <Button
              type="button"
              variant="ghost"
              aria-label="更多 Agent 与提供商"
            >
              更多 Agent
              <NativeComposerIcon name="chevron" />
            </Button>
          }
        />
      </div>
      <div className="session-native-provider-settings">
        <p>高级提供商配置</p>
        {children}
      </div>
    </div>
  );
}
