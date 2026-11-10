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
} from "@session/services/apiAdapt/codex";
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
  modelStatus: "pending" | "success" | "error";
  modelSnapshot: Model[] | null;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  refreshProviders: () => Promise<void>;
};

// Shared across every selector instance so the model lists are fetched once.
let loadPromise: Promise<void> | null = null;
let reloadPromise: Promise<void> | null = null;
let reloadReadStarted = false;
let reloadNeedsAnotherRead = false;
let currentCatalogReadVersion = 0;
let currentProviderRefreshVersion = 0;
let activeCatalogAbort: AbortController | null = null;
let activeProviderRefreshAbort: AbortController | null = null;
const CATALOG_READ_TIMEOUT_MS = 15_000;

function abortableRead<T>(
  read: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("读取已取消"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    const finish = () => signal.removeEventListener("abort", abort);
    try {
      read().then(
        (value) => {
          finish();
          resolve(value);
        },
        (error) => {
          finish();
          reject(error);
        },
      );
    } catch (error) {
      finish();
      reject(error);
    }
  });
}

function supersedeCatalogRead() {
  currentCatalogReadVersion++;
  const reason = new Error("模型目录读取已由新刷新替代");
  activeCatalogAbort?.abort(reason);
  activeProviderRefreshAbort?.abort(reason);
}

export const useModelCacheStore = create<ModelCacheStore>()((set, get) => ({
  openAiModels: [],
  otherModels: {},
  configProviders: [],
  presets: [],
  loaded: false,
  loading: false,
  error: null,
  modelStatus: "pending",
  modelSnapshot: null,

  // A refresh can arrive while the first catalog read is still in flight.
  // Keep its promise so the refresh can wait before publishing its newer data.
  load: async () => {
    if (get().loaded) return;
    if (loadPromise) return loadPromise;
    const current = get();
    const catalogReadVersion = currentCatalogReadVersion;
    const providerRefreshVersion = currentProviderRefreshVersion;
    const controller = new AbortController();
    activeCatalogAbort = controller;
    set({
      loading: true,
      error: null,
      modelStatus:
        current.modelSnapshot === current.openAiModels
          ? current.modelStatus
          : "pending",
    });
    const timeout = setTimeout(
      () => controller.abort(new Error("读取模型目录超时，请重试")),
      CATALOG_READ_TIMEOUT_MS,
    );
    const task = (async () => {
      try {
        // model/list has its own settled state. Ancillary provider/preset reads do
        // not postpone an accepted catalog or turn its success into a model error.
        const modelRead = abortableRead(
          () => listModels({ signal: controller.signal }),
          controller.signal,
        ).then(
          (response) => {
            if (catalogReadVersion !== currentCatalogReadVersion)
              return response;
            if (response && Array.isArray(response.data))
              set({
                openAiModels: response.data,
                modelSnapshot: response.data,
                modelStatus: "success",
              });
            else set({ modelStatus: "error" });
            return response;
          },
          (error) => {
            if (catalogReadVersion === currentCatalogReadVersion)
              set({ modelStatus: "error" });
            throw error;
          },
        );
        const [models, providers, other, presets] = await Promise.allSettled([
          modelRead,
          abortableRead(
            () => listConfigProviders({ signal: controller.signal }),
            controller.signal,
          ),
          abortableRead(
            () => listOtherModels({ signal: controller.signal }),
            controller.signal,
          ),
          abortableRead(
            () => listProviderPresets({ signal: controller.signal }),
            controller.signal,
          ),
        ]);
        if (catalogReadVersion !== currentCatalogReadVersion) {
          set({ loading: false, loaded: false });
          return;
        }
        const update: Partial<ModelCacheStore> = {};
        const errors: string[] = [];
        if (models.status !== "fulfilled" || !Array.isArray(models.value?.data))
          errors.push(
            models.status === "rejected"
              ? String(
                  models.reason instanceof Error
                    ? models.reason.message
                    : models.reason,
                )
              : "服务返回的模型列表无效",
          );
        if (
          providers.status === "fulfilled" &&
          Array.isArray(providers.value)
        ) {
          if (providerRefreshVersion === currentProviderRefreshVersion)
            update.configProviders = providers.value;
        } else
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
          if (providerRefreshVersion === currentProviderRefreshVersion) {
            const grouped: Record<string, ModelListItem[]> = {};
            for (const item of other.value)
              grouped[item.provider] = item.models.map((m) => ({
                id: m.id,
                label: m.id,
              }));
            update.otherModels = grouped;
          }
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
          loaded:
            errors.length === 0 &&
            providerRefreshVersion === currentProviderRefreshVersion,
          error: errors.length ? [...new Set(errors)].join("；") : null,
        });
      } finally {
        clearTimeout(timeout);
        if (activeCatalogAbort === controller) activeCatalogAbort = null;
      }
    })();
    loadPromise = task;
    try {
      await task;
    } finally {
      if (loadPromise === task) loadPromise = null;
    }
  },

  reload: async () => {
    // A gesture can share a read that has not started yet. Once a refresh is
    // in flight, a later gesture needs one subsequent read of the new catalog.
    if (reloadPromise) {
      if (reloadReadStarted && !reloadNeedsAnotherRead) {
        supersedeCatalogRead();
        reloadNeedsAnotherRead = true;
        set({ loaded: false });
      }
      return reloadPromise;
    }
    supersedeCatalogRead();
    set({ loaded: false });
    const task = (async () => {
      // Let gestures from the same UI update share the next read.
      await Promise.resolve();
      do {
        reloadNeedsAnotherRead = false;
        const pendingLoad = loadPromise;
        if (pendingLoad) await pendingLoad;
        set({ loaded: false });
        reloadReadStarted = true;
        try {
          await get().load();
        } finally {
          reloadReadStarted = false;
        }
      } while (reloadNeedsAnotherRead);
    })();
    reloadPromise = task;
    try {
      await task;
    } finally {
      if (reloadPromise === task) reloadPromise = null;
    }
  },

  refreshProviders: async () => {
    const refreshVersion = ++currentProviderRefreshVersion;
    const catalogReadVersion = currentCatalogReadVersion;
    activeProviderRefreshAbort?.abort(new Error("提供商读取已由新刷新替代"));
    const controller = new AbortController();
    activeProviderRefreshAbort = controller;
    const timeout = setTimeout(
      () => controller.abort(new Error("刷新模型提供商超时，请重试")),
      CATALOG_READ_TIMEOUT_MS,
    );
    try {
      const providers = await abortableRead(
        () => listConfigProviders({ signal: controller.signal }),
        controller.signal,
      );
      if (!Array.isArray(providers))
        throw new Error("服务返回的提供商列表无效");
      if (
        refreshVersion !== currentProviderRefreshVersion ||
        catalogReadVersion !== currentCatalogReadVersion
      )
        return;
      const pendingLoad = loadPromise;
      if (pendingLoad)
        await abortableRead(() => pendingLoad, controller.signal);
      if (
        refreshVersion !== currentProviderRefreshVersion ||
        catalogReadVersion !== currentCatalogReadVersion
      )
        return;
      set({ configProviders: providers, loaded: false });
      await abortableRead(() => get().load(), controller.signal);
    } catch (error) {
      if (
        refreshVersion === currentProviderRefreshVersion &&
        catalogReadVersion === currentCatalogReadVersion
      )
        set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timeout);
      if (activeProviderRefreshAbort === controller)
        activeProviderRefreshAbort = null;
    }
  },
}));

export function useModels() {
  const openAiModels = useModelCacheStore((s) => s.openAiModels);
  const otherModels = useModelCacheStore((s) => s.otherModels);
  const load = useModelCacheStore((s) => s.load);
  const reload = useModelCacheStore((s) => s.reload);
  const loading = useModelCacheStore((s) => s.loading);
  const loaded = useModelCacheStore((s) => s.loaded);
  const error = useModelCacheStore((s) => s.error);
  const modelStatus = useModelCacheStore((s) => s.modelStatus);
  const modelSnapshot = useModelCacheStore((s) => s.modelSnapshot);
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
    loaded,
    error,
    modelStatus,
    hasModelSnapshot: modelSnapshot === openAiModels,
    reload,
    openAiModels,
    providerSuggestions,
    itemsByProvider,
    providerItems,
    allProviders,
    configProviders,
    refreshProviders,
  };
}
