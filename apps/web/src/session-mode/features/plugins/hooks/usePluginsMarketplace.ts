import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MarketplaceLoadErrorInfo,
  PluginDetail,
  PluginMarketplaceEntry,
  PluginSummary,
} from "@session/bindings/v2";
import { pluginNotice as toast } from "../pluginNotices";
import { pluginList, pluginRead } from "@session/services";
import { usePluginsViewContext } from "../hooks";
import {
  dedupePluginEntries,
  type PluginEntry,
  pluginRequestTarget,
  preferredLocalSources,
  pluginEntryKey,
  assertPluginDetailTarget,
} from "./pluginTargets";
import {
  capturePluginScope,
  isPluginScopeCurrent,
  readPluginCatalogCache,
  savePluginCatalogCache,
  usePluginCatalogRevision,
} from "../pluginScope";
import { tryPluginInComposer } from "../pluginNavigation";

/** Build a placeholder detail from a list summary so the detail page can render immediately. */
function summaryToDetail(
  marketplace: PluginMarketplaceEntry,
  plugin: PluginSummary,
): PluginDetail {
  return {
    marketplaceName: marketplace.name,
    marketplacePath: marketplace.path,
    summary: plugin,
    shareUrl: null,
    description: null,
    skills: [],
    hooks: [],
    apps: [],
    appTemplates: [],
    mcpServers: [],
    scheduledTasks: null,
  };
}

/**
 * Provides state and handlers for the marketplace view.
 *
 * The component passes an optional `refreshTrigger` prop; changing it forces a reload.
 */
export function usePluginsMarketplace(refreshTrigger = 0) {
  const revision = usePluginCatalogRevision(),
    cached = readPluginCatalogCache();
  const [marketplaces, setMarketplaces] = useState<PluginMarketplaceEntry[]>(
    cached?.marketplaces ?? [],
  );
  const [errors, setErrors] = useState<MarketplaceLoadErrorInfo[]>(
    cached?.errors ?? [],
  );
  const [isLoading, setIsLoading] = useState(!cached);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestVersion = useRef(0),
    detailVersion = useRef(0),
    detailRead = useRef<AbortController | null>(null);
  const domain = useRef(capturePluginScope());
  useEffect(
    () => () => {
      requestVersion.current++;
      detailVersion.current++;
      detailRead.current?.abort();
    },
    [],
  );
  const [installingPluginId, setInstallingPluginId] = useState<string | null>(
    null,
  );
  const [query, setQuery] = useState("");

  const { handlePluginDetail, handlePluginDetailError, handlePluginInstall } =
    usePluginsViewContext();

  const loadPlugins = useCallback(async (forceRefetch = false) => {
    const request = ++requestVersion.current,
      scope = capturePluginScope();
    setIsLoading(true);
    setLoadError(null);
    try {
      // forceRefetch also makes the app-server re-sync the curated marketplace
      // checkout under ~/.codex/.tmp instead of serving its in-memory catalog.
      const response = await pluginList({ forceRefetch });
      if (request !== requestVersion.current || !isPluginScopeCurrent(scope))
        return;
      if (
        new TextEncoder().encode(JSON.stringify(response)).byteLength >
        2 * 1024 * 1024
      )
        throw new Error("插件目录超过 2 MiB 读取预算，请缩小市场范围后重试");
      if (
        !Array.isArray(response?.marketplaces) ||
        response.marketplaces.some(
          (market) =>
            !market ||
            typeof market.name !== "string" ||
            !Array.isArray(market.plugins),
        )
      )
        throw new Error("服务返回的插件列表无效");
      const marketplaceErrors = Array.isArray(response.marketplaceLoadErrors)
        ? response.marketplaceLoadErrors
        : [];
      savePluginCatalogCache({
        marketplaces: response.marketplaces,
        errors: marketplaceErrors,
      });
      setMarketplaces(response.marketplaces);
      setErrors(marketplaceErrors);
    } catch (error) {
      if (request === requestVersion.current && isPluginScopeCurrent(scope))
        setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === requestVersion.current && isPluginScopeCurrent(scope))
        setIsLoading(false);
    }
  }, []);

  const preferred = useMemo(
    () => preferredLocalSources(marketplaces),
    [marketplaces],
  );

  /** One entry per plugin, with duplicates across marketplaces collapsed. */
  const entries = useMemo(() => {
    const all: PluginEntry[] = [];
    for (const marketplace of marketplaces) {
      for (const plugin of marketplace.plugins) {
        all.push({ marketplace, plugin });
      }
    }
    return dedupePluginEntries(all);
  }, [marketplaces]);

  const handleInstall = useCallback(
    async (marketplace: PluginMarketplaceEntry, plugin: PluginSummary) => {
      const target = pluginRequestTarget(marketplace, plugin, preferred),
        scope = capturePluginScope(),
        identity = pluginEntryKey(marketplace, plugin);
      if (!target) {
        toast({
          title: "无法安装插件",
          description: "无法确认原生市场来源",
          variant: "destructive",
        });
        return;
      }
      setInstallingPluginId(identity);
      try {
        await handlePluginInstall(summaryToDetail(marketplace, plugin), target);
      } finally {
        if (isPluginScopeCurrent(scope))
          setInstallingPluginId((current) =>
            current === identity ? null : current,
          );
      }
    },
    [preferred, handlePluginInstall],
  );

  const handleUsePlugin = useCallback((plugin: PluginSummary) => {
    tryPluginInComposer(plugin);
  }, []);

  const handleShowDetail = useCallback(
    async (marketplace: PluginMarketplaceEntry, plugin: PluginSummary) => {
      // Open immediately with what the list already knows, then fill in the rest.
      const request = ++detailVersion.current,
        scope = capturePluginScope();
      detailRead.current?.abort();
      const controller = new AbortController();
      detailRead.current = controller;
      const selection = handlePluginDetail(
        summaryToDetail(marketplace, plugin),
      );
      const target = pluginRequestTarget(marketplace, plugin, preferred);
      if (!target) return;
      try {
        const response = await pluginRead(target, {
          signal: controller.signal,
        });
        if (
          request === detailVersion.current &&
          !controller.signal.aborted &&
          isPluginScopeCurrent(scope)
        ) {
          assertPluginDetailTarget(response.plugin, target);
          handlePluginDetail(response.plugin, selection);
        }
      } catch (error) {
        // The detail page already shows what the list knows; a failed enrich
        // (e.g. the remote catalog 404s on this plugin) is not worth a toast.
        if (
          request === detailVersion.current &&
          !controller.signal.aborted &&
          isPluginScopeCurrent(scope)
        )
          handlePluginDetailError?.(error, selection);
      }
    },
    [handlePluginDetail, handlePluginDetailError, preferred],
  );

  const lastTrigger = useRef(refreshTrigger);
  useEffect(() => {
    // Serve the first render from cache; only hit the backend when there is
    // nothing cached or the user explicitly asked for a refresh.
    const refreshRequested = refreshTrigger !== lastTrigger.current;
    lastTrigger.current = refreshTrigger;
    if (readPluginCatalogCache() && !refreshRequested) return;
    void loadPlugins(refreshRequested);
  }, [loadPlugins, refreshTrigger]);

  const lastRevision = useRef(revision);
  useEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    if (!isPluginScopeCurrent(domain.current)) {
      domain.current = capturePluginScope();
      requestVersion.current++;
      detailVersion.current++;
      detailRead.current?.abort();
      setMarketplaces([]);
      setErrors([]);
      setInstallingPluginId(null);
    }
    void loadPlugins(false);
  }, [revision, loadPlugins]);

  const browseGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const groupsMap = new Map<string, PluginEntry[]>();
    entries.forEach(({ marketplace: m, plugin: p }) => {
      if (needle) {
        const haystack = [
          p.name,
          p.interface?.displayName ?? "",
          p.interface?.shortDescription ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return;
      }
      const category = p.interface?.category || "Others";
      if (!groupsMap.has(category)) {
        groupsMap.set(category, []);
      }
      groupsMap.get(category)!.push({ marketplace: m, plugin: p });
    });
    return Array.from(groupsMap.entries()).sort(([a], [b]) => {
      if (a === "Others") return 1;
      if (b === "Others") return -1;
      return a.localeCompare(b);
    });
  }, [entries, query]);

  return {
    marketplaces,
    errors,
    loadError,
    isLoading,
    installingPluginId,
    query,
    setQuery,
    loadPlugins,
    handleInstall,
    handleUsePlugin,
    handleShowDetail,
    browseGroups,
  };
}
