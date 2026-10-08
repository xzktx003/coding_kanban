import { Bot } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import KekeIcon from "@session/assets/keke-agent.svg";
import { AcpModelMenu } from "@session/components/acp/AcpModelMenu";
import { useAcpAgents } from "@session/components/acp/useAcpAgents";
import { ModelSelector as CCModelSelector } from "@session/components/cc/composer/ModelSelector";
import { ModelReasonSelector } from "@session/components/codex/composer/ModelReasonSelector";
import { AgentIcon } from "@session/components/common/AgentIcon";
import { ClaudeCode, Codex } from "@session/components/icons";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@session/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@session/components/ui/popover";
import { acpStop } from "@session/services/apiAdapt/acp";
import { useLayoutStore } from "@session/stores";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useSessionActionConfirmation } from "../common/useSessionActionConfirmation";
import { toast } from "@session/components/ui/use-toast";

type AgentModelPanelProps = { trigger: ReactNode };

export function AgentModelPanel({ trigger }: AgentModelPanelProps) {
  const selectedAgent = useAgentSettingsStore((s) => s.selectedAgent);
  const active = useAcpStore((s) => s.active);
  const { agentId, connectionId, setActive, setAgentId, reset } = useAcpStore();
  const { setSelectedAgent } = useAgentSettingsStore();
  const { setActiveSidebarTab } = useLayoutStore();
  const agents = useAcpAgents() ?? [];
  const [open, setOpen] = useState(false);
  const { ask, confirmation } = useSessionActionConfirmation();

  const selectBuiltin = (id: "codex" | "cc") => {
    setSelectedAgent(id);
    setActiveSidebarTab(id);
    setActive(false);
  };

  const selectAcp = async (id: string) => {
    if (active && agentId === id) return;
    if (connectionId && agentId !== id) {
      const originalSession = useAcpStore.getState().sessionId;
      const accepted = await ask({
        title: "切换 Agent？",
        description:
          "切换会关闭当前 Agent 服务，并中断仍在执行的任务。当前会话记录会保留。",
        confirmLabel: "关闭服务并切换",
      });
      if (
        !accepted ||
        useAcpStore.getState().connectionId !== connectionId ||
        useAcpStore.getState().agentId !== agentId ||
        useAcpStore.getState().sessionId !== originalSession
      )
        return;
      try {
        await acpStop(connectionId);
      } catch (error) {
        toast({
          title: "无法切换 Agent",
          description: String(error),
          variant: "destructive",
        });
        return;
      }
      if (useAcpStore.getState().connectionId !== connectionId) return;
      reset();
    }
    setAgentId(id);
    setActive(true);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="end"
          collisionPadding={16}
          className="session-agent-model-panel w-[min(26rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-0"
        >
          <div className="px-3 py-2 border-b text-sm font-medium">
            Agent 与模型
          </div>
          <div className="grid max-h-[min(70vh,640px)] min-h-0 grid-cols-[104px_minmax(0,1fr)]">
            <section className="border-r">
              <Command>
                <CommandList className="max-h-[min(70vh,640px)]">
                  <CommandGroup className="p-1">
                    <CommandItem
                      value="Codex"
                      onSelect={() => selectBuiltin("codex")}
                      aria-label="Codex"
                      data-agent-active={!active && selectedAgent === "codex"}
                    >
                      {active ? (
                        <Codex size="sm" />
                      ) : (
                        <AgentIcon agent="codex" />
                      )}
                      <span>Codex</span>
                    </CommandItem>
                    <CommandItem
                      value="Claude Code"
                      onSelect={() => selectBuiltin("cc")}
                      aria-label="Claude Code"
                      data-agent-active={!active && selectedAgent === "cc"}
                    >
                      {active ? (
                        <ClaudeCode size="sm" />
                      ) : (
                        <AgentIcon agent="cc" />
                      )}
                      <span>Claude</span>
                    </CommandItem>
                  </CommandGroup>
                  <CommandGroup className="p-1">
                    {agents.map((agent) => (
                      <CommandItem
                        key={agent.id}
                        value={agent.name}
                        onSelect={() => void selectAcp(agent.id)}
                        aria-label={agent.name}
                        data-agent-active={active && agentId === agent.id}
                      >
                        {agent.id === "keke" ? (
                          <img src={KekeIcon} alt="" className="h-4 w-4" />
                        ) : agent.id === "claude" ? (
                          <ClaudeCode size="sm" />
                        ) : (
                          <Bot className="h-4 w-4" />
                        )}
                        <span className="truncate">{agent.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </section>
            <section className="min-h-0 min-w-0 overflow-y-auto p-2">
              {active ? (
                <AcpModelMenu embedded />
              ) : selectedAgent === "cc" ? (
                <CCModelSelector embedded />
              ) : (
                <ModelReasonSelector mode="panel" />
              )}
            </section>
          </div>
        </PopoverContent>
      </Popover>
      {confirmation}
    </>
  );
}
