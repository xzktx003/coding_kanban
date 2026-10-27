import { commitModelSelectionWithNotice } from "./ModelChangeNotice";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Search } from "lucide-react";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { useCodexStore } from "@session/components/codex/stores";
import {
  isAgentInteractionVisible,
  sessionPortalContainer,
} from "@session/session-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import { useModels } from "../hooks/useModels";
import { useOrdinaryNativePickerModels } from "./ordinaryNativePickerModels";
import { NativeModelTrigger } from "./NativeModelTrigger";
import { useNativeModelPickerPreferencesStore } from "@session/stores/settings/useNativeModelPickerPreferencesStore";
import { nativeDefaultModelChoice } from "./nativeBuiltinModelPresets";
import { deriveNativePickerPresentation } from "./nativePickerPresentation";
import { nativePickerModelPowerChoices } from "./nativePickerModelPowerChoices";
import {
  canonicalNativeItems,
  canonicalNativeModel,
  nextEffortForNativeRecord,
} from "./nativeModelIdentity";
import { NativeComposerIcon } from "./NativeComposerIcon";
import { ComposerTooltip } from "./ComposerTooltip";
import {
  GENERIC_REASONING_OPTIONS,
  nextReasoningEffort,
} from "./ReasoningEffortSelector";
import { nativeReasoningLabel } from "./nativeReasoningLabel";
import { nextOrdinaryPowerWheel } from "./nativePowerWheel";
import {
  NATIVE_UNKNOWN_REASONING_OPTIONS,
  nativeDisplayReasoningEffort,
  nativeMenuReasoningEffort,
  nativeReasoningOptions,
} from "./nativeReasoningOptions";
import { NativeServiceTierControl } from "./NativeServiceTierControl";
import { recentModelConfigs, rememberRecentModel } from "./recentModelConfigs";

// Native impl-517ea8aeeec5 dt(percent): 28px thumb / 2 minus 1px.
const POWER_ENDPOINT_INSET = 13;
const POWER_TRACK_WIDTH = 200;
const POWER_TRAVEL = POWER_TRACK_WIDTH - POWER_ENDPOINT_INSET * 2;
const COMPOSER_SCOPE =
  ".session-codex-composer, .session-composer-sheet.is-full";
const COMPOSER_EDITOR =
  ".session-native-editor-slot [contenteditable=true], .session-rich-draft textarea";
type ComposerFocusTarget = {
  scope: HTMLElement;
  editor: HTMLElement;
  owner: string;
  scopeOwner: string | undefined;
  threadId: string | null;
  sessionRoot: HTMLElement | null;
};
type PowerWheelCommit = {
  identity: object;
  layer: object | null;
  target: ComposerFocusTarget | null;
  threadId: string | null;
  draftOwner: string | undefined;
  enabled: boolean;
  index: number;
  count: number;
  select: (index: number) => void;
};
type PowerWheelLease = {
  node: HTMLDivElement;
  content: HTMLDivElement;
  root: HTMLElement;
  target: ComposerFocusTarget;
  identity: object;
  layer: object;
  listener: (event: WheelEvent) => void;
};

function isVisibleComposerEditor(editor: HTMLElement) {
  if (!editor.isConnected || editor.closest("[hidden], [inert]")) return false;
  const style = editor.ownerDocument.defaultView?.getComputedStyle(editor);
  return (
    style?.display !== "none" &&
    style?.visibility !== "hidden" &&
    style?.visibility !== "collapse" &&
    editor.getClientRects().length > 0
  );
}

/** Native hCa/lCa/uca simple power view and advanced model radio list. */
export function NativeModelSelector({
  threadId,
  draftOwner,
}: {
  threadId: string | null;
  draftOwner?: string;
}) {
  const settings = useThreadModelSettings(threadId);
  const { openAiModels, providerItems, loading, error, reload, modelStatus, hasModelSnapshot } =
    useModels();
  const [open, setOpen] = useState(false);
  const [completionTooltipHeld, setCompletionTooltipHeld] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentTick, setRecentTick] = useState(0);
  const [triggerContentWidth, setTriggerContentWidth] = useState<
    { value: number; shrinkable: boolean } | undefined
  >(undefined);
  const recent = recentOpen && recentTick >= 0 ? recentModelConfigs() : [];
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const skipCompletionTriggerBlur = useRef(false);
  const powerSliderRef = useRef<HTMLDivElement | null>(null);
  const [powerSliderNode, setPowerSliderNode] = useState<HTMLDivElement | null>(null);
  const powerWheelCommit = useRef<PowerWheelCommit | null>(null);
  const powerWheelLease = useRef<PowerWheelLease | null>(null);
  const releasePowerWheel = useCallback(() => {
    const lease = powerWheelLease.current;
    powerWheelLease.current = null;
    lease?.node.removeEventListener("wheel", lease.listener);
  }, []);
  const capturePowerSlider = useCallback((node: HTMLDivElement | null) => {
    powerSliderRef.current = node;
    if (powerWheelLease.current?.node !== node) releasePowerWheel();
    // A portal can hide/show internally without rerendering this component.
    // Ref detachment releases immediately; attachment requests a committed pass.
    setPowerSliderNode(node);
  }, [releasePowerWheel]);
  const openedComposer = useRef<ComposerFocusTarget | null>(null);
  const returnComposer = useRef<ComposerFocusTarget | null>(null);
  const openedLayer = useRef<{ modal: boolean } | null>(null);
  const openedInWorkbench = useRef(false);
  const layerIdentity = openedLayer.current;
  const suppressCloseFocus = useRef(false);
  const keyboardViewFocus = useRef(false);
  const viewPointerType = useRef<string | null>(null);
  const viewReset = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const scopeIdentity = useMemo(() => ({}), [threadId, draftOwner, settings.modelProvider]);
  const currentScope = useRef({
    threadId,
    draftOwner,
    open,
    identity: scopeIdentity,
  });
  currentScope.current = {
    threadId,
    draftOwner,
    open,
    identity: scopeIdentity,
  };
  const powerStatusId = useId();
  useLayoutEffect(() => {
    skipCompletionTriggerBlur.current = false;
    setCompletionTooltipHeld(false);
    openedComposer.current = null;
    setOpen(false);
    setAdvanced(false);
    return () => {
      clearTimeout(viewReset.current);
      viewReset.current = undefined;
      openedComposer.current = null;
      returnComposer.current = null;
      openedLayer.current = null;
      skipCompletionTriggerBlur.current = false;
      keyboardViewFocus.current = false;
      viewPointerType.current = null;
      suppressCloseFocus.current = true;
    };
  }, [scopeIdentity]);
  function isCurrentComposer(target: ComposerFocusTarget) {
    const current = currentScope.current;
    return (
      isAgentInteractionVisible() &&
      current.threadId === target.threadId &&
      useCodexStore.getState().currentThreadId === target.threadId &&
      (current.draftOwner ?? target.scope.dataset.draftOwner) ===
        target.owner &&
      target.scope.dataset.draftOwner === target.scopeOwner &&
      triggerRef.current?.closest(COMPOSER_SCOPE) === target.scope &&
      target.scope.contains(target.editor) &&
      isVisibleComposerEditor(target.editor)
    );
  }
  // A real workbench action keeps the root and layer captured at opening.
  // Bare primitives retain their prior local row/Power adapter.
  function isCurrentNativePickerTarget(target: ComposerFocusTarget | null) {
    const root = target?.sessionRoot;
    return Boolean(
      target && root && root.isConnected &&
      currentScope.current.identity === scopeIdentity &&
      openedLayer.current &&
      sessionPortalContainer(target.editor.ownerDocument) === root &&
      target.scope.closest(".session-mode") === root &&
      !target.scope.closest("[hidden], [inert]") &&
      isCurrentComposer(target),
    );
  }
  function isCurrentNativeAction(allowStandalone = true) {
    const root = sessionPortalContainer(triggerRef.current?.ownerDocument);
    if (!root) return allowStandalone && !openedInWorkbench.current;
    const target = openedComposer.current;
    const content = contentRef.current;
    return Boolean(
      currentScope.current.open &&
      openedLayer.current === layerIdentity &&
      target?.sessionRoot === root &&
      isCurrentNativePickerTarget(target) &&
      content?.isConnected &&
      content.closest(".session-mode") === root &&
      !content.closest('[hidden], [inert], [aria-hidden="true"]') &&
      isVisibleComposerEditor(content),
    );
  }
  function handleCompletionTriggerBlur() {
    if (currentScope.current.identity !== scopeIdentity) return;
    if (skipCompletionTriggerBlur.current) {
      skipCompletionTriggerBlur.current = false;
      return;
    }
    setCompletionTooltipHeld(false);
  }
  function handleCompletionTriggerPointerLeave() {
    if (currentScope.current.identity !== scopeIdentity) return;
    skipCompletionTriggerBlur.current = false;
    setCompletionTooltipHeld(false);
  }
  const isNativeModelProvider = settings.modelProvider === "openai";
  const savedSelectionMode = useNativeModelPickerPreferencesStore((state) =>
    isNativeModelProvider ? state.selectionMode : null,
  );
  const pickerModels = useOrdinaryNativePickerModels(openAiModels, isNativeModelProvider);
  const model = isNativeModelProvider
    ? canonicalNativeModel(pickerModels, settings.model)
    : openAiModels.find(
        (m) => m.id === settings.model || m.model === settings.model,
      );
  const nativeItems = useMemo(
    () => isNativeModelProvider ? canonicalNativeItems(pickerModels) : null,
    [isNativeModelProvider, pickerModels],
  );
  const items = nativeItems ?? providerItems(settings.modelProvider);
  const catalogOptions =
    settings.modelProvider === "openai"
      ? nativeReasoningOptions(model)
      : GENERIC_REASONING_OPTIONS;
  const isUnknownOpenAiModel =
    settings.modelProvider === "openai" &&
    Boolean(settings.model) &&
    !model &&
    (modelStatus === "success" || modelStatus === "error");
  const modelPending =
    settings.modelProvider === "openai" &&
    Boolean(settings.model) &&
    modelStatus === "pending";
  const modelSelectionDisabled =
    settings.modelProvider === "openai" && modelStatus === "error";
  const options =
    settings.modelProvider === "openai" && model
      ? catalogOptions
      : isUnknownOpenAiModel
        ? hasModelSnapshot
          ? NATIVE_UNKNOWN_REASONING_OPTIONS
          : []
        : GENERIC_REASONING_OPTIONS;
  // Existing ordinary native threads use the current canonical model's power
  // projection. New drafts retain their separate catalog-default initialization.
  const menuModel =
    threadId !== null &&
    settings.modelProvider === "openai" &&
    model?.model === settings.model
      ? model
      : undefined;
  const configuredEffort =
    settings.reasoningEffort ?? model?.defaultReasoningEffort;
  const currentModelEffort = menuModel
    ? nativeMenuReasoningEffort(settings.reasoningEffort, menuModel, pickerModels)
    : settings.modelProvider === "openai" && (model || isUnknownOpenAiModel)
      ? nativeDisplayReasoningEffort(
          configuredEffort,
          isUnknownOpenAiModel ? NATIVE_UNKNOWN_REASONING_OPTIONS : options,
        )
      : configuredEffort;
  // bt is the current model's raw-to-display value. It is independent of the
  // selected physical pair and its TX fallback in either presentation mode.
  const nativeDisplayEffort = nativeDisplayReasoningEffort(
    settings.reasoningEffort,
    options,
  );
  const pickerPresentation = useMemo(
    () => isNativeModelProvider
      ? deriveNativePickerPresentation({
          models: pickerModels,
          presetModels: pickerModels,
          current: {
            model: settings.model,
            displayReasoningEffort: nativeDisplayEffort,
          },
          savedSelectionMode,
        })
      : null,
    [isNativeModelProvider, pickerModels, settings.model, nativeDisplayEffort, savedSelectionMode],
  );
  const modelPowerChoices = useMemo(
    () => isNativeModelProvider && model
      ? nativePickerModelPowerChoices(pickerModels, settings.model)
      : null,
    [isNativeModelProvider, model, pickerModels, settings.model],
  );
  const effectiveSelectionMode = pickerPresentation?.effectiveSelectionMode ?? "model";
  const physicalPowerChoices = modelPowerChoices === null
    ? null
    : effectiveSelectionMode === "default" && pickerPresentation
      ? pickerPresentation.presets
      : modelPowerChoices;
  const preferredModel = pickerPresentation?.preferredModel;
  const preferredPowerId = preferredModel
    ? `${preferredModel.model}:${preferredModel.defaultReasoningEffort}`
    : undefined;
  const selectedPhysicalPower = physicalPowerChoices?.find((choice) =>
    choice.model === settings.model && choice.reasoningEffort === nativeDisplayEffort,
  ) ?? (physicalPowerChoices
    ? nativeDefaultModelChoice(physicalPowerChoices, preferredPowerId)
    : undefined);
  const powerOptions = physicalPowerChoices?.map((choice) => choice.reasoningEffort) ?? options;
  const effort = selectedPhysicalPower?.reasoningEffort ?? currentModelEffort;
  const position = physicalPowerChoices && selectedPhysicalPower
    ? physicalPowerChoices.indexOf(selectedPhysicalPower)
    : Math.max(0, options.indexOf(effort!));
  const canAdjust = powerOptions.length > 1;
  const showAdvanced = advanced || !canAdjust;
  // E8 is only the ordinary local display path. Auxiliary read state does not
  // turn an accepted primary catalog into the native legacy/error surface.
  const enhancedTrigger =
    isNativeModelProvider && !modelPending && !modelSelectionDisabled;
  const triggerOpenLabel =
    effectiveSelectionMode === "model" ? "选择强度" : "选择模型";
  useLayoutEffect(() => {
    if (!open || !enhancedTrigger) setTriggerContentWidth(undefined);
  }, [open, enhancedTrigger]);
  useEffect(() => {
    if (!open) return;
    const focusKeyboardView = keyboardViewFocus.current;
    keyboardViewFocus.current = false;
    const pointerType = viewPointerType.current;
    viewPointerType.current = null;
    const captured = openedComposer.current;
    const frame = requestAnimationFrame(() => {
      if (
        currentScope.current.identity !== scopeIdentity ||
        !currentScope.current.open
      )
        return;
      if (focusKeyboardView) {
        if (
          !isAgentInteractionVisible() ||
          (captured && !isCurrentComposer(captured))
        )
          return;
        const checked = showAdvanced
          ? contentRef.current?.querySelector<HTMLElement>(
              '[role="menuitemradio"][aria-checked="true"]:not([data-disabled]):not([aria-disabled="true"])',
            )
          : null;
        const first = contentRef.current?.querySelector<HTMLElement>(
          '[role^="menuitem"]:not([data-disabled]):not([aria-disabled="true"]):not([data-interactive="false"])',
        );
        (checked ?? first)?.focus({ preventScroll: !showAdvanced });
      } else if (pointerType !== "touch") {
        // Native touch view changes let the outgoing item lose focus naturally.
        // Do not add a later focus move after that gesture. Initial opens and
        // mouse navigation retain the container; keyboard changes target rows.
        contentRef.current?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, showAdvanced, scopeIdentity]);
  const label =
    items.find((m) => m.id === settings.model)?.label ??
    settings.model ??
    "自定义模型";
  const powerModelLabel = selectedPhysicalPower?.modelLabel ?? label;
  const statusModelLabel = isUnknownOpenAiModel ? "自定义" : powerModelLabel;
  const statusEffortLabel =
    settings.modelProvider === "openai" && effort === "medium"
      ? "标准"
      : settings.modelProvider === "openai" && effort === "high"
        ? "深度"
        : nativeReasoningLabel(effort);
  const choose = (id: string) => {
    if (modelPending || modelSelectionDisabled) return;
    if (isNativeModelProvider && !isCurrentNativeAction()) return;
    const nativeTargetModel = isNativeModelProvider
      ? canonicalNativeModel(pickerModels, id)
      : undefined;
    const isCurrentNativeModel =
      isNativeModelProvider && id === settings.model;
    // Native hCa passes its display fallback (bt) to a different model row;
    // the menu's TX power fallback is a separate selection. The record helper
    // returns undefined to preserve its input, so materialize bt when raw differs.
    const inheritedNativeEffort = nativeDisplayReasoningEffort(
      settings.reasoningEffort,
      options,
    );
    const next = isNativeModelProvider
      ? isCurrentNativeModel
        ? undefined
        : nextEffortForNativeRecord(nativeTargetModel, inheritedNativeEffort) ??
          (nativeTargetModel && inheritedNativeEffort !== settings.reasoningEffort
            ? inheritedNativeEffort
            : undefined)
      : nextReasoningEffort(
          settings.modelProvider,
          id,
          settings.reasoningEffort ?? undefined,
          openAiModels,
        );
    const finalNativeEffort = next || settings.reasoningEffort;
    const jointNativeSelection =
      nativeTargetModel &&
      !isCurrentNativeModel &&
      typeof finalNativeEffort === "string"
        ? {
            model: id,
            reasoningEffort: finalNativeEffort,
            ...(settings.serviceTier &&
            !nativeTargetModel.serviceTiers?.some(
              (tier) => tier.id === settings.serviceTier,
            )
              ? { serviceTier: null }
              : {}),
          }
        : null;
    if (jointNativeSelection) {
      settings.setModelSelection(jointNativeSelection);
    } else {
      if (id !== settings.model) {
        settings.setModel(id);
      }
      if (next) settings.setReasoningEffort(next);
    }
    setAdvanced(false);
    setRecentTick((tick) => tick + 1);
    rememberRecentModel({
      model: id,
      label: items.find((item) => item.id === id)?.label ?? id,
      reasoningEffort: next ?? settings.reasoningEffort,
      serviceTier: settings.serviceTier ?? null,
    });
    const nextModel = isNativeModelProvider
      ? nativeTargetModel
      : openAiModels.find(
          (model) => model.id === id || model.model === id,
        );
    if (
      !jointNativeSelection &&
      !isCurrentNativeModel &&
      settings.serviceTier &&
      !nextModel?.serviceTiers?.some((tier) => tier.id === settings.serviceTier)
    )
      settings.setServiceTier(null);
    if (isNativeModelProvider && isCurrentNativeAction(false))
      useNativeModelPickerPreferencesStore.getState().setSelectionMode("model");
  };
  const chooseDefault = () => {
    if (
      !isNativeModelProvider || modelPending || modelSelectionDisabled ||
      !isCurrentNativeAction(false)
    )
      return;
    if (effectiveSelectionMode !== "default") {
      const choice = pickerPresentation?.defaultChoice;
      if (!choice) return;
      useNativeModelPickerPreferencesStore.getState().setSelectionMode("default");
      settings.setModelSelection({
        model: choice.model,
        reasoningEffort: choice.reasoningEffort,
      });
    }
    setAdvanced(false);
  };
  const resetToDefault = () => {
    if (
      !isNativeModelProvider || modelPending || modelSelectionDisabled ||
      !isCurrentNativeAction(false)
    ) return;
    const choice = pickerPresentation?.defaultChoice;
    if (!choice) return;
    // hCa Ln restores the recommended pair without a power-commit notice or
    // changing speed. The advanced selected Default radio remains a no-op.
    useNativeModelPickerPreferencesStore.getState().setSelectionMode("default");
    settings.setModelSelection({
      model: choice.model,
      reasoningEffort: choice.reasoningEffort,
    });
    if (keyboardViewFocus.current) {
      keyboardViewFocus.current = false;
      contentRef.current?.querySelector<HTMLElement>(
        ".session-native-power-caption",
      )?.focus({ preventScroll: true });
    }
  };
  const selectEffort = (index: number) => {
    if (modelPending) return;
    if (isNativeModelProvider && !isCurrentNativeAction()) return;
    if (physicalPowerChoices) {
      const choice = physicalPowerChoices[
        Math.max(0, Math.min(physicalPowerChoices.length - 1, index))
      ];
      if (!choice) return;
      commitModelSelectionWithNotice(threadId, "power", () => settings.setModelSelection({
        model: choice.model,
        reasoningEffort: choice.reasoningEffort,
      }));
      setRecentTick((tick) => tick + 1);
      rememberRecentModel({
        model: choice.model,
        label: items.find((item) => item.id === choice.model)?.label ?? choice.modelLabel,
        reasoningEffort: choice.reasoningEffort,
        serviceTier: settings.serviceTier ?? null,
      });
      return;
    }
    const next = options[Math.max(0, Math.min(options.length - 1, index))];
    if (next) {
      if (isNativeModelProvider && settings.model) {
        settings.setModelSelection({
          model: settings.model,
          reasoningEffort: next,
        });
      } else {
        settings.setReasoningEffort(next);
      }
    }
    setRecentTick((tick) => tick + 1);
    if (settings.model) {
      rememberRecentModel({
        model: settings.model,
        label,
        reasoningEffort: next ?? null,
        serviceTier: settings.serviceTier ?? null,
      });
    }
  };
  function isCurrentPowerWheel(
    lease: PowerWheelLease,
    current: PowerWheelCommit | null,
  ) {
    if (
      powerWheelLease.current !== lease ||
      !current?.enabled ||
      current.identity !== lease.identity ||
      current.layer !== lease.layer ||
      current.target !== lease.target ||
      openedLayer.current !== lease.layer ||
      openedComposer.current !== lease.target ||
      powerSliderRef.current !== lease.node ||
      contentRef.current !== lease.content ||
      !lease.node.isConnected ||
      !lease.content.contains(lease.node) ||
      !lease.root.isConnected ||
      sessionPortalContainer(lease.node.ownerDocument) !== lease.root ||
      lease.target.scope.closest(".session-mode") !== lease.root ||
      lease.node.closest(".session-mode") !== lease.root ||
      !isAgentInteractionVisible() ||
      current.threadId !== lease.target.threadId ||
      useCodexStore.getState().currentThreadId !== lease.target.threadId ||
      (current.draftOwner ?? lease.target.scope.dataset.draftOwner) !==
        lease.target.owner ||
      lease.target.scope.dataset.draftOwner !== lease.target.scopeOwner ||
      triggerRef.current?.closest(COMPOSER_SCOPE) !== lease.target.scope ||
      !lease.target.scope.contains(lease.target.editor) ||
      !isVisibleComposerEditor(lease.target.editor) ||
      lease.node.closest('[hidden], [inert], [aria-hidden="true"]')
    )
      return false;
    const style = lease.node.ownerDocument.defaultView?.getComputedStyle(
      lease.node,
    );
    return (
      style?.display !== "none" &&
      style?.visibility !== "hidden" &&
      style?.visibility !== "collapse" &&
      lease.node.getClientRects().length > 0
    );
  }
  useLayoutEffect(() => {
    // Publish only committed values. currentScope is also used by older focus
    // paths and is assigned during render, so wheel does not use it as authority.
    const current: PowerWheelCommit = {
      identity: scopeIdentity,
      layer: openedLayer.current,
      target: openedComposer.current,
      threadId,
      draftOwner,
      enabled:
        open && !showAdvanced && canAdjust && !modelPending &&
        settings.modelProvider === "openai",
      index: position,
      count: powerOptions.length,
      select: selectEffort,
    };
    powerWheelCommit.current = current;
    const node = powerSliderNode;
    const content = contentRef.current;
    const target = current.target;
    const root = target?.sessionRoot;
    const layer = current.layer;
    // The opening captured this root. The same layer cannot adopt a replacement
    // portal root, even if a later render finds another visible session root.
    if (
      !current.enabled || !node || !content || !target || !root || !layer ||
      powerSliderRef.current !== node ||
      !node.isConnected || !root.isConnected || !content.contains(node) ||
      sessionPortalContainer(node.ownerDocument) !== root ||
      target.scope.closest(".session-mode") !== root ||
      node.closest(".session-mode") !== root
    ) {
      releasePowerWheel();
      return;
    }
    const previous = powerWheelLease.current;
    if (
      previous?.node === node && previous.content === content &&
      previous.root === root && previous.target === target &&
      previous.identity === current.identity && previous.layer === layer
    )
      return;
    releasePowerWheel();
    const accumulator = { accumulatedDelta: 0, lastEventTime: 0 };
    const lease: PowerWheelLease = {
      node, content, root, target, identity: current.identity, layer,
      listener(event) {
        const committed = powerWheelCommit.current;
        if (!isCurrentPowerWheel(lease, committed)) return;
        // isCurrentPowerWheel requires a non-null committed snapshot.
        if (!committed) return;
        const next = nextOrdinaryPowerWheel(accumulator, event, {
          index: committed.index,
          count: committed.count,
          disabled: false,
        });
        if (next.consume) {
          event.preventDefault();
          event.stopPropagation();
        }
        // A boundary must not reach selectEffort's recent-model bookkeeping.
        if (next.nextIndex === null || next.nextIndex === committed.index) return;
        if (
          powerWheelCommit.current !== committed ||
          !isCurrentPowerWheel(lease, committed)
        )
          return;
        committed.select(next.nextIndex);
      },
    };
    powerWheelLease.current = lease;
    node.addEventListener("wheel", lease.listener, { passive: false });
    // No per-commit cleanup: effort/options/callback changes keep this lease
    // and accumulator. Structural changes above replace it; unmount releases it.
  });
  useLayoutEffect(() => () => {
    powerWheelCommit.current = null;
    releasePowerWheel();
  }, [releasePowerWheel]);
  const applyRecent = (item: (typeof recent)[number]) => {
    if (modelPending || modelSelectionDisabled) return;
    commitModelSelectionWithNotice(threadId, "recent", () => {
      settings.setModel(item.model);
      if (item.reasoningEffort) settings.setReasoningEffort(item.reasoningEffort);
      settings.setServiceTier?.(item.serviceTier);
    });
    setRecentOpen(false);
    changeOpen(false);
  };
  const dragEffort = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    selectEffort(
      Math.round(
        ((event.clientX - rect.left - POWER_ENDPOINT_INSET) /
          (rect.width - POWER_ENDPOINT_INSET * 2)) *
          (powerOptions.length - 1),
      ),
    );
  };
  function changeOpen(value: boolean) {
    viewPointerType.current = null;
    if (value && modelPending) return;
    clearTimeout(viewReset.current);
    viewReset.current = undefined;
    keyboardViewFocus.current = false;
    if (value) {
      // Never reinterpret a former workbench layer as a bare primitive.
      if (sessionPortalContainer(triggerRef.current?.ownerDocument))
        openedInWorkbench.current = true;
      if (!currentScope.current.open)
        openedLayer.current = { modal: !isNativeModelProvider };
      suppressCloseFocus.current = false;
      returnComposer.current = null;
      const scope = triggerRef.current?.closest<HTMLElement>(COMPOSER_SCOPE);
      const owner = draftOwner ?? scope?.dataset.draftOwner;
      const editor = scope
        ? [...scope.querySelectorAll<HTMLElement>(COMPOSER_EDITOR)].find(
            isVisibleComposerEditor,
          )
        : undefined;
      openedComposer.current =
        scope &&
        owner &&
        editor &&
        (scope.dataset.draftOwner === undefined ||
          scope.dataset.draftOwner === owner)
          ? {
              scope,
              owner,
              editor,
              scopeOwner: scope.dataset.draftOwner,
              threadId,
              sessionRoot: scope.closest<HTMLElement>(".session-mode"),
            }
          : null;
      if (
        isNativeModelProvider &&
        isCurrentNativePickerTarget(openedComposer.current)
      ) {
        const preferences = useNativeModelPickerPreferencesStore.getState();
        if (preferences.selectionMode === null)
          preferences.setSelectionMode(
            pickerPresentation?.selectedPreset ? "default" : "model",
          );
      }
      if (!canAdjust) setAdvanced(true);
    } else {
      openedComposer.current = null;
      const identity = scopeIdentity;
      viewReset.current = setTimeout(() => {
        viewReset.current = undefined;
        if (
          currentScope.current.identity === identity &&
          !currentScope.current.open
        )
          setAdvanced(false);
      }, 350);
    }
    setOpen(value);
  }
  function changeTriggerOpen(value: boolean) {
    if (value && enhancedTrigger) {
      const trigger = triggerRef.current;
      const content = trigger?.querySelector<HTMLElement>(
        ".session-native-model-trigger-content",
      );
      const measurement = trigger?.querySelector<HTMLElement>(
        ".session-native-model-trigger-measurement",
      );
      if (trigger && content && measurement) {
        // Read the current selection before changeOpen replaces its visible
        // subtree. CT/wT is a native context scale, not devicePixelRatio; this
        // application uses its actual local CSS geometry without a new scale.
        const currentWidth = content.getBoundingClientRect().width;
        const placeholderWidth = measurement.getBoundingClientRect().width;
        const maximum = Math.max(currentWidth, placeholderWidth);
        const buttonWidth = trigger.getBoundingClientRect().width;
        const cssMaximum =
          trigger.ownerDocument.defaultView?.getComputedStyle(trigger).maxWidth ?? "";
        const pixelMaximum = /^(?:\d+(?:\.\d+)?|\.\d+)px$/i.test(cssMaximum)
          ? Number(cssMaximum.slice(0, -2))
          : Number.NaN;
        const hasPixelMaximum = Number.isFinite(pixelMaximum);
        const chromeWidth = Math.max(0, buttonWidth - currentWidth);
        // Only a complete finite nonnegative px cap is a numeric budget.
        // Other declared caps stay with CSS; a preferred width can shrink as
        // the actual containing grid/flex area changes after replacement.
        const width = hasPixelMaximum
          ? Math.min(maximum, Math.max(0, pixelMaximum - chromeWidth))
          : maximum;
        setTriggerContentWidth(
          Number.isFinite(width)
            ? {
                value: width,
                shrinkable:
                  cssMaximum !== "" && cssMaximum !== "none" && !hasPixelMaximum,
              }
            : undefined,
        );
      } else {
        setTriggerContentWidth(undefined);
      }
    } else {
      setTriggerContentWidth(undefined);
    }
    // Keep the captured root/owner/layer, FI seed and focus action unchanged.
    changeOpen(value);
  }
  return (
    <DropdownMenu modal={openedLayer.current?.modal ?? true} open={open} onOpenChange={changeTriggerOpen}>
      <DropdownMenuTrigger asChild>
        <NativeModelTrigger
          ref={triggerRef}
          completionTooltipHeld={completionTooltipHeld}
          onBlur={handleCompletionTriggerBlur}
          onPointerLeave={handleCompletionTriggerPointerLeave}
          disabled={modelPending}
          pickerOpen={enhancedTrigger && open}
          pickerSimple={enhancedTrigger && !showAdvanced}
          pickerOpenLabel={enhancedTrigger ? triggerOpenLabel : undefined}
          minimumContentWidth={
            triggerContentWidth?.shrinkable ? undefined : triggerContentWidth?.value
          }
          preferredContentWidth={
            triggerContentWidth?.shrinkable ? triggerContentWidth.value : undefined
          }
        />
      </DropdownMenuTrigger>
      {/* Radix 1.1.11 must unmount this layer while it still owns its modal lock. */}
      {open && (
        <DropdownMenuContent
          ref={contentRef}
          className="session-native-model-menu"
          align="end"
          side="top"
          collisionPadding={8}
          sideOffset={4}
          onPointerDownCapture={(event) => {
            keyboardViewFocus.current = false;
            viewPointerType.current = event.pointerType;
          }}
          onKeyDownCapture={(event) => {
            const target = event.target;
            if (
              event.key === "Escape" && target instanceof HTMLElement &&
              target.closest(".session-native-model-reset") &&
              isCurrentNativeAction(false)
            ) {
              // The original Reset tooltip is part of this menu's Escape
              // dismissal. Radix otherwise dismisses only its top tooltip layer.
              event.preventDefault();
              event.stopPropagation();
              returnComposer.current = openedComposer.current;
              changeOpen(false);
              return;
            }
            if (
              !(target instanceof HTMLElement) ||
              !["Tab", "ArrowDown", "ArrowUp", "Home", "End"].includes(
                event.key,
              )
            )
              return;
            if (
              event.code === "ComposerNavigation" &&
              target.closest("[data-reasoning-slider]")
            )
              return;
            const rows = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                '[role^="menuitem"]:not([data-disabled]):not([aria-disabled="true"])',
              ),
            ].filter(
              (row) => !row.closest('[hidden], [inert], [aria-hidden="true"]'),
            );
            const index = rows.findIndex(
              (row) => row === target || row.contains(target),
            );
            if (index < 0 || rows.length === 0) return;
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? rows.length - 1
                  : (index +
                      (event.key === "ArrowUp" ||
                      (event.key === "Tab" && event.shiftKey)
                        ? -1
                        : 1) +
                      rows.length) %
                    rows.length;
            event.preventDefault();
            event.stopPropagation();
            rows[next]?.focus();
          }}
          onEscapeKeyDown={() => {
            // Native hCa returns Escape to its composer; pointer dismissal retains
            // the menu primitive's normal focus behavior.
            returnComposer.current = openedComposer.current;
          }}
          onCloseAutoFocus={(event) => {
            if (
              currentScope.current.identity !== scopeIdentity ||
              openedLayer.current !== layerIdentity ||
              currentScope.current.open
            ) {
              event.preventDefault();
              return;
            }
            const target = returnComposer.current;
            returnComposer.current = null;
            openedComposer.current = null;
            const suppressed = suppressCloseFocus.current;
            suppressCloseFocus.current = false;
            if (suppressed) {
              event.preventDefault();
              return;
            }
            if (!target) return;
            event.preventDefault();
            if (!isCurrentComposer(target)) return;
            target.editor.focus({ preventScroll: true });
          }}
        >
          {showAdvanced ? (
            <div
              className="session-native-model-list"
              data-model-picker-view="advanced"
            >
              <div className="session-native-model-heading-row">
                <p className="session-native-model-heading">选择模型</p>
                <button
                  type="button"
                  className="session-native-model-search-toggle"
                  aria-label="搜索模型"
                  aria-expanded={searching}
                  onClick={() => setSearching(true)}
                >
                  <Search size={12} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                aria-expanded={recentOpen}
                onClick={() => setRecentOpen((value) => !value)}
              >
                打开最近使用的模型
              </button>
              {recentOpen && (
                <div role="group" aria-label="最近使用的模型">
                  {recent.length === 0 ? (
                    <p role="status">还没有最近使用的模型</p>
                  ) : (
                    recent.map((item) => (
                      <button
                        disabled={modelPending || modelSelectionDisabled}
                        key={`${item.model}-${item.reasoningEffort ?? ""}-${item.serviceTier ?? ""}`}
                        type="button"
                        onClick={() => applyRecent(item)}
                      >
                        {item.label} ·{" "}
                        {nativeReasoningLabel(item.reasoningEffort)} ·{" "}
                        {item.serviceTier ? "快速" : "标准"}
                      </button>
                    ))
                  )}
                </div>
              )}
              {searching && (
                <input
                  aria-label="搜索或输入模型 ID"
                  placeholder="搜索或输入模型 ID…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
              {settings.modelProvider !== "openai" && loading && <p role="status">正在加载模型…</p>}
              {settings.modelProvider !== "openai" && error && (
                <p role="alert">
                  {error}
                  <button type="button" onClick={() => void reload()}>
                    重试
                  </button>
                </p>
              )}
              {pickerPresentation && pickerPresentation.presets.length > 0 && (
                <DropdownMenuItem
                  disabled={modelPending || modelSelectionDisabled}
                  role="menuitemradio"
                  aria-checked={effectiveSelectionMode === "default"}
                  className="session-native-model-option session-native-model-default"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ")
                      keyboardViewFocus.current = true;
                  }}
                  onSelect={(event) => {
                    event.preventDefault();
                    chooseDefault();
                  }}
                >
                  <span className="session-native-model-default-copy">
                    <span className="session-native-model-default-title">默认</span>
                    <span className="session-native-model-default-description">推荐模型集</span>
                  </span>
                  {effectiveSelectionMode === "default" && (
                    <NativeComposerIcon name="check" />
                  )}
                </DropdownMenuItem>
              )}
              {items
                .filter(
                  (item) =>
                    !query ||
                    item.label.toLowerCase().includes(query.toLowerCase()) ||
                    item.id.toLowerCase().includes(query.toLowerCase()),
                )
                .map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    disabled={modelPending || modelSelectionDisabled}
                    role="menuitemradio"
                    aria-checked={
                      item.id === settings.model &&
                      (!isNativeModelProvider || effectiveSelectionMode === "model")
                    }
                    title={item.description}
                    className="session-native-model-option"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ")
                        keyboardViewFocus.current = true;
                    }}
                    onSelect={(e) => {
                      e.preventDefault();
                      choose(item.id);
                    }}
                  >
                    <span>{item.label}</span>
                    {item.id === settings.model &&
                      (!isNativeModelProvider || effectiveSelectionMode === "model") && (
                        <NativeComposerIcon name="check" />
                      )}
                  </DropdownMenuItem>
                ))}
              {searching &&
                query &&
                !items.some((item) => item.id === query) && (
                  <button
                    type="button"
                    role="option"
                    disabled={modelPending || modelSelectionDisabled}
                    aria-label={`使用模型 ID：${query}`}
                    onClick={() => settings.setModel(query)}
                  >
                    使用模型 ID：{query}
                  </button>
                )}
              {!items.some((item) => item.id === settings.model) &&
                settings.model && (
                  <DropdownMenuItem
                    role="menuitemradio"
                    disabled={modelPending || modelSelectionDisabled}
                    aria-checked
                    className="session-native-model-option"
                    onSelect={() => setAdvanced(false)}
                  >
                    {settings.model}
                    <NativeComposerIcon name="check" />
                  </DropdownMenuItem>
                )}
              {!canAdjust && (
                <NativeServiceTierControl model={model} threadId={threadId} />
              )}
            </div>
          ) : (
            <div
              className="session-native-power-view"
              data-model-picker-view="simple"
            >
              <div className="session-native-power-controls">
                <DropdownMenuItem
                  aria-label="选择模型"
                  className="session-native-power-caption"
                  onPointerDown={() => {
                    keyboardViewFocus.current = false;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ")
                      keyboardViewFocus.current = true;
                  }}
                  onSelect={(e) => {
                    e.preventDefault();
                    setAdvanced(true);
                  }}
                >
                  <span className="session-native-power-caption-content">
                    <span
                      className="session-native-power-effort"
                      data-accent={
                        isNativeModelProvider && effectiveSelectionMode === "default"
                          ? false
                          : Boolean(settings.model)
                      }
                      data-maximum={
                        effort === "ultra" && powerOptions.includes("ultra")
                      }
                    >
                      {nativeReasoningLabel(effort)}
                    </span>
                    <span className="session-native-power-model">
                      {isUnknownOpenAiModel ? "自定义" : powerModelLabel}
                    </span>
                    <NativeComposerIcon
                      name="right"
                      className="session-native-power-chevron"
                      width={12}
                      height={12}
                    />
                  </span>
                </DropdownMenuItem>
                <NativeServiceTierControl model={model} threadId={threadId} />
                {isNativeModelProvider && effectiveSelectionMode === "model" &&
                  pickerPresentation?.defaultChoice && (
                  <ComposerTooltip label="恢复默认">
                  <DropdownMenuItem
                    className="session-native-model-reset"
                    aria-label="恢复默认"
                    disabled={modelPending || modelSelectionDisabled}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ")
                        keyboardViewFocus.current = true;
                    }}
                    onSelect={(event) => {
                      event.preventDefault();
                      resetToDefault();
                    }}
                  >
                    <span><NativeComposerIcon name="reset" width={16} height={16} /></span>
                  </DropdownMenuItem>
                  </ComposerTooltip>
                )}
              </div>
              <div
                ref={capturePowerSlider}
                className="session-native-power-slider"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  dragEffort(e);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture?.(e.pointerId))
                    dragEffort(e);
                }}
                onPointerUp={(e) => {
                  if (e.currentTarget.hasPointerCapture?.(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }}
              >
                <div className="session-native-power-track">
                  {powerOptions.map((option, index) => (
                    <span
                      key={physicalPowerChoices ? `${physicalPowerChoices[index]?.id}:${index}` : option}
                      className="session-native-power-dot"
                      style={{
                        left: `${POWER_ENDPOINT_INSET + (index / (powerOptions.length - 1)) * POWER_TRAVEL}px`,
                      }}
                    />
                  ))}
                </div>
                <DropdownMenuItem
                  asChild
                  className="p-0 focus:bg-transparent"
                  aria-label="强度"
                  aria-keyshortcuts="ArrowLeft ArrowRight"
                  aria-describedby={powerStatusId}
                  data-reasoning-slider
                  onSelect={(event) => event.preventDefault()}
                  onPointerMove={(event) => event.preventDefault()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      if (
                        enhancedTrigger &&
                        !showAdvanced &&
                        isCurrentNativeAction(false)
                      ) {
                        setCompletionTooltipHeld(true);
                        skipCompletionTriggerBlur.current = true;
                        triggerRef.current?.blur();
                      }
                      returnComposer.current = openedComposer.current;
                      changeOpen(false);
                      return;
                    }
                    const composerNavigation = e.code === "ComposerNavigation";
                    const next =
                      e.key === "ArrowLeft" ||
                      (composerNavigation && e.key === "ArrowUp")
                        ? position - 1
                        : e.key === "ArrowRight" ||
                            (composerNavigation && e.key === "ArrowDown")
                          ? position + 1
                          : null;
                    if (next !== null) {
                      e.preventDefault();
                      e.stopPropagation();
                      if (
                        next >= 0 &&
                        next < powerOptions.length &&
                        next !== position
                      )
                        selectEffort(next);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="session-native-power-thumb"
                    style={{
                      left: `calc(${POWER_ENDPOINT_INSET}px + ${(position / (powerOptions.length - 1)) * POWER_TRAVEL}px)`,
                    }}
                  />
                </DropdownMenuItem>
              </div>
              <span
                id={powerStatusId}
                role="status"
                aria-live="polite"
                className="sr-only"
              >
                {statusModelLabel} {statusEffortLabel}，第 {position + 1} 项，共{" "}
                {powerOptions.length} 项。使用左右方向键调整强度
              </span>
            </div>
          )}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
