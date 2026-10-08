import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
type Request = { title: string; description: string; confirmLabel: string };
export function useSessionActionConfirmation() {
  const [request, setRequest] = useState<Request | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const finish = useCallback((value: boolean) => {
    const pending = resolver.current;
    resolver.current = null;
    setRequest(null);
    pending?.(value);
  }, []);
  const ask = useCallback((next: Request) => {
    resolver.current?.(false);
    setRequest(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  useEffect(
    () => () => {
      resolver.current?.(false);
      resolver.current = null;
    },
    [],
  );
  return {
    ask,
    confirmation: (
      <ConfirmDialog
        isOpen={Boolean(request)}
        title={request?.title ?? ""}
        description={request?.description ?? ""}
        confirmLabel={request?.confirmLabel}
        onConfirm={() => finish(true)}
        onCancel={() => finish(false)}
      />
    ),
  };
}
