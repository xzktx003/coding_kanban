import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  isSessionInteractionVisible,
  useSessionInteractionVisible,
} from "@session/session-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@session/components/ui/dialog";

type Panel = ComponentType<{ initialOpen?: boolean }>;
const loadHistory = () => import("./HistoryProjectsDialog");

/** Listen immediately, but load the closed panel only after an explicit gesture. */
export function DeferredHistoryProjectsDialog({
  load = loadHistory,
}: { load?: () => Promise<{ HistoryProjectsDialog: Panel }> } = {}) {
  const visible = useSessionInteractionVisible();
  const [Panel, setPanel] = useState<Panel | null>(null),
    [opening, setOpening] = useState(false),
    [error, setError] = useState<string | null>(null);
  const requested = useRef(false),
    mounted = useRef(false),
    disposed = useRef(false),
    inflight = useRef<Promise<void> | null>(null);
  const cancel = () => {
    requested.current = false;
    setOpening(false);
    setError(null);
  };
  const request = () => {
    if (!isSessionInteractionVisible() || mounted.current) return;
    requested.current = true;
    setOpening(true);
    setError(null);
    if (Panel || inflight.current) return;
    const operation = Promise.resolve()
      .then(load)
      .then((module) => {
        if (disposed.current) return;
        if (typeof module.HistoryProjectsDialog !== "function")
          throw new Error("历史项目模块接口不可用");
        setPanel(() => module.HistoryProjectsDialog);
        if (!requested.current || !isSessionInteractionVisible()) {
          requested.current = false;
          setOpening(false);
        }
      })
      .catch((reason) => {
        if (!disposed.current && requested.current)
          setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (inflight.current === operation) inflight.current = null;
      });
    inflight.current = operation;
  };
  useEffect(() => {
    disposed.current = false;
    const open = () => request(),
      mode = () => {
        if (!isSessionInteractionVisible()) cancel();
      };
    window.addEventListener("session-project-history", open);
    window.addEventListener("workbench-mode-changed", mode);
    return () => {
      disposed.current = true;
      window.removeEventListener("session-project-history", open);
      window.removeEventListener("workbench-mode-changed", mode);
    };
  }, [Panel, load]);
  useEffect(() => {
    if (!visible) cancel();
  }, [visible]);
  useLayoutEffect(() => {
    if (Panel && opening && visible) {
      mounted.current = true;
      requested.current = false;
      setOpening(false);
    }
  }, [Panel, opening, visible]);
  if (Panel && (mounted.current || (opening && visible)))
    return <Panel initialOpen={opening} />;
  if (!opening || !visible) return null;
  return (
    <Dialog
      open={opening && visible}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent
        className="max-w-sm"
        onCloseAutoFocus={(event) => {
          if (requested.current || mounted.current) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>历史项目</DialogTitle>
          <DialogDescription>
            加载后可选择已有项目；当前对话和草稿保留。
          </DialogDescription>
        </DialogHeader>
        <p role={error ? "alert" : "status"}>
          {error ? `历史项目暂未加载：${error}` : "正在加载历史项目…"}
        </p>
        <div className="flex justify-end gap-3 text-xs">
          <button type="button" aria-label="取消加载历史项目" onClick={cancel}>
            取消
          </button>
          {error && (
            <button
              type="button"
              aria-label="重试加载历史项目"
              onClick={request}
            >
              重试
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
