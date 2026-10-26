'use strict';

const CAPTURE_KEY = Symbol.for('coding-kanban.native-codex.appserver-provider');
const FORK_KEY = Symbol.for('coding-kanban.native-codex.extension-host-fork');
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
    let retained = false;
    const restoreWindow = () => {
      if (window.registerCustomEditorProvider === wrappedRegister) {
        try {
          if (originalDescriptor) Object.defineProperty(window, 'registerCustomEditorProvider', originalDescriptor);
          else delete window.registerCustomEditorProvider;
        } catch { try { window.registerCustomEditorProvider = originalRegister; } catch {} }
      }
      if (retained && window.registerCustomEditorProvider !== wrappedRegister) {
        retained = false;
        state.apiPatchRetainedCount--;
      }
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
      retained = true;
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

function installOwnedExtensionHostForkPreload(childProcess, processObject, synchronize) {
  const path = require('node:path');
  const fs = require('node:fs');
  const configured = processObject.env?.NATIVE_CODEX_HOST_CODE_SERVER;
  const companionConfig = processObject.env?.NATIVE_CODEX_COMPANION_CONFIG;
  if (typeof configured !== 'string' || !path.isAbsolute(configured) || typeof companionConfig !== 'string' || !path.isAbsolute(companionConfig)) return;
  let executable;
  try { executable = fs.realpathSync(configured); } catch { return; }
  if (path.basename(executable) !== 'code-server' || path.basename(path.dirname(executable)) !== 'bin') return;
  const root = path.dirname(path.dirname(executable));
  const entries = new Set([root, path.join(root, 'out/node/entry'), path.join(root, 'out/node/entry.js')]);
  if (typeof processObject.argv?.[1] !== 'string' || !entries.has(path.resolve(processObject.argv[1]))) return;
  if (processObject[FORK_KEY]) return processObject[FORK_KEY];
  if (typeof childProcess?.fork !== 'function' || typeof synchronize !== 'function') return;
  const bootstraps = new Set([path.join(root, 'lib/vscode/out/bootstrap-fork'), path.join(root, 'lib/vscode/out/bootstrap-fork.js')]);
  const originalFork = childProcess.fork;
  const state = { installed: true, extensionHostForks: 0, restore: undefined };
  const wrappedFork = function (...parameters) {
    const [modulePath, args, options] = parameters;
    if (typeof modulePath !== 'string' || !path.isAbsolute(modulePath) || !bootstraps.has(path.resolve(modulePath)) ||
        !Array.isArray(args) || !args.every(arg => typeof arg === 'string') ||
        args.filter(arg => arg.startsWith('--type=')).length !== 1 || !args.includes('--type=extensionHost') ||
        !options || options.env?.VSCODE_ESM_ENTRYPOINT !== 'vs/workbench/api/node/extensionHostProcess' ||
        options.env.NATIVE_CODEX_COMPANION_CONFIG !== companionConfig ||
        !Array.isArray(options.execArgv) || !options.execArgv.every(arg => typeof arg === 'string')) {
      return originalFork.apply(this, parameters);
    }
    // VS Code intentionally removes NODE_OPTIONS. Add only our fixed preload to
    // this owned extensionHost fork; retain every original launch argument.
    const preload = __filename;
    const present = options.execArgv.some((arg, index) => arg === `--require=${preload}` || (arg === '--require' && options.execArgv[index + 1] === preload));
    const nextOptions = { ...options, execArgv: present ? [...options.execArgv] : ['--require', preload, ...options.execArgv] };
    state.extensionHostForks++;
    return originalFork.call(this, modulePath, args, nextOptions, ...parameters.slice(3));
  };
  childProcess.fork = wrappedFork;
  synchronize();
  state.restore = () => {
    if (childProcess.fork === wrappedFork) { childProcess.fork = originalFork; synchronize(); }
    state.installed = false;
  };
  Object.defineProperty(processObject, FORK_KEY, { configurable: true, value: state });
  return state;
}

if (process.argv.some(argument => argument === '--type=extensionHost')) {
  installNativeCodexProviderCapture(require('node:module'), process);
} else {
  installOwnedExtensionHostForkPreload(require('node:child_process'), process, require('node:module').syncBuiltinESMExports);
}

module.exports = { CAPTURE_KEY, FORK_KEY, TARGET_VIEW_TYPE, installNativeCodexProviderCapture, installOwnedExtensionHostForkPreload };
