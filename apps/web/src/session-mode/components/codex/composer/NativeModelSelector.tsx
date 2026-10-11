import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import { useModels } from "../hooks/useModels";
import { NativeModelTrigger } from "./NativeModelTrigger";
import { NativeComposerIcon } from "./NativeComposerIcon";
import {
  GENERIC_REASONING_OPTIONS,
  nextReasoningEffort,
} from "./ReasoningEffortSelector";
import { nativeReasoningLabel } from "./nativeReasoningLabel";
import { NativeServiceTierControl } from "./NativeServiceTierControl";
import {
  recentModelConfigs,
  rememberRecentModel,
} from "./recentModelConfigs";

// Native impl-517ea8aeeec5 dt(percent): 28px thumb / 2 minus 1px.
const POWER_ENDPOINT_INSET = 13;
const POWER_TRACK_WIDTH = 200;
const POWER_TRAVEL = POWER_TRACK_WIDTH - POWER_ENDPOINT_INSET * 2;

/** Native xma/1d00n simple power view and advanced model radio list. */
export function NativeModelSelector({ threadId }: { threadId: string | null }) {
  const settings = useThreadModelSettings(threadId);
  const { openAiModels, providerItems, loading, error, reload } = useModels();
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentTick, setRecentTick] = useState(0);
  const recent = recentOpen && recentTick >= 0 ? recentModelConfigs() : [];
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setOpen(false);
  }, [threadId]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      // Native pointer opening and view changes keep the menu container focused.
      // Radix moves into rows when the user navigates with the keyboard.
      contentRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, advanced]);
  const model = openAiModels.find(
    (m) => m.id === settings.model || m.model === settings.model,
  );
  const items = providerItems(settings.modelProvider);
  const catalogOptions =
    settings.modelProvider === "openai"
      ? (model?.supportedReasoningEfforts.map((o) => o.reasoningEffort) ?? [])
      : GENERIC_REASONING_OPTIONS;
  const options = catalogOptions.length > 1 ? catalogOptions : GENERIC_REASONING_OPTIONS;
  const effort = settings.reasoningEffort ?? model?.defaultReasoningEffort;
  const position = Math.max(0, options.indexOf(effort!));
  const canAdjust = options.length > 1;
  const label =
    items.find((m) => m.id === settings.model)?.label ??
    settings.model ??
    "自定义模型";
  const choose = (id: string) => {
    const next = nextReasoningEffort(
      settings.modelProvider,
      id,
      settings.reasoningEffort ?? undefined,
      openAiModels,
    );
    if (id !== settings.model) {
      settings.setModel(id);
    }
    if (next) settings.setReasoningEffort(next);
    setAdvanced(true);
    setRecentTick((tick) => tick + 1);
    rememberRecentModel({
      model: id,
      label: items.find((item) => item.id === id)?.label ?? id,
      reasoningEffort: next ?? settings.reasoningEffort,
      serviceTier: settings.serviceTier ?? null,
    });
    const nextModel = openAiModels.find(
      (model) => model.id === id || model.model === id,
    );
    if (
      settings.serviceTier &&
      !nextModel?.serviceTiers?.some((tier) => tier.id === settings.serviceTier)
    )
      settings.setServiceTier(null);
  };
  const selectEffort = (index: number) => {
    const next = options[Math.max(0, Math.min(options.length - 1, index))];
    if (next) settings.setReasoningEffort(next);
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
  const applyRecent = (item: (typeof recent)[number]) => {
    settings.setModel(item.model);
    if (item.reasoningEffort) settings.setReasoningEffort(item.reasoningEffort);
    settings.setServiceTier?.(item.serviceTier);
    setRecentOpen(false);
    setOpen(false);
  };
  const dragEffort = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    selectEffort(
      Math.round(
        ((event.clientX - rect.left - POWER_ENDPOINT_INSET) /
          (rect.width - POWER_ENDPOINT_INSET * 2)) *
          (options.length - 1),
      ),
    );
  };
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setAdvanced(!canAdjust);
      }}
    >
      <DropdownMenuTrigger asChild>
        <NativeModelTrigger />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={contentRef}
        className="session-native-model-menu"
        align="end"
        side="top"
        collisionPadding={8}
        sideOffset={4}
      >
        {advanced || !canAdjust ? (
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
                      key={`${item.model}-${item.reasoningEffort ?? ""}-${item.serviceTier ?? ""}`}
                      type="button"
                      onClick={() => applyRecent(item)}
                    >
                      {item.label} · {nativeReasoningLabel(item.reasoningEffort)} ·{" "}
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
            {loading && <p role="status">正在加载模型…</p>}
            {error && (
              <p role="alert">
                {error}
                <button type="button" onClick={() => void reload()}>
                  重试
                </button>
              </p>
            )}
            {items
              .filter((item) =>
                !query || item.label.toLowerCase().includes(query.toLowerCase()) || item.id.toLowerCase().includes(query.toLowerCase()),
              )
              .map((item) => (
              <DropdownMenuItem
                key={item.id}
                role="menuitemradio"
                aria-checked={item.id === settings.model}
                title={item.description}
                className="session-native-model-option"
                onSelect={(e) => {
                  e.preventDefault();
                  choose(item.id);
                }}
              >
                <span>{item.label}</span>
                {item.id === settings.model && (
                  <NativeComposerIcon name="check" />
                )}
              </DropdownMenuItem>
            ))}
            {searching && query && !items.some((item) => item.id === query) && (
              <button
                type="button"
                role="option"
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
                onSelect={(e) => {
                  e.preventDefault();
                  setAdvanced(true);
                }}
              >
                <span className="session-native-power-caption-content">
                  <span
                    className="session-native-power-effort"
                    data-accent={Boolean(settings.model)}
                    data-maximum={
                      effort === "ultra" && options.includes("ultra")
                    }
                  >
                    {nativeReasoningLabel(effort)}
                  </span>
                  <span className="session-native-power-model">{label}</span>
                  <NativeComposerIcon
                    name="right"
                    className="session-native-power-chevron"
                    width={12}
                    height={12}
                  />
                </span>
              </DropdownMenuItem>
              <NativeServiceTierControl model={model} threadId={threadId} />
            </div>
            <div
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
                {options.map((option, index) => (
                  <span
                    key={option}
                    className="session-native-power-dot"
                    style={{
                      left: `${POWER_ENDPOINT_INSET + (index / (options.length - 1)) * POWER_TRAVEL}px`,
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                role="slider"
                aria-label="推理强度"
                aria-valuemin={0}
                aria-valuemax={options.length - 1}
                aria-valuenow={position}
                aria-valuetext={effort ?? ""}
                className="session-native-power-thumb"
                style={{
                  left: `calc(${POWER_ENDPOINT_INSET}px + ${(position / (options.length - 1)) * POWER_TRAVEL}px)`,
                }}
                onKeyDown={(e) => {
                  const next =
                    e.key === "ArrowLeft" || e.key === "ArrowDown"
                      ? position - 1
                      : e.key === "ArrowRight" || e.key === "ArrowUp"
                        ? position + 1
                        : e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? options.length - 1
                            : null;
                  if (next !== null) {
                    e.preventDefault();
                    e.stopPropagation();
                    selectEffort(next);
                  }
                }}
              />
            </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
