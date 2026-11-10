// Read-only reference harness for the REAL 26.51021.22027 app entry.
//
// native-app.html boots the unchanged official webview (index.html -> index-*.js
// -> app-main-*.js -> initializeApp). This module only exposes a control surface
// and diagnostics. It never starts Codex, opens IPC, or reads login state.
//
// The official app waits for the VS Code host to drive it over postMessage. To
// render a real chat thread + composer from this entry, send the host messages
// below through window.__dispatchHostMessage (see the baseline design doc).
//
// Host -> webview message types observed in out/extension.js:
//   initialize, thread/list, thread/started, thread/turns/list,
//   thread/tokenUsage/updated, thread-read-state-changed, model/settings, ...
// A minimal thread+composer drive must first satisfy `initialize`.
let dispatched = 0;
const errors = [];
window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));

export function dispatchHostMessage(message) {
  if (typeof message !== "object" || message == null) return;
  dispatched += 1;
  window.__dispatchHostMessage?.(message);
}

export function appState() {
  return {
    version: "26.51021.22027",
    booted: Boolean(window.nativeAppBooted),
    hostMessagesSent: (window.__hostMessages ?? []).length,
    dispatched,
    errors: errors.slice(),
    body: (document.getElementById("root")?.textContent ?? "").slice(0, 200),
  };
}

export default { dispatchHostMessage, appState };
