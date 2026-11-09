import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';

const method = 'thread/attachment/list';
const threadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sha = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  const writes = [], state = {current: true, threadId}, reads = [];
  const gate = createSharedDaemonRpcGate({
    verifyReadSync(frame) { reads.push(frame.method); return state.current && (frame.method !== method || frame.params.threadId === state.threadId); },
    verifyBindingSync: () => state.current, verifyHistorySync: () => state.current,
    write: encoded => writes.push(encoded),
    desktop: {daemonVersion: '0.166.0', verifyInitializeSync: result => result.codexHome === '/owned/home'},
  });
  gate.write(JSON.stringify({id: 1, method: 'initialize', params: {clientInfo: {name: 'codex_desktop', version: '1'}, capabilities: {experimentalApi: true, requestAttestation: false}}}));
  gate.receive(JSON.stringify({id: 1, result: {userAgent: 'codex_app_server/0.166.0', codexHome: '/owned/home'}}));
  gate.write(JSON.stringify({method: 'initialized', params: {}}));
  return {gate, writes, state, reads};
}
const request = (id = 2, params = {}) => ({id, method, params: {threadId, cursor: null, limit: 100, ...params}});
const attachment = {attachmentType: 'future-attachment-kind', createdAt: 1, id: 'owned-attachment', identityKey: 'owned-key', payload: null};

test('scoped desktop attachment reads preserve native pages, arbitrary JSON payloads, optional cursors and native errors', () => {
  const f = fixture();
  try {
    for (const [index, result] of [
      {data: [attachment]}, {data: [{...attachment, payload: {items: [true, null, 'owned']}}], nextCursor: 'native-cursor'},
      {data: [], nextCursor: null},
    ].entries()) {
      const frame = request(10 + index), encoded = JSON.stringify(frame);
      f.gate.write(encoded);
      assert.equal(f.writes.at(-1), encoded);
      const reply = JSON.stringify({id: frame.id, result});
      assert.equal(f.gate.receive(reply), reply);
    }
    const frame = request(20); f.gate.write(JSON.stringify(frame));
    const failure = JSON.stringify({id: 20, error: {code: -32600, message: 'owned native thread error'}});
    assert.equal(f.gate.receive(failure), failure);
    assert.ok(f.reads.filter(value => value === method).length >= 8, 'the read authority is checked on request and response');
  } finally { f.gate.close(); }
});

test('attachment method expansion cannot acquire another thread or permit sibling mutations and unknown fields', () => {
  for (const variant of ['other-thread', 'revoked-before-write', 'revoked-before-reply', 'params', 'limit', 'add', 'remove', 'owner']) {
    const f = fixture();
    try {
      const frame = request();
      if (variant === 'other-thread') frame.params.threadId = randomUUID();
      if (variant === 'revoked-before-write') f.state.current = false;
      if (variant === 'params') frame.params.cwd = '/not-authorized';
      if (variant === 'limit') frame.params.limit = 101;
      if (variant === 'add') frame.method = 'thread/attachment/add';
      if (variant === 'remove') frame.method = 'thread/attachment/remove';
      if (variant === 'owner') frame.method = 'thread/attachmentOwner/list';
      if (variant === 'revoked-before-reply') {
        f.gate.write(JSON.stringify(frame)); f.state.current = false;
        assert.throws(() => f.gate.receive(JSON.stringify({id: 2, result: {data: []}})), {code: 'SHARED_DAEMON_DENIED'});
      } else {
        assert.throws(() => f.gate.write(JSON.stringify(frame)), {code: 'SHARED_DAEMON_DENIED'});
        assert.equal(f.writes.length, 2);
      }
    } finally { f.gate.close(); }
  }
});

test('malformed attachment results never become an accepted partial page', () => {
  for (const result of [{}, {data: {}}, {data: [], nextCursor: 1}, {data: [{...attachment, createdAt: 1.5}]},
    {data: [{attachmentType: 'owned', createdAt: 1, id: 'owned', identityKey: 'owned'}]},
    {data: [{...attachment, privateExtra: true}]}, {data: [], privateExtra: true}]) {
    const f = fixture();
    try {
      f.gate.write(JSON.stringify(request()));
      assert.throws(() => f.gate.receive(JSON.stringify({id: 2, result})));
    } finally { f.gate.close(); }
  }
});

const originalSource = process.env.CHATGPT_ATTACHMENT_ORIGINAL_APP_SOURCE;
test('the pinned original QQ attachment query sends limit100, follows only native cursors and propagates failures', {
  skip: !originalSource && 'Requires fixed original app-initial source',
}, async () => {
  const source = await readFile(originalSource, 'utf8');
  assert.equal(sha(source), '244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032');
  const a = source.indexOf('function bka(e,t){'), b = source.indexOf('function xka()', a);
  const c = source.indexOf('queryFn:async({signal:t,queryKey:r})=>', b), d = source.indexOf(',staleTime:Ei.ONE_MINUTE', c);
  assert.ok(a >= 0 && b > a && c > b && d > c);
  const wrapper = source.slice(a, b), query = source.slice(c + 'queryFn:'.length, d);
  assert.equal(sha(wrapper), '70b2154bda5eb14c6933a718b9389ee999bc780a07eb3baa01bc5cd29fa0721a');
  assert.equal(sha(query), '0421180bf1dbe1b9d79ab399a66dd9989099926366ac56affbca38c37aafec0c');
  for (const fails of [false, true]) {
    const f = fixture(), seen = [], account = Symbol(), user = Symbol(); let nextId = 100;
    try {
      const scope = {get: key => key === account ? 'owned-account' : 'owned-user'};
      const client = {async sendRequest(rpcMethod, params) {
        seen.push({method: rpcMethod, params}); const id = ++nextId;
        f.gate.write(JSON.stringify({id, method: rpcMethod, params}));
        const reply = fails ? {id, error: {code: -32600, message: 'owned original failure'}} : {id, result: seen.length === 1 ? {data: [attachment], nextCursor: 'opaque-native-cursor'} : {data: []}};
        const received = JSON.parse(f.gate.receive(JSON.stringify(reply)));
        if (received.error) throw Object.assign(new Error(received.error.message), {code: received.error.code});
        return received.result;
      }};
      const bka = new Function('ht', 'Jh', `return (${wrapper});`)(() => false, () => client);
      // Only query-store/resource services are local boundaries. The complete
      // original bka and QQ queryFn execute unchanged, without a model or task.
      const fn = new Function('e', 'n', 'p_', '$', 'gc', 'ht', 'bka', 'Yi', 'kka', 'Cka', 'Mka', `return (${query});`)(
        {hostId: 'kanban-shared-cli', conversationId: threadId}, scope, account, user,
        () => ({u: value => value, d() { if (this.e) throw this.e; }}), () => false, bka,
        {managedWorktrees: {getPendingArchives: () => undefined}}, () => { throw new Error('unexpected archive'); }, () => {}, 'pull_request');
      const result = fn({signal: new AbortController().signal, queryKey: ['thread-attachments', 'owned-account', 'owned-user']});
      if (fails) await assert.rejects(result, {code: -32600});
      else {
        assert.equal(await result, null);
        assert.deepEqual(seen, [{method, params: {threadId, cursor: null, limit: 100}}, {method, params: {threadId, cursor: 'opaque-native-cursor', limit: 100}}]);
      }
    } finally { f.gate.close(); }
  }
});
