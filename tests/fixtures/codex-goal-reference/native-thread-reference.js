// Reference discovery + seeding for the chat-thread renderer of 26.51021.22027.
//
// The official app is bundled by Rolldown into many chunks with opaque exported
// identifiers. This module loads the chunks that own the thread/goal rendering
// so a later harness can bind their exported components, and it reports exactly
// which exports exist for a given build. It never starts Codex or opens IPC.
//
// Identified chunks (SHA-256 pinned in reference-assets.json):
//   app-initial-13f932cb2f13.js   (React + shared providers, 1191 exports)
//   thread-goal-side-panel-content-e914e774b73f.js  -> exports ThreadGoalSidePanelTab (A)
//   am-50db9ef5b136.js is the *Amharic* locale, not code.
export async function discoverThreadExports() {
  const chunks = {
    appInitial: "./assets/app-initial-13f932cb2f13.js",
    goalPanel: "./assets/thread-goal-side-panel-content-e914e774b73f.js",
  };
  const result = {};
  for (const [key, url] of Object.entries(chunks)) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      result[key] = Object.keys(mod);
    } catch (error) {
      result[key] = { error: String(error) };
    }
  }
  return result;
}

export function renderNativeThread() {
  // TODO(session-render-alignment): bind the app providers + the exported
  // transcript/thread component to a real host message drive. See
  // docs/designs/session-render-alignment/codex-26.51021.22027-reference-baseline-20261107.md.
  return { rendered: false, reason: "host protocol drive required" };
}
