import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWireValue } from '../../packages/chatgpt-desktop-host/src/wire-value.mjs';
import { createAccountAppHostProbe } from './chatgpt-desktop-account-apphost-probe.mjs';

const wire = value => JSON.parse(encodeWireValue(value));
const frame = (type, portId, data) => wire({ type, portId, data });
const push = (port, base, path, args) => frame('portPost', port, ['push', ['pipeline', base, path, ...(args ? [args] : [])]]);
const pull = (port, ref) => frame('portPost', port, ['pull', ref]);
const resolve = (port, ref, value) => frame('portMessage', port, ['resolve', ref, value]);

function connect(probe, port = 'app-host-1') {
  probe.observe('sent', wire({ type: 'openPort', portId: port, name: 'app-host' }), 'before', 0);
  probe.observe('sent', push(port, 0, ['services']), 'before', 1);
  probe.observe('sent', pull(port, 1), 'before', 2);
  probe.observe('received', resolve(port, 1, { settings: ['export', -21], secret: 'not retained' }), 'before', 3);
}

test('attributes only the fixed settings methods in the observed services scope', () => {
  const p = createAccountAppHostProbe();
  connect(p);
  p.observe('sent', push('app-host-1', -99, ['write'], ['other', 'sensitive']), 'after', 4);
  p.observe('sent', push('app-host-1', -21, ['readAll']), 'before', 10);
  p.observe('sent', pull('app-host-1', 3), 'before', 11);
  p.observe('received', resolve('app-host-1', 3, { someAccountValue: 'secret' }), 'after', 21);
  p.observe('sent', push('app-host-1', -21, ['write'], ['conversationDetailMode', 'STEPS_COMMANDS']), 'after', 30);
  p.observe('sent', pull('app-host-1', 4), 'after', 31);
  p.observe('received', frame('portMessage', 'app-host-1', ['reject', 4, { message: 'private' }]), 'after', 62);
  p.observe('sent', push('app-host-1', -21, ['read'], ['conversationDetailMode']), 'after', 70);
  const s = p.snapshot();
  assert.equal(s.reliable, true);
  assert.equal(s.servicesResolved, 1);
  assert.deepEqual(s.before.readAll, { started: 1, pulled: 1, resolved: 1, rejected: 0, pending: 0, maxMs: 11 });
  assert.deepEqual(s.after.write, { started: 1, pulled: 1, resolved: 0, rejected: 1, pending: 0, maxMs: 32 });
  assert.deepEqual(s.after.read, { started: 1, pulled: 0, resolved: 0, rejected: 0, pending: 1, maxMs: 0 });
  assert.doesNotMatch(JSON.stringify(s), /secret|sensitive|STEPS_COMMANDS|app-host|-21|conversationDetailMode|private/);
});

test('never correlates across ports or recognizes other settings arguments', () => {
  const p = createAccountAppHostProbe(); connect(p, 'app-host-1');
  p.observe('sent', wire({ type: 'openPort', portId: 'app-host-2', name: 'app-host' }), 'after', 5);
  p.observe('sent', push('app-host-2', -21, ['write'], ['conversationDetailMode', 'x']), 'after', 6);
  p.observe('sent', push('app-host-1', -21, ['write'], ['otherKey', 'x']), 'after', 7);
  p.observe('received', resolve('app-host-2', 2, 'anything'), 'after', 8);
  const s = p.snapshot();
  assert.equal(s.after.write.started, 0);
  assert.equal(s.reliable, true);
});

test('a missing frame or budget exhaustion makes subsequent correlation explicitly unknown', () => {
  const p = createAccountAppHostProbe({ maxPending: 1 }); connect(p);
  p.observe('sent', push('app-host-1', -21, ['write'], ['conversationDetailMode', 'x']), 'after', 4);
  p.observe('sent', push('app-host-1', -21, ['read'], ['conversationDetailMode']), 'after', 5);
  let s = p.snapshot();
  assert.equal(s.reliable, false);
  assert.equal(s.reason, 'budget');
  assert.equal(s.after.write.pending, null);
  assert.equal(s.after.read.started, 0);
  p.gap();
  s = p.snapshot(); assert.equal(s.reliable, false);
});

test('an observed transport gap invalidates method-to-reply inference', () => {
  const p = createAccountAppHostProbe(); connect(p); p.gap();
  p.observe('sent', push('app-host-1', -21, ['write'], ['conversationDetailMode', 'x']), 'after', 4);
  const s = p.snapshot(); assert.equal(s.reliable, false); assert.equal(s.reason, 'gap');
  assert.equal(s.after.write.started, 0); assert.equal(s.after.write.pending, null);
});

test('a reply without an observed pull is not counted as a completed method', () => {
  const p = createAccountAppHostProbe(); connect(p);
  p.observe('sent', push('app-host-1', -21, ['write'], ['conversationDetailMode', 'x']), 'after', 4);
  p.observe('received', resolve('app-host-1', 2, null), 'after', 5);
  const s = p.snapshot(); assert.equal(s.after.write.resolved, 0); assert.equal(s.reliable, false); assert.equal(s.reason, 'protocol');
});

test('closing a port with an outstanding observed call leaves its outcome unknown', () => {
  const p = createAccountAppHostProbe(); connect(p);
  p.observe('sent', push('app-host-1', -21, ['write'], ['conversationDetailMode', 'x']), 'after', 4);
  p.observe('received', wire({ type: 'portClosed', portId: 'app-host-1' }), 'after', 5);
  const s = p.snapshot(); assert.equal(s.reliable, false); assert.equal(s.reason, 'closed');
  assert.equal(s.after.write.pending, null); assert.equal(s.after.write.resolved, 0);
});

test('reacquiring the same services export does not change scope', () => {
  const p = createAccountAppHostProbe(); connect(p);
  p.observe('sent', push('app-host-1', 0, ['services']), 'before', 4);
  p.observe('sent', pull('app-host-1', 2), 'before', 5);
  p.observe('received', resolve('app-host-1', 2, { settings: ['export', -21] }), 'before', 6);
  const s = p.snapshot(); assert.equal(s.reliable, true); assert.equal(s.servicesResolved, 2);
});
