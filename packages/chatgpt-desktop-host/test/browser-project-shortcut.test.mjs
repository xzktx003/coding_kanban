import test from 'node:test';
import assert from 'node:assert/strict';
import { installProjectOpenShortcut } from '../src/browser-entry.mjs';

function fixture() {
  const listeners = new Set();
  const win = {
    document: { visibilityState: 'visible' },
    addEventListener(type, fn, capture) { assert.equal(type, 'keydown'); assert.equal(capture, true); listeners.add(fn); },
    removeEventListener(type, fn, capture) { assert.equal(type, 'keydown'); assert.equal(capture, true); listeners.delete(fn); },
  };
  const token = {};
  let active = true, original = 0, resolveSend;
  const sent = [];
  const activation = { getSnapshot: () => active ? token : null, isCurrent: value => active && value === token };
  const shortcut = installProjectOpenShortcut({
    window: win, activation,
    sendMessage: message => { sent.push(message); return new Promise(resolve => { resolveSend = resolve; }); },
  });
  listeners.add(() => { original++; });
  function dispatch(changes = {}) {
    const e = {
      isTrusted: true, defaultPrevented: false, isComposing: false, repeat: false,
      ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'o', keyCode: 79,
      stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
      ...changes,
    };
    for (const listener of listeners) { listener(e); if (e.stopped) break; }
    return e;
  }
  return { win, sent, shortcut, dispatch, resolve: () => resolveSend(), setActive: v => { active = v; }, original: () => original };
}

test('one trusted Ctrl/Meta+O uses the original native action and suppresses duplicate handling', async () => {
  const f = fixture();
  const e = f.dispatch();
  assert.equal(e.defaultPrevented, true);
  assert.equal(e.stopped, true);
  assert.deepEqual(f.sent, [{ type: 'electron-add-new-workspace-root-option' }]);
  assert.equal(f.original(), 0);
  const repeatedGesture = f.dispatch({ ctrlKey: false, metaKey: true, key: 'O' });
  assert.equal(repeatedGesture.defaultPrevented, true);
  assert.equal(f.sent.length, 1);
  f.resolve();
  await new Promise(resolve => setImmediate(resolve));
  f.dispatch({ ctrlKey: false, metaKey: true, key: 'O' });
  assert.equal(f.sent.length, 2);
  f.shortcut.dispose();
});

test('hidden, inactive, synthetic, composition, modifiers, ordinary input and prior handlers are not intercepted', () => {
  const cases = [
    { isTrusted: false }, { defaultPrevented: true }, { isComposing: true }, { keyCode: 229 },
    { repeat: true }, { altKey: true }, { shiftKey: true }, { ctrlKey: true, metaKey: true },
    { ctrlKey: false, metaKey: false }, { key: 'p' },
  ];
  for (const change of cases) {
    const f = fixture();
    const e = f.dispatch(change);
    assert.equal(e.stopped, false, JSON.stringify(change));
    assert.equal(f.sent.length, 0, JSON.stringify(change));
    assert.equal(f.original(), 1, JSON.stringify(change));
    f.shortcut.dispose();
  }
  const f = fixture();
  f.win.document.visibilityState = 'hidden';
  assert.equal(f.dispatch().stopped, false);
  f.win.document.visibilityState = 'visible'; f.setActive(false);
  assert.equal(f.dispatch().stopped, false);
  f.setActive(true); f.shortcut.dispose();
  assert.equal(f.dispatch().stopped, false);
  assert.equal(f.sent.length, 0);
});

test('rejection never retries, a fresh gesture may explicitly try again', async () => {
  const listeners = new Set();
  let attempts = 0;
  const token = {};
  const win = { document: { visibilityState: 'visible' }, addEventListener(_t, fn) { listeners.add(fn); }, removeEventListener(_t, fn) { listeners.delete(fn); } };
  const shortcut = installProjectOpenShortcut({window: win, activation: {getSnapshot: () => token, isCurrent: t => t === token}, sendMessage: () => { attempts++; return Promise.reject(new Error('failed')); }});
  const event = () => ({ isTrusted:true, key:'o', keyCode:79, ctrlKey:true, preventDefault(){}, stopImmediatePropagation(){} });
  for (const fn of listeners) fn(event());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 1);
  for (const fn of listeners) fn(event());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2);
  shortcut.dispose();
});
