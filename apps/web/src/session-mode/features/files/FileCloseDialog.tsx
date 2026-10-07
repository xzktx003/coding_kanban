import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@session/components/ui/dialog";
import { Button } from "@session/components/ui/button";
import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
import { persistFileDraft } from "@session/services/workspaceFiles";
export function FileCloseDialog({
  path,
  onCancel,
  onClose,
}: {
  path: string | null;
  onCancel: () => void;
  onClose: (path: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      open={Boolean(path)}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setError("");
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogTitle>文件尚未保存</DialogTitle>
        <DialogDescription>
          {path} 有未保存修改。请选择保存、放弃或继续编辑。
        </DialogDescription>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button disabled={busy} variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => {
              if (path) {
                useFileDocumentStore.getState().discard(path);
                onClose(path);
              }
            }}
          >
            放弃修改
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (!path || busy) return;
              setBusy(true);
              setError("");
              try {
                await persistFileDraft(path);
                const doc = useFileDocumentStore.getState().documents[path];
                if (doc?.draft !== doc?.base)
                  throw new Error("保存期间又有新修改，请再次保存后关闭");
                onClose(path);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "保存中…" : "保存并关闭"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
