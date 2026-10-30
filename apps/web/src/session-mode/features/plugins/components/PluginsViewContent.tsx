import { useCallback, useEffect, useRef, useState } from "react";
import CCMcpView from "@session/components/cc/mcp/CCMcpView";
import { CodexMcpView } from "@session/features/mcp/CodexMcpView";
import { DefaultMcpServers } from "@session/features/mcp/DefaultMcpServers";
import { KekeMcpView } from "@session/features/mcp/KekeMcpView";
import { McpAddPanel } from "@session/features/mcp/McpAddPanel";
import { Clone } from "@session/features/skills/Clone";
import { InstalledTab } from "@session/features/skills/InstalledTab";
import SkillsViewContent from "@session/features/skills/SkillsView";
import { unifiedReadMcpConfig } from "@session/services";
import { readKekeMcpServers } from "@session/services/apiAdapt/kekeMcp";
import { useAgentSettingsStore, useWorkspaceStore } from "@session/stores";
import { usePluginsViewContext } from "../hooks";
import { PluginDetailView } from "./PluginDetailView";
import { PluginsMarketplaceView } from "./PluginsMarketplaceView";
import { TabSwitcher } from "./TabSwitcher";
import { PluginAuthenticationPanel } from "./PluginAuthenticationPanel";
import { pluginDetailKey } from "../hooks/usePluginsView";
import { Button } from "@session/components/ui/button";

/** Main content area: switches between Plugins / Connectors / Skills, or a manage / add overlay. */
export function PluginsViewContent() {
  const { selectedAgent } = useAgentSettingsStore();
  const { cwd } = useWorkspaceStore();
  const { connectorTarget } = usePluginsViewContext();
  const quickAddRequest = useRef(0);
  const [quickAddState, setQuickAddState] = useState<{
    key: string;
    servers: Record<string, unknown>;
    error: string;
  }>({ key: "", servers: {}, error: "" });
  const targetKey =
    connectorTarget === "bots" ? "bots" : `${selectedAgent}:${cwd ?? ""}`;
  const loadQuickAddServers = useCallback(async () => {
    const request = ++quickAddRequest.current;
    try {
      const servers =
        connectorTarget === "bots"
          ? await readKekeMcpServers()
          : selectedAgent === "cc" && !cwd
            ? {}
            : ((await unifiedReadMcpConfig(selectedAgent, cwd || undefined))
                .mcpServers ?? {});
      if (request === quickAddRequest.current)
        setQuickAddState({ key: targetKey, servers, error: "" });
    } catch (error) {
      if (request === quickAddRequest.current)
        setQuickAddState({ key: targetKey, servers: {}, error: String(error) });
    }
  }, [selectedAgent, cwd, connectorTarget, targetKey]);
  const {
    mainTab,
    overlay,
    manageTab,
    setManageTab,
    addTab,
    setRefreshTrigger,
    refreshTrigger,
    manageRefreshKey,
    scope,
    groupsConfig,
    saveGroups,
    handleMcpAdded,
    selectedPluginDetail,
    installingPluginId,
    uninstallingPluginId,
    handlePluginInstall,
    handlePluginUninstall,
    handleUsePlugin,
    showPluginAuthentication,
    handleInspectPlugin,
    operationError,
  } = usePluginsViewContext();

  // biome-ignore lint/correctness/useExhaustiveDependencies: The shared refresh trigger intentionally reloads connector definitions.
  useEffect(() => {
    loadQuickAddServers();
  }, [loadQuickAddServers, refreshTrigger]);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {operationError && (
        <div
          role="alert"
          className="shrink-0 space-y-2 border-b border-border p-3 text-sm"
        >
          <p>{operationError}</p>
          {selectedPluginDetail && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleInspectPlugin(selectedPluginDetail)}
            >
              核对当前插件状态
            </Button>
          )}
        </div>
      )}
      <PluginAuthenticationPanel />
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* Kept mounted under the detail overlay so going back does not reload the list. */}
        {(!overlay || overlay === "detail") && mainTab === "Plugins" && (
          <div className={overlay === "detail" ? "hidden" : "h-full"}>
            <PluginsMarketplaceView refreshTrigger={refreshTrigger} />
          </div>
        )}
        {!overlay && mainTab === "Skills" && <SkillsViewContent />}

        {!overlay && mainTab === "Connectors" && (
          <div className="h-full overflow-y-auto p-4">
            {quickAddState.key !== targetKey ? (
              <p className="text-sm text-muted-foreground">
                Loading connectors…
              </p>
            ) : quickAddState.error ? (
              <p role="alert" className="text-sm text-destructive">
                Could not load connectors: {quickAddState.error}
              </p>
            ) : (
              <DefaultMcpServers
                agent={connectorTarget === "bots" ? "keke" : selectedAgent}
                cwd={cwd || undefined}
                servers={quickAddState.servers}
                onServerAdded={() => {
                  setRefreshTrigger((t: number) => t + 1);
                }}
              />
            )}
          </div>
        )}

        {overlay === "manage" && (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5 mx-3 mt-2">
              <TabSwitcher
                tabs={["Connectors", "Skills"] as const}
                active={manageTab}
                onChange={setManageTab}
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto py-3">
              {manageTab === "Connectors" ? (
                connectorTarget === "bots" ? (
                  <KekeMcpView refreshKey={manageRefreshKey + refreshTrigger} />
                ) : selectedAgent === "codex" ? (
                  <CodexMcpView refreshKey={manageRefreshKey} />
                ) : (
                  <CCMcpView refreshKey={manageRefreshKey} />
                )
              ) : (
                <div className="px-4">
                  <InstalledTab
                    searchQuery=""
                    scope={scope}
                    refreshKey={manageRefreshKey}
                    groupsConfig={groupsConfig}
                    onGroupsChange={saveGroups}
                    selectedGroupId={null}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {overlay === "add" && (
          <div className="h-full overflow-y-auto p-4">
            {addTab === "Connector" ? (
              <McpAddPanel
                key={connectorTarget}
                target={connectorTarget === "bots" ? "keke" : undefined}
                onAdded={handleMcpAdded}
              />
            ) : (
              <Clone />
            )}
          </div>
        )}

        {overlay === "detail" && selectedPluginDetail && (
          <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto">
              <PluginDetailView
                plugin={selectedPluginDetail}
                isInstalling={
                  installingPluginId === pluginDetailKey(selectedPluginDetail)
                }
                isUninstalling={
                  uninstallingPluginId === pluginDetailKey(selectedPluginDetail)
                }
                canInstall
                onInstall={() => handlePluginInstall(selectedPluginDetail)}
                onUninstall={() => handlePluginUninstall(selectedPluginDetail)}
                onUse={() => handleUsePlugin(selectedPluginDetail)}
                onAuthentication={() =>
                  showPluginAuthentication(selectedPluginDetail)
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
