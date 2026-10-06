import { codexService } from '@session/services/codexService';
import { open } from '@session/browser-dialog';
import { FolderPlus } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@session/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@session/components/ui/dialog';
import { BrowserProjects } from '@session/features/ProjectSelector';
import { isDesktopTauri } from '@session/hooks/runtime';
import { useWorkspaceStore } from '@session/stores/useWorkspaceStore';

export function SideBarAddProjectButton() {
  const { addProject, cwd, setCwd } = useWorkspaceStore();
  const [browserOpen, setBrowserOpen] = useState(false);

  const selectProject = useCallback(
    async (projectPath: string) => {
      await codexService.setCurrentThread(null);
      addProject(projectPath);
      setCwd(projectPath);
      setBrowserOpen(false);
    },
    [addProject, setCwd]
  );

  const handleAddProject = useCallback(async () => {
    if (!isDesktopTauri()) {
      setBrowserOpen(true);
      return;
    }

    const projectPath = await open({ directory: true, multiple: false });
    if (!projectPath || Array.isArray(projectPath)) return;
    selectProject(projectPath);
  }, [selectProject]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title="添加项目"
        onClick={handleAddProject}
      >
        <FolderPlus className="h-4 w-4" />
      </Button>
      <Dialog open={browserOpen} onOpenChange={setBrowserOpen}>
        <DialogContent size="xl" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>添加项目</DialogTitle>
            <DialogDescription>浏览服务器目录并选择要添加的项目。</DialogDescription>
          </DialogHeader>
          <BrowserProjects cwd={cwd} onAddProject={selectProject} />
        </DialogContent>
      </Dialog>
    </>
  );
}
