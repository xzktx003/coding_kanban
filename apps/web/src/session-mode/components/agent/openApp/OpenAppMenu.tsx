import { CodeXml, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@session/components/ui/button";
import { openProjectVsCodeWeb } from "../../../../lib/api";

export function OpenAppMenu({ path }: { path: string }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openProject = async () => {
    if (opening) return;
    setError(null);
    // Reserve the tab during the click: browsers block window.open after an
    // asynchronous service startup. Detach its opener before navigation.
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      setError("浏览器阻止了新标签页，请允许弹出窗口后重试。");
      return;
    }
    tab.opener = null;
    setOpening(true);
    try {
      const result = await openProjectVsCodeWeb(path);
      tab.location.replace(result.url);
    } catch (cause) {
      tab.close();
      setError(
        cause instanceof Error
          ? cause.message
          : "VS Code Web 启动失败，请重试。",
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        className="session-vscode-trigger h-7 w-7 p-0"
        title="在 VS Code Web 中打开当前项目"
        aria-label="在 VS Code Web 中打开当前项目"
        disabled={opening}
        onClick={() => void openProject()}
      >
        {opening ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <CodeXml className="size-3.5" />
        )}
      </Button>
      {error && (
        <div
          role="alert"
          className="absolute right-0 top-full z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border bg-background p-2 text-xs text-destructive shadow-md"
        >
          {error}
        </div>
      )}
    </div>
  );
}
