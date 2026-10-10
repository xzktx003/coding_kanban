import { save } from "@session/browser-dialog";
import { Check, Copy, Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CodexMarkdown as Markdown } from "../presentation/CodexMarkdown";
import { Button } from "@session/components/ui/button";
import { isTauri } from "@session/hooks/runtime";
import { writeFile } from "@session/services";
import { openPlanWindow } from "@session/features/thread-workflows/planWindow";
import { useThemeContext } from "@session/contexts/ThemeContext";
import { useCodexContentOwner } from "../presentation/ownerContext";
import { NativePlanOpenWindow } from "@session/features/thread-workflows/NativeMessageIcons";
import { toast } from "sonner";
import { NativeChevronDown } from "../presentation/NativeIcons";
import "@session/features/thread-workflows/native-message.css";

type PlanContentItemProps = {
  text: string;
  running?: boolean;
  threadId?: string;
  turnId?: string;
};

export const PlanContentItem = ({
  text,
  running = false,
  threadId,
  turnId,
}: PlanContentItemProps) => {
  const { t, i18n } = useTranslation("thread");
  const theme = useThemeContext();
  const owner = useCodexContentOwner(threadId);
  const [collapsed, setCollapsed] = useState(true);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (!text.length) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1400);
    } catch (error) {
      console.error("Failed to copy plan text:", error);
    }
  };

  const handleDownload = async () => {
    if (!text.length || running) return;

    if (!isTauri()) {
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/markdown;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "plan.md";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }

    try {
      const filePath = await save({
        defaultPath: "plan.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!filePath) return;
      await writeFile(filePath, text);
    } catch (error) {
      console.error("Failed to save plan file:", error);
    }
  };

  if (!text.length) return null;

  return (
    <div>
      <div
        className="codex-plan overflow-hidden"
        data-owner-thread={threadId}
        data-owner-turn={turnId}
        data-streaming={running || undefined}
      >
        <div className="codex-plan-header flex items-center justify-between">
          <span className="codex-plan-title">
            {running ? "正在编写计划" : t("plan.label")}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="xs"
              disabled={running}
              aria-label="在新窗口打开计划"
              title="在新窗口打开计划"
              onClick={() => {
                try {
                  openPlanWindow({
                    text,
                    threadId: owner.threadId ?? undefined,
                    turnId,
                    cwd: owner.cwd,
                    theme,
                    i18n,
                  });
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }}
            >
              {i18n?.language?.startsWith("zh") ? "打开" : "Open"}
              <NativePlanOpenWindow width={12} height={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => void handleDownload()}
              disabled={!text.length || running}
              aria-label={t("plan.download")}
              title={t("plan.downloadFile")}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => void handleCopy()}
              disabled={!text.length || running}
              aria-label={copied ? t("plan.copied") : t("plan.copy")}
              title={copied ? t("plan.copied") : t("plan.copy")}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setCollapsed((prev) => !prev)}
              aria-label={
                collapsed ? t("plan.expandContent") : t("plan.collapseContent")
              }
              title={
                collapsed ? t("plan.expandContent") : t("plan.collapseContent")
              }
            >
              <NativeChevronDown
                width={12}
                height={12}
                className={collapsed ? "rotate-180" : undefined}
              />
            </Button>
          </div>
        </div>
        <div
          className="codex-plan-content"
          data-collapsed={collapsed ? "true" : "false"}
        >
          <div className="codex-plan-markdown">
            <Markdown value={text} threadId={threadId} streaming={running} />
          </div>
          {collapsed && (
            <>
              <div className="codex-plan-fade" aria-hidden="true" />
              <div className="codex-plan-expand">
                <Button size="xs" onClick={() => setCollapsed(false)}>
                  {t("plan.expandPlan")}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
