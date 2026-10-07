import { useEffect, useMemo } from "react";
import { create } from "zustand";
import type { Model } from "@session/bindings/v2";
import type {
  ConfigProvider,
  FrontendProviderModels,
  ModelListItem,
  ProviderPreset,
} from "@session/components/codex/types";
import {
  listConfigProviders,
  listModels,
  listOtherModels,
  listProviderPresets,
} from "@session/services/apiAdapt";
import { useModelSettingsStore } from "@session/stores/settings";

type ModelCacheStore = {
  openAiModels: Model[];
  otherModels: Record<string, ModelListItem[]>;
  // Providers read from the user's config.toml — the source of truth for which
  // providers exist at all.
  configProviders: ConfigProvider[];
  // llms.json entries: suggested models a user can add, never auto-listed.
  presets: ProviderPreset[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  refreshProviders: () => Promise<void>;
};

// Shared across every selector instance so the model lists are fetched once.
const useModelCacheStore = create<ModelCacheStore>()((set, get) => ({
  openAiModels: [],
  otherModels: {},
  configProviders: [],
  presets: [],
  loaded: false,
  loading: false,
  error: null,

  refreshProviders: async () => {
    try {
      const providers = await listConfigProviders();
      if (!Array.isArray(providers))
        throw new Error("服务返回的提供商列表无效");
      set({ configProviders: providers });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true, error: null });
    const [models, providers, other, presets] = await Promise.allSettled([
      listModels(),
      listConfigProviders(),
      listOtherModels(),
      listProviderPresets(),
    ]);
    const update: Partial<ModelCacheStore> = {};
    const errors: string[] = [];
    if (models.status === "fulfilled" && Array.isArray(models.value.data))
      update.openAiModels = models.value.data;
    else
      errors.push(
        models.status === "rejected"
          ? String(
              models.reason instanceof Error
                ? models.reason.message
                : models.reason,
            )
          : "服务返回的模型列表无效",
      );
    if (providers.status === "fulfilled" && Array.isArray(providers.value))
      update.configProviders = providers.value;
    else
      errors.push(
        providers.status === "rejected"
          ? String(
              providers.reason instanceof Error
                ? providers.reason.message
                : providers.reason,
            )
          : "服务返回的提供商列表无效",
      );
    if (other.status === "fulfilled" && Array.isArray(other.value)) {
      const grouped: Record<string, ModelListItem[]> = {};
      for (const item of other.value)
        grouped[item.provider] = item.models.map((m) => ({
          id: m.id,
          label: m.id,
        }));
      update.otherModels = grouped;
    } else
      errors.push(
        other.status === "rejected"
          ? String(
              other.reason instanceof Error
                ? other.reason.message
                : other.reason,
            )
          : "服务返回的其他模型列表无效",
      );
    if (presets.status === "fulfilled" && Array.isArray(presets.value))
      update.presets = presets.value;
    else
      errors.push(
        presets.status === "rejected"
          ? String(
              presets.reason instanceof Error
                ? presets.reason.message
                : presets.reason,
            )
          : "服务返回的推荐模型列表无效",
      );
    set({
      ...update,
      loading: false,
      loaded: errors.length === 0,
      error: errors.length ? errors.join("；") : null,
    });
  },
}));

export function useModels() {
  const openAiModels = useModelCacheStore((s) => s.openAiModels);
  const otherModels = useModelCacheStore((s) => s.otherModels);
  const load = useModelCacheStore((s) => s.load);
  const loading = useModelCacheStore((s) => s.loading);
  const error = useModelCacheStore((s) => s.error);
  const configProviders = useModelCacheStore((s) => s.configProviders);
  const refreshProviders = useModelCacheStore((s) => s.refreshProviders);
  const presets = useModelCacheStore((s) => s.presets);
  const storedModels = useModelSettingsStore((s) => s.models);

  useEffect(() => {
    load();
  }, [load]);

  // Precomputed once per data change instead of per render/filter pass.
  const itemsByProvider = useMemo(() => {
    const map: Record<string, ModelListItem[]> = {
      openai: openAiModels.map((m) => ({
        id: m.id,
        label: m.displayName || m.model,
        description: m.description,
      })),
    };

    // Only providers present in config.toml; llms.json entries are merely
    // suggested models for those.
    for (const { name: provider } of configProviders) {
      if (provider === "openai") continue;
      const stored = (storedModels[provider] ?? []).map((m) => ({
        id: m.id,
        label: m.name,
      }));
      const suggested = (otherModels[provider] ?? []).filter(
        (m) => !stored.some((s) => s.id === m.id),
      );
      map[provider] = [...stored, ...suggested];
    }

    return map;
  }, [openAiModels, otherModels, storedModels, configProviders]);

  const allProviders = useMemo(
    () => Object.keys(itemsByProvider),
    [itemsByProvider],
  );

  const providerItems = useMemo(
    () =>
      (provider: string): ModelListItem[] =>
        itemsByProvider[provider] ?? [],
    [itemsByProvider],
  );

  // Models llms.json knows about that the user has not added yet.
  const providerSuggestions = useMemo(
    () =>
      (provider: string): ModelListItem[] => {
        const listed = itemsByProvider[provider] ?? [];
        const preset = presets.find((p) => p.model_provider === provider);
        return (preset?.models ?? [])
          .filter((m) => !listed.some((item) => item.id === m.id))
          .map((m) => ({ id: m.id, label: m.id }));
      },
    [presets, itemsByProvider],
  );

  return {
    loading,
    error,
    reload: async () => {
      useModelCacheStore.setState({ loaded: false });
      await load();
    },
    openAiModels,
    providerSuggestions,
    itemsByProvider,
    providerItems,
    allProviders,
    configProviders,
    refreshProviders,
  };
}
