import { useState } from "react";
import { Code2, FilePlus2, Quote, RotateCw } from "lucide-react";
import type {
  CodexEditorContext,
  CodexHostOwner,
} from "@agent-orchestrator/shared";
import { Button } from "@session/components/ui/button";
import { openVsCodePanel } from "@session/stores/useVsCodePanelStore";
import {
  addBrowserEditorContext,
  codexHostOwnerKey,
  editorHostCommand,
  reconnectEditorHost,
  useCodexHostStore,
} from "./bridge";
import { HostWorkspacePanel } from "./HostWorkspacePanel";
/** Explicit actions capture the original composer owner before asking the IDE. */
export function CodexHostPanel({ owner }: { owner: CodexHostOwner }) {
  const status = useCodexHostStore((s) => s.statuses[codexHostOwnerKey(owner)]);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function add(selectionOnly: boolean) {
    const captured = { ...owner };
    setPending(true);
    setError(null);
    try {
      addBrowserEditorContext(
        captured,
        (await editorHostCommand(captured, {
          type: "context",
          selectionOnly,
        })) as CodexEditorContext,
      );
    } catch (error) {
      setError(String(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-2 text-sm" aria-label="VS Code 上下文">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={openVsCodePanel}>
          <Code2 className="size-4" />
          打开 VS Code
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            void reconnectEditorHost(owner).catch((error) =>
              setError(String(error)),
            )
          }
        >
          <RotateCw className="size-4" />
          重连上下文
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !status?.capabilities.context}
          onClick={() => void add(false)}
        >
          <FilePlus2 className="size-4" />
          添加活动文件
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !status?.capabilities.context}
          onClick={() => void add(true)}
        >
          <Quote className="size-4" />
          添加选区
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {status?.available
          ? "上下文包含当前未保存文字；添加到本会话草稿后由你发送。TODO 行也可通过编辑器 CodeLens 添加。"
          : (status?.reason ??
            "在右侧打开该会话项目的 VS Code 后连接上下文。网页文件编辑器也提供相同的选区引用入口。")}
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <HostWorkspacePanel key={codexHostOwnerKey(owner)} owner={owner} />
    </div>
  );
}
