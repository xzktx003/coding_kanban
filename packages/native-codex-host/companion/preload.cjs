'use strict';

const CAPTURE_KEY = Symbol.for('coding-kanban.native-codex.appserver-provider');
const TARGET_VIEW_TYPE = 'chatgpt.conversationEditor';

function installNativeCodexProviderCapture(moduleLoader, processObject) {
  if (!moduleLoader || typeof moduleLoader._load !== 'function' || !processObject || typeof processObject !== 'object')
    throw new Error('Node module loader and process object are required');
  if (processObject[CAPTURE_KEY]) return processObject[CAPTURE_KEY];

  const state = {
    provider: undefined,
    registrationCallCount: 0,
    registeredViewTypes: [],
    captureInstalled: true,
    vscodeModuleLoadCount: 0,
    apiPatchCount: 0,
    apiPatchRetainedCount: 0,
    restoreWindows: [],
    restore: undefined,
    hookedWindows: new WeakSet(),
  };
  Object.defineProperty(processObject, CAPTURE_KEY, { configurable: true, value: state });
  const originalLoad = moduleLoader._load;
  const originalRequire = moduleLoader.prototype?.require;
  const restoreWindows = () => {
    for (const restore of state.restoreWindows.splice(0)) restore();
  };
  const patchApi = (request, api) => {
    if (request !== 'vscode') return;
    state.vscodeModuleLoadCount++;
    if (!api?.window || typeof api.window.registerCustomEditorProvider !== 'function') return;
    const window = api.window;
    if (state.hookedWindows.has(window)) return api;
    const originalRegister = window.registerCustomEditorProvider;
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'registerCustomEditorProvider');
    const restoreWindow = () => {
      if (window.registerCustomEditorProvider !== wrappedRegister) return;
      try {
        if (originalDescriptor) Object.defineProperty(window, 'registerCustomEditorProvider', originalDescriptor);
        else delete window.registerCustomEditorProvider;
      } catch { try { window.registerCustomEditorProvider = originalRegister; } catch {} }
    };
    const wrappedRegister = function (viewType, provider, options) {
      const result = originalRegister.call(this, viewType, provider, options);
      state.registrationCallCount++;
      if (state.registeredViewTypes.length < 8) state.registeredViewTypes.push(String(viewType));
      if (viewType === TARGET_VIEW_TYPE && !state.provider) {
        state.provider = provider;
        state.captureInstalled = false;
        restoreWindows();
        state.restoreLoader();
      }
      return result;
    };
    try {
      if (!originalDescriptor || originalDescriptor.configurable !== false)
        Object.defineProperty(window, 'registerCustomEditorProvider', { configurable: true, enumerable: originalDescriptor?.enumerable ?? true, writable: true, value: wrappedRegister });
      else if (originalDescriptor.writable) window.registerCustomEditorProvider = wrappedRegister;
    } catch {}
    if (window.registerCustomEditorProvider === wrappedRegister) {
      state.apiPatchCount++;
      state.apiPatchRetainedCount++;
      state.hookedWindows.add(window);
      state.restoreWindows.push(restoreWindow);
    }
  };
  const wrappedLoad = function (request, parent, isMain) {
    const api = originalLoad.call(this, request, parent, isMain);
    patchApi(request, api);
    return api;
  };
  const wrappedRequire = typeof originalRequire === 'function' ? function (request, ...args) {
    const api = originalRequire.call(this, request, ...args);
    patchApi(request, api);
    return api;
  } : undefined;
  state.restoreLoader = () => {
    if (moduleLoader._load === wrappedLoad) moduleLoader._load = originalLoad;
    if (typeof originalRequire === 'function' && moduleLoader.prototype.require === wrappedRequire)
      moduleLoader.prototype.require = originalRequire;
    state.captureInstalled = false;
  };
  state.restore = () => {
    restoreWindows();
    state.restoreLoader();
  };
  moduleLoader._load = wrappedLoad;
  if (typeof originalRequire === 'function') moduleLoader.prototype.require = wrappedRequire;
  return state;
}

if (process.argv.some(argument => argument === '--type=extensionHost')) {
  installNativeCodexProviderCapture(require('node:module'), process);
}

module.exports = { CAPTURE_KEY, TARGET_VIEW_TYPE, installNativeCodexProviderCapture };
