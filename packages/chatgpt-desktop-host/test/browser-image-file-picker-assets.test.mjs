import test from 'node:test';
import assert from 'node:assert/strict';
import {realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {openWebviewArchive} from '../src/assets.mjs';
import {createBrowserImageFilePickerAssetAdapter, IMAGE_FILE_PICKER_REFERENCE as ref} from '../src/browser-image-file-picker-assets.mjs';

test('only the exact pinned original picker is adapted and other asset bytes remain untouched', async () => {
  const archive=await openWebviewArchive({asarPath:await realpath(resolve('third_party/ChatGPT.app/Contents/Resources/app.asar')),sha256:ref.archiveSha256});
  try {
    const member=await archive.acquireAsset(ref.member);
    try {
      const adapter=createBrowserImageFilePickerAssetAdapter({archiveSha256:ref.archiveSha256});
      const result=adapter.adapt({member:ref.member,body:member.body});
      assert.equal(result.originalSha256,ref.originalSha256);
      const source=result.body.toString('utf8');
      assert.match(source,/typeof o===`boolean`&&c===void 0&&t===void 0&&a===void 0/);
      assert.match(source,/u\.persistImageFileToTemp/);
      assert.match(source,/u\.pickFiles\(\{kind:c/);
      assert.equal(adapter.adapt({member:'webview/other.js',body:Buffer.from('x')}),null);
      assert.throws(()=>adapter.adapt({member:ref.member,body:Buffer.from('bad')}),{code:'IMAGE_PICKER_DIGEST_MISMATCH'});
    } finally { member.release(); }
  } finally { await archive.close(); }
});

test('unknown archives cannot enable the adaptation',()=>{
  assert.throws(()=>createBrowserImageFilePickerAssetAdapter({archiveSha256:'0'.repeat(64)}),{code:'IMAGE_PICKER_UNSUPPORTED_ARCHIVE'});
});
