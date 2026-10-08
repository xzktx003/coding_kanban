/** Abort a request on unmount or deadline without requiring newer static AbortSignal APIs. */
export function requestTimeout(parent: AbortSignal, milliseconds: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
    dispose();
  }, milliseconds);
  function dispose() {
    clearTimeout(timer);
    parent.removeEventListener("abort", cancel);
  }
  function cancel() {
    controller.abort(parent.reason);
    dispose();
  }
  if (parent.aborted) cancel();
  else parent.addEventListener("abort", cancel, { once: true });
  return { signal: controller.signal, dispose };
}
