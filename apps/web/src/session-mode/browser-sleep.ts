/** Browser wake locks keep the current device awake while visible tasks run. */
const conversations = new Set<string>();
let lock: WakeLockSentinel | null = null;
let pending: Promise<void> | null = null;
let visibilityClients = 0;
let visibilityListenerActive = false;
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
const onVisibilityChange = () => {
  void acquire();
};
function attachVisibilityListener() {
  if (visibilityListenerActive || typeof document === "undefined") return;
  visibilityListenerActive = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
}
function detachVisibilityListenerIfIdle() {
  if (
    !visibilityListenerActive ||
    visibilityClients > 0 ||
    conversations.size > 0 ||
    typeof document === "undefined"
  )
    return;
  visibilityListenerActive = false;
  document.removeEventListener("visibilitychange", onVisibilityChange);
}
export function startBrowserSleepVisibilitySync() {
  visibilityClients++;
  attachVisibilityListener();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    visibilityClients = Math.max(0, visibilityClients - 1);
    detachVisibilityListenerIfIdle();
  };
}
export async function preventBrowserSleep(id = "session") {
  conversations.add(id);
  attachVisibilityListener();
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
  detachVisibilityListenerIfIdle();
}
