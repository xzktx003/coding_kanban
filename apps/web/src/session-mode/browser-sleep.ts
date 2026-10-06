/** Browser wake locks keep the current device awake while visible tasks run. */
const conversations = new Set<string>();
let lock: WakeLockSentinel | null = null;
let pending: Promise<void> | null = null;
async function acquire() {
  if (
    !conversations.size ||
    document.visibilityState === "hidden" ||
    !navigator.wakeLock ||
    lock ||
    pending
  )
    return pending;
  pending = (async () => {
    try {
      const next = await navigator.wakeLock.request("screen");
      if (!conversations.size) {
        await next.release();
        return;
      }
      lock = next;
      next.addEventListener("release", () => {
        if (lock === next) lock = null;
      });
    } catch {
      /* Browsers may deny wake locks; agent work continues on the server. */
    } finally {
      pending = null;
    }
  })();
  return pending;
}
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    void acquire();
  });
export async function preventBrowserSleep(id = "session") {
  conversations.add(id);
  await acquire();
}
export async function allowBrowserSleep(id?: string | null) {
  if (id) conversations.delete(id);
  else conversations.clear();
  if (!conversations.size && lock) {
    const previous = lock;
    lock = null;
    await previous.release();
  }
}
