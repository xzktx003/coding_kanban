import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CAPTURE_KEY, installNativeCodexProviderCapture } = require('../companion/preload.cjs');

test('extension-host preload captures the official custom editor provider before activation hooks run', () => {
  const calls = [];
  const provider = { codexMcpConnection: { registerProvider() {}, sendRequest() {} } };
  const originalRegister = function (viewType, value, options) {
    calls.push({ viewType, provider: value, options });
    return { dispose() {} };
  };
  const api = { window: { registerCustomEditorProvider: originalRegister } };
  const moduleLoader = { _load(request) { return request === 'vscode' ? api : undefined; } };
  const processObject = {};
  const originalLoad = moduleLoader._load;
  const state = installNativeCodexProviderCapture(moduleLoader, processObject);

  assert.equal(processObject[CAPTURE_KEY], state);
  assert.equal(state.provider, undefined);
  assert.notEqual(moduleLoader._load, originalLoad);
  const loadedApi = moduleLoader._load('vscode', null, false);
  assert.equal(loadedApi, api);
  assert.equal(state.vscodeModuleLoadCount, 1);
  assert.equal(state.apiPatchCount, 1);
  assert.equal(state.apiPatchRetainedCount, 1);
  assert.notEqual(api.window.registerCustomEditorProvider, originalRegister);

  const options = { supportsMultipleEditorsPerDocument: false };
  const receipt = api.window.registerCustomEditorProvider('chatgpt.conversationEditor', provider, options);
  assert.equal(state.provider, provider);
  assert.equal(state.registrationCallCount, 1);
  assert.deepEqual(state.registeredViewTypes, ['chatgpt.conversationEditor']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, provider);
  assert.equal(calls[0].options, options);
  assert.equal(typeof receipt.dispose, 'function');
  assert.equal(api.window.registerCustomEditorProvider, originalRegister);
  assert.equal(moduleLoader._load, originalLoad);
});

test('extension-host preload passes unrelated editor registrations through without capturing them', () => {
  const calls = [];
  const provider = {};
  const originalRegister = (viewType, value) => { calls.push({ viewType, provider: value }); return null; };
  const api = { window: { registerCustomEditorProvider: originalRegister } };
  const moduleLoader = { _load(request) { return request === 'vscode' ? api : undefined; } };
  const originalLoad = moduleLoader._load;
  const state = installNativeCodexProviderCapture(moduleLoader, {});
  moduleLoader._load('vscode', null, false);
  api.window.registerCustomEditorProvider('another.editor', provider, {});
  assert.equal(state.provider, undefined);
  assert.deepEqual(calls.map(call => call.viewType), ['another.editor']);
  state.restore();
  assert.equal(api.window.registerCustomEditorProvider, originalRegister);
  assert.equal(moduleLoader._load, originalLoad);
});
