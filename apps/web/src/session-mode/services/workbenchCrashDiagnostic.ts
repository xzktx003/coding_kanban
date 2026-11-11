import type { ErrorInfo } from "react";

/** One bounded record per tab; never retain Error objects, props or transcript bodies. */
export function recordWorkbenchCrash(
  mode: string,
  error: unknown,
  info: ErrorInfo,
) {
  try {
    sessionStorage.setItem(
      "kanban:workbench:last-error",
      JSON.stringify({
        time: new Date().toISOString(),
        mode,
        message: (error instanceof Error ? error.message : String(error)).slice(
          0,
          1000,
        ),
        componentStack: (info.componentStack ?? "").slice(0, 3000),
        visibility: document.visibilityState,
        focused: document.hasFocus(),
      }),
    );
  } catch {
    /* Diagnostics must not prevent recovery when storage is unavailable. */
  }
}
