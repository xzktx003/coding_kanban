import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { openWebviewArchive } from '../src/assets.mjs';
import { adaptCodexRendererAsset } from '../src/renderer-policy.mjs';

const member = 'webview/assets/app-runtime-b179428fcc1e.js';
const original = '8f01cd3d7abe83168a66a85464bb1502f9f1fd1671da1d7840cdcda172956d2a';
const archiveSha = 'bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95';
const sha = body => createHash('sha256').update(body).digest('hex');

test('untargeted members pass through; unknown bytes for the target fail closed', () => {
  assert.equal(adaptCodexRendererAsset({member:'webview/assets/other.js',body:Buffer.from('original')}), null);
  assert.throws(() => adaptCodexRendererAsset({member,body:Buffer.from('different')}), {code:'CODEX_POLICY_DIGEST_MISMATCH'});
});

test('adapts the pinned Mac ASAR effect only for the immutable Codex surface', {
  skip: !process.env.CHATGPT_DESKTOP_TEST_MAC_ASAR && 'Set CHATGPT_DESKTOP_TEST_MAC_ASAR to the exact reviewed Mac archive',
}, async () => {
  const archive = await openWebviewArchive({asarPath:process.env.CHATGPT_DESKTOP_TEST_MAC_ASAR,sha256:archiveSha});
  let asset;
  try {
    asset = await archive.acquireAsset(member);
    assert.equal(sha(asset.body), original);
    const adapted = adaptCodexRendererAsset({member,body:asset.body});
    assert.equal(adapted.originalSha256,original);
    assert.equal(sha(adapted.body),adapted.adaptedSha256);
    assert.equal(adapted.adaptedSha256,'0add79691f44702ef8408a02ef3b71337f55320a832e77b43ce924d64ba98be7');
    assert.equal(sha(asset.body),original);
    const source = adapted.body.toString('utf8');
    const insertion = 'if(globalThis.__kanbanCodexOnlySurface===true)return;';
    assert.equal(source.split(insertion).length,2);
    assert.equal(source.replace(insertion,''),asset.body.toString('utf8'));
    const start = source.indexOf('s=()=>{if(globalThis.__kanbanCodexOnlySurface===true)');
    assert.notEqual(start,-1);
    const end = source.indexOf('})}',start);
    assert.notEqual(end,-1);
    const effect = source.slice(start+2,end+3);
    const calls = [];
    const context = {a:'acct',o:'user',r:false,i:false,n:true,ws:()=>({setAuthorization:value=>calls.push(value)})};
    vm.runInNewContext(`(${effect})()`,{...context,__kanbanCodexOnlySurface:true});
    assert.equal(calls.length,0);
    vm.runInNewContext(`(${effect})()`,context);
    assert.equal(calls.length,1);
    assert.equal(calls[0].accountId,'acct'); assert.equal(calls[0].userId,'user'); assert.equal(calls[0].enabled,true);
  } finally { asset?.release(); await archive.close(); }
});
