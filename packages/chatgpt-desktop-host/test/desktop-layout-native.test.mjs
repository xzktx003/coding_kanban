import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDesktopLayoutRuntime } from '../src/desktop-layout-core.mjs';

// Optional isolated test of the actual Mac renderer's React and three context
// providers with a synthetic GI and composer. It does not render native GI/XI,
// connect a host, issue a native send, or demonstrate a split implementation.
const moduleDir = process.env.CHATGPT_DESKTOP_TEST_MAC_MODULE_DIR;
const hashes = {
  'rolldown-runtime-428824ca0286.js': 'f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e',
  'app-shared-601019a330d7.js': '02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116',
  'app-initial-18b189e867e7.js': '244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032',
};

async function runSyntheticScopes() {
  assert.ok(moduleDir, 'explicit reviewed native module directory required');
  for (const [member, expected] of Object.entries(hashes)) {
    const actual = createHash('sha256').update(readFileSync(join(moduleDir, member))).digest('hex');
    assert.equal(actual, expected, `unsupported native member ${member}`);
  }
  const require = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'navigator', 'location', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'DOMException', 'localStorage', 'sessionStorage', 'CustomEvent', 'Event', 'MouseEvent', 'MessageChannel']) {
    if (dom.window[name] !== undefined) Object.defineProperty(globalThis, name, { value: dom.window[name], writable: true, configurable: true });
  }
  const network = [];
  globalThis.fetch = dom.window.fetch = async () => { network.push('fetch'); throw Error('network disabled by fixture'); };
  globalThis.WebSocket = dom.window.WebSocket = class { constructor() { network.push('WebSocket'); throw Error('network disabled by fixture'); } };
  const shared = await import(pathToFileURL(join(moduleDir, 'app-shared-601019a330d7.js')));
  const initial = await import(pathToFileURL(join(moduleDir, 'app-initial-18b189e867e7.js')));
  shared.Alt(); shared.iTt(); initial.t7n(); initial.b5n(); initial.I6n();
  initial.Gcr({}, () => {}); // fixture-only persisted-state sink
  const React = shared.pWt(), jsx = shared.JFt(), nativeDom = shared.GFt(), domApi = shared.KFt();
  const Scope = shared.fTt, read = shared.oTt;
  assert.equal(React.version, '19.2.7');
  const runtime = createDesktopLayoutRuntime({ React, jsx, enabled: true });
  const root = nativeDom.createRoot(document.getElementById('root'));
  const a = { threadId: 'fake-thread-A', hostId: 'fake-host-A', clientThreadId: 'local:fake-thread-A' };
  const b = { threadId: 'fake-thread-B', hostId: 'fake-host-B', clientThreadId: 'local:fake-thread-B' };
  const pending = [], delivered = [], lifetimes = { giMounted: 0, giUnmounted: 0, composerMounted: 0, composerUnmounted: 0 };
  const snapshot = () => ({ thread: read(initial.B5n).value, route: read(initial.p5n).value, composer: read(initial.w6n).value });
  function Identity() {
    const { thread, route, composer } = snapshot();
    const resolved = read(shared.klt).get(initial.q5n, initial.Y5n(route.conversationId));
    return jsx.jsx('span', { 'data-client': thread.clientThreadId, 'data-thread': route.conversationId, 'data-host': route.hostId, 'data-composer': composer.conversationId, 'data-resolved': resolved });
  }
  function MockComposer() {
    const { thread, route, composer } = snapshot();
    React.useEffect(() => { lifetimes.composerMounted++; return () => { lifetimes.composerUnmounted++; }; }, []);
    return jsx.jsx('button', { 'data-mock-composer': '', onClick: () => {
      const target = { threadId: composer.conversationId, hostId: route.hostId, clientThreadId: thread.clientThreadId };
      pending.push(() => delivered.push(target));
    }, children: 'synthetic send' });
  }
  function MockGI({ renderLayout, showComposer }) {
    React.useEffect(() => { lifetimes.giMounted++; return () => { lifetimes.giUnmounted++; }; }, []);
    return renderLayout({ content: jsx.jsx(Identity, {}), footer: showComposer ? jsx.jsx(MockComposer, {}) : null });
  }
  function draw(target, showComposer) {
    const thread = { clientThreadId: target.clientThreadId, routeConversationId: target.threadId };
    const route = { pathname: `/local/${encodeURIComponent(target.threadId)}`, routeTemplate: '/local/:conversationId', search: `?${new URLSearchParams({ hostId: target.hostId })}`, routeKind: 'local-thread', conversationId: target.threadId, hostId: target.hostId, projectContext: null };
    const composer = initial.O6n(target.threadId, 'main', target.threadId, target.clientThreadId);
    const child = jsx.jsx(runtime.DesktopLayoutBoundary, { component: MockGI, originalProps: { showComposer } });
    const tree = jsx.jsx(Scope, { scope: shared.klt, value: {}, children:
      jsx.jsx(Scope, { scope: initial.B5n, value: thread, children:
        jsx.jsx(Scope, { scope: initial.p5n, value: route, children:
          jsx.jsx(Scope, { scope: initial.w6n, value: composer, children: child }) }) }) });
    domApi.flushSync(() => root.render(tree));
  }
  function identity(target) {
    const el = document.querySelector('[data-client]');
    assert.ok(el);
    assert.equal(el.dataset.client, target.clientThreadId);
    assert.equal(el.dataset.thread, target.threadId);
    assert.equal(el.dataset.host, target.hostId);
    assert.equal(el.dataset.composer, target.threadId);
    assert.equal(el.dataset.resolved, target.clientThreadId);
  }
  draw(a, true); identity(a);
  assert.equal(document.querySelectorAll('[data-chatgpt-desktop-footer] [data-mock-composer]').length, 1);
  document.querySelector('[data-mock-composer]').click();
  draw(b, true); identity(b);
  document.querySelector('[data-mock-composer]').click();
  assert.deepEqual(lifetimes, { giMounted: 1, giUnmounted: 0, composerMounted: 1, composerUnmounted: 0 });
  pending[1](); pending[0]();
  assert.deepEqual(delivered, [b, a]);
  draw(b, false);
  assert.equal(document.querySelector('[data-chatgpt-desktop-footer]'), null);
  assert.equal(document.querySelector('[data-mock-composer]'), null);
  assert.throws(() => runtime.requestReadonlyPane(b), { code: 'DESKTOP_READONLY_PANE_UNVERIFIED' });
  assert.deepEqual(network, []);
  domApi.flushSync(() => root.unmount());
  assert.equal(lifetimes.giUnmounted, 1);
  assert.equal(lifetimes.composerUnmounted, 1);
  dom.window.close();
  return { react: React.version, officialModules: Object.keys(hashes).length, scopes: 3, fakeTargets: 2, mockSubmissions: 2, networkAttempts: network.length };
}

if (process.argv.includes('--synthetic-scopes-child')) {
  try {
    const result = await runSyntheticScopes();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    // The original app schedules background timers; this one-shot child owns
    // only its fixture and is not allowed to persist after its assertions.
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exit(1);
  }
} else {
  test('official React and scopes preserve a synthetic active target and null footer', { skip: !moduleDir && 'Set CHATGPT_DESKTOP_TEST_MAC_MODULE_DIR to the verified Mac modules' }, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--synthetic-scopes-child'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.deepEqual(JSON.parse(result.stdout), { react: '19.2.7', officialModules: 3, scopes: 3, fakeTargets: 2, mockSubmissions: 2, networkAttempts: 0 });
  });
}
