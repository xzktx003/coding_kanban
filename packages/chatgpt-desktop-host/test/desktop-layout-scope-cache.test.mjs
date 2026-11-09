import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDesktopLayoutAssetAdapter, DESKTOP_LAYOUT_REFERENCE } from '../src/desktop-layout-adapter.mjs';

const reviewedPage = process.env.CHATGPT_DESKTOP_TEST_MAC_PAGE;

test('Fl refreshes the committed scope when any original identity changes', { skip: !reviewedPage && 'Set CHATGPT_DESKTOP_TEST_MAC_PAGE to the reviewed Mac member' }, () => {
  const adapted = createDesktopLayoutAssetAdapter({ archiveSha256: DESKTOP_LAYOUT_REFERENCE.archiveSha256 })
    .adapt({ member: DESKTOP_LAYOUT_REFERENCE.pageMember, body: readFileSync(reviewedPage) }).body.toString('utf8');
  assert.match(adapted, /function Fl\(e\)\{let t=\(0,Hl\.c\)\(103\),\{clientThreadId:n,conversationId:r,/);
  const begin = 'let oe=!u,ce=!u&&!_,K=c&&ee&&!u,le;';
  const end = 'let ue=le,de;';
  const start = adapted.indexOf(begin), stop = adapted.indexOf(end, start);
  assert.ok(start >= 0 && stop > start && adapted.indexOf(begin, start + 1) === -1);
  const execute = new Function('t','Q','go','Fs','As','__chatgptDesktopLayoutBoundary','R','H','B','g','u','a','ie','ae','U','W','re','c','ee','_','b','r','n', adapted.slice(start, stop) + 'return le;');
  const jsx = { jsx: (component, props) => ({ component, props }) };
  const stable = [jsx, 'provider', 'value', 'component', 'boundary', 'open-agent', 'open-pr', 'open-subs', false, false, null, null, null, true, true, true, true, true, false];
  const cache = [];
  let node = execute(cache, ...stable, 'local', 'thread-a', 'client-a');
  assert.deepEqual(node.props.children.props.nativeScope, { hostId: 'local', conversationId: 'thread-a', clientThreadId: 'client-a' });
  for (const [hostId, conversationId, clientThreadId] of [['remote','thread-a','client-a'], ['remote','thread-b','client-a'], ['remote','thread-b','client-b']]) {
    const next = execute(cache, ...stable, hostId, conversationId, clientThreadId);
    assert.notEqual(next, node);
    assert.deepEqual(next.props.children.props.nativeScope, { hostId, conversationId, clientThreadId });
    node = next;
  }
  assert.equal(execute(cache, ...stable, 'remote', 'thread-b', 'client-b'), node);
});
