/** Each view owns its wait; only the final cancelled consumer aborts transport. */
export function historyReadConsumer(
  promise: Promise<void>,
  controller: AbortController,
  detach: () => void,
) {
  const consumers = new Set<symbol>();
  return (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const token = Symbol();
      consumers.add(token);
      const release = () => {
        consumers.delete(token);
        signal?.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        release();
        reject(
          signal?.reason ?? new DOMException("Read cancelled", "AbortError"),
        );
        if (!consumers.size) {
          detach();
          controller.abort();
        }
      };
      signal?.addEventListener("abort", cancel, { once: true });
      promise.then(
        () => {
          release();
          resolve();
        },
        (error) => {
          release();
          reject(error);
        },
      );
    });
}
