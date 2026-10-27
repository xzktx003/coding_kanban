import { useState } from "react";
import { toast } from "sonner";
import {
  OwnerFormSummary,
  useConversationFormField,
  useConversationOwnerForm,
} from "@session/components/codex/composer/conversationOwnerFormContext";
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
  const [commitMessage, setCommitMessage] =
    useConversationFormField("commitMessage");
  const owner = useConversationOwnerForm();
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!commitMessage.trim() || loading || owner?.pending) return;
    setLoading(true);
    try {
      if (owner)
        await owner.run(
          () => onConfirm(commitMessage),
          () => {
            toast.message(`已提交：${commitMessage}`);
            onClose();
          },
        );
      else {
        await onConfirm(commitMessage);
        setCommitMessage("");
        onClose();
      }
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
        <OwnerFormSummary />
        <div className="py-4">
          <Textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="说明这次更改…"
            aria-label="Git 提交说明"
            autoFocus
            className="min-h-[100px] bg-muted/20 border-border"
            disabled={loading || owner?.pending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleConfirm();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={loading || owner?.pending}
          >
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || owner?.pending || !commitMessage.trim()}
          >
            {loading ? "正在提交…" : "提交更改"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
