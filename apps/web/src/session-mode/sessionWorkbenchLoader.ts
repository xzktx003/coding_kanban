type SessionWorkbenchModule = typeof import("./SessionWorkbench");
type SessionAppModule = typeof import("./App");

let workbenchPromise: Promise<SessionWorkbenchModule> | undefined;
let appPromise: Promise<SessionAppModule> | undefined;

export function loadSessionWorkbench() {
  workbenchPromise ??= import("./SessionWorkbench").catch((error) => {
    workbenchPromise = undefined;
    throw error;
  });
  return workbenchPromise;
}

export function preloadSessionWorkbench() {
  void loadSessionWorkbench().catch(() => undefined);
}

export function loadSessionApp() {
  appPromise ??= import("./App").catch((error) => {
    appPromise = undefined;
    throw error;
  });
  return appPromise;
}

export function preloadSessionApp() {
  const app = loadSessionApp();
  // The composer is the first critical control. Preload it directly so Vite
  // does not also fetch the transcript, session list, and optional tool graph
  // that would be pulled in by preloading AgentView as a whole.
  return Promise.all([app, import("./components/agent/AgentComposer")])
    .then(() => undefined)
    .catch(() => undefined);
}
