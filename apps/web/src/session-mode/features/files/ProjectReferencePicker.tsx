import { useEffect, useRef, useState } from "react";
import { FileText, Folder, ChevronUp } from "lucide-react";
import type { ComposerContext } from "@agent-orchestrator/shared";
import { Button } from "@session/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@session/components/ui/dialog";
import { readWithDeadline } from "@session/services/sessionReadQueue";
import { subscribeGoalCompletionScopeReset } from "@session/services/goalCompletionAutoClear";
import { authHeaders, buildUrl } from "@session/hooks/runtime";
import { usePairingStore } from "@session/stores/usePairingStore";
import {
  listProjectReferences,
  readProjectReference,
  referenceContext,
  type ProjectDirectory,
} from "./projectReferences";

/** Server project references are distinct from device uploads. No directory is recursively uploaded. */
export function ProjectReferencePicker({
  owner,
  root,
  onSelect,
  onClose,
}: {
  owner: string;
  root: string;
  onSelect: (context: ComposerContext) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState(root),
    [directory, setDirectory] = useState<ProjectDirectory | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  const current = useRef({ owner, root });
  current.current = { owner, root };
  const selection = useRef<AbortController | null>(null);
  const listing = useRef<AbortController | null>(null),
    generation = useRef(0);
  const callbacks = useRef({ onClose });
  callbacks.current = { onClose };
  const connection = () =>
    JSON.stringify([buildUrl("/workspace-files/list"), authHeaders()]);
  useEffect(() => {
    const controller = new AbortController();
    listing.current = controller;
    const stamp = connection(),
      capturedGeneration = generation.current;
    setDirectory(null);
    setError(null);
    void readWithDeadline(
      (signal) => listProjectReferences(root, path, signal),
      15_000,
      controller.signal,
    )
      .then((value) => {
        if (
          !controller.signal.aborted &&
          generation.current === capturedGeneration &&
          stamp === connection()
        )
          setDirectory(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, [root, path, retry]);
  useEffect(() => {
    setPath(root);
    setBusy(false);
    selection.current?.abort();
    selection.current = null;
    return () => selection.current?.abort();
  }, [owner, root]);
  useEffect(() => {
    const stamp = connection();
    let revoked = false;
    const invalidate = () => {
      if (revoked) return;
      revoked = true;
      generation.current++;
      selection.current?.abort();
      listing.current?.abort();
      callbacks.current.onClose();
    };
    const account = owner.startsWith("codex:")
      ? subscribeGoalCompletionScopeReset(invalidate)
      : () => {};
    const pairing = usePairingStore.subscribe(() => {
      if (stamp !== connection()) invalidate();
    });
    window.addEventListener("session-runtime-restarted", invalidate);
    return () => {
      generation.current++;
      account();
      pairing();
      window.removeEventListener("session-runtime-restarted", invalidate);
    };
  }, [owner, root]);
  async function select(selected: string) {
    if (selection.current || busy) return;
    const controller = new AbortController(),
      captured = {
        owner,
        root,
        canonicalRoot: directory?.root ?? root,
        generation: generation.current,
        connection: connection(),
      };
    selection.current = controller;
    setBusy(true);
    setError(null);
    try {
      const value = await readWithDeadline(
        (signal) => readProjectReference(captured.root, selected, signal),
        15_000,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        generation.current !== captured.generation ||
        connection() !== captured.connection ||
        current.current.owner !== captured.owner ||
        current.current.root !== captured.root
      )
        return;
      if (value.root !== captured.canonicalRoot || value.path !== selected)
        throw new Error("项目引用目标已变化，请重新选择。");
      onSelect(referenceContext(value));
      onClose();
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (selection.current === controller) {
        selection.current = null;
        setBusy(false);
      }
    }
  }
  const parent =
    directory?.path.slice(0, directory.path.lastIndexOf("/")) || root;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>引用项目文件或目录</DialogTitle>
          <DialogDescription>
            文件保存本次文本快照；目录只引用路径和当前层级清单。
          </DialogDescription>
        </DialogHeader>
        <p className="break-all text-xs text-muted-foreground">
          {directory?.path ?? path}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !directory || directory.path === directory.root}
            onClick={() => setPath(parent)}
          >
            <ChevronUp className="mr-1 h-4 w-4" />
            上一级
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !directory}
            onClick={() => void select(directory!.path)}
          >
            <Folder className="mr-1 h-4 w-4" />
            引用此目录
          </Button>
        </div>
        {error && (
          <div role="alert" className="text-sm text-destructive">
            {error}
            <Button
              type="button"
              variant="link"
              onClick={() => setRetry((v) => v + 1)}
            >
              重试读取
            </Button>
          </div>
        )}
        {!directory && !error && <p role="status">正在读取项目目录…</p>}
        <div className="max-h-[min(50dvh,420px)] overflow-y-auto rounded-md border divide-y">
          {directory?.entries.map((entry) => (
            <div className="flex items-center gap-2 px-2" key={entry.path}>
              {entry.kind === "directory" ? (
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <Button
                type="button"
                variant="ghost"
                className="min-w-0 flex-1 justify-start overflow-hidden"
                disabled={busy}
                onClick={() =>
                  entry.kind === "directory"
                    ? setPath(entry.path)
                    : void select(entry.path)
                }
              >
                <span className="truncate">{entry.name}</span>
              </Button>
              {entry.kind === "directory" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`引用目录 ${entry.name}`}
                  onClick={() => void select(entry.path)}
                >
                  引用
                </Button>
              )}
            </div>
          ))}
          {directory && !directory.entries.length && (
            <p className="p-3 text-sm text-muted-foreground">此目录为空</p>
          )}
        </div>
        {directory?.truncated && (
          <p className="text-xs text-muted-foreground">
            目录较大，仅展示当前层级的部分条目。
          </p>
        )}
        {busy && <p role="status">正在保存引用快照…</p>}
      </DialogContent>
    </Dialog>
  );
}
