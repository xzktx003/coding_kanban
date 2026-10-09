import { useComposerToolbarNarrow } from "@session/components/codex/composer/ComposerToolbarContext";
import { Bot, ChevronDown } from "lucide-react";
import { forwardRef } from "react";
import KekeIcon from "@session/assets/keke-agent.svg";
import { useCodexStore } from "@session/components/codex/stores";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { AgentIcon } from "@session/components/common/AgentIcon";
import { ClaudeCode } from "@session/components/icons";
import { Button } from "@session/components/ui/button";
import { useCCStore } from "@session/stores/cc";
import { useAcpStore } from "@session/stores/useAcpStore";
import {
  useAgentCenterStore,
  selectedAgentCard,
} from "@session/stores/useAgentCenterStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";

/**
 * Plain button trigger for `AgentModelPanel`. Deliberately has no popover of
 * its own — the panel owns the popover, so a selector like `ModelSelector`
 * or `ModelReasonSelector` can't be used directly as `trigger` (it renders
 * its own nested `Popover`, which swallows the click before the panel's
 * `PopoverTrigger asChild` ever sees it).
 *
 * Shows the current model/effort so it reads the same as the old
 * agent-specific triggers did, not just which agent is selected.
 */
export const AgentModelTrigger = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button> & { compact?: boolean }
>(function AgentModelTrigger({ compact = false, ...props }, ref) {
  const isNarrow = useComposerToolbarNarrow();
  const preferredAgent = useAgentSettingsStore((s) => s.selectedAgent);
  const card = useAgentCenterStore(selectedAgentCard);
  const selectedAgent = card?.kind ?? preferredAgent;
  const active = useAcpStore((s) => s.active);
  const agentId = useAcpStore((s) => s.agentId);
  const acpModels = useAcpStore((s) => s.models);
  const acpReasoningEffort = useAcpStore((s) => s.reasoningEffort);
  const acpConfigOptions = useAcpStore((s) => s.configOptions);
  const threadId = useCodexStore((s) => s.currentThreadId);
  const { model: codexModel, reasoningEffort: codexReasoningEffort } =
    useThreadModelSettings(threadId);
  const ccOptions = useCCStore((s) => s.options);

  let label: string;
  let effort: string | undefined;
  let icon: React.ReactNode;

  if (active) {
    icon =
      agentId === "keke" ? (
        <img src={KekeIcon} alt="" className="h-4 w-4" />
      ) : agentId === "claude" ? (
        <ClaudeCode size="sm" />
      ) : (
        <Bot className="h-4 w-4" />
      );
    const modelOption = acpConfigOptions.find(
      (option) =>
        option.category === "model" || option.category === "model_config",
    );
    const modelValue = modelOption?.currentValue;
    label =
      acpModels?.availableModels.find(
        (model) => model.modelId === acpModels.currentModelId,
      )?.name ??
      acpModels?.currentModelId ??
      (typeof modelValue === "string"
        ? (modelOption?.options?.find((option) => option.value === modelValue)
            ?.name ?? modelValue)
        : "选择模型");
    const effortOption = acpConfigOptions.find(
      (option) => option.category === "thought_level",
    );
    const selectedEffort = effortOption?.currentValue;
    effort =
      (typeof selectedEffort === "string"
        ? (effortOption?.options?.find(
            (option) => option.value === selectedEffort,
          )?.name ?? selectedEffort)
        : null) ??
      acpReasoningEffort ??
      undefined;
  } else if (selectedAgent === "cc") {
    icon = <AgentIcon agent="cc" />;
    label = ccOptions.model ?? "sonnet";
    effort = ccOptions.effort ?? "medium";
  } else {
    icon = <AgentIcon agent="codex" />;
    label = codexModel || "选择模型";
    effort =
      codexReasoningEffort !== "none"
        ? (codexReasoningEffort ?? undefined)
        : undefined;
  }

  const agentName = active
    ? (agentId ?? "Agent")
    : selectedAgent === "cc"
      ? "Claude"
      : "Codex";
  const compactEffort =
    effort ??
    (!active && selectedAgent === "codex" && codexReasoningEffort === "none"
      ? "none"
      : "默认");
  const effortLabel =
    compactEffort.charAt(0).toUpperCase() + compactEffort.slice(1);
  if (compact)
    return (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size="sm"
        className="session-model-trigger session-model-compact"
        aria-label={`Agent 与模型：${agentName}，${label}，${compactEffort}`}
        title={`${agentName} · ${label} / ${compactEffort}`}
        {...props}
      >
        <span className="session-model-description">
          <span className="session-model-caption">
            <span>{agentName}</span>
            <span aria-hidden="true">·</span>
            <span className="session-model-name">
              {label === "选择模型"
                ? "模型"
                : label
                    .replace(/^gpt-6-/i, "")
                    .replace(/^gpt-/i, "")
                    .replace(/-/g, " ")}
            </span>
          </span>
          <span className="session-model-effort">
            <span aria-hidden="true" className="session-model-effort-divider">
              ·
            </span>
            <span>{effortLabel}</span>
          </span>
        </span>
        <ChevronDown size={13} />
      </Button>
    );
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      className="session-model-trigger h-8 gap-2 px-2 border border-transparent transition-all hover:border-input hover:bg-accent/50"
      aria-label={`Agent 与模型：${active ? agentId : selectedAgent === "cc" ? "Claude" : "Codex"}，${label}${effort ? `，${effort}` : ""}`}
      title={`${label}${effort ? ` / ${effort}` : ""}`}
      {...props}
    >
      {icon}
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
        <span
          className={
            isNarrow
              ? "font-medium max-w-[80px] truncate"
              : "font-medium max-w-[120px] truncate"
          }
        >
          {label}
        </span>
        {effort && !isNarrow && (
          <span className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono capitalize text-muted-foreground border">
            {effort}
          </span>
        )}
      </div>
      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    </Button>
  );
});
