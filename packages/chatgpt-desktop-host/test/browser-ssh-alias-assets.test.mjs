import assert from 'node:assert/strict';
import test from 'node:test';
import {createDesktopSurfaceAssetAdapter} from '../src/desktop-surface-assets.mjs';
import {createBrowserSshAliasAssetAdapter,SSH_ALIAS_ASSET_REFERENCES} from '../src/browser-ssh-alias-assets.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {openWebviewArchive} from '../src/assets.mjs';

test('the explicit SSH discovery recipe admits the exact original settings call site',()=>{
  const adapter=createDesktopSurfaceAssetAdapter({archiveSha256:'bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95',splitPane:true,sshDiscovery:true});
  assert.ok(adapter.members.includes('webview/assets/remote-connections-settings-4dd0ca54883c.js'));
  assert.equal(adapter.members.length,7);
});

test('unknown archives and modified members cannot select the SSH adapter',()=>{
  assert.throws(()=>createBrowserSshAliasAssetAdapter({archiveSha256:'a'.repeat(64)}),{code:'SSH_ALIAS_UNSUPPORTED_ARCHIVE'});
  assert.throws(()=>createDesktopSurfaceAssetAdapter({archiveSha256:SSH_ALIAS_ASSET_REFERENCES[0].archiveSha256,sshDiscovery:'true'}),{code:'DESKTOP_SURFACE_UNSUPPORTED_ARCHIVE'});
  const a=createBrowserSshAliasAssetAdapter({archiveSha256:SSH_ALIAS_ASSET_REFERENCES[0].archiveSha256});
  assert.equal(a.adapt({member:'webview/assets/elsewhere.js',body:Buffer.alloc(0)}),null);
  assert.throws(()=>a.adapt({member:a.members[0],body:Buffer.from('modified')}),{code:'SSH_ALIAS_DIGEST_MISMATCH'});
});

const directory=process.env.CHATGPT_DESKTOP_SSH_ORIGINAL_DIR;
test('both exact original Mac/Linux query call sites select the server read without native commands',{skip:!directory&&'Set CHATGPT_DESKTOP_SSH_ORIGINAL_DIR to independently extracted original members'},async()=>{
  for(const [index,ref]of SSH_ALIAS_ASSET_REFERENCES.entries()){
    const original=await readFile(`${directory}/${index===0?'mac':'linux'}/${ref.member}`);
    const adapter=createBrowserSshAliasAssetAdapter({archiveSha256:ref.archiveSha256}),result=adapter.adapt({member:ref.member,body:original});
    assert.equal(result.originalSha256,ref.originalSha256);assert.equal(result.adaptedSha256,ref.adaptedSha256);
    const fn=/function ys\(\)\{return ([^}]+)\}/.exec(result.body.toString())?.[0];assert.ok(fn);
    let serverCalls=0;const value=await vm.runInNewContext(`(${fn})()`,{__kanbanDiscoverServerSshAliases:async()=>{serverCalls++;return{sshAliases:['server-fixture']};},Kr(){throw Error('native discover must not execute for this server configuration')}});
    assert.deepEqual(Array.from(value.sshAliases),['server-fixture']);assert.equal(serverCalls,1);
    assert.throws(()=>adapter.adapt({member:ref.member,body:result.body}),{code:'SSH_ALIAS_DIGEST_MISMATCH'});
  }
});

test('the checked-in Mac Codex settings UI displays server-discovered aliases through the pinned call site',async t=>{
  const ref=SSH_ALIAS_ASSET_REFERENCES[0];
  const archive=await openWebviewArchive({
    asarPath:fileURLToPath(new URL('../../../third_party/ChatGPT.app/Contents/Resources/app.asar',import.meta.url)),
    sha256:ref.archiveSha256,
  });
  t.after(()=>archive.close());
  const lease=await archive.acquireAsset(ref.member);
  t.after(()=>lease.release());
  const adapter=createBrowserSshAliasAssetAdapter({archiveSha256:ref.archiveSha256});
  const adapted=adapter.adapt({member:ref.member,body:lease.body});
  assert.equal(adapted.originalSha256,ref.originalSha256);
  assert.equal(adapted.adaptedSha256,ref.adaptedSha256);
  const query=/function ys\(\)\{return [^}]+\}/.exec(adapted.body.toString())?.[0];
  assert.ok(query,'the official remote-connection settings query remains present');
  let discovered=0;
  const result=await vm.runInNewContext(`(${query})()`,{
    __kanbanDiscoverServerSshAliases:async()=>{discovered++;return{sshAliases:['server-project-fixture']};},
    Kr(){throw Error('the UI must not inspect the browser or container SSH configuration');},
  });
  assert.deepEqual(Array.from(result.sshAliases),['server-project-fixture']);
  assert.equal(discovered,1);
});
