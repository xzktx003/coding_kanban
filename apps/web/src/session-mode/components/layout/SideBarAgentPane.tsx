import { ListFilter, Package2, Timer } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNewThread, useThreadList } from '@session/components/codex/hooks';
import { NewAgentButton } from '@session/components/common/NewAgentButton';
import { Button } from '@session/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@session/components/ui/dropdown-menu';
import { useSidebar } from '@session/components/ui/sidebar';
import { useCCSessionManager } from '@session/hooks/useCCSessionManager';
import { useLayoutStore } from '@session/stores';
import { useAcpStore } from '@session/stores/useAcpStore';
import { useAgentSettingsStore } from '@session/stores/useAgentSettingsStore';
import { useWorkspaceStore } from '@session/stores/useWorkspaceStore';
import { SideBarAddProjectButton } from './SideBarAddProjectButton';
import { SideBarAcpTab, SideBarClaudeTab, SideBarCodexTab } from './SideBarTab';

const focusCCInput = () => window.dispatchEvent(new Event('cc-input-focus-request'));

// Shared class for nav buttons (Automations / Marketplace)
const navBtnBase = 'justify-start gap-2 rounded-md border px-2.5';
const navBtnActive = 'border-border bg-accent/70 text-accent-foreground';
const navBtnInactive = 'border-transparent hover:border-border/60';
const navBtnCls = (active: boolean) => `${navBtnBase} ${active ? navBtnActive : navBtnInactive}`;

/** New conversation action; section navigation belongs to the mode toolbar. */
export function SideBarAgentHeader() {
  return <div className="px-1 pb-2"><NewAgentButton showLabel /></div>;
}

/** Project-specific sorting and creation actions. */
export function SideBarProjectActions() {
  const { selectedAgent } = useAgentSettingsStore();
  const { open: isSidebarOpen } = useSidebar();
  const { sortKey, setSortKey } = useThreadList({
    enabled: isSidebarOpen && selectedAgent === 'codex',
  });
  const currentThreadSortLabel = sortKey === 'created_at' ? 'Created' : 'Updated';

  return (
    <div className="flex items-center justify-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={`Filter threads (current: ${currentThreadSortLabel})`}
          >
            <ListFilter className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={sortKey}
            onValueChange={(v) => setSortKey(v as 'created_at' | 'updated_at')}
          >
            <DropdownMenuRadioItem value="created_at">Sort by Created</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="updated_at">Sort by Updated</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <button className="text-xs text-muted-foreground px-2" title="打开历史项目" onClick={() => window.dispatchEvent(new Event("session-project-history"))}>历史</button>
      <SideBarAddProjectButton />
    </div>
  );
}

/** The Agent tab's list — `selectedAgent` is the single source of truth. */
export function SideBarAgentList() {
  const { cwd, setCwd } = useWorkspaceStore();
  const { setSelectedAgent, selectedAgent } = useAgentSettingsStore();
  const acpActive = useAcpStore((s) => s.active);
  const { setView, setActiveSidebarTab } = useLayoutStore();
  const { handleNewThread } = useNewThread();
  const { handleNewSession } = useCCSessionManager();

  const handleCreateNewThreadForProject = useCallback(
    (project: string) => {
      if (project !== cwd) setCwd(project);
      void handleNewThread();
    },
    [cwd, handleNewThread, setCwd]
  );

  const handleStartNewAcpSessionForProject = useCallback(
    (directory: string) => {
      setView('agent');
      setCwd(directory);
      // `restart` tears down the connection and asks the composer to reconnect
      // in the new workspace.
      useAcpStore.getState().restart();
    },
    [setCwd, setView]
  );

  const handleStartNewCcSessionForProject = useCallback(
    async (directory: string) => {
      setSelectedAgent('cc');
      setActiveSidebarTab('cc');
      setView('agent');
      setCwd(directory);
      await handleNewSession();
      focusCCInput();
    },
    [handleNewSession, setActiveSidebarTab, setCwd, setSelectedAgent, setView]
  );

  if (acpActive) {
    return <SideBarAcpTab onStartNewSession={handleStartNewAcpSessionForProject} />;
  }
  if (selectedAgent === 'codex') {
    return <SideBarCodexTab onCreateNewThread={handleCreateNewThreadForProject} />;
  }
  return <SideBarClaudeTab onStartNewSession={handleStartNewCcSessionForProject} />;
}
