import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedRefreshHistory } from '../../../tests/e2e/codex-refresh-history.mjs';
const threadId = '019aabcd-1234-7890-abcd-0123456789ab', cwd = '/tmp/ck-private/project';
const completed = (id, text) => ({id, status: 'completed', items: [{type: 'agentMessage', text}]});
test('history evidence follows the exact latest completed native reply instead of requiring an evicted first turn', () => {
  const thread = {id: threadId, cwd, turns: [completed('first', 'REFRESH_PROFILE_SEED'), completed('latest', 'REFRESH_IPHONE_ACCEPTED_1')]};
  assert.deepEqual(expectedRefreshHistory(thread, {threadId, cwd}), {token: 'REFRESH_IPHONE_ACCEPTED_1', turnId: 'latest', turnCount: 2});
  assert.equal(expectedRefreshHistory(thread, {threadId, cwd, turnId: 'latest'}).turnId, 'latest');
  assert.throws(() => expectedRefreshHistory(thread, {threadId, cwd, turnId: 'first'}));
});
test('history oracle rejects another target, uncontrolled text, unknown completion and excessive fixture history', () => {
  const base = {id: threadId, cwd, turns: [completed('first', 'REFRESH_PROFILE_SEED')]};
  for (const thread of [{...base, id: 'wrong'}, {...base, cwd: '/another/project'}, {...base, turns: [completed('first', 'private unrelated body')]},
    {...base, turns: [{...completed('first', 'REFRESH_PROFILE_SEED'), status: 'inProgress'}]},
    {...base, turns: Array.from({length: 33}, (_, i) => completed(String(i), 'REFRESH_PROFILE_SEED'))}]) {
    assert.throws(() => expectedRefreshHistory(thread, {threadId, cwd}), error => !error.message.includes('private unrelated body'));
  }
});
