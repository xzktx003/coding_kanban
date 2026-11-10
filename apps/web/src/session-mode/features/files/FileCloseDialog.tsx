import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@session/components/ui/dialog";
import { Button } from "@session/components/ui/button";
import { useFileDocumentStore } from "@session/stores/useFileDocumentStore";
import {
  hasPendingFileOperation,
  useFileSaveStatusStore,
} from "@session/stores/useFileSaveStatusStore";
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
  const attempt = useRef(0),
    currentPath = useRef(path);
  currentPath.current = path;
  const fileDoc = useFileDocumentStore((state) =>
    path ? state.documents[path] : undefined,
  );
  const pending = useFileSaveStatusStore(
    (state) => !!path && state.pending.has(path),
  );
  const operationPending = useFileSaveStatusStore(
    (state) => !!path && hasPendingFileOperation(state.operations, path),
  );
  const failure = useFileSaveStatusStore((state) =>
    path ? state.failures.get(path) : undefined,
  );
  const dirty =
    !!fileDoc &&
    (fileDoc.draft !== fileDoc.base || (!!fileDoc.saveUnconfirmed && !pending));
  useEffect(() => {
    attempt.current++;
    setBusy(false);
    setError("");
    return () => {
      attempt.current++;
    };
  }, [path]);
  const cancel = () => {
    attempt.current++;
    setBusy(false);
    setError("");
    onCancel();
  };
  return (
    <Dialog
      open={Boolean(path)}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent>
        <DialogTitle>文件尚未保存</DialogTitle>
        <DialogDescription>
          {path}{" "}
          {fileDoc?.saveUnconfirmed && !pending
            ? "上次保存结果尚未确认，请检查磁盘内容和草稿。"
            : dirty
              ? "有未保存修改。请选择保存、放弃或继续编辑。"
              : pending
                ? "文件正在保存，请等待结果或继续编辑。"
                : "没有未保存修改，可以关闭文件。"}
        </DialogDescription>
        {pending && (
          <p role="status" className="text-sm text-muted-foreground">
            文件正在保存。你可以继续编辑；当前保存仍会继续，完成前不能放弃或再次保存。
          </p>
        )}
        {operationPending && (
          <p role="status" className="text-sm text-muted-foreground">
            文件操作进行中，请等待结果后再保存。
          </p>
        )}
        {(error || failure) && (
          <p role="alert" className="text-destructive text-sm">
            {failure ? `保存未确认：${failure}。请检查磁盘内容和草稿。` : error}
          </p>
        )}
        {fileDoc?.saveUnconfirmed && !pending && !failure && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            之前的保存可能仍在进行，操作前请先核对磁盘内容。
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            {busy ? "继续编辑" : "取消"}
          </Button>
          {dirty && (
            <Button
              disabled={busy || pending}
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
          )}
          {dirty ? (
            <Button
              disabled={busy || pending || operationPending}
              onClick={async () => {
                if (!path || busy || pending || operationPending) return;
                const target = path,
                  own = ++attempt.current;
                const current = () =>
                  attempt.current === own && currentPath.current === target;
                setBusy(true);
                setError("");
                try {
                  await persistFileDraft(target);
                  if (!current()) return;
                  const doc = useFileDocumentStore.getState().documents[target];
                  if (!doc) throw new Error("文件状态已变化，请重新核对");
                  if (doc?.draft !== doc?.base)
                    throw new Error("保存期间又有新修改，请再次保存后关闭");
                  onClose(target);
                } catch (e) {
                  if (current())
                    setError(e instanceof Error ? e.message : String(e));
                } finally {
                  if (current()) setBusy(false);
                }
              }}
            >
              {busy ? "保存中…" : "保存并关闭"}
            </Button>
          ) : (
            <Button
              disabled={busy || pending}
              onClick={() => path && onClose(path)}
            >
              关闭文件
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
