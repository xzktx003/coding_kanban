import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createBrowserComposerCapability } from '../src/browser-composer-capability.mjs';

// Real React commits run without a browser, native connection, or account.
const requireWeb = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const React = requireWeb('react');
const { createRoot } = requireWeb('react-dom/client');
const { JSDOM } = requireWeb('jsdom');
const scope = { profileId: '11111111-1111-4111-8111-111111111111',
  generation: '22222222-2222-4222-8222-222222222222',
  viewId: '33333333-3333-4333-8333-333333333333' };

async function fixture(t) {
  const dom = new JSDOM('<!doctype html><div id="root"></div><div id="editors"></div>');
  const saved = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const root = createRoot(document.getElementById('root'));
  const Provider = React.createContext(null);
  const targets = ['a', 'b'].map(name => ({ hostId: 'local', conversationId: 'thread-' + name,
    clientThreadId: 'client-' + name, isMain: true }));
  const controllers = targets.map(() => {
    const node = document.createElement('div');
    document.getElementById('editors').append(node);
    return { isInputActive: true, view: { isDestroyed: false, editable: true, dom: node } };
  });
  function lease() {
    let token = Object.freeze({});
    const listeners = new Set();
    return { getSnapshot: () => token, isCurrent: value => token !== null && value === token,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      notify() { for (const fn of [...listeners]) fn(); },
      rotate() { token = Object.freeze({}); this.notify(); },
      hide() { token = null; this.notify(); } };
  }
  const mode = lease(), pane = lease();
  const capability = createBrowserComposerCapability({ window, React,
    useComposerController: () => React.useContext(Provider), documentScope: scope, modeActivation: mode });
  let mounted = true, selected = 0, second = false;
  let currentScope = targets[0];
  const render = () => root.render(React.createElement(React.Fragment, null,
    ...(mounted ? [React.createElement(Provider.Provider, { key: 'main', value: controllers[selected] },
      React.createElement(capability.Registrar, { scope: currentScope, paneLease: pane }))] : []),
    ...(second ? [React.createElement(Provider.Provider, { key: 'second', value: controllers[1] },
      React.createElement(capability.Registrar, { scope: targets[1], paneLease: pane }))] : [])));
  const commit = async fn => React.act(async () => { fn?.(); render(); });
  t.after(async () => {
    await React.act(async () => root.unmount());
    capability.dispose();
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await commit();
  return { capability, mode, pane, controllers, targets, commit,
    setScope(value) { currentScope = value; },
    select(index) { selected = index; currentScope = targets[index]; },
    mounted(value) { mounted = value; },
    multiple(value) { second = value; } };
}

test('ordinary React commits retain the pending attachment while revoking the editing token', async t => {
  const f = await fixture(t), c = f.capability;
  // The fallback reproduces the previous picker wiring on the red run.
  const capture = c.captureAttachmentScope ?? c.captureScope;
  const current = c.isAttachmentScopeCurrent ?? c.isScopeCurrent;
  const editing = c.captureScope(), attachment = capture();
  assert.ok(editing && attachment);
  await f.commit();
  assert.equal(c.isScopeCurrent(editing), false);
  assert.equal(current(attachment), true, 'closing the original picker menu must not discard the same composer selection');
  await f.commit(() => f.setScope({ ...f.targets[0] }));
  assert.equal(current(attachment), true, 'equal target fields in an ordinary render do not issue a new pane authorization');
});

test('attachment leases revoke synchronously on every pane or mode confirmation including equal values', async t => {
  const f = await fixture(t), c = f.capability;
  let token = c.captureAttachmentScope();
  await React.act(async () => {
    f.pane.notify();
    assert.equal(c.isAttachmentScopeCurrent(token), false);
  });
  await f.commit();
  const next = c.captureAttachmentScope();
  assert.ok(next && next !== token);
  token = next;
  await React.act(async () => {
    f.mode.hide();
    assert.equal(c.isAttachmentScopeCurrent(token), false);
    f.mode.rotate();
  });
  await f.commit();
  assert.equal(c.isAttachmentScopeCurrent(token), false);
  assert.ok(c.captureAttachmentScope());
});

test('target or controller changes, ambiguous owners and unmounts never revive old attachment tokens', async t => {
  const f = await fixture(t), c = f.capability;
  let token = c.captureAttachmentScope();
  await f.commit(() => f.setScope({ ...f.targets[0], conversationId: null }));
  assert.equal(c.isAttachmentScopeCurrent(token), false);
  token = c.captureAttachmentScope();
  assert.ok(token);
  await f.commit(() => f.select(1));
  assert.equal(c.isAttachmentScopeCurrent(token), false);
  token = c.captureAttachmentScope();
  await f.commit(() => f.multiple(true));
  assert.equal(c.isAttachmentScopeCurrent(token), false);
  assert.equal(c.captureAttachmentScope(), null);
  await f.commit(() => f.multiple(false));
  token = c.captureAttachmentScope();
  await f.commit(() => f.mounted(false));
  assert.equal(c.isAttachmentScopeCurrent(token), false);
  await f.commit(() => f.mounted(true));
  assert.equal(c.isAttachmentScopeCurrent(token), false);
  assert.ok(c.captureAttachmentScope());
});

test('attachment scope rejects disconnected or inactive original editors without resurrection', async t => {
  const f = await fixture(t), c = f.capability;
  let token = c.captureAttachmentScope();
  const view = f.controllers[0].view, parent = view.dom.parentNode;
  view.dom.remove();
  assert.equal(c.isAttachmentScopeCurrent(token), false);
  parent.append(view.dom);
  assert.equal(c.captureAttachmentScope(), null);
  await f.commit();
  token = c.captureAttachmentScope();
  assert.ok(token);
  f.controllers[0].isInputActive = false;
  assert.equal(c.isAttachmentScopeCurrent(token), false);
  f.controllers[0].isInputActive = true;
  assert.equal(c.captureAttachmentScope(), null);
  c.dispose();
  assert.equal(c.isAttachmentScopeCurrent(token), false);
});

test('replacing the original editor node or its document revokes the attachment', async t => {
  const f = await fixture(t), c = f.capability;
  let token = c.captureAttachmentScope();
  const view = f.controllers[0].view;
  const original = view.dom, replacement = document.createElement('div');
  original.parentNode.append(replacement);
  view.dom = replacement;
  assert.equal(c.isAttachmentScopeCurrent(token), false);
  assert.equal(c.captureAttachmentScope(), null);
  await f.commit();
  token = c.captureAttachmentScope();
  assert.ok(token);
  const another = new JSDOM('<!doctype html><body></body>');
  another.window.document.body.append(view.dom);
  assert.equal(c.isAttachmentScopeCurrent(token), false);
  another.window.close();
});

test('an inactive commit and a controller replacement revoke even when the original target returns before another read', async t => {
  const f = await fixture(t), c = f.capability;
  let token = c.captureAttachmentScope();
  await f.commit(() => f.setScope({ ...f.targets[0], isMain: false }));
  await f.commit(() => f.setScope(f.targets[0]));
  assert.equal(c.isAttachmentScopeCurrent(token), false);
  token = c.captureAttachmentScope();
  await f.commit(() => { f.select(1); f.setScope(f.targets[0]); });
  await f.commit(() => f.select(0));
  assert.equal(c.isAttachmentScopeCurrent(token), false);
});
