import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createDesktopFooterOwnership, createDesktopLayoutRuntime } from '../src/desktop-layout-core.mjs';
import { createDesktopPaneLayout } from '../src/desktop-pane-layout.mjs';

const require = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const React = require('react');
const jsx = require('react/jsx-runtime');
const { act } = React;

const scopeA = Object.freeze({ hostId: 'local', conversationId: 'thread-a', clientThreadId: 'client-a' });
const scopeB = Object.freeze({ hostId: 'local', conversationId: 'thread-b', clientThreadId: 'client-b' });
const target = (paneId, scope, tabKey = 'tab-a') => ({ paneId, tabKey, ...scope });
function selectedLayout() {
  let serial = 0;
  const panes = createDesktopPaneLayout({ idFactory: () => `pane-${++serial}` });
  panes.open('tab-a');
  return { panes, paneId: panes.getSnapshot().activeGroupId };
}

test('a real pane selection change immediately revokes the old footer lease', () => {
  let serial = 0;
  const panes = createDesktopPaneLayout({ idFactory: () => `pane-${++serial}` });
  panes.open('tab-a');
  const paneId = panes.getSnapshot().activeGroupId;
  const owner = createDesktopFooterOwnership();
  const unbind = owner.bindPaneLayout(panes);
  const slot = owner.createSlot();
  slot.commit(paneId);
  assert.equal(owner.confirmTarget({ paneId, tabKey: 'tab-a', ...scopeA }), true);
  const token = slot.lease.getSnapshot();
  assert.ok(token && slot.lease.isCurrent(token, scopeA));
  panes.open('tab-b');
  assert.equal(slot.lease.getSnapshot(), null);
  assert.equal(slot.lease.isCurrent(token, scopeA), false);
  assert.equal(owner.confirmTarget({ paneId, tabKey: 'tab-a', ...scopeA }), false);
  assert.equal(slot.lease.getSnapshot(), null);
  unbind();
});

test('committed Fl scope and pane revision grant and revoke without manual confirmation', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://fixture.invalid/', pretendToBeVisual: true });
  const saved = new Map();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) {
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
  const runtime = createDesktopLayoutRuntime({ React, jsx, enabled: true });
  const { panes, paneId } = selectedLayout();
  runtime.footerOwnership.bindPaneLayout(panes);
  let lease;
  function OriginalComposer() { lease = runtime.useDesktopFooterOwnership(); return null; }
  function OriginalGI({ renderLayout }) { return renderLayout({ content: null, footer: jsx.jsx(OriginalComposer, {}) }); }
  const draw = (scope, revision = panes.getSnapshot().revision, tabKey = 'tab-a', selectionEpoch = 0) => jsx.jsx(runtime.DesktopPaneOwnershipProvider, {
    paneId, tabKey, layoutRevision: revision,
    children: jsx.jsx(runtime.DesktopLayoutBoundary, { component: OriginalGI, originalProps: {}, nativeScope: scope, selectionEpoch }),
  });
  await act(async () => root.render(draw(scopeA)));
  const first = lease.getSnapshot();
  assert.ok(first && lease.isCurrent(first, scopeA));
  panes.open('tab-b');
  assert.equal(lease.isCurrent(first, scopeA), false);
  await act(async () => root.render(draw(scopeB, panes.getSnapshot().revision, 'tab-b')));
  const second = lease.getSnapshot();
  assert.ok(second && lease.isCurrent(second, scopeB));
  assert.equal(lease.isCurrent(second, scopeA), false);
  runtime.footerOwnership.clearTarget();
  assert.equal(lease.getSnapshot(), null);
  await act(async () => root.render(draw(scopeB, panes.getSnapshot().revision, 'tab-b', 1)));
  const reconfirmed = lease.getSnapshot();
  assert.ok(reconfirmed && lease.isCurrent(reconfirmed, scopeB), 'a fresh selection confirmation re-grants the same native identity');
  assert.notEqual(reconfirmed, second);
  await act(async () => root.render(draw(scopeB, panes.getSnapshot().revision - 1, 'tab-b')));
  assert.equal(lease.getSnapshot(), null, 'stale pane revision cannot re-grant');
  await act(async () => root.unmount());
});

test('requires one committed slot for the selected pane and exact native scope', () => {
  const owner = createDesktopFooterOwnership();
  const slot = owner.createSlot();
  const { panes, paneId } = selectedLayout();
  assert.equal(slot.lease.getSnapshot(), null);
  assert.equal(owner.confirmTarget(target(paneId, scopeA)), false, 'an unbound pane model cannot grant');
  owner.bindPaneLayout(panes);
  assert.equal(owner.confirmTarget(target(paneId, scopeA)), true);
  assert.equal(slot.lease.getSnapshot(), null, 'render-time selection alone is not a commit');
  const release = slot.commit(paneId);
  const token = slot.lease.getSnapshot();
  assert.ok(token && Object.isFrozen(token));
  assert.deepEqual(Object.keys(token), [], 'token exposes no identity');
  assert.equal(slot.lease.isCurrent(token, scopeA), true);
  assert.equal(slot.lease.isCurrent(token, scopeB), false);
  assert.equal(slot.lease.isCurrent(token, { ...scopeA, clientThreadId: 'other' }), false);
  assert.equal(slot.lease.isCurrent(token, { ...scopeA, extra: true }), false);
  release();
  assert.equal(slot.lease.getSnapshot(), null);
  assert.equal(slot.lease.isCurrent(token, scopeA), false);
});

test('an explicit pending conversation may own a footer only with its real client identity', () => {
  const owner = createDesktopFooterOwnership();
  const { panes, paneId } = selectedLayout();
  owner.bindPaneLayout(panes);
  const slot = owner.createSlot();
  slot.commit(paneId);
  const pending = { hostId: 'local', conversationId: null, clientThreadId: 'pending-client' };
  assert.equal(owner.confirmTarget(target(paneId, pending)), true);
  const token = slot.lease.getSnapshot();
  assert.ok(token && slot.lease.isCurrent(token, pending));
  assert.equal(slot.lease.isCurrent(token, { hostId: 'local', clientThreadId: 'pending-client' }), false);
  assert.equal(slot.lease.isCurrent(token, { ...pending, conversationId: '' }), false);
  assert.equal(slot.lease.isCurrent(token, { ...pending, conversationId: 'thread-a' }), false);
  assert.equal(owner.confirmTarget(target(paneId, { ...pending, clientThreadId: '' })), false);
  assert.equal(slot.lease.getSnapshot(), null);
  assert.equal(slot.lease.isCurrent(token, pending), false);
});

test('same-value confirmation, invalid scope, and target changes revoke prior leases', () => {
  const owner = createDesktopFooterOwnership();
  const slot = owner.createSlot();
  const { panes, paneId } = selectedLayout();
  owner.bindPaneLayout(panes);
  const changes = [];
  const unsubscribe = slot.lease.subscribe(() => changes.push(slot.lease.getSnapshot()));
  slot.commit(paneId);
  owner.confirmTarget(target(paneId, scopeA));
  const first = slot.lease.getSnapshot();
  owner.confirmTarget(target(paneId, scopeA));
  const second = slot.lease.getSnapshot();
  assert.ok(second && second !== first);
  assert.equal(slot.lease.isCurrent(first, scopeA), false);
  assert.equal(owner.confirmTarget({ ...target(paneId, scopeA), clientThreadId: '' }), false);
  assert.equal(slot.lease.getSnapshot(), null);
  assert.equal(slot.lease.isCurrent(second, scopeA), false);
  owner.confirmTarget(target('other-pane', scopeB));
  assert.equal(slot.lease.getSnapshot(), null, 'old footer is not selected in the new pane');
  let getterCalled = false;
  const bad = { ...target(paneId, scopeA) };
  Object.defineProperty(bad, 'hostId', { enumerable: true, get() { getterCalled = true; return 'local'; } });
  assert.equal(owner.confirmTarget(bad), false);
  assert.equal(getterCalled, false);
  assert.ok(changes.length >= 4);
  unsubscribe();
});

test('ambiguous slots deny access and stale cleanup cannot release a newer slot commit', () => {
  const owner = createDesktopFooterOwnership();
  const { panes, paneId } = selectedLayout();
  owner.bindPaneLayout(panes);
  const a = owner.createSlot(), b = owner.createSlot();
  owner.confirmTarget(target(paneId, scopeA));
  const stale = a.commit(paneId);
  const first = a.lease.getSnapshot();
  const currentCleanup = a.commit(paneId);
  const second = a.lease.getSnapshot();
  assert.ok(second && second !== first);
  stale();
  assert.equal(a.lease.getSnapshot(), second);
  const removeB = b.commit('other-pane');
  assert.equal(a.lease.getSnapshot(), null);
  assert.equal(b.lease.getSnapshot(), null);
  assert.equal(a.lease.isCurrent(second, scopeA), false);
  removeB();
  const third = a.lease.getSnapshot();
  assert.ok(third && third !== second);
  currentCleanup();
  currentCleanup();
  assert.equal(a.lease.getSnapshot(), null);
});

test('subscriptions are independent even when they use the same callback', () => {
  const owner = createDesktopFooterOwnership();
  const { panes, paneId } = selectedLayout();
  owner.bindPaneLayout(panes);
  const slot = owner.createSlot();
  slot.commit(paneId);
  let calls = 0;
  const listener = () => { calls++; };
  const removeFirst = slot.lease.subscribe(listener);
  const removeSecond = slot.lease.subscribe(listener);
  removeFirst();
  owner.confirmTarget(target(paneId, scopeA));
  assert.equal(calls, 1);
  removeSecond();
});

test('late target cleanup cannot revoke a newer same-value confirmation', () => {
  const owner = createDesktopFooterOwnership();
  const { panes, paneId } = selectedLayout();
  owner.bindPaneLayout(panes);
  const slot = owner.createSlot();
  slot.commit(paneId);
  const firstCleanup = owner.commitTarget(target(paneId, scopeA), panes.getSnapshot().revision);
  const first = slot.lease.getSnapshot();
  const secondCleanup = owner.commitTarget(target(paneId, scopeA), panes.getSnapshot().revision);
  const second = slot.lease.getSnapshot();
  assert.ok(second && second !== first);
  firstCleanup();
  assert.equal(slot.lease.getSnapshot(), second);
  assert.equal(slot.lease.isCurrent(first, scopeA), false);
  secondCleanup();
  assert.equal(slot.lease.getSnapshot(), null);
});

test('footer context is committed in the native React tree and revokes when removed', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://fixture.invalid/', pretendToBeVisual: true });
  const saved = new Map();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) {
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
  const runtime = createDesktopLayoutRuntime({ React, jsx, enabled: true });
  const { panes, paneId } = selectedLayout();
  panes.open('tab-b');
  panes.place('tab-b', paneId, 'right');
  const otherPaneId = panes.getSnapshot().activeGroupId;
  panes.focus('tab-a');
  runtime.footerOwnership.bindPaneLayout(panes);
  let lease;
  function OriginalComposer() { lease = runtime.useDesktopFooterOwnership(); return jsx.jsx('div', { 'data-composer': '' }); }
  function OriginalGI({ renderLayout, showComposer }) { return renderLayout({ content: jsx.jsx('div', {}), footer: showComposer ? jsx.jsx(OriginalComposer, {}) : null }); }
  const draw = (id, showComposer = true) => jsx.jsx(runtime.DesktopPaneOwnershipProvider, {
    paneId: id, tabKey: id === paneId ? 'tab-a' : 'tab-b', layoutRevision: panes.getSnapshot().revision,
    children: jsx.jsx(runtime.DesktopLayoutBoundary, { component: OriginalGI, originalProps: { showComposer }, nativeScope: id === paneId ? scopeA : scopeB }),
  });
  assert.equal(lease, undefined);
  await act(async () => root.render(draw(paneId)));
  const first = lease.getSnapshot();
  assert.ok(first && lease.isCurrent(first, scopeA));
  panes.focus('tab-b');
  assert.equal(lease.isCurrent(first, scopeA), false, 'model transition revokes before React commits');
  assert.equal(lease.getSnapshot(), null);
  await act(async () => root.render(draw(otherPaneId)));
  assert.equal(lease.isCurrent(first, scopeA), false);
  const second = lease.getSnapshot();
  assert.ok(second && lease.isCurrent(second, scopeB));
  assert.equal(lease.isCurrent(second, scopeA), false);
  await act(async () => root.render(draw(otherPaneId, false)));
  assert.equal(lease.getSnapshot(), null);
  assert.equal(lease.isCurrent(second, scopeB), false);
  await act(async () => root.unmount());
});
