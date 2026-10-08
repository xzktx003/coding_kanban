import { useShallow } from "zustand/react/shallow";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ReasoningEffort } from "@session/bindings";
import type { Model } from "@session/bindings/v2";
import { useCodexStore } from "@session/components/codex/stores";
import type { ModelListItem } from "@session/components/codex/types";
import { AgentIcon } from "@session/components/common/AgentIcon";
import { ProviderIcons } from "@session/components/icons";
import { Button } from "@session/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@session/components/ui/command";
import { Input } from "@session/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@session/components/ui/popover";
import { cn } from "@session/lib/utils";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import type { Provider } from "@session/stores/settings";
import { useModelSettingsStore } from "@session/stores/settings";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useModels } from "../hooks/useModels";
import { EnvKeysDialog } from "./EnvKeysDialog";
import {
  nextReasoningEffort,
  ReasoningEffortSelector,
} from "./ReasoningEffortSelector";

// Models shown per provider before "Show all" in the composer popover.
const COLLAPSED_MODEL_COUNT = 3;

function defaultOpenAiModel(models: Model[]): Model | undefined {
  return models.find((m) => m.isDefault) ?? models[0];
}

function ModelItem({
  provider,
  item,
  selected,
  showProvider,
  onSelect,
  onRemove,
}: {
  provider: string;
  item: ModelListItem;
  selected: boolean;
  showProvider: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <CommandItem
      value={`${provider} ${item.label} ${item.id}`}
      onSelect={onSelect}
      title={item.description}
      className={cn("group gap-1.5 text-xs", !showProvider && "pl-7")}
    >
      {showProvider && <ProviderIcons providerId={provider} size="sm" />}
      <span className="truncate">{item.label}</span>
      {showProvider && (
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          {provider}
        </span>
      )}
      {selected && (
        <Check
          className={cn("h-3.5 w-3.5 shrink-0", !showProvider && "ml-auto")}
        />
      )}
      {onRemove && (
        <button
          type="button"
          title="Remove model"
          className={cn(
            "shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-data-[selected=true]:opacity-100",
            !selected && !showProvider && "ml-auto",
          )}
          // cmdk selects on click, so the row must not react to this button.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </CommandItem>
  );
}

type BaseModelSelectorProps = {
  provider: Provider;
  onProviderChange: (provider: Provider) => void;
  value: string | undefined;
  onValueChange: (id: string) => void;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffortChange?: (value: ReasoningEffort) => void;
  disabled?: boolean;
  onClose?: () => void;
  mode?: "popover" | "panel";
};

function BaseModelSelector({
  provider,
  onProviderChange,
  value,
  onValueChange,
  reasoningEffort,
  onReasoningEffortChange,
  disabled = false,
  onClose,
  mode = "popover",
}: BaseModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [envKeysOpen, setEnvKeysOpen] = useState(false);
  // The list swaps to provider picking instead of opening a nested menu, so
  // arrow keys never leave the command list.
  const [pickingProvider, setPickingProvider] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [newModelId, setNewModelId] = useState("");
  // Providers showing their full model list instead of the first few.
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    new Set(),
  );
  const {
    openAiModels,
    providerItems,
    allProviders,
    providerSuggestions,
    loading: modelsLoading,
    error: modelsError,
    reload: reloadModels,
  } = useModels();
  const selectedAgent = useAgentSettingsStore((s) => s.selectedAgent);
  const addCustomModel = useModelSettingsStore((s) => s.addModel);
  const removeCustomModel = useModelSettingsStore((s) => s.removeModel);
  const storedModels = useModelSettingsStore((s) => s.models);

  const handleSelect = useCallback(
    (targetProvider: string, id: string) => {
      if (targetProvider !== provider) {
        onProviderChange(targetProvider as Provider);
      }
      onValueChange(id);

      const nextEffort = nextReasoningEffort(
        targetProvider,
        id,
        reasoningEffort,
        openAiModels,
      );
      if (nextEffort && onReasoningEffortChange) {
        onReasoningEffortChange(nextEffort);
      }

      setOpen(false);
      onClose?.();
    },
    [
      onValueChange,
      onProviderChange,
      provider,
      openAiModels,
      onReasoningEffortChange,
      reasoningEffort,
      onClose,
    ],
  );

  const currentItems = providerItems(provider);
  const activeItem = currentItems.find((m) => m.id === value);
  const activeLabel = activeItem?.label || value || "选择模型";

  const selectedOpenAiModel =
    provider === "openai"
      ? openAiModels.find((m) => m.id === value)
      : undefined;

  const query = searchQuery.trim();
  const expanded = expandedProviders.has(provider);
  // Collapsed lists still show the selected model, wherever it ranks.
  let visibleItems = currentItems;
  if (mode !== "panel" && !expanded && !query) {
    visibleItems = currentItems.slice(0, COLLAPSED_MODEL_COUNT);
    if (activeItem && !visibleItems.includes(activeItem)) {
      visibleItems = [...visibleItems, activeItem];
    }
  }

  // Models are never restricted to the known list: any typed id can be used.
  const canUseTyped =
    query.length > 0 && !currentItems.some((m) => m.id === query);

  const handlePickProvider = useCallback(
    (next: string) => {
      if (next !== provider) onProviderChange(next as Provider);
      setPickingProvider(false);
      setSearchQuery("");
    },
    [provider, onProviderChange],
  );

  const suggestions = providerSuggestions(provider);

  const handleAddSuggested = useCallback(
    (id: string) => {
      addCustomModel(provider, { id, name: id });
      handleSelect(provider, id);
    },
    [provider, addCustomModel, handleSelect],
  );

  const handleAddTyped = useCallback(() => {
    const id = newModelId.trim();
    if (!id) return;
    setNewModelId("");
    handleAddSuggested(id);
  }, [newModelId, handleAddSuggested]);

  const handleUseTyped = useCallback(() => {
    const id = searchQuery.trim();
    if (!id) return;
    if (provider !== "openai") addCustomModel(provider, { id, name: id });
    handleSelect(provider, id);
  }, [searchQuery, provider, addCustomModel, handleSelect]);

  return (
    <div className="flex items-center">
      {mode === "panel" ? (
        <div className="flex w-full flex-col overflow-hidden rounded-md border bg-popover">
          {modelsLoading && (
            <p
              role="status"
              className="px-2 py-2 text-xs text-muted-foreground"
            >
              正在加载模型…
            </p>
          )}
          {modelsError && (
            <div role="alert" className="px-2 py-2 text-xs text-destructive">
              模型加载失败：{modelsError}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void reloadModels()}
              >
                重试
              </Button>
            </div>
          )}
          <div className="flex items-center gap-1 border-b px-1 py-1">
            <button
              type="button"
              onClick={() => {
                setPickingProvider((prev) => !prev);
                setSearchQuery("");
              }}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs hover:bg-accent/50"
            >
              <ProviderIcons providerId={provider} size="sm" />
              <span className="truncate">{provider}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="搜索模型"
              onClick={() => setShowSearch((v) => !v)}
            >
              <Search className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="提供商与 API 配置"
              onClick={() => setEnvKeysOpen(true)}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
          <Command loop>
            {showSearch && (
              <CommandInput
                placeholder="搜索或输入模型 ID…"
                value={searchQuery}
                onValueChange={setSearchQuery}
              />
            )}
            <CommandList className="max-h-[min(55vh,400px)]">
              <CommandEmpty className="py-4 text-xs text-muted-foreground">
                没有匹配的模型
              </CommandEmpty>
              {pickingProvider ? (
                <CommandGroup>
                  {allProviders.map((p) => (
                    <CommandItem
                      key={p}
                      value={p}
                      onSelect={() => handlePickProvider(p)}
                    >
                      {p}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : (
                <CommandGroup>
                  {visibleItems.map((item) => (
                    <ModelItem
                      key={item.id}
                      provider={provider}
                      item={item}
                      selected={item.id === value}
                      showProvider={false}
                      onSelect={() => handleSelect(provider, item.id)}
                    />
                  ))}
                  {canUseTyped && (
                    <CommandItem
                      value={query}
                      aria-label={`使用模型 ID：${query}`}
                      onSelect={handleUseTyped}
                    >
                      <span className="break-all text-xs">
                        使用模型 ID：{query}
                      </span>
                    </CommandItem>
                  )}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
          {reasoningEffort !== undefined && onReasoningEffortChange && (
            <ReasoningEffortSelector
              provider={provider}
              openAiModel={selectedOpenAiModel}
              value={reasoningEffort}
              onChange={onReasoningEffortChange}
              disabled={disabled || !value}
            />
          )}
        </div>
      ) : (
        <Popover
          open={open}
          onOpenChange={(io) => {
            setOpen(io);
            if (!io) {
              setSearchQuery("");
              setExpandedProviders(new Set());
              setPickingProvider(false);
              setShowSearch(false);
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-2 px-2 border border-transparent transition-all hover:border-input hover:bg-accent/50"
              disabled={disabled}
            >
              <AgentIcon agent={selectedAgent} />
              <div className="flex items-center gap-1.5 text-xs text-foreground">
                <span className="font-medium max-w-[120px] truncate">
                  {activeLabel}
                </span>
                {reasoningEffort !== undefined &&
                  reasoningEffort !== "none" && (
                    <span className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono capitalize text-muted-foreground border">
                      {reasoningEffort}
                    </span>
                  )}
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </Button>
          </PopoverTrigger>

          <PopoverContent className="w-72 p-0 flex flex-col" align="start">
            <Command
              loop
              onKeyDown={(e) => {
                // Escape backs out of provider picking / search before closing.
                if (e.key === "Escape" && (pickingProvider || showSearch)) {
                  e.preventDefault();
                  e.stopPropagation();
                  setPickingProvider(false);
                  setShowSearch(false);
                  setSearchQuery("");
                }
              }}
            >
              {/* Header: provider dropdown on the left, then search and settings. */}
              <div className="flex items-center gap-1 border-b px-1 py-1">
                <button
                  type="button"
                  onClick={() => {
                    setPickingProvider((prev) => !prev);
                    setSearchQuery("");
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs hover:bg-accent/50"
                >
                  <ProviderIcons providerId={provider} size="sm" />
                  <span className="truncate">{provider}</span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                      pickingProvider && "rotate-180",
                    )}
                  />
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  title="Search"
                  onClick={() => {
                    setShowSearch((prev) => !prev);
                    setSearchQuery("");
                  }}
                >
                  <Search className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  title="Providers & API keys"
                  onClick={() => setEnvKeysOpen(true)}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>

              <div className={cn(!showSearch && "hidden")}>
                <CommandInput
                  placeholder={
                    pickingProvider ? "搜索提供商…" : "搜索或输入模型 ID…"
                  }
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  className="text-xs"
                />
              </div>

              <CommandList className="max-h-64">
                <CommandEmpty className="py-4 text-xs text-muted-foreground">
                  没有匹配的模型
                </CommandEmpty>

                {pickingProvider ? (
                  <CommandGroup>
                    {allProviders.map((p) => (
                      <CommandItem
                        key={p}
                        value={`provider ${p}`}
                        onSelect={() => handlePickProvider(p)}
                        className="gap-1.5 text-xs"
                      >
                        <ProviderIcons providerId={p} size="sm" />
                        <span className="truncate">{p}</span>
                        {p === provider && (
                          <Check className="ml-auto h-3.5 w-3.5 shrink-0" />
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : (
                  <CommandGroup>
                    {visibleItems.map((item) => (
                      <ModelItem
                        key={item.id}
                        provider={provider}
                        item={item}
                        selected={item.id === value}
                        showProvider={false}
                        onSelect={() => handleSelect(provider, item.id)}
                        onRemove={
                          // Only user-added models can be removed; the rest come
                          // from the provider itself.
                          (storedModels[provider] ?? []).some(
                            (m) => m.id === item.id,
                          )
                            ? () => removeCustomModel(provider, item.id)
                            : undefined
                        }
                      />
                    ))}
                    {canUseTyped && (
                      <CommandItem
                        value={`use-${query}`}
                        onSelect={handleUseTyped}
                        className="gap-1.5 pl-7 text-xs text-muted-foreground"
                        forceMount
                      >
                        Use "{query}"
                      </CommandItem>
                    )}
                    {!expanded &&
                      !query &&
                      currentItems.length > visibleItems.length && (
                        <CommandItem
                          value={`${provider} show all models`}
                          onSelect={() =>
                            setExpandedProviders((prev) =>
                              new Set(prev).add(provider),
                            )
                          }
                          className="gap-1.5 pl-7 text-xs text-muted-foreground"
                        >
                          Show all {currentItems.length} models
                          <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" />
                        </CommandItem>
                      )}
                    {/* llms.json models are offered for the user to add, never
                      listed as if they were already configured. */}
                    {suggestions.map((item) => (
                      <CommandItem
                        key={`suggested-${item.id}`}
                        value={`add ${provider} ${item.id}`}
                        onSelect={() => handleAddSuggested(item.id)}
                        className="gap-1.5 pl-7 text-xs text-muted-foreground"
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>

              {/* Manual model entry: providers other than openai/ollama have no
                model list of their own to pick from. */}
              {!pickingProvider &&
                provider !== "openai" &&
                provider !== "ollama" && (
                  <div className="flex items-center gap-1 border-t p-1">
                    <Input
                      className="h-7 text-xs"
                      placeholder="Add model id..."
                      value={newModelId}
                      onChange={(e) => setNewModelId(e.target.value)}
                      onKeyDown={(e) => {
                        // cmdk owns Enter/arrows for the list; keep them local here.
                        e.stopPropagation();
                        if (e.key === "Enter") handleAddTyped();
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      title="Add model"
                      disabled={!newModelId.trim()}
                      onClick={handleAddTyped}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
            </Command>

            {reasoningEffort !== undefined && onReasoningEffortChange && (
              <ReasoningEffortSelector
                provider={provider}
                openAiModel={selectedOpenAiModel}
                value={reasoningEffort}
                onChange={(option) => {
                  onReasoningEffortChange(option);
                  setOpen(false);
                  onClose?.();
                }}
                disabled={disabled || !value}
              />
            )}
          </PopoverContent>
        </Popover>
      )}
      <EnvKeysDialog
        open={envKeysOpen}
        onOpenChange={setEnvKeysOpen}
        provider={provider}
        onProviderChange={onProviderChange}
      />
    </div>
  );
}

export function ModelReasonSelector({
  mode = "popover",
  threadId,
  onClose,
}: {
  mode?: "popover" | "panel";
  threadId?: string | null;
  onClose?: () => void;
}) {
  const { activeThreadId, triggerInputFocus } = useCodexStore(
    useShallow((s) => ({
      activeThreadId: s.currentThreadId,
      triggerInputFocus: s.triggerInputFocus,
    })),
  );
  const currentThreadId = threadId === undefined ? activeThreadId : threadId;
  const { openAiModels } = useModels();

  const {
    modelProvider,
    providerModels,
    setModel,
    setModelProvider,
    reasoningEffort,
    setReasoningEffort,
  } = useThreadModelSettings(currentThreadId);

  useEffect(() => {
    if (
      !currentThreadId &&
      modelProvider === "openai" &&
      !providerModels.openai &&
      openAiModels.length > 0
    ) {
      const defaultModel = defaultOpenAiModel(openAiModels);
      if (defaultModel) {
        setModel(defaultModel.id);
        setReasoningEffort(defaultModel.defaultReasoningEffort);
      }
    }
  }, [
    openAiModels,
    currentThreadId,
    modelProvider,
    providerModels.openai,
    setModel,
    setReasoningEffort,
  ]);

  const onProviderChange = (p: Provider) => {
    setModelProvider(p);

    let modelId = providerModels[p];
    if (p === "openai" && !openAiModels.some((m) => m.id === modelId)) {
      const fallback = defaultOpenAiModel(openAiModels);
      if (fallback) {
        modelId = fallback.id;
        setModel(fallback.id);
      }
    }

    const nextEffort = nextReasoningEffort(
      p,
      modelId,
      reasoningEffort ?? undefined,
      openAiModels,
    );
    if (nextEffort) setReasoningEffort(nextEffort);
  };

  if (mode === "panel") {
    return (
      <BaseModelSelector
        provider={modelProvider}
        onProviderChange={onProviderChange}
        value={providerModels[modelProvider] ?? ""}
        onValueChange={setModel}
        reasoningEffort={reasoningEffort ?? undefined}
        onReasoningEffortChange={setReasoningEffort}
        onClose={onClose ?? triggerInputFocus}
        mode="panel"
      />
    );
  }

  return (
    <BaseModelSelector
      provider={modelProvider}
      onProviderChange={onProviderChange}
      value={providerModels[modelProvider] ?? ""}
      onValueChange={setModel}
      reasoningEffort={reasoningEffort ?? undefined}
      onReasoningEffortChange={setReasoningEffort}
      onClose={onClose ?? triggerInputFocus}
    />
  );
}

export { BaseModelSelector as CodexModelSelector };
