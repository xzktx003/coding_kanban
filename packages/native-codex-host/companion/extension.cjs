'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const vscode = require('vscode');
const { openThread, resumeThread, threadUri, validateFixturePanels, openFixturePanels, validateNewChatPanels, restoreNewChatThread, openNewChatPanels } = require('./control.cjs');
const { MAX_BODY_BYTES, SUPPORTED_OFFICIAL_VERSION, createNativeAppServerSender } = require('./appserver-send.cjs');
let server; let disposeActivation;
const officialAtModuleLoad = vscode.extensions?.getExtension?.('openai.chatgpt');
const officialActiveAtModuleLoad = Boolean(officialAtModuleLoad?.isActive);
const preloadedBridge = process[Symbol.for('coding-kanban.native-codex.appserver-provider')];
const vscodeWindow = vscode.window;
const originalRegisterCustomEditorProvider = vscodeWindow?.registerCustomEditorProvider;
const originalRegisterCustomEditorProviderDescriptor = vscodeWindow && Object.getOwnPropertyDescriptor(vscodeWindow, 'registerCustomEditorProvider');
let capturedProvider = preloadedBridge?.provider;
let registrationCallCount = preloadedBridge?.registrationCallCount ?? 0;
const registeredViewTypes = [...(preloadedBridge?.registeredViewTypes ?? [])];
let captureInstalled = false;
const captureProviderRegistration = function (viewType, provider, options) {
  registrationCallCount++;
  if (registeredViewTypes.length < 8) registeredViewTypes.push(String(viewType));
  if (viewType === 'chatgpt.conversationEditor' && !capturedProvider) capturedProvider = provider;
  return originalRegisterCustomEditorProvider.call(this, viewType, provider, options);
};
if (!capturedProvider && typeof originalRegisterCustomEditorProvider === 'function') {
  try {
    if (!originalRegisterCustomEditorProviderDescriptor || originalRegisterCustomEditorProviderDescriptor.configurable !== false)
      Object.defineProperty(vscodeWindow, 'registerCustomEditorProvider', { configurable: true, enumerable: originalRegisterCustomEditorProviderDescriptor?.enumerable ?? true, writable: true, value: captureProviderRegistration });
    else if (originalRegisterCustomEditorProviderDescriptor.writable) vscodeWindow.registerCustomEditorProvider = captureProviderRegistration;
    captureInstalled = vscodeWindow.registerCustomEditorProvider === captureProviderRegistration;
  } catch {}
}
const capturePatchRetainedAtModuleLoad = captureInstalled;
function restoreProviderRegistrationCapture() {
  if (captureInstalled && vscodeWindow?.registerCustomEditorProvider === captureProviderRegistration) {
    try {
      if (originalRegisterCustomEditorProviderDescriptor)
        Object.defineProperty(vscodeWindow, 'registerCustomEditorProvider', originalRegisterCustomEditorProviderDescriptor);
      else delete vscodeWindow.registerCustomEditorProvider;
    } catch { try { vscodeWindow.registerCustomEditorProvider = originalRegisterCustomEditorProvider; } catch {} }
  }
  captureInstalled = false;
}
function secureRead(file) {
  if (!file || !path.isAbsolute(file)) throw new Error('explicit companion config path required');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600) throw new Error('companion config must be private owned mode 0600 file');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function activationStatus(opened) {
  const official = vscode.extensions.getExtension('openai.chatgpt');
  return { companionActive: true, officialInstalled: Boolean(official), officialActive: Boolean(official?.isActive), officialVersion: official?.packageJSON.version,
    opened, tabs: vscode.window.tabGroups.all.map(group => ({ column: group.viewColumn, active: group.isActive,
      tabs: group.tabs.map(tab => ({ label: tab.label, active: tab.isActive, uri: tab.input?.uri?.toString(), viewType: tab.input?.viewType })) })) };
}
async function activate(context) {
  context.subscriptions.push({ dispose: restoreProviderRegistrationCapture });
  const config = secureRead(process.env.NATIVE_CODEX_COMPANION_CONFIG);
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('private companion port invalid');
  if (!Array.isArray(config.threads) || config.threads.length > 16 || typeof config.token !== 'string' || config.token.length < 32) throw new Error('invalid companion config');
  if (Object.hasOwn(config, 'autoOpenFixtures') && typeof config.autoOpenFixtures !== 'boolean') throw new Error('autoOpenFixtures must be a boolean');
  if (Object.hasOwn(config, 'autoOpenNewChats') && typeof config.autoOpenNewChats !== 'boolean') throw new Error('autoOpenNewChats must be a boolean');
  if (config.autoOpenFixtures === true && config.autoOpenNewChats === true) throw new Error('fixture and new chat startup are mutually exclusive');
  if (Object.hasOwn(config, 'newChatWindowIds')) validateNewChatPanels(config.newChatWindowIds);
  for (const id of config.threads) threadUri(id, config.threads);
  const opened = []; let opening = false;
  const fixtures = Object.freeze(config.threads.slice(0, 2));
  const autoOpenFixtures = { enabled: config.autoOpenFixtures === true, state: config.autoOpenFixtures === true ? 'pending' : 'disabled' };
  const newChatWindows = Object.freeze((config.newChatWindowIds ?? []).slice());
  const autoOpenNewChats = { enabled: config.autoOpenNewChats === true, state: config.autoOpenNewChats === true ? 'pending' : 'disabled' };
  if (autoOpenFixtures.enabled) validateFixturePanels(fixtures);
  if (autoOpenNewChats.enabled) validateNewChatPanels(newChatWindows);
  let disposed = false; const commandDisposables = []; let ownedServer; let sender;
  const assertActive = () => { if (disposed) throw new Error('companion instance disposed'); };
  disposeActivation = () => { disposed = true; restoreProviderRegistrationCapture(); sender?.dispose(); for (const item of commandDisposables) item.dispose(); ownedServer?.close(); if (server === ownedServer) server = null; };
  context.subscriptions.push({ dispose: disposeActivation });
  const instanceId = crypto.randomUUID();
  const broker = { enabled: false, scope: 'first-listener-instance', pid: process.pid, instanceId };
  const official = vscode.extensions.getExtension('openai.chatgpt');
  const officialActiveAtActivation = Boolean(official?.isActive);
  let activationError = null;
  if (official) {
    try { await official.activate(); } catch (error) { activationError = String(error.message); }
    finally { restoreProviderRegistrationCapture(); }
    if (!activationError && capturedProvider) {
      sender = createNativeAppServerSender({ provider: capturedProvider, officialVersion: official.packageJSON?.version, vscode,
        receiptFile: path.join(path.dirname(process.env.NATIVE_CODEX_COMPANION_CONFIG), 'companion-send-receipts.json') });
    }
  }
  capturedProvider ??= preloadedBridge?.provider;
  if (!sender && !activationError && capturedProvider) {
    sender = createNativeAppServerSender({ provider: capturedProvider, officialVersion: official?.packageJSON?.version, vscode,
      receiptFile: path.join(path.dirname(process.env.NATIVE_CODEX_COMPANION_CONFIG), 'companion-send-receipts.json') });
  }
  registrationCallCount = preloadedBridge?.registrationCallCount ?? registrationCallCount;
  const observedViewTypes = preloadedBridge?.registeredViewTypes ?? registeredViewTypes;
  const sendBridge = {
    officialActiveAtModuleLoad,
    officialActiveAtActivation,
    preloadInstalled: Boolean(preloadedBridge),
    preloadCaptureInstalled: preloadedBridge?.captureInstalled === true,
    preloadProviderCaptured: Boolean(preloadedBridge?.provider),
    preloadVscodeModuleLoadCount: preloadedBridge?.vscodeModuleLoadCount ?? 0,
    preloadApiPatchCount: preloadedBridge?.apiPatchCount ?? 0,
    preloadApiPatchRetainedCount: preloadedBridge?.apiPatchRetainedCount ?? 0,
    captureInstalledAtModuleLoad: typeof originalRegisterCustomEditorProvider === 'function',
    capturePatchRetainedAtModuleLoad,
    registrationCallCount,
    registeredViewTypes: observedViewTypes,
    providerCaptured: Boolean(capturedProvider),
    officialExportKeys: Object.keys(official?.exports ?? {}).slice(0, 16),
  };
  const sendReason = sender?.reason ?? (!official ? 'official Codex extension is unavailable' : activationError ? 'official Codex extension activation failed' :
    officialActiveAtModuleLoad ? 'official extension was active before the companion module loaded' :
    officialActiveAtActivation ? 'official extension was active before the companion activated' :
    capturedProvider ? 'official app-server bridge is unavailable' : 'official custom editor provider registration was not captured');
  if (disposed) { sender?.dispose(); return; }
  const remember = results => { opened.push(...results); while (opened.length > 32) opened.shift(); };
  const openCapturedPanels = async (openPanels, identities) => {
    assertActive();
    if (opening) throw new Error('panel opening in progress');
    opening = true;
    try { const results = await openPanels(vscode, identities, assertActive); remember(results); return results; }
    finally { opening = false; }
  };
  const openCapturedFixtures = () => openCapturedPanels(openFixturePanels, fixtures);
  const openCapturedNewChats = () => openCapturedPanels(openNewChatPanels, newChatWindows);
  commandDisposables.push(vscode.commands.registerCommand('nativeCodexPrototype.openTwoTestPanels', async (...args) => {
    if (args.length !== 0) throw new Error('test panel command accepts no arguments');
    return openCapturedFixtures();
  }), vscode.commands.registerCommand('nativeCodexPrototype.openTwoNewChats', async (...args) => {
    if (args.length !== 0) throw new Error('new chat panel command accepts no arguments');
    return openCapturedNewChats();
  }));
  context.subscriptions.push(...commandDisposables);
  server = http.createServer(async (request, response) => {
    const send = (status, value) => { if (response.writableEnded || response.destroyed) return; response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
    const supplied = Buffer.from(request.headers.authorization || ''); const expected = Buffer.from(`Bearer ${config.token}`);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return send(401, { error: 'unauthorized' });
    if (disposed) return send(503, { error: 'companion instance disposed' });
    if (request.method === 'GET' && request.url === '/status') return send(200, { ...activationStatus(opened), activationError, broker, autoOpenFixtures, autoOpenNewChats, sendBridge,
      sendAvailable: sender?.available === true, ...(sender?.available ? {} : { sendReason }) });
    if (request.method !== 'POST' || !['/open', '/restore', '/resume', '/send'].includes(request.url)) return send(404, { error: 'unsupported operation' });
    const restoringNewChat = request.url === '/restore';
    const resumingThread = request.url === '/resume';
    const sending = request.url === '/send';
    if (sending && !sender?.available) return send(503, { error: 'native Codex send is unavailable' });
    if (restoringNewChat && !autoOpenNewChats.enabled) return send(404, { error: 'unsupported operation' });
    if (opening) return send(409, { error: 'panel opening in progress' });
    opening = true;
    let body = ''; request.setTimeout(5000, () => request.destroy());
    const bodyDeadline = setTimeout(() => request.destroy(), 5000);
    let executionDeadline;
    try {
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > (sending ? MAX_BODY_BYTES : 2048)) { send(413, { error: 'request too large' }); request.destroy(); return; } }
      clearTimeout(bodyDeadline); request.setTimeout(0);
      assertActive();
      // VS Code commands cannot be cancelled. A timeout replies but retains the lock until the command settles.
      executionDeadline = setTimeout(() => send(504, { error: 'panel command timed out; still waiting for VS Code' }), 20000);
      const input = JSON.parse(body);
      if (restoringNewChat) {
        const result = await restoreNewChatThread(vscode, input, newChatWindows);
        remember([{ windowId: result.windowId, column: result.column, kind: 'restore' }]);
        send(200, { restored: true });
      } else if (resumingThread) {
        const result = await resumeThread(vscode, input);
        remember([{ threadId: result.threadId, column: result.column, kind: 'resume' }]);
        send(200, { opened: true });
      } else if (sending) {
        send(200, await sender.send(input));
      } else {
        const result = await openThread(vscode, input, config.threads); remember([result]);
        send(200, result);
      }
    } catch (error) { send(Number.isInteger(error.statusCode) ? error.statusCode : 400, { error: String(error.message).slice(0, 240) }); }
    finally { clearTimeout(bodyDeadline); clearTimeout(executionDeadline); opening = false; }
  });
  ownedServer = server;
  // A retained browser extension host may still own the fixed port. Never replace it or pick another port.
  try {
    try {
      await new Promise((resolve, reject) => {
        const cleanup = () => { ownedServer.off('error', onError); ownedServer.off('close', onClose); ownedServer.off('listening', onListening); };
        const onError = error => { cleanup(); reject(error); };
        const onListening = () => { cleanup(); resolve(); };
        // Closing before the listening event suppresses its callback. Disposal still must settle activation.
        const onClose = () => { cleanup(); disposed ? resolve() : reject(new Error('broker closed before listening')); };
        ownedServer.once('error', onError); ownedServer.once('close', onClose); ownedServer.once('listening', onListening);
        try { ownedServer.listen(config.port, '127.0.0.1'); } catch (error) { onError(error); }
      });
      if (disposed) return;
      broker.enabled = true;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      ownedServer.close(); if (server === ownedServer) server = null;
      broker.disabledReason = 'address-in-use';
    }
    if (disposed) return;
    for (const [autoOpen, openPanels] of [[autoOpenFixtures, openCapturedFixtures], [autoOpenNewChats, openCapturedNewChats]]) {
      if (!autoOpen.enabled) continue;
      if (activationError || !official?.isActive) {
        autoOpen.state = 'failed'; autoOpen.error = 'official extension activation unavailable';
      } else {
        autoOpen.state = 'opening';
        try { await openPanels(); autoOpen.state = disposed ? 'cancelled' : 'completed'; }
        catch (error) { autoOpen.state = disposed ? 'cancelled' : 'failed'; autoOpen.error = String(error.message).slice(0, 240); }
      }
    }
    if (disposed) return;
    const directory = path.dirname(process.env.NATIVE_CODEX_COMPANION_CONFIG);
    const activatedAt = new Date().toISOString();
    // Per-instance diagnostics contain flags/counts only; a disabled instance must not overwrite owner readiness.
    fs.writeFileSync(path.join(directory, `companion-instance-${process.pid}-${instanceId}.json`), JSON.stringify({
      pid: process.pid, activatedAt, companionActive: true, brokerEnabled: broker.enabled,
      brokerDisabledReason: broker.disabledReason ?? null, fixtureCount: fixtures.length,
      autoOpenFixturesEnabled: autoOpenFixtures.enabled, autoOpenFixturesState: autoOpenFixtures.state,
      newChatWindowCount: newChatWindows.length, autoOpenNewChatsEnabled: autoOpenNewChats.enabled, autoOpenNewChatsState: autoOpenNewChats.state
    }, null, 2), { mode: 0o600, flag: 'wx' });
    if (broker.enabled) fs.writeFileSync(path.join(directory, 'companion-ready.json'), JSON.stringify({
      pid: process.pid, activatedAt, ...activationStatus(opened), activationError, broker, autoOpenFixtures, autoOpenNewChats,
      sendAvailable: sender?.available === true, sendBridge, ...(sender?.available ? {} : { sendReason })
    }, null, 2), { mode: 0o600 });
  } catch (error) {
    disposeActivation();
    throw error;
  }
}
function deactivate() { disposeActivation?.(); restoreProviderRegistrationCapture(); }
module.exports = { activate, deactivate };
