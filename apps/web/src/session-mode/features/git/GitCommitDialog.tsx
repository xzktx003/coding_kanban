import { useState } from "react";
import { Button } from "@session/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@session/components/ui/dialog";
import { Textarea } from "@session/components/ui/textarea";

interface GitCommitDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (message: string) => Promise<void>;
}

export function GitCommitDialog({
  isOpen,
  onClose,
  onConfirm,
}: GitCommitDialogProps) {
  const [commitMessage, setCommitMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!commitMessage.trim()) return;
    setLoading(true);
    try {
      await onConfirm(commitMessage);
      setCommitMessage("");
      onClose();
    } catch {
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>提交 Git 更改</DialogTitle>
          <DialogDescription>
            填写提交说明，将当前已暂存的更改提交到本地仓库。
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="说明这次更改…"
            aria-label="Git 提交说明"
            autoFocus
            className="min-h-[100px] bg-muted/20 border-border"
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleConfirm();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || !commitMessage.trim()}
          >
            {loading ? "正在提交…" : "提交更改"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
