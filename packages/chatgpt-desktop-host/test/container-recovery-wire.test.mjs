import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isContainerRecoveryQuery, isContainerRecoveryReply, requireIdleContainerRecoveryReply } from '../src/container-recovery-wire.mjs';

test('recovery wire accepts only the fixed query and its exact identity-bound response', () => {
  const profileId = randomUUID(), generation = randomUUID(), nonce = randomUUID();
  const query = { v: 1, type: 'recoveryStatus', nonce };
  const response = { v: 1, type: 'recoveryStatus', nonce, profileId, generation,
    views: { live: 0, pending: 0, destroying: 0 }, provisional: 0, pendingOutput: false, ready: true };
  assert.equal(isContainerRecoveryQuery(query), true);
  assert.equal(isContainerRecoveryReply(response, { nonce, profileId, generation }), true);
  for (const bad of [
    { ...response, nonce: randomUUID() }, { ...response, profileId: randomUUID() },
    { ...response, payload: 'unexpected' }, { ...response, views: { ...response.views, live: 17 } },
    { ...response, pendingOutput: 0 },
  ]) assert.equal(isContainerRecoveryReply(bad, { nonce, profileId, generation }), false);
  assert.equal(isContainerRecoveryQuery({ ...query, scope: {} }), false);
  assert.equal(isContainerRecoveryQuery({ ...query, nonce: 'bad' }), false);
});

test('recovery is denied while any old view, pending create, pending destruction or output exists', () => {
  const profileId = randomUUID(), generation = randomUUID(), nonce = randomUUID();
  const identity = { nonce, profileId, generation };
  const reply = { v: 1, type: 'recoveryStatus', nonce, profileId, generation,
    views: { live: 0, pending: 0, destroying: 0 }, provisional: 0, pendingOutput: false, ready: true };
  assert.equal(requireIdleContainerRecoveryReply(reply, identity), true);
  for (const field of ['live', 'pending', 'destroying']) {
    assert.throws(() => requireIdleContainerRecoveryReply({ ...reply, views: { ...reply.views, [field]: 1 } }, identity),
      { code: 'CONTAINER_RECOVERY_VIEWS_ACTIVE' });
  }
  assert.throws(() => requireIdleContainerRecoveryReply({ ...reply, provisional: 1 }, identity),
    { code: 'CONTAINER_RECOVERY_VIEWS_ACTIVE' });
  assert.throws(() => requireIdleContainerRecoveryReply({ ...reply, pendingOutput: true }, identity),
    { code: 'CONTAINER_RECOVERY_STATUS_UNAVAILABLE' });
  assert.throws(() => requireIdleContainerRecoveryReply({ ...reply, ready: false }, identity),
    { code: 'CONTAINER_RECOVERY_STATUS_UNAVAILABLE' });
});
