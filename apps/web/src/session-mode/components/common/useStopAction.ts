import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** A stop is pending until the task actually ends, not merely until HTTP returns. */
export function useStopAction(
  key: string | null,
  running: boolean,
  stop: () => Promise<unknown>,
) {
  const pending = useRef(new Set<string>());
  const [, refresh] = useState(0);
  useEffect(() => {
    if (key && !running && pending.current.delete(key)) refresh((n) => n + 1);
  }, [key, running]);

  const requestStop = async () => {
    if (!key || !running || pending.current.has(key)) return;
    pending.current.add(key);
    refresh((n) => n + 1);
    try {
      await stop();
    } catch (error) {
      pending.current.delete(key);
      refresh((n) => n + 1);
      toast.error(
        `停止失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  return {
    stopping: !!key && running && pending.current.has(key),
    requestStop,
  };
}
