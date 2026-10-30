import { requestSessionNavigation } from "@session/services/sessionNavigationGuard";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSummary, PluginDetail } from "@session/bindings/v2";
import { pluginNotice as toast } from "../pluginNotices";
import {
  pluginRead,
  readSkillGroups,
  type SkillGroupsConfig,
  writeSkillGroups,
} from "@session/services";
import { usePluginStore } from "@session/stores";
import { usePluginsNavigationStore } from "@session/stores/usePluginsNavigationStore";
import {
  pluginDetailRequestTarget,
  assertPluginDetailTarget,
  type PluginRequestTarget,
} from "./pluginTargets";
import { useExternalUrl } from "./useExternalUrl";
import { tryPluginInComposer } from "../pluginNavigation";
import {
  capturePluginScope,
  isPluginScopeCurrent,
  publishPluginChange,
  usePluginCatalogRevision,
} from "../pluginScope";
import {
  performPluginOperation,
  readPluginAuthentication,
} from "../pluginOperations";
export type MainTab = "Plugins" | "Skills" | "Connectors";
export type Overlay = "manage" | "add" | "detail" | null;
export type ManageTab = "Skills" | "Connectors";
export type AddTab = "Connector" | "Skill";
export type SkillScope = "user" | "project";
export const pluginDetailKey = (plugin: PluginDetail) =>
  JSON.stringify(pluginDetailRequestTarget(plugin));
export type PluginAuthentication = {
  target: PluginRequestTarget;
  name: string;
  apps: Array<AppSummary & { isAccessible?: boolean | null }>;
  scope: ReturnType<typeof capturePluginScope>;
};
export function usePluginsView() {
  const { openExternalUrl } = useExternalUrl(),
    revision = usePluginCatalogRevision();
  const { mainTab, setMainTab, connectorTarget, setConnectorTarget } =
    usePluginsNavigationStore();
  const [overlay, setOverlay] = useState<Overlay>(null),
    [manageTab, setManageTab] = useState<ManageTab>("Connectors"),
    [addTab, setAddTab] = useState<AddTab>("Connector"),
    [refreshTrigger, setRefreshTrigger] = useState(0),
    [manageRefreshKey, setManageRefreshKey] = useState(0),
    [groupsConfig, setGroupsConfig] = useState<SkillGroupsConfig>({
      groups: [],
    }),
    [selectedPluginDetail, setSelectedPluginDetail] =
      useState<PluginDetail | null>(null),
    [installingPluginId, setInstallingPluginId] = useState<string | null>(null),
    [uninstallingPluginId, setUninstallingPluginId] = useState<string | null>(
      null,
    ),
    [authentication, setAuthentication] = useState<PluginAuthentication | null>(
      null,
    ),
    [authenticationBusy, setAuthenticationBusy] = useState(false),
    [operationError, setOperationError] = useState<string | null>(null);
  const { skillScope: scope, setSkillScope: setScope } = usePluginStore();
  const mounted = useRef(true),
    detailVersion = useRef(0),
    selected = useRef<PluginDetail | null>(null),
    domain = useRef(capturePluginScope()),
    inflight = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void readSkillGroups()
      .then((value) => {
        if (active) setGroupsConfig(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      mounted.current = false;
      detailVersion.current++;
    };
  }, []);
  useEffect(() => {
    if (isPluginScopeCurrent(domain.current)) return;
    domain.current = capturePluginScope();
    detailVersion.current++;
    selected.current = null;
    setSelectedPluginDetail(null);
    setOverlay(null);
    setAuthentication(null);
    setAuthenticationBusy(false);
    setInstallingPluginId(null);
    setUninstallingPluginId(null);
    setOperationError("插件账号或连接已变化，请重新打开详情。");
  }, [revision]);
  const saveGroups = useCallback(async (config: SkillGroupsConfig) => {
    setGroupsConfig(config);
    await writeSkillGroups(config);
  }, []);
  const handleMcpAdded = useCallback(() => {
    setManageRefreshKey((value) => value + 1);
    setOverlay("manage");
    setManageTab("Connectors");
  }, []);
  /** A detail request may enrich only the exact still-open selection generation. */
  const handlePluginDetail = useCallback(
    (plugin: PluginDetail | null, expectedVersion?: number) => {
      if (
        expectedVersion !== undefined &&
        expectedVersion !== detailVersion.current
      )
        return detailVersion.current;
      if (expectedVersion === undefined) {
        detailVersion.current++;
        setOperationError(null);
      }
      selected.current = plugin;
      setSelectedPluginDetail(plugin);
      setOverlay(plugin ? "detail" : null);
      return detailVersion.current;
    },
    [],
  );
  const handlePluginDetailError = useCallback(
    (error: unknown, version: number) => {
      if (mounted.current && version === detailVersion.current)
        setOperationError(
          "插件详情尚未加载：" +
            String(error instanceof Error ? error.message : error) +
            "。返回后重新打开可重试。",
        );
    },
    [],
  );
  const refreshSelectedPluginDetail = useCallback(
    async (
      plugin: PluginDetail,
      version: number,
      captured: ReturnType<typeof capturePluginScope>,
    ) => {
      const target = pluginDetailRequestTarget(plugin);
      if (!target) return;
      try {
        const response = await pluginRead(target);
        if (
          !mounted.current ||
          !isPluginScopeCurrent(captured) ||
          version !== detailVersion.current ||
          !selected.current ||
          pluginDetailKey(selected.current) !== pluginDetailKey(plugin)
        )
          return;
        assertPluginDetailTarget(response.plugin, target);
        selected.current = response.plugin;
        setSelectedPluginDetail(response.plugin);
      } catch (error) {
        if (
          mounted.current &&
          isPluginScopeCurrent(captured) &&
          version === detailVersion.current
        )
          setOperationError(
            "操作回执已保留，详情刷新失败：" +
              String(error instanceof Error ? error.message : error),
          );
      }
    },
    [],
  );
  const mutate = useCallback(
    async (
      plugin: PluginDetail,
      operation: "install" | "uninstall",
      override?: PluginRequestTarget,
      inspectOnly = false,
    ) => {
      const target = override ?? pluginDetailRequestTarget(plugin);
      if (!target) {
        setOperationError("无法确认该插件的原生市场来源，操作未发送。");
        return;
      }
      const key = JSON.stringify(target),
        captured = capturePluginScope(),
        version = detailVersion.current,
        name = plugin.summary.interface?.displayName ?? plugin.summary.name;
      if (inflight.current.has(key)) return;
      inflight.current.add(key);
      const setBusy =
        operation === "install"
          ? setInstallingPluginId
          : setUninstallingPluginId;
      setBusy(key);
      setOperationError(null);
      try {
        const result = await performPluginOperation(
          target,
          operation,
          inspectOnly,
        );
        if (!mounted.current || !isPluginScopeCurrent(captured)) return result;
        if (result.status === "unknown" || result.status === "rejected") {
          setOperationError(
            `${name}：${result.error ?? "操作结果待核对"}。再次点击只核对原状态，不会重复安装或卸载。`,
          );
          toast({
            title: "插件结果待核对",
            description: result.error ?? "不会重复执行原操作",
            variant: "destructive",
          });
          return result;
        }
        publishPluginChange();
        setRefreshTrigger((value) => value + 1);
        if (
          result.plugin &&
          result.plugin.summary.installed !== (operation === "install")
        )
          setOperationError(
            `${name}：原状态已核对，目前${result.plugin?.summary.installed ? "已安装" : "未安装"}；需要变更请再次明确点击。`,
          );
        if (
          version === detailVersion.current &&
          selected.current &&
          pluginDetailKey(selected.current) === pluginDetailKey(plugin)
        ) {
          const next = result.plugin ?? {
            ...selected.current,
            summary: {
              ...selected.current.summary,
              installed: operation === "install",
            },
          };
          selected.current = next;
          setSelectedPluginDetail(next);
          void refreshSelectedPluginDetail(plugin, version, captured);
        }
        if (operation === "install" && result.appsNeedingAuth.length)
          setAuthentication({
            target,
            name,
            apps: result.appsNeedingAuth,
            scope: captured,
          });
        else if (
          operation === "install" &&
          result.plugin?.apps.some((app) => app.installUrl)
        )
          setAuthentication({
            target,
            name,
            apps: result.plugin.apps.filter((app) => app.installUrl),
            scope: captured,
          });
        else if (operation === "uninstall")
          setAuthentication((value) =>
            value && JSON.stringify(value.target) === key ? null : value,
          );
        toast({
          title: result.plugin
            ? "插件状态已核对"
            : operation === "install"
              ? "插件安装状态已确认"
              : "插件卸载状态已确认",
          description: result.appsNeedingAuth.length
            ? `${name} 仍有 ${result.appsNeedingAuth.length} 项认证，请逐项完成。`
            : name,
        });
        return result;
      } catch (error) {
        if (mounted.current && isPluginScopeCurrent(captured)) {
          const message =
            error instanceof Error ? error.message : String(error);
          setOperationError(`${name}：${message}。请核对状态，不要重复操作。`);
          toast({
            title: "插件操作失败",
            description: message,
            variant: "destructive",
          });
        }
      } finally {
        inflight.current.delete(key);
        if (mounted.current && isPluginScopeCurrent(captured))
          setBusy((value) => (value === key ? null : value));
      }
    },
    [refreshSelectedPluginDetail],
  );
  const handlePluginInstall = useCallback(
    (plugin: PluginDetail, target?: PluginRequestTarget) =>
      mutate(plugin, "install", target),
    [mutate],
  );
  const handlePluginUninstall = useCallback(
    (plugin: PluginDetail) => mutate(plugin, "uninstall"),
    [mutate],
  );
  const checkAuthentication = useCallback(async () => {
    const captured = authentication;
    if (
      !captured ||
      authenticationBusy ||
      !isPluginScopeCurrent(captured.scope)
    )
      return;
    setAuthenticationBusy(true);
    setOperationError(null);
    try {
      const value = await readPluginAuthentication(
        captured.target,
        captured.apps.map((app) => app.id),
      );
      if (mounted.current && isPluginScopeCurrent(captured.scope))
        setAuthentication((current) =>
          current === captured
            ? {
                ...captured,
                apps: captured.apps.map((app) => ({
                  ...app,
                  isAccessible:
                    value.apps.find((value) => value.id === app.id)
                      ?.isAccessible ?? null,
                })),
              }
            : current,
        );
    } catch (error) {
      if (mounted.current && isPluginScopeCurrent(captured.scope))
        setOperationError(
          "认证状态尚未核实：" +
            String(error instanceof Error ? error.message : error),
        );
    } finally {
      if (mounted.current && isPluginScopeCurrent(captured.scope))
        setAuthenticationBusy(false);
    }
  }, [authentication, authenticationBusy]);
  const openAuthentication = useCallback(
    async (app: AppSummary) => {
      if (
        !authentication ||
        !isPluginScopeCurrent(authentication.scope) ||
        !authentication.apps.some((value) => value === app) ||
        !app.installUrl
      )
        return;
      try {
        const url = new URL(app.installUrl);
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new Error("认证地址无效");
        await openExternalUrl(url.href);
      } catch (error) {
        setOperationError(
          "无法打开认证页面：" +
            String(error instanceof Error ? error.message : error),
        );
      }
    },
    [authentication, openExternalUrl],
  );
  const handleInspectPlugin = useCallback(
    (plugin: PluginDetail) => mutate(plugin, "install", undefined, true),
    [mutate],
  );
  const showPluginAuthentication = useCallback((plugin: PluginDetail) => {
    const target = pluginDetailRequestTarget(plugin);
    if (target && isPluginScopeCurrent(domain.current))
      setAuthentication({
        target,
        name: plugin.summary.interface?.displayName ?? plugin.summary.name,
        apps: plugin.apps.filter((app) => app.installUrl),
        scope: capturePluginScope(),
      });
  }, []);
  const handleUsePlugin = useCallback((plugin: PluginDetail) => {
    tryPluginInComposer(plugin.summary);
  }, []);
  return {
    mainTab,
    setMainTab: (next: MainTab) =>
      requestSessionNavigation(() => setMainTab(next)),
    connectorTarget,
    setConnectorTarget: (next: "agent" | "bots") =>
      requestSessionNavigation(() => setConnectorTarget(next)),
    overlay,
    setOverlay: (next: Overlay) =>
      requestSessionNavigation(() => setOverlay(next)),
    manageTab,
    setManageTab: (next: ManageTab) =>
      requestSessionNavigation(() => setManageTab(next)),
    addTab,
    setAddTab: (next: AddTab) =>
      requestSessionNavigation(() => setAddTab(next)),
    refreshTrigger,
    setRefreshTrigger,
    manageRefreshKey,
    setManageRefreshKey,
    groupsConfig,
    saveGroups,
    scope,
    setScope,
    handleMcpAdded,
    selectedPluginDetail,
    handlePluginDetail,
    handlePluginDetailError,
    installingPluginId,
    uninstallingPluginId,
    handlePluginInstall,
    handlePluginUninstall,
    handleInspectPlugin,
    showPluginAuthentication,
    handleUsePlugin,
    authentication,
    setAuthentication,
    authenticationBusy,
    checkAuthentication,
    openAuthentication,
    operationError,
  };
}
