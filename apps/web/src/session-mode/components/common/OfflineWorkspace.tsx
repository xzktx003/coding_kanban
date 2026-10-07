import { useState } from "react";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { Button } from "@session/components/ui/button";
import { Input } from "@session/components/ui/input";

/** Cached metadata remains usable while the runtime is unavailable; no Agent requests are made here. */
export function OfflineWorkspace({ retry }: { retry: () => void }) {
  const ws = useWorkspaceStore(),
    tabs = useAgentCenterStore();
  const [path, setPath] = useState(""),
    [error, setError] = useState("");
  const moveProject = (index: number, direction: number) => {
    const projects = [...ws.projects],
      target = index + direction;
    if (target < 0 || target >= projects.length) return;
    [projects[index], projects[target]] = [projects[target], projects[index]];
    ws.setProjects(projects);
  };
  return (
    <div className="h-full min-h-0 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div role="status" className="rounded-lg border p-4 space-y-2">
          <h1 className="font-medium">正在连接，已保存的记录仍可使用</h1>
          <p className="text-sm text-muted-foreground">
            项目和关注会话已保存在本设备。此处的修改会在重连后同步；对话内容和任务操作将在连接恢复后加载。
          </p>
          <Button variant="outline" onClick={retry}>
            重试连接
          </Button>
        </div>
        <section aria-label="已保存项目" className="space-y-2">
          <h2 className="text-sm font-medium">项目</h2>
          {ws.projects.map((project, index) => (
            <div
              key={project}
              className="flex min-w-0 gap-1 items-center rounded-md border p-2"
            >
              <button
                className="flex-1 min-w-0 text-left text-sm truncate"
                title={project}
                onClick={() => ws.setCwd(project)}
                aria-pressed={ws.cwd === project}
              >
                {project}
              </button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`上移项目 ${project}`}
                disabled={index === 0}
                onClick={() => moveProject(index, -1)}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`下移项目 ${project}`}
                disabled={index === ws.projects.length - 1}
                onClick={() => moveProject(index, 1)}
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`移出项目 ${project}`}
                onClick={() => ws.removeProject(project)}
              >
                移出
              </Button>
            </div>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = path.trim();
              if (
                !value.startsWith("/") ||
                value.length > 4096 ||
                /[\\\x00-\x1f]/.test(value)
              ) {
                setError("请输入服务器上的绝对项目路径");
                return;
              }
              ws.addProject(value);
              setPath("");
              setError("");
            }}
          >
            <Input
              aria-label="保存项目路径"
              placeholder="服务器上的绝对项目路径"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <Button type="submit">添加</Button>
          </form>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </section>
        <section aria-label="已保存关注会话" className="space-y-2">
          <h2 className="text-sm font-medium">关注会话</h2>
          {tabs.cards.map((card, index) => (
            <div
              key={`${card.kind}:${card.id}`}
              className="flex min-w-0 gap-1 items-center rounded-md border p-2"
            >
              <button
                className="flex-1 min-w-0 text-left text-sm truncate"
                onClick={() => tabs.setCurrentAgentCardId(card.id, card.kind)}
                aria-pressed={
                  tabs.currentAgentCardId === card.id &&
                  tabs.currentAgentCardKind === card.kind
                }
              >
                {card.preview || card.id}
              </button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`上移关注会话 ${card.id}`}
                disabled={index === 0}
                onClick={() => tabs.moveCard(card, tabs.cards[index - 1])}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`下移关注会话 ${card.id}`}
                disabled={index === tabs.cards.length - 1}
                onClick={() => tabs.moveCard(card, tabs.cards[index + 1])}
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`移出关注会话 ${card.id}`}
                onClick={() => tabs.removeCard(card)}
              >
                移出
              </Button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
