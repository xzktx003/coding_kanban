import { forwardRef } from "react";
import { useCodexStore } from "@session/components/codex/stores";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { Button } from "@session/components/ui/button";
import { NativeComposerIcon } from "./NativeComposerIcon";
import { ComposerTooltip } from "./ComposerTooltip";
import { ComposerFooterLabel } from "./ComposerToolbarContext";
import { useModels } from "../hooks/useModels";
import { useOrdinaryNativePickerModels } from "./ordinaryNativePickerModels";
import { nativeReasoningLabel } from "./nativeReasoningLabel";
import { canonicalNativeModel } from "./nativeModelIdentity";
import {
  NATIVE_UNKNOWN_REASONING_OPTIONS,
  nativeDisplayReasoningEffort,
  nativeReasoningOptions,
} from "./nativeReasoningOptions";

type NativeModelTriggerProps = React.ComponentProps<typeof Button> & {
  pickerOpen?: boolean;
  pickerSimple?: boolean;
  pickerOpenLabel?: string;
  completionTooltipHeld?: boolean;
  minimumContentWidth?: number;
  preferredContentWidth?: number;
};

/** Closed/advanced keep raw identity; ordinary simple-open exposes its purpose. */
export const NativeModelTrigger = forwardRef<
  HTMLButtonElement,
  NativeModelTriggerProps
>(function NativeModelTrigger(
  {
    pickerOpen = false,
    pickerSimple = false,
    pickerOpenLabel,
    completionTooltipHeld = false,
    minimumContentWidth,
    preferredContentWidth,
    ...props
  },
  ref,
) {
  const threadId = useCodexStore((s) => s.currentThreadId);
  const { model, modelProvider, reasoningEffort } =
    useThreadModelSettings(threadId);
  const { providerItems, openAiModels, modelStatus } = useModels();
  const pickerModels = useOrdinaryNativePickerModels(
    openAiModels,
    modelProvider === "openai",
  );
  const catalog =
    modelProvider === "openai"
      ? canonicalNativeModel(pickerModels, model)
      : undefined;
  const isUnknownOpenAiModel =
    modelProvider === "openai" &&
    Boolean(model) &&
    !catalog &&
    (modelStatus === "success" || modelStatus === "error");
  const modelPending =
    modelProvider === "openai" && Boolean(model) && modelStatus === "pending";
  const options = catalog
    ? nativeReasoningOptions(catalog)
    : isUnknownOpenAiModel
      ? NATIVE_UNKNOWN_REASONING_OPTIONS
      : null;
  const displayedEffort =
    options &&
    (reasoningEffort ||
      isUnknownOpenAiModel ||
      (threadId !== null && reasoningEffort === null))
      ? nativeDisplayReasoningEffort(reasoningEffort, options)
      : reasoningEffort;
  const label =
    (modelProvider === "openai"
      ? catalog?.displayName || catalog?.model
      : providerItems(modelProvider).find((item) => item.id === model)
          ?.label) ??
    model ??
    "选择模型";
  const effort = displayedEffort || "默认";
  const enhancedTrigger =
    pickerOpenLabel !== undefined &&
    modelProvider === "openai" &&
    !modelPending &&
    modelStatus !== "error";
  const showPurpose = enhancedTrigger && pickerOpen && pickerSimple;
  const triggerProps: React.ComponentProps<typeof Button> = {
    "aria-label": modelPending
      ? "Loading model…"
      : `模型：${model || "选择模型"}，${effort}`,
    ...props,
  };
  if (showPurpose) {
    triggerProps["aria-label"] = undefined;
    triggerProps["aria-labelledby"] = undefined;
  }
  /*
   * Official nests the two labels at different tiers: the effort text is a
   * `collapse: "sm"` label inside the model trigger's selected value, and the
   * model name around it is `collapse: "none"`
   * (`app-initial-fee819fe4f22.js` @5298263). So a narrowing footer drops the
   * effort first and keeps the model name at every width — the reader can
   * always see which model is about to answer. Both keep their text in the
   * button's `aria-label` regardless.
   */
  const selection = (
    <>
      <ComposerFooterLabel
        collapse="none"
        className="session-native-model-label session-model-name"
      >
        {modelPending
          ? "Loading model…"
          : isUnknownOpenAiModel
            ? "自定义"
            : label}
      </ComposerFooterLabel>
      {!modelPending && (
        <ComposerFooterLabel
          collapse="sm"
          className="session-native-model-effort session-model-effort"
        >
          {nativeReasoningLabel(displayedEffort)}
        </ComposerFooterLabel>
      )}
    </>
  );
  return (
    <ComposerTooltip
      label={enhancedTrigger ? pickerOpenLabel : `${label} · ${effort}`}
      popupOpen={enhancedTrigger && (pickerOpen || completionTooltipHeld)}
    >
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size="sm"
        className="session-model-trigger session-native-model-trigger"
        {...triggerProps}
        disabled={modelPending || props.disabled}
        aria-busy={modelPending || undefined}
      >
        {enhancedTrigger ? (
          <span
            className="session-native-model-trigger-content"
            style={
              pickerOpen && preferredContentWidth !== undefined
                ? { width: preferredContentWidth }
                : pickerOpen && minimumContentWidth !== undefined
                  ? { minWidth: minimumContentWidth }
                  : undefined
            }
          >
            <span
              className="session-native-model-trigger-measurement"
              aria-hidden="true"
            >
              {pickerOpenLabel}
            </span>
            {showPurpose ? (
              <span className="session-native-model-trigger-placeholder">
                {pickerOpenLabel}
              </span>
            ) : (
              selection
            )}
          </span>
        ) : (
          selection
        )}
        <NativeComposerIcon name="chevron" />
      </Button>
    </ComposerTooltip>
  );
});
