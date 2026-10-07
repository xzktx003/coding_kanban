import { useEffect, useState } from "react";
import { CCSessionManager } from "@session/components/cc/session";
import { CodexThreadManager } from "@session/components/codex/thread/CodexThreadManager";
import { AgentIcon } from "@session/components/common/AgentIcon";
import { Button } from "@session/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@session/components/ui/dialog";

type AgentTab = "cc" | "codex";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: AgentTab;
}

export function SessionManagerDialog({
  open,
  onOpenChange,
  defaultTab = "cc",
}: Props) {
  const [activeTab, setActiveTab] = useState<AgentTab>(defaultTab);

  // Reset tab when dialog opens
  useEffect(() => {
    if (open) setActiveTab(defaultTab);
  }, [open, defaultTab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="session-manager-dialog flex flex-col gap-0 p-0 sm:max-w-2xl h-[min(80dvh,720px)]">
        <DialogHeader className="flex flex-row items-center justify-between px-4 pt-4 pb-0 shrink-0">
          <DialogTitle className="text-base">管理会话</DialogTitle>
          {/* Agent tab switcher */}
          <div className="session-manager-agent-tabs flex items-center gap-1 mr-6">
            {(["cc", "codex"] as AgentTab[]).map((tab) => (
              <Button
                key={tab}
                variant="ghost"
                size="sm"
                className={`h-8 px-2 ${activeTab === tab ? "bg-accent" : ""}`}
                onClick={() => setActiveTab(tab)}
                title={tab === "cc" ? "Claude 会话" : "Codex 会话"}
                aria-label={tab === "cc" ? "Claude 会话" : "Codex 会话"}
                aria-pressed={activeTab === tab}
              >
                <AgentIcon agent={tab} />
                <span>{tab === "cc" ? "Claude" : "Codex"}</span>
              </Button>
            ))}
          </div>
        </DialogHeader>

        <div className="flex flex-col flex-1 min-h-0 px-4 pb-4 pt-3">
          {activeTab === "cc" ? (
            <CCSessionManager open={open} onClose={() => onOpenChange(false)} />
          ) : (
            <CodexThreadManager onClose={() => onOpenChange(false)} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
