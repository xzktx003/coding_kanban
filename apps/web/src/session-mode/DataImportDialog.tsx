import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { getHomeDirectory } from "./services";
import { postJson } from "./services/apiAdapt/shared";
import { loadSettings } from "./lib/settings";
import { open } from "./browser-dialog";

interface Summary {
  projects: number;
  tasks: number;
  records: Record<string, number>;
}
export function DataImportDialog() {
  const [opened, setOpened] = useState(false);
  const [source, setSource] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function begin() {
    setOpened(true);
    if (!source) {
      try {
        setSource(`${await getHomeDirectory()}/.codexia`);
      } catch {
        /* The source remains editable. */
      }
    }
  }
  async function preview() {
    setBusy(true);
    setError(null);
    try {
      setSummary(await postJson<Summary>("/api/import/preview", { source }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法读取来源");
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<{
        projects: number;
        records: number;
        tasks: number;
        memoryFiles: number;
        warnings: string[];
      }>("/api/import/apply", { source });
      await loadSettings();
      window.dispatchEvent(new Event("session-data-imported"));
      toast.success(
        `已导入 ${result.projects} 个项目、${result.records} 条记录和 ${result.tasks} 个暂停的定时任务`,
      );
      if (result.warnings?.length) {
        setError(result.warnings.join("；"));
        setSummary(null);
      } else {
        setOpened(false);
        setSummary(null);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="session-import-trigger"
        onClick={begin}
        title="从 Codexia 导入应用数据"
      >
        <Download size={14} />
        <span>导入</span>
      </button>
      <Dialog
        open={opened}
        onOpenChange={(value) => {
          if (!busy) setOpened(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>从 Codexia 导入</DialogTitle>
            <DialogDescription>
              合并项目、Bots、会话历史和记忆。导入的定时任务保持暂停，之后可在界面启用。
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-2 text-sm">
            来源数据目录
            <Input
              aria-label="来源数据目录"
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setSummary(null);
              }}
            />
          </label>
          <Button
            variant="outline"
            onClick={async () => {
              const path = await open({ directory: true, defaultPath: source });
              if (typeof path === "string") {
                setSource(path);
                setSummary(null);
              }
            }}
          >
            浏览目录
          </Button>
          {summary && (
            <div className="session-import-summary">
              <span>
                项目<strong>{summary.projects}</strong>
              </span>
              <span>
                Bots<strong>{summary.records.bots ?? 0}</strong>
              </span>
              <span>
                会话<strong>{summary.records.acp_sessions ?? 0}</strong>
              </span>
              <span>
                定时任务<strong>{summary.tasks}</strong>
              </span>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setOpened(false)}
            >
              取消
            </Button>
            {summary ? (
              <Button disabled={busy} onClick={apply}>
                {busy && <Loader2 size={15} className="animate-spin" />}确认导入
              </Button>
            ) : (
              <Button disabled={busy || !source.trim()} onClick={preview}>
                {busy && <Loader2 size={15} className="animate-spin" />}预览数据
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
