import { codexService } from '@session/services/codexService';
import { open } from '@session/browser-dialog';
import { Check, ChevronDown, FolderOpen, FolderPlus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { type ThreadCwdMode, useConfigStore } from '@session/components/codex/stores';
import { Button } from '@session/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@session/components/ui/dropdown-menu';
import { BrowserProjects } from '@session/features/ProjectSelector';
import { isDesktopTauri } from '@session/hooks/runtime';
import { useCCStore } from '@session/stores';
import { useAgentSettingsStore } from '@session/stores/useAgentSettingsStore';
import { useWorkspaceStore } from '@session/stores/useWorkspaceStore';
import { BranchSwitcher } from '../../features/branch';
import { AgentWorkspaceSelect } from './AgentWorkspaceSelect';

export function WorkspaceSwitcher() {
  const [projectOpen, setProjectOpen] = useState(false);
  const [browseMode, setBrowseMode] = useState(false);
  const { cwd, projects, addProject, setCwd } = useWorkspaceStore();
  const { selectedAgent } = useAgentSettingsStore();
  const { options, updateOptions } = useCCStore();
  const { threadCwdMode, setThreadCwdMode } = useConfigStore();

  const handleSelectProject = useCallback(
    async (project: string) => {
      await codexService.setCurrentThread(null);
      setCwd(project);
      setProjectOpen(false);
    },
    [setCwd]
  );

  async function handleSelectBrowseProject(path: string) {
    await codexService.setCurrentThread(null);
    addProject(path);
    setCwd(path);
    setBrowseMode(false);
    setProjectOpen(false);
  }

  const handleChooseFolder = useCallback(async () => {
    if (isDesktopTauri()) {
      const projectPath = await open({ directory: true, multiple: false });
      if (!projectPath || Array.isArray(projectPath)) return;
      addProject(projectPath as string);
      setCwd(projectPath as string);
      setProjectOpen(false);
    } else {
      setBrowseMode(true);
    }
  }, [addProject, setCwd]);

  const repoLabel = cwd ? (cwd.split('/').filter(Boolean).pop() ?? cwd) : '选择项目';

  return (
    <div className="session-workspace-switcher flex items-center gap-1 font-mono py-2">
      {/* Left: Project selector */}
      <DropdownMenu
        open={projectOpen}
        onOpenChange={(o) => {
          setProjectOpen(o);
          if (!o) setBrowseMode(false);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto gap-1 px-1.5 py-0.5 text-xs text-muted-foreground"
          >
            <FolderOpen className="h-3 w-3 shrink-0" />
            <span>{repoLabel}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-fix">
          {browseMode ? (
            <BrowserProjects cwd={cwd} onAddProject={handleSelectBrowseProject} />
          ) : (
            <>
              <div className="max-h-60 overflow-y-auto p-1">
                {projects.map((project) => {
                  const isCurrent = project === cwd;
                  const folderName = project.split('/').filter(Boolean).pop() ?? project;
                  return (
                    <DropdownMenuItem
                      key={project}
                      asChild
                      onSelect={(e) => {
                        e.preventDefault();
                        handleSelectProject(project);
                      }}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-xs font-mono focus-visible:ring-0"
                      >
                        <div className="flex w-full justify-between items-center">
                          <span className="font-medium">{folderName}</span>
                          {isCurrent ? (
                            <Check className="h-3 w-3 shrink-0 text-primary" />
                          ) : (
                            <span className="h-3 w-3 shrink-0" />
                          )}
                        </div>
                      </Button>
                    </DropdownMenuItem>
                  );
                })}
              </div>
              <div className="border-t p-1">
                <DropdownMenuItem
                  asChild
                  onSelect={(e) => {
                    e.preventDefault();
                    handleChooseFolder();
                  }}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto w-full justify-start gap-2 text-xs text-muted-foreground focus-visible:ring-0"
                  >
                    <FolderPlus className="h-3 w-3 shrink-0" />
                    <span>Choose a different folder</span>
                  </Button>
                </DropdownMenuItem>
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedAgent === 'cc' ? (
        <AgentWorkspaceSelect
          value={options.worktreeMode ?? 'local'}
          onValueChange={(v: ThreadCwdMode) => updateOptions({ worktreeMode: v })}
        />
      ) : (
        <AgentWorkspaceSelect
          value={threadCwdMode}
          onValueChange={(v: ThreadCwdMode) => setThreadCwdMode(v)}
        />
      )}

      <BranchSwitcher cwd={cwd} />
    </div>
  );
}
