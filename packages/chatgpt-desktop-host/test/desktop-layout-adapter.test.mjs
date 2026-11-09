import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
  createDesktopLayoutAssetAdapter,
  DESKTOP_LAYOUT_REFERENCE,
} from '../src/desktop-layout-adapter.mjs';

const hash = body => createHash('sha256').update(body).digest('hex');
const { archiveSha256, pageMember, pageSha256 } = DESKTOP_LAYOUT_REFERENCE;
const reviewedPage = process.env.CHATGPT_DESKTOP_TEST_MAC_PAGE;

test('requires the reviewed archive identity and advertises only the reviewed member', () => {
  assert.throws(() => createDesktopLayoutAssetAdapter(), { code: 'DESKTOP_LAYOUT_UNSUPPORTED_ARCHIVE' });
  assert.throws(() => createDesktopLayoutAssetAdapter({ archiveSha256: '0'.repeat(64) }), { code: 'DESKTOP_LAYOUT_UNSUPPORTED_ARCHIVE' });
  const adapter = createDesktopLayoutAssetAdapter({ archiveSha256 });
  assert.deepEqual(adapter.members, [pageMember]);
  assert.ok(Object.isFrozen(adapter));
  assert.ok(Object.isFrozen(adapter.members));
  assert.equal(adapter.adapt({ member: 'webview/assets/other.js', body: Buffer.from('other') }), null);
  assert.throws(() => adapter.adapt({ member: null, body: Buffer.alloc(0) }), { code: 'DESKTOP_LAYOUT_INVALID_MEMBER' });
});

test('does not adapt unrecognized, malformed, or oversized target bytes', () => {
  const adapter = createDesktopLayoutAssetAdapter({ archiveSha256 });
  assert.throws(() => adapter.adapt({ member: pageMember, body: Buffer.from('different vendor build') }), { code: 'DESKTOP_LAYOUT_DIGEST_MISMATCH' });
  assert.throws(() => adapter.adapt({ member: pageMember, body: 'not bytes' }), { code: 'DESKTOP_LAYOUT_INVALID_BODY' });
  assert.throws(() => adapter.adapt({ member: pageMember, body: new Uint8Array(512 * 1024 + 1) }), { code: 'DESKTOP_LAYOUT_RESOURCE_LIMIT' });
});

test('split selection is server-owned and rejects malformed configuration', () => {
  assert.throws(() => createDesktopLayoutAssetAdapter({ archiveSha256, splitPane: 'true' }), { code: 'DESKTOP_LAYOUT_UNSUPPORTED_ARCHIVE' });
  assert.throws(() => createDesktopLayoutAssetAdapter({ archiveSha256, splitPane: null }), { code: 'DESKTOP_LAYOUT_UNSUPPORTED_ARCHIVE' });
});

test('an explicit split recipe changes only the pinned page boundary', { skip: !reviewedPage && 'Set CHATGPT_DESKTOP_TEST_MAC_PAGE to the reviewed Mac member' }, async () => {
  const original = await readFile(reviewedPage);
  const single = createDesktopLayoutAssetAdapter({ archiveSha256 }).adapt({ member: pageMember, body: original });
  const split = createDesktopLayoutAssetAdapter({ archiveSha256, splitPane: true }).adapt({ member: pageMember, body: original });
  assert.equal(single.adaptedSha256, DESKTOP_LAYOUT_REFERENCE.adaptedPageSha256);
  assert.equal(split.adaptedSha256, DESKTOP_LAYOUT_REFERENCE.splitAdaptedPageSha256);
  assert.equal(split.adaptedSha256, hash(split.body));
  assert.match(single.body.toString(), /DesktopSelectedPaneBoundary/);
  assert.match(split.body.toString(), /DesktopSplitPaneBoundary/);
  assert.notEqual(single.adaptedSha256, split.adaptedSha256);
  assert.equal(split.originalSha256, pageSha256);
});

test('adapts only the pinned original page and reports the actual response digest', { skip: !reviewedPage && 'Set CHATGPT_DESKTOP_TEST_MAC_PAGE to the reviewed Mac member' }, async () => {
  const original = await readFile(reviewedPage);
  assert.equal(hash(original), pageSha256);
  const before = Buffer.from(original);
  const result = createDesktopLayoutAssetAdapter({ archiveSha256 }).adapt({ member: pageMember, body: original });
  assert.deepEqual(original, before, 'adapter must not modify archive bytes');
  assert.equal(result.originalSha256, pageSha256);
  assert.equal(result.adaptedSha256, hash(result.body));
  assert.equal(result.adaptedSha256, DESKTOP_LAYOUT_REFERENCE.adaptedPageSha256);
  assert.notEqual(result.adaptedSha256, pageSha256);
  assert.ok(result.body.byteLength < 512 * 1024);
  const text = result.body.toString('utf8');
  assert.match(text, /^import\{DesktopSelectedPaneBoundary as __chatgptDesktopLayoutBoundary\}from"\.\.\/__host\/desktop-selected-pane-browser\.mjs";\n/);
  const parsed = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: result.body, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.equal(text.split('../__host/desktop-selected-pane-browser.mjs').length, 2);
  assert.equal(text.split('__chatgptDesktopLayoutBoundary').length, 3, 'one import and one GI boundary use');
  assert.match(text, /component:As,nativeScope:\{hostId:b,conversationId:r,clientThreadId:n\},originalProps:\{hideWhenCoveredByRightPanel:U/);
  assert.match(text, /showUtilityBar:!1,showComposer:K\}\}/);
});
