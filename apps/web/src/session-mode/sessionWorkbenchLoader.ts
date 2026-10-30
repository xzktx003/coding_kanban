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
  // Start the critical composer graph alongside the app's dependencies. Its
  // provider-specific inputs, transcripts, and optional tools remain deferred.
  return Promise.all([app, import("./components/agent/AgentComposer")])
    .then(() => undefined)
    .catch(() => undefined);
}
