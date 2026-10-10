import { forwardRef } from "react";
import { useCodexStore } from "@session/components/codex/stores";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { Button } from "@session/components/ui/button";
import { NativeComposerIcon } from "./NativeComposerIcon";
import { ComposerTooltip } from "./ComposerTooltip";
import { useModels } from "../hooks/useModels";
import { nativeReasoningLabel } from "./nativeReasoningLabel";

/** Catalog label, with the full raw model identity retained for accessibility. */
export const NativeModelTrigger = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(function NativeModelTrigger(props, ref) {
  const threadId = useCodexStore((s) => s.currentThreadId);
  const { model, modelProvider, reasoningEffort } =
    useThreadModelSettings(threadId);
  const { providerItems } = useModels();
  const label =
    providerItems(modelProvider).find((item) => item.id === model)?.label ??
    model ??
    "选择模型";
  const effort = reasoningEffort || "默认";
  return (
    <ComposerTooltip label={`${label} · ${effort}`}>
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size="sm"
        className="session-model-trigger session-native-model-trigger"
        aria-label={`Agent 与模型：Codex，${model || "选择模型"}，${effort}`}
        title={`${label} · ${effort}`}
        {...props}
      >
        <span className="session-native-model-label">{label}</span>
        <span className="session-native-model-effort">
          {nativeReasoningLabel(reasoningEffort)}
        </span>
        <NativeComposerIcon name="chevron" />
      </Button>
    </ComposerTooltip>
  );
});
