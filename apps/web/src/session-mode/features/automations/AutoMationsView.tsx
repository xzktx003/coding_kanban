import { Clock, ShoppingBag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@session/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@session/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@session/components/ui/tabs";
import { toast } from "@session/components/ui/use-toast";
import type { AutomationTask } from "@session/services/apiAdapt";
import {
  listAutomations,
  setAutomationPaused,
} from "@session/services/apiAdapt";
import { useLayoutStore } from "@session/stores";
import { getErrorMessage } from "@session/utils/errorUtils";
import { AutomationTaskList } from "./AutomationTaskList";
import { BUILTIN_TEMPLATES } from "./constants";
import { ManageDialog } from "./ManageDialog";
import { TaskDetailPanel } from "./TaskDetailPanel";
import type { DialogMode, TemplateTask } from "./types";
import { useAutomationRuns } from "./useAutomationRuns";
import { useBotNames } from "./useBotNames";
import { formFromTemplate } from "./utils";

export function AutoMationsView() {
  const { selectedAutomationTaskId, setSelectedAutomationTaskId } =
    useLayoutStore();
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoadedTasks, setHasLoadedTasks] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Unified dialog state: null = closed, { type: 'create' } = new, { type: 'edit', task } = edit
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const { getRunsForTask } = useAutomationRuns();
  const botNames = useBotNames();
  const [togglingPauseTaskId, setTogglingPauseTaskId] = useState<string | null>(
    null,
  );

  const loadAutomations = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await listAutomations();
      setTasks(data);
    } catch (error) {
      const message = getErrorMessage(error);
      setLoadError(message);
    } finally {
      setIsLoading(false);
      setHasLoadedTasks(true);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot load on mount; loadAutomations is rebuilt every render
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot load on mount; loadAutomations is rebuilt every render
  useEffect(() => {
    void loadAutomations();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const openBlankCreate = () => setDialogMode({ type: "create" });

  const openCreateFromTemplate = (template: TemplateTask) =>
    setDialogMode({ type: "create", initialForm: formFromTemplate(template) });

  const openEdit = (task: AutomationTask) =>
    setDialogMode({ type: "edit", task });

  const closeDialog = () => setDialogMode(null);

  const handleSelectTask = (task: AutomationTask) => {
    setSelectedAutomationTaskId(
      selectedAutomationTaskId === task.id ? null : task.id,
    );
  };

  const handleCreated = (task: AutomationTask) => {
    setTasks((prev) => [task, ...prev]);
    setSelectedAutomationTaskId(task.id);
  };

  const handleUpdated = (updated: AutomationTask) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setSelectedAutomationTaskId(updated.id);
    setDialogMode({ type: "edit", task: updated });
  };

  const handleDeleted = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (selectedAutomationTaskId === id) setSelectedAutomationTaskId(null);
  };

  const handleQuickTogglePaused = async (task: AutomationTask) => {
    setTogglingPauseTaskId(task.id);
    try {
      const updated = await setAutomationPaused(task.id, !task.paused);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (error) {
      const message = getErrorMessage(error);
      toast({
        title: "Update failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setTogglingPauseTaskId(null);
    }
  };

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedAutomationTaskId) ?? null,
    [tasks, selectedAutomationTaskId],
  );

  useEffect(() => {
    if (!hasLoadedTasks) return;
    if (!selectedAutomationTaskId) return;
    if (!tasks.some((task) => task.id === selectedAutomationTaskId)) {
      setSelectedAutomationTaskId(null);
    }
  }, [
    hasLoadedTasks,
    tasks,
    selectedAutomationTaskId,
    setSelectedAutomationTaskId,
  ]);

  return (
    <div className="h-full overflow-auto p-3 sm:p-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Tabs defaultValue="mine" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">定时任务</h1>
              <p className="text-sm text-muted-foreground">
                按计划自动执行 Agent 任务。
              </p>
            </div>

            <TabsList className="ml-auto">
              <TabsTrigger value="mine" className="gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                已安排
                {tasks.length > 0 && (
                  <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-xs font-medium text-primary">
                    {tasks.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="templates" className="gap-1.5">
                <ShoppingBag className="h-3.5 w-3.5" />
                模板
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="mine">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              {/* Left: task list */}
              {loadError ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-card p-4 text-sm"
                >
                  <p className="font-medium">定时任务加载失败</p>
                  <p className="mt-1 break-words text-muted-foreground">
                    {loadError}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    disabled={isLoading}
                    onClick={() => void loadAutomations()}
                  >
                    重试
                  </Button>
                </div>
              ) : (
                <AutomationTaskList
                  tasks={tasks}
                  botNames={botNames}
                  isLoading={isLoading}
                  now={now}
                  selectedTaskId={selectedTask?.id ?? null}
                  togglingPauseTaskId={togglingPauseTaskId}
                  onCreateNew={openBlankCreate}
                  onSelectTask={handleSelectTask}
                  onEditTask={openEdit}
                  onTogglePause={(task) => {
                    void handleQuickTogglePaused(task);
                  }}
                />
              )}

              {/* Right: detail panel */}
              <TaskDetailPanel
                task={selectedTask}
                now={now}
                runs={selectedTask ? getRunsForTask(selectedTask.id) : []}
                togglingPauseTaskId={togglingPauseTaskId}
              />
            </div>
          </TabsContent>

          <TabsContent value="templates" className="mt-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {BUILTIN_TEMPLATES.map((template) => (
                <Card
                  key={template.id}
                  className="flex cursor-pointer flex-col gap-2 py-3 transition-colors hover:bg-accent/30"
                  onClick={() => openCreateFromTemplate(template)}
                >
                  <CardHeader className="px-3 pb-1 pt-3">
                    <CardTitle className="text-base">{template.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col justify-between gap-2 px-3 pb-3 pt-0">
                    <p className="text-xs text-muted-foreground">
                      {template.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <ManageDialog
        mode={dialogMode}
        onClose={closeDialog}
        onCreated={handleCreated}
        onUpdated={handleUpdated}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
