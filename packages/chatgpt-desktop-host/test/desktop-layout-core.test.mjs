import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createDesktopLayoutRuntime, readDesktopLayoutConfig } from '../src/desktop-layout-core.mjs';

const require = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const React = require('react');
const jsx = require('react/jsx-runtime');
const { act } = React;

function setupDom(t) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://fixture.invalid/', pretendToBeVisual: true });
  const saved = new Map();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MouseEvent']) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  const flag = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(() => {
    dom.window.close();
    for (const [key, value] of saved) value ? Object.defineProperty(globalThis, key, value) : delete globalThis[key];
    flag ? Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', flag) : delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return root;
}

test('requires an immutable document-scoped layout decision', () => {
  assert.deepEqual(readDesktopLayoutConfig({}), { enabled: false });
  assert.deepEqual(readDesktopLayoutConfig(Object.create({ __chatgptDesktopLayoutEnabled: true })), { enabled: false });
  for (const enabled of [false, true]) {
    const host = {};
    Object.defineProperty(host, '__chatgptDesktopLayoutEnabled', { value: enabled, writable: false, configurable: false });
    assert.deepEqual(readDesktopLayoutConfig(host), { enabled });
    assert.ok(Object.isFrozen(readDesktopLayoutConfig(host)));
  }
  assert.throws(() => readDesktopLayoutConfig(null), { code: 'DESKTOP_LAYOUT_INVALID_CONFIG' });
  assert.throws(() => readDesktopLayoutConfig({ __chatgptDesktopLayoutEnabled: true }), { code: 'DESKTOP_LAYOUT_INVALID_CONFIG' });
  const accessor = {};
  Object.defineProperty(accessor, '__chatgptDesktopLayoutEnabled', { get: () => true });
  assert.throws(() => readDesktopLayoutConfig(accessor), { code: 'DESKTOP_LAYOUT_INVALID_CONFIG' });
  const nonBoolean = {};
  Object.defineProperty(nonBoolean, '__chatgptDesktopLayoutEnabled', { value: 1 });
  assert.throws(() => readDesktopLayoutConfig(nonBoolean), { code: 'DESKTOP_LAYOUT_INVALID_CONFIG' });
});

test('rejects incomplete native runtimes, mutable config, and unverified readonly panes', () => {
  assert.throws(() => createDesktopLayoutRuntime({ React: {}, jsx }), { code: 'DESKTOP_LAYOUT_INVALID_RUNTIME' });
  assert.throws(() => createDesktopLayoutRuntime({ React, jsx: {} }), { code: 'DESKTOP_LAYOUT_INVALID_RUNTIME' });
  assert.throws(() => createDesktopLayoutRuntime({ React, jsx, enabled: 'yes' }), { code: 'DESKTOP_LAYOUT_INVALID_CONFIG' });
  const runtime = createDesktopLayoutRuntime({ React, jsx });
  assert.deepEqual(runtime.getSnapshot(), { enabled: false, readonlyPanes: 'unverified' });
  assert.ok(Object.isFrozen(runtime.getSnapshot()));
  assert.throws(() => runtime.requestReadonlyPane({ hostId: 'fixture', threadId: 'fixture' }), { code: 'DESKTOP_READONLY_PANE_UNVERIFIED' });
  assert.deepEqual(runtime.getSnapshot(), { enabled: false, readonlyPanes: 'unverified' });
  assert.equal(runtime.setEnabled, undefined, 'live replacement of the original composer layout is not supported');
});

test('disabled boundary transparently forwards native GI props', async (t) => {
  const root = setupDom(t);
  const runtime = createDesktopLayoutRuntime({ React, jsx });
  const nativeCallback = () => {};
  const nativeProps = { showComposer: false, isTranscriptVisible: false, shouldResume: false, onStop: nativeCallback };
  let seen;
  function GI(props) { seen = props; return jsx.jsx('div', { 'data-native-default': '' }); }
  await act(async () => { root.render(jsx.jsx(runtime.DesktopLayoutBoundary, { component: GI, originalProps: nativeProps })); });
  assert.ok(document.querySelector('[data-native-default]'));
  assert.equal(document.querySelector('[data-chatgpt-desktop-layout]'), null);
  assert.equal(seen.onStop, nativeCallback);
  assert.equal(seen.showComposer, false);
  assert.equal(seen.isTranscriptVisible, false);
  assert.equal(seen.shouldResume, false);
  assert.equal(Object.hasOwn(seen, 'renderLayout'), false);
  await act(async () => { root.unmount(); });
});

test('pre-enabled active layout preserves native context, GI lifecycle and null footer', async (t) => {
  const root = setupDom(t);
  const runtime = createDesktopLayoutRuntime({ React, jsx, enabled: true });
  assert.deepEqual(runtime.getSnapshot(), { enabled: true, readonlyPanes: 'unverified' });
  const Thread = React.createContext(null);
  const sent = [], seen = [], lifetime = { mounted: 0, unmounted: 0 };
  function Composer() {
    const thread = React.useContext(Thread);
    return jsx.jsx('button', { 'data-native-composer': '', onClick: () => sent.push(thread), children: 'Send' });
  }
  function NativeGI(props) {
    seen.push(props);
    React.useEffect(() => { lifetime.mounted++; return () => { lifetime.unmounted++; }; }, []);
    const content = jsx.jsx('div', { 'data-native-content': '', children: React.useContext(Thread) });
    const footer = props.showComposer ? jsx.jsx(Composer, {}) : null;
    return props.renderLayout ? props.renderLayout({ content, footer }) : jsx.jsxs('main', { 'data-native-default': '', children: [content, footer] });
  }
  const nativeCallback = () => {};
  const nativeProps = { showComposer: true, isTranscriptVisible: true, shouldResume: false, onStop: nativeCallback };
  const draw = (props, thread) => jsx.jsx(Thread.Provider, { value: thread, children: jsx.jsx(runtime.DesktopLayoutBoundary, { component: NativeGI, originalProps: props }) });
  await act(async () => { root.render(draw(nativeProps, 'fixture-A')); });
  assert.ok(document.querySelector('[data-chatgpt-desktop-layout]'));
  assert.equal(document.querySelectorAll('[data-native-composer]').length, 1);
  assert.ok(document.querySelector('[data-chatgpt-desktop-footer] [data-native-composer]'));
  assert.equal(seen.at(-1).onStop, nativeCallback);
  assert.equal(seen.at(-1).shouldResume, false);
  assert.deepEqual(lifetime, { mounted: 1, unmounted: 0 });
  document.querySelector('[data-native-composer]').click();
  assert.deepEqual(sent, ['fixture-A']);

  await act(async () => { root.render(draw({ ...nativeProps, showComposer: false }, 'fixture-B')); });
  assert.equal(seen.at(-1).showComposer, false);
  assert.equal(document.querySelector('[data-native-composer]'), null);
  assert.equal(document.querySelector('[data-chatgpt-desktop-footer]'), null);
  assert.deepEqual(sent, ['fixture-A']);
  assert.throws(() => runtime.requestReadonlyPane({ hostId: 'fixture', threadId: 'fixture-B' }), { code: 'DESKTOP_READONLY_PANE_UNVERIFIED' });

  await act(async () => { root.render(draw(nativeProps, 'fixture-B')); });
  document.querySelector('[data-native-composer]').click();
  assert.deepEqual(sent, ['fixture-A', 'fixture-B']);
  assert.deepEqual(lifetime, { mounted: 1, unmounted: 0 });
  await act(async () => { root.unmount(); });
  assert.deepEqual(lifetime, { mounted: 1, unmounted: 1 });
});

test('a controlled layout reuses the original footer context without changing the native GI', async (t) => {
  const root = setupDom(t), runtime = createDesktopLayoutRuntime({ React, jsx, enabled: true });
  assert.equal(typeof runtime.renderLayout, 'function');
  let lease, seen;
  function Composer() { lease = runtime.useDesktopFooterOwnership(); return jsx.jsx('div', {'data-native-composer': ''}); }
  function GI(props) { seen = props; return props.renderLayout({content: jsx.jsx('div', {'data-native-content': ''}), footer: jsx.jsx(Composer, {})}); }
  const custom = ({content, footer}) => runtime.renderLayout({content: jsx.jsxs('section', {'data-controlled-panes': '', children: [jsx.jsx('aside', {children: 'pane'}), content]}), footer});
  await act(async () => root.render(jsx.jsx(runtime.DesktopLayoutBoundary, {component: GI, originalProps: {shouldResume: false}, renderCustomLayout: custom})));
  assert.ok(document.querySelector('[data-controlled-panes] [data-native-content]'));
  assert.equal(document.querySelectorAll('[data-native-composer]').length, 1);
  assert.ok(document.querySelector('[data-chatgpt-desktop-footer] [data-native-composer]'));
  assert.equal(typeof lease?.getSnapshot, 'function');
  assert.equal(seen.shouldResume, false);
  assert.equal(seen.renderLayout, custom);
  await act(async () => root.unmount());
});

test('preserves an existing native layout and native visibility props', async (t) => {
  const root = setupDom(t);
  const runtime = createDesktopLayoutRuntime({ React, jsx, enabled: true });
  const originalLayout = () => null;
  let seen;
  function GI(props) { seen = props; return null; }
  const draw = originalProps => jsx.jsx(runtime.DesktopLayoutBoundary, { component: GI, originalProps });
  await act(async () => { root.render(draw({ isTranscriptVisible: true, renderLayout: originalLayout })); });
  assert.equal(seen.renderLayout, originalLayout);
  await act(async () => { root.render(draw({ isTranscriptVisible: false, renderLayout: originalLayout })); });
  assert.equal(seen.renderLayout, originalLayout);
  assert.equal(seen.isTranscriptVisible, false);
  await act(async () => { root.unmount(); });
});
